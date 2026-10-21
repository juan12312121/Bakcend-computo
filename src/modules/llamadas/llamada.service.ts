import type { InferAttributes, Sequelize } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import {
  sequelize,
  type EstadoLlamada,
  type EstadoParticipante,
  type Grupo,
  type Llamada,
  type TipoLlamada,
  type Usuario,
} from '../../infrastructure/database/models';
import { grupoMiembroRepository, type GrupoMiembroRepository } from '../grupos/grupo-miembro.repository';
import { grupoRepository, type GrupoRepository } from '../grupos/grupo.repository';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { privacidadService, type PrivacidadService } from '../privacidad/privacidad.service';
import { ATRIBUTOS_USUARIO_PUBLICO, usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { configuracionIce, type ConfiguracionIce } from './ice';
import {
  ATRIBUTOS_GRUPO_LLAMADA,
  llamadaParticipanteRepository,
  llamadaRepository,
  type LlamadaParticipanteRepository,
  type LlamadaRepository,
} from './llamada.repository';
import type { HistorialQuery, IniciarLlamadaDto } from './llamada.schemas';

export type UsuarioPublico = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]>;
export type GrupoResumen = Pick<InferAttributes<Grupo>, (typeof ATRIBUTOS_GRUPO_LLAMADA)[number]>;

/** A quién suena una llamada nueva. */
export interface DestinoLlamada {
  destinatarios: UsuarioPublico[];
  grupo: GrupoResumen | null;
}

/** Fila del historial (GET /llamadas). */
export interface LlamadaHistorial {
  id: number;
  tipo: TipoLlamada;
  estado: EstadoLlamada;
  /** saliente: la hice yo · entrante: me llamaron. */
  direccion: 'saliente' | 'entrante';
  /** Cómo me fue a mí: unido/salio (contesté), perdida, rechazo, invitado (sigue sonando). */
  mi_estado: EstadoParticipante;
  /** En una llamada 1 a 1, la otra persona (null en las de grupo). */
  otro: UsuarioPublico | null;
  grupo: GrupoResumen | null;
  iniciador: UsuarioPublico;
  inicio: Date | null;
  fin: Date | null;
  duracion_seg: number;
  max_participantes: number;
  fecha_creacion: Date;
}

const publico = (u: Usuario): UsuarioPublico => {
  const datos = u.get({ plain: true }) as InferAttributes<Usuario>;
  return Object.fromEntries(ATRIBUTOS_USUARIO_PUBLICO.map((c) => [c, datos[c]])) as UsuarioPublico;
};

const grupoResumen = (g: Grupo): GrupoResumen => {
  const datos = g.get({ plain: true }) as InferAttributes<Grupo>;
  return Object.fromEntries(ATRIBUTOS_GRUPO_LLAMADA.map((c) => [c, datos[c]])) as GrupoResumen;
};

const ETIQUETA_TIPO: Record<TipoLlamada, string> = { audio: 'llamada', video: 'videollamada' };

/**
 * Reglas y registro de las llamadas (lo que vive en la base). La parte en tiempo real
 * (quién está sonando, quién está dentro, reenviar SDP/ICE) está en `llamada.senalizacion.ts`.
 */
export class LlamadaService extends BaseService<Llamada, LlamadaRepository> {
  constructor(
    repository: LlamadaRepository,
    private readonly participantes: LlamadaParticipanteRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly grupos: GrupoRepository,
    private readonly miembros: GrupoMiembroRepository,
    private readonly privacidad: PrivacidadService,
    private readonly notificaciones: NotificacionService,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  // ---------- Permisos ----------

  /** Datos públicos de una cuenta activa y sin suspender (el JWT del socket no revisa eso). */
  async perfilActivo(usuarioId: number): Promise<UsuarioPublico> {
    const usuario = await this.usuarios.findById(usuarioId, { attributes: [...ATRIBUTOS_USUARIO_PUBLICO, 'activo', 'suspendido'] });
    if (!usuario || !usuario.activo) throw new UnauthorizedError('Tu cuenta no está activa');
    if (usuario.suspendido) throw new ForbiddenError('Tu cuenta está suspendida');
    return publico(usuario);
  }

  /**
   * A quién le suena la llamada:
   * - a un usuario: que exista y esté activo, sin bloqueo en ningún sentido; si su cuenta es privada,
   *   solo si uno lo sigue o él lo sigue a uno (aceptado).
   * - a un grupo: solo miembros activos; suena a los demás miembros activos (sin bloqueados).
   */
  async destinoDe(iniciadorId: number, { usuario_id: usuarioId, grupo_id: grupoId }: Pick<IniciarLlamadaDto, 'usuario_id' | 'grupo_id'>): Promise<DestinoLlamada> {
    if (usuarioId !== undefined) return { destinatarios: [await this.destinatarioDirecto(iniciadorId, usuarioId)], grupo: null };
    if (grupoId === undefined) throw new BadRequestError('Indica a quién llamar');

    const grupo = await this.grupos.findById(grupoId, { attributes: [...ATRIBUTOS_GRUPO_LLAMADA] });
    if (!grupo) throw new NotFoundError('Grupo');
    if (!(await this.miembros.esMiembroActivo(grupoId, iniciadorId))) throw new ForbiddenError('Solo los miembros del grupo pueden llamar al grupo');

    const ocultos = new Set(await this.privacidad.idsOcultosPara(iniciadorId));
    const filas = await this.miembros.findAll({ grupo_id: grupoId, estado: 'activo' }, { attributes: ['usuario_id'] });
    const ids = filas.map((f) => f.usuario_id).filter((id) => id !== iniciadorId && !ocultos.has(id));
    const usuarios = ids.length
      ? await this.usuarios.findAll({ id: ids, activo: true, suspendido: false }, { attributes: [...ATRIBUTOS_USUARIO_PUBLICO] })
      : [];
    if (!usuarios.length) throw new BadRequestError('No hay nadie más en el grupo a quien llamar');
    return { destinatarios: usuarios.map(publico), grupo: grupoResumen(grupo) };
  }

  /** ¿Puede entrar a la llamada de un grupo sin que le haya sonado? (miembro activo, sin bloqueo con quien llamó). */
  async puedeUnirseAGrupo(grupoId: number, usuarioId: number, iniciadorId: number): Promise<boolean> {
    if (!(await this.miembros.esMiembroActivo(grupoId, usuarioId))) return false;
    return !(await this.privacidad.hayBloqueo(usuarioId, iniciadorId));
  }

  esMiembroActivo(grupoId: number, usuarioId: number): Promise<boolean> {
    return this.miembros.esMiembroActivo(grupoId, usuarioId);
  }

  private async destinatarioDirecto(iniciadorId: number, usuarioId: number): Promise<UsuarioPublico> {
    if (usuarioId === iniciadorId) throw new BadRequestError('No puedes llamarte a ti mismo');
    const usuario = await this.usuarios.findById(usuarioId, { attributes: [...ATRIBUTOS_USUARIO_PUBLICO, 'activo', 'suspendido', 'cuenta_privada'] });
    if (!usuario || !usuario.activo || usuario.suspendido) throw new NotFoundError('Usuario');
    if (await this.privacidad.hayBloqueo(iniciadorId, usuarioId)) throw new ForbiddenError('No puedes llamar a esta persona');
    if (usuario.cuenta_privada) {
      const relacion = await this.privacidad.relacion(iniciadorId, usuarioId);
      if (!relacion.lo_sigo && !relacion.me_sigue) throw new ForbiddenError('Esta cuenta es privada: solo pueden llamarle quienes se siguen');
    }
    return publico(usuario);
  }

  // ---------- Registro ----------

  /** Crea la llamada con una fila por persona: quien llama queda "unido" y los demás "invitado". */
  async registrar(iniciadorId: number, tipo: TipoLlamada, destino: DestinoLlamada, invitados: number[]): Promise<Llamada> {
    const ahora = new Date();
    return this.db.transaction(async (t) => {
      const llamada = await this.repository.create(
        {
          iniciador_id: iniciadorId,
          destinatario_id: destino.grupo ? null : (destino.destinatarios[0]?.id ?? null),
          grupo_id: destino.grupo?.id ?? null,
          tipo,
          estado: 'sonando',
        },
        t,
      );
      await this.participantes.create({ llamada_id: llamada.id, usuario_id: iniciadorId, estado: 'unido', unido_en: ahora }, t);
      for (const usuarioId of invitados) {
        await this.participantes.create({ llamada_id: llamada.id, usuario_id: usuarioId, estado: 'invitado' }, t);
      }
      return llamada;
    });
  }

  /** Alguien contestó: la primera vez la llamada pasa a "en curso". */
  async marcarUnido(llamadaId: number, usuarioId: number, totalDentro: number): Promise<void> {
    const ahora = new Date();
    await this.participantes.marcar(llamadaId, usuarioId, 'unido', ahora);
    const llamada = await this.repository.findById(llamadaId, { include: [] });
    if (!llamada) return;
    await this.repository.update(llamada, {
      ...(llamada.estado === 'sonando' ? { estado: 'en_curso' as const, inicio: ahora } : {}),
      max_participantes: Math.max(llamada.max_participantes, totalDentro),
    });
  }

  marcarParticipante(llamadaId: number, usuarioId: number, estado: Exclude<EstadoParticipante, 'unido'>): Promise<void> {
    return this.participantes.marcar(llamadaId, usuarioId, estado);
  }

  /** Cierra la llamada: fin, duración (desde que contestaron) y estado final de cada persona. */
  async finalizar(llamadaId: number, estado: Exclude<EstadoLlamada, 'sonando' | 'en_curso'>): Promise<Llamada | null> {
    const ahora = new Date();
    const llamada = await this.repository.findById(llamadaId, { include: [] });
    if (!llamada) return null;
    const duracion = llamada.inicio ? Math.max(0, Math.round((ahora.getTime() - new Date(llamada.inicio).getTime()) / 1000)) : 0;
    await this.db.transaction(async (t) => {
      await this.repository.update(llamada, { estado, fin: ahora, duracion_seg: duracion }, t);
      await this.participantes.cerrarTodos(llamadaId, ahora, t);
    });
    return llamada;
  }

  /** Notificación 'llamada_perdida' (SSE + push). Apunta al grupo o a quien llamó. */
  async avisarPerdida(llamada: { id: number; tipo: TipoLlamada; iniciadorId: number; grupo: GrupoResumen | null }, usuarioId: number, enOtraLlamada = false): Promise<void> {
    const que = ETIQUETA_TIPO[llamada.tipo];
    const mensaje = llamada.grupo
      ? `te invitó a una ${que} del grupo «${llamada.grupo.nombre}»`
      : enOtraLlamada
        ? `te hizo una ${que} mientras estabas en otra llamada`
        : `te hizo una ${que} que no contestaste`;
    await this.notificaciones.notificar({
      usuario_id: usuarioId,
      de_usuario_id: llamada.iniciadorId,
      tipo: 'llamada_perdida',
      mensaje,
      entidad_tipo: llamada.grupo ? 'grupo' : 'usuario',
      entidad_id: llamada.grupo ? llamada.grupo.id : llamada.iniciadorId,
    });
  }

  // ---------- Consultas ----------

  async historial(usuarioId: number, { filtro, limit, offset }: HistorialQuery): Promise<Page<LlamadaHistorial>> {
    const page = await this.repository.historialDe(usuarioId, { limit, offset }, filtro === 'perdidas');
    return { ...page, items: page.items.map((l) => this.presentar(l, usuarioId)) };
  }

  ice(): ConfiguracionIce {
    return configuracionIce();
  }

  /** Para server.ts al arrancar: cierra las llamadas que quedaron abiertas en la base. */
  cerrarHuerfanas(): Promise<number> {
    return this.repository.cerrarHuerfanas();
  }

  private presentar(llamada: Llamada, usuarioId: number): LlamadaHistorial {
    const saliente = llamada.iniciador_id === usuarioId;
    const otro = llamada.grupo_id ? null : saliente ? llamada.destinatario : llamada.iniciador;
    return {
      id: llamada.id,
      tipo: llamada.tipo,
      estado: llamada.estado,
      direccion: saliente ? 'saliente' : 'entrante',
      mi_estado: llamada.participantes?.[0]?.estado ?? (saliente ? 'unido' : 'invitado'),
      otro: otro ? publico(otro) : null,
      grupo: llamada.grupo ? grupoResumen(llamada.grupo) : null,
      iniciador: publico(llamada.iniciador!),
      inicio: llamada.inicio,
      fin: llamada.fin,
      duracion_seg: llamada.duracion_seg,
      max_participantes: llamada.max_participantes,
      fecha_creacion: llamada.fecha_creacion,
    };
  }
}

export const llamadaService = new LlamadaService(
  llamadaRepository,
  llamadaParticipanteRepository,
  usuarioRepository,
  grupoRepository,
  grupoMiembroRepository,
  privacidadService,
  notificacionService,
  sequelize,
);
