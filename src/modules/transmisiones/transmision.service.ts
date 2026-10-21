import type { InferAttributes } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Transmision, TransmisionComentario } from '../../infrastructure/database/models';
import { grupoMiembroRepository, type GrupoMiembroRepository } from '../grupos/grupo-miembro.repository';
import { grupoRepository, type GrupoRepository } from '../grupos/grupo.repository';
import { llamadaService, type GrupoResumen, type LlamadaService, type UsuarioPublico } from '../llamadas/llamada.service';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { privacidadService, type PrivacidadService } from '../privacidad/privacidad.service';
import { seguidorRepository, type SeguidorRepository } from '../seguidores/seguidor.repository';
import { registroTransmisiones, type ContadorEspectadores, type EnVivo } from './transmision.registro';
import {
  transmisionComentarioRepository,
  transmisionRepository,
  type TransmisionComentarioRepository,
  type TransmisionRepository,
} from './transmision.repository';
import type { ComentariosQuery, CrearTransmisionDto, ListarTransmisionesQuery } from './transmision.schemas';

/** Transmisión tal como la recibe el cliente. */
export type TransmisionVista = InferAttributes<Transmision> & {
  anfitrion: UsuarioPublico;
  grupo: GrupoResumen | null;
  /** Conectados ahora mismo (0 si ya terminó). */
  espectadores: number;
  soy_anfitrion: boolean;
};

export interface ComentarioEnVivo {
  id: number;
  transmision_id: number;
  texto: string;
  fecha_creacion: Date;
  usuario: UsuarioPublico;
}

/** Lo que alcanza a ver alguien: a quién sigo, mis grupos y a quién no debo ver (bloqueos). */
interface Alcance {
  usuarioId: number;
  seguidos: Set<number>;
  grupos: Set<number>;
  ocultos: Set<number>;
}

/**
 * Reglas de las transmisiones en vivo (lo que vive en la base). Lo que pasa en tiempo real
 * (espectadores, señales WebRTC, comentarios y reacciones al momento) está en `transmision.senalizacion.ts`.
 *
 * Quién la ve: si es de un grupo, sus miembros activos; si no, quien puede ver las publicaciones del anfitrión
 * (cuenta pública o seguidor aceptado). Nunca con un bloqueo de por medio.
 */
export class TransmisionService extends BaseService<Transmision, TransmisionRepository> {
  constructor(
    repository: TransmisionRepository,
    private readonly comentarios: TransmisionComentarioRepository,
    private readonly llamadas: LlamadaService,
    private readonly grupos: GrupoRepository,
    private readonly miembros: GrupoMiembroRepository,
    private readonly seguidores: SeguidorRepository,
    private readonly privacidad: PrivacidadService,
    private readonly notificaciones: NotificacionService,
    private readonly contador: ContadorEspectadores,
  ) {
    super(repository);
  }

  // ---------- Escritura ----------

  /** Empieza en vivo y avisa a mis seguidores aceptados (o a los miembros del grupo). Una sola a la vez. */
  async iniciar(anfitrionId: number, datos: CrearTransmisionDto): Promise<TransmisionVista> {
    await this.llamadas.perfilActivo(anfitrionId);
    if (datos.grupo_id) {
      if (!(await this.grupos.exists({ id: datos.grupo_id }))) throw new NotFoundError('Grupo');
      if (!(await this.miembros.esMiembroActivo(datos.grupo_id, anfitrionId))) {
        throw new ForbiddenError('Solo los miembros del grupo pueden transmitir en él');
      }
    }
    if (await this.repository.enVivoDe(anfitrionId)) throw new ConflictError('Ya tienes una transmisión en vivo');

    const creada = await this.repository.create({
      anfitrion_id: anfitrionId,
      titulo: datos.titulo,
      grupo_id: datos.grupo_id ?? null,
      inicio: new Date(),
    });
    await this.anunciar(creada);
    return this.detalle(creada.id, anfitrionId);
  }

  /** Guarda el cierre con los totales de lo que pasó en vivo. Devuelve false si ya estaba terminada. */
  async finalizar(id: number, anfitrionId: number, enVivo: EnVivo | undefined): Promise<boolean> {
    const transmision = await this.repository.findByIdOrFail(id, { include: [] });
    this.asegurarDueno(transmision.anfitrion_id, anfitrionId, 'Solo quien transmite puede terminar la transmisión');
    if (transmision.estado === 'terminada') return false;
    await this.repository.update(transmision, {
      estado: 'terminada',
      fin: new Date(),
      max_espectadores: Math.max(transmision.max_espectadores, enVivo?.maximo ?? 0),
      total_espectadores: Math.max(transmision.total_espectadores, enVivo?.vistos.size ?? 0),
      total_reacciones: transmision.total_reacciones + (enVivo?.reacciones ?? 0),
    });
    return true;
  }

  async comentar(transmisionId: number, usuarioId: number, texto: string): Promise<ComentarioEnVivo> {
    const creado = await this.comentarios.create({ transmision_id: transmisionId, usuario_id: usuarioId, texto });
    await this.repository.sumarComentario(transmisionId);
    const completo = await this.comentarios.findByIdOrFail(creado.id);
    return this.presentarComentario(completo);
  }

  // ---------- Consultas ----------

  /** En vivo que puedo ver (las de grupos solo si soy miembro), la más reciente primero. */
  async listar(usuarioId: number, { limit, offset, grupo_id, anfitrion_id }: ListarTransmisionesQuery): Promise<Page<TransmisionVista>> {
    const [todas, alcance] = await Promise.all([this.repository.enVivo({ grupo_id, anfitrion_id }), this.alcance(usuarioId)]);
    const visibles = todas.filter((t) => this.visibleCon(t, alcance));
    return {
      items: visibles.slice(offset, offset + limit).map((t) => this.presentar(t, usuarioId)),
      total: visibles.length,
      limit,
      offset,
    };
  }

  async detalle(id: number, usuarioId: number): Promise<TransmisionVista> {
    return this.presentar(await this.visibleOrFail(id, usuarioId), usuarioId);
  }

  /** Comentarios guardados (el más nuevo primero). */
  async comentariosDe(id: number, usuarioId: number, paginacion: ComentariosQuery): Promise<Page<ComentarioEnVivo>> {
    await this.visibleOrFail(id, usuarioId);
    const page = await this.comentarios.pagina(id, paginacion);
    return { ...page, items: page.items.map((c) => this.presentarComentario(c)) };
  }

  async recientes(id: number, cantidad: number): Promise<ComentarioEnVivo[]> {
    return (await this.comentarios.recientes(id, cantidad)).map((c) => this.presentarComentario(c));
  }

  /** La transmisión si la puede ver (404 / 403 con el motivo). */
  async visibleOrFail(id: number, usuarioId: number): Promise<Transmision> {
    const transmision = await this.repository.findByIdOrFail(id);
    if (transmision.anfitrion_id === usuarioId) return transmision;
    if (await this.privacidad.hayBloqueo(transmision.anfitrion_id, usuarioId)) throw new NotFoundError('Transmisión');
    if (transmision.grupo_id) {
      if (!(await this.miembros.esMiembroActivo(transmision.grupo_id, usuarioId))) {
        throw new ForbiddenError('Solo los miembros del grupo pueden ver esta transmisión');
      }
      return transmision;
    }
    if (!(await this.privacidad.puedeVerPublicacionesDe(transmision.anfitrion_id, usuarioId))) {
      throw new ForbiddenError('Esta cuenta es privada: solo sus seguidores pueden ver la transmisión');
    }
    return transmision;
  }

  /** Para server.ts al arrancar. */
  cerrarHuerfanas(): Promise<number> {
    return this.repository.cerrarHuerfanas();
  }

  // ---------- Apoyo ----------

  /** Notificación 'transmision_en_vivo' a los seguidores aceptados o a los miembros activos del grupo. */
  private async anunciar(transmision: Transmision): Promise<void> {
    const ocultos = new Set(await this.privacidad.idsOcultosPara(transmision.anfitrion_id));
    const destinatarios = transmision.grupo_id
      ? (await this.miembros.findAll({ grupo_id: transmision.grupo_id, estado: 'activo' }, { attributes: ['usuario_id'] })).map((m) => m.usuario_id)
      : (await this.seguidores.findAll({ siguiendo_id: transmision.anfitrion_id, estado: 'aceptado' }, { attributes: ['seguidor_id'] })).map((s) => s.seguidor_id);

    for (const usuarioId of new Set(destinatarios)) {
      if (usuarioId === transmision.anfitrion_id || ocultos.has(usuarioId)) continue;
      await this.notificaciones.notificar({
        usuario_id: usuarioId,
        de_usuario_id: transmision.anfitrion_id,
        tipo: 'transmision_en_vivo',
        mensaje: `está en vivo: «${transmision.titulo}»`,
        entidad_tipo: 'transmision',
        entidad_id: transmision.id,
      });
    }
  }

  private async alcance(usuarioId: number): Promise<Alcance> {
    const [seguidos, grupos, ocultos] = await Promise.all([
      this.seguidores.findAll({ seguidor_id: usuarioId, estado: 'aceptado' }, { attributes: ['siguiendo_id'] }).then((f) => f.map((s) => s.siguiendo_id)),
      this.miembros.gruposActivosDe(usuarioId),
      this.privacidad.idsOcultosPara(usuarioId),
    ]);
    return { usuarioId, seguidos: new Set(seguidos), grupos: new Set(grupos), ocultos: new Set(ocultos) };
  }

  /** Misma regla que `visibleOrFail`, en memoria (para el listado). */
  private visibleCon(t: Transmision, alcance: Alcance): boolean {
    if (t.anfitrion_id === alcance.usuarioId) return true;
    if (alcance.ocultos.has(t.anfitrion_id)) return false;
    if (t.grupo_id) return alcance.grupos.has(t.grupo_id);
    return !t.anfitrion?.cuenta_privada || alcance.seguidos.has(t.anfitrion_id);
  }

  private presentar(t: Transmision, usuarioId: number): TransmisionVista {
    const datos = t.toJSON() as InferAttributes<Transmision> & { anfitrion: UsuarioPublico & { cuenta_privada?: boolean }; grupo?: GrupoResumen | null };
    const { cuenta_privada: _privada, ...anfitrion } = datos.anfitrion;
    return {
      ...datos,
      anfitrion,
      grupo: datos.grupo ?? null,
      espectadores: t.estado === 'en_vivo' ? this.contador.espectadores(t.id) : 0,
      soy_anfitrion: t.anfitrion_id === usuarioId,
    };
  }

  private presentarComentario(c: TransmisionComentario): ComentarioEnVivo {
    return {
      id: c.id,
      transmision_id: c.transmision_id,
      texto: c.texto,
      fecha_creacion: c.fecha_creacion,
      usuario: c.usuario!.toJSON() as UsuarioPublico,
    };
  }
}

export const transmisionService = new TransmisionService(
  transmisionRepository,
  transmisionComentarioRepository,
  llamadaService,
  grupoRepository,
  grupoMiembroRepository,
  seguidorRepository,
  privacidadService,
  notificacionService,
  registroTransmisiones,
);
