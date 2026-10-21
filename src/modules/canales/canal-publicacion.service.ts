import type { InferAttributes } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import { sequelize, type CanalPublicacion, type EmojiReaccion } from '../../infrastructure/database/models';
import { realtime, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { tipoDeArchivo } from '../chat/adjuntos';
import { sinMia, type ConteoReaccion, type ReaccionResumen } from '../chat/reacciones';
import {
  canalPublicacionRepository,
  canalReaccionRepository,
  canalVistaRepository,
  type CanalPublicacionRepository,
  type CanalReaccionRepository,
  type CanalVistaRepository,
} from './canal-publicacion.repository';
import { canalMiembroRepository, canalRepository, type CanalMiembroRepository, type CanalRepository } from './canal.repository';
import { difusorCanal, type DifusorCanal, type ResultadoDifusion } from './canal.difusion';
import type { PublicacionesQuery, PublicarDto } from './canal.schemas';
import { canalService, type CanalService, type UsuarioPublico } from './canal.service';
import { EVENTOS_CANAL, salaCanal } from './canal.socket';
import { asegurarTextoPermitido } from '../moderacion/palabras.service';

/** Publicación como la recibe el cliente. */
export type PublicacionCanalVista = InferAttributes<CanalPublicacion> & {
  autor: UsuarioPublico | null;
  reacciones: ReaccionResumen[];
};

/** Respuesta de PUT/DELETE .../reaccion. */
export interface ResultadoReaccionCanal {
  canal_id: number;
  publicacion_id: number;
  reacciones: ReaccionResumen[];
}

/** Payload de `canal_reaccion`: `emoji` null = la quitó. */
export interface AvisoReaccionCanal {
  canal_id: number;
  publicacion_id: number;
  usuario_id: number;
  emoji: EmojiReaccion | null;
  reacciones: ConteoReaccion[];
}

export interface LecturaCanal {
  canal_id: number;
  ultima_leida_id: number | null;
}

export class CanalPublicacionService extends BaseService<CanalPublicacion, CanalPublicacionRepository> {
  constructor(
    repository: CanalPublicacionRepository,
    private readonly canales: CanalService,
    private readonly canalesRepo: CanalRepository,
    private readonly miembros: CanalMiembroRepository,
    private readonly reacciones: CanalReaccionRepository,
    private readonly vistas: CanalVistaRepository,
    private readonly difusor: DifusorCanal,
    private readonly tiempoReal: RealtimeGateway,
    private readonly storage: FileStorage,
  ) {
    super(repository);
  }

  // ---------- Consultas ----------

  /**
   * Publicaciones del canal, las más nuevas primero (cursor `antes_de`). Con sesión cuenta una vista por persona
   * y, si soy miembro y pido la página más reciente, la marca como leída.
   */
  async listar(canalId: number, { antes_de, limit }: PublicacionesQuery, usuarioId?: number): Promise<Page<PublicacionCanalVista>> {
    const { membresia } = await this.canales.visible(canalId, usuarioId);
    const page = antes_de ? await this.repository.pagina(canalId, limit, antes_de) : await this.repository.pagina(canalId, limit);
    const ids = page.items.map((p) => p.id);

    let nuevas = new Set<number>();
    if (usuarioId) {
      nuevas = new Set(await this.vistas.registrar(ids, usuarioId));
      await this.repository.sumarVistas([...nuevas]);
    }
    if (membresia && !antes_de && ids.length && ids[0] > (membresia.ultima_leida_id ?? 0)) {
      await this.miembros.update(membresia, { ultima_leida_id: ids[0] });
    }

    const reacciones = await this.reacciones.resumenDe(ids, usuarioId);
    return {
      ...page,
      items: page.items.map((p) => {
        const vista = this.vista(p, reacciones.get(p.id) ?? []);
        // La vista recién contada ya se refleja en la respuesta
        return nuevas.has(p.id) ? { ...vista, total_vistas: vista.total_vistas + 1 } : vista;
      }),
    };
  }

  /** Marca leído todo el canal (para el globo de "mis canales"). */
  async leer(canalId: number, usuarioId: number): Promise<LecturaCanal> {
    await this.canalesRepo.findByIdOrFail(canalId);
    const membresia = await this.miembros.de(canalId, usuarioId);
    if (!membresia) throw new NotFoundError('Suscripción', 'No estás suscrito a este canal');
    const ultimo = await this.repository.ultimoId(canalId);
    if (ultimo !== null && ultimo > (membresia.ultima_leida_id ?? 0)) await this.miembros.update(membresia, { ultima_leida_id: ultimo });
    return { canal_id: canalId, ultima_leida_id: membresia.ultima_leida_id };
  }

  // ---------- Escritura ----------

  /**
   * Solo administradores: texto y/o un archivo (imagen o documento; audio no). Emite `canal_publicacion` a la sala
   * del canal y avisa a los suscriptores no silenciados (ver DifusorCanal).
   */
  async publicar(
    canalId: number,
    autorId: number,
    { texto }: PublicarDto,
    archivo?: ArchivoSubido,
  ): Promise<{ publicacion: PublicacionCanalVista; difusion: ResultadoDifusion }> {
    const { canal, membresia } = await this.canales.administrador(canalId, autorId);
    if (!texto && !archivo) throw new BadRequestError('Escribe algo o adjunta una imagen o documento');
    texto = await asegurarTextoPermitido(texto, 'publicacion');
    const tipo = archivo ? tipoDeArchivo(archivo.mimetype) : null;
    if (tipo === 'audio') throw new BadRequestError('En los canales solo se publican imágenes o documentos');

    const creada = await sequelize.transaction(async (t) => {
      const publicacion = await this.repository.create(
        {
          canal_id: canalId,
          autor_id: autorId,
          texto,
          archivo_url: archivo?.url ?? null,
          tipo_archivo: tipo,
          nombre_archivo: tipo === 'document' ? (archivo?.nombreOriginal ?? null) : null,
        },
        t,
      );
      await this.canalesRepo.ajustarContador(canalId, 'total_publicaciones', +1, t);
      await this.canalesRepo.update(canal, { ultima_publicacion_en: new Date() }, t);
      // Lo propio cuenta como leído
      await this.miembros.update(membresia, { ultima_leida_id: publicacion.id }, t);
      return publicacion;
    });

    const guardada = await this.repository.findByIdOrFail(creada.id);
    const vista = this.vista(guardada, []);
    this.tiempoReal.aSala(salaCanal(canalId), EVENTOS_CANAL.publicacion, vista);
    const difusion = await this.difusor.difundir(canal, guardada, await this.miembros.idsParaAvisar(canalId, autorId));
    return { publicacion: vista, difusion };
  }

  /** Solo administradores: borra la publicación (con su archivo) y avisa a la sala. */
  async eliminar(canalId: number, publicacionId: number, usuarioId: number): Promise<{ canal_id: number; publicacion_id: number }> {
    await this.canales.administrador(canalId, usuarioId);
    const publicacion = await this.delCanal(canalId, publicacionId);
    await sequelize.transaction(async (t) => {
      await publicacion.destroy({ transaction: t });
      await this.canalesRepo.ajustarContador(canalId, 'total_publicaciones', -1, t);
    });
    await this.storage.eliminar(publicacion.archivo_url);

    const aviso = { canal_id: canalId, publicacion_id: publicacionId };
    this.tiempoReal.aSala(salaCanal(canalId), EVENTOS_CANAL.eliminada, aviso);
    return aviso;
  }

  // ---------- Reacciones ----------

  /** Cualquiera con sesión que pueda ver el canal reacciona (una por persona; cambiarla la reemplaza). */
  async reaccionar(canalId: number, publicacionId: number, usuarioId: number, emoji: EmojiReaccion): Promise<ResultadoReaccionCanal> {
    await this.publicacionVisible(canalId, publicacionId, usuarioId);
    await this.reacciones.poner(publicacionId, usuarioId, emoji);
    return this.avisarReaccion(canalId, publicacionId, usuarioId, emoji);
  }

  async quitarReaccion(canalId: number, publicacionId: number, usuarioId: number): Promise<ResultadoReaccionCanal> {
    await this.publicacionVisible(canalId, publicacionId, usuarioId);
    const quitadas = await this.reacciones.quitar(publicacionId, usuarioId);
    if (!quitadas) return { canal_id: canalId, publicacion_id: publicacionId, reacciones: await this.reacciones.de(publicacionId, usuarioId) };
    return this.avisarReaccion(canalId, publicacionId, usuarioId, null);
  }

  // ---------- Apoyo ----------

  private async publicacionVisible(canalId: number, publicacionId: number, usuarioId: number | undefined): Promise<CanalPublicacion> {
    if (!usuarioId) throw new UnauthorizedError('Inicia sesión para reaccionar');
    await this.canales.visible(canalId, usuarioId);
    return this.delCanal(canalId, publicacionId);
  }

  private async delCanal(canalId: number, publicacionId: number): Promise<CanalPublicacion> {
    const publicacion = await this.repository.findOne({ id: publicacionId, canal_id: canalId });
    if (!publicacion) throw new NotFoundError('Publicación', 'Publicación no encontrada');
    return publicacion;
  }

  private async avisarReaccion(canalId: number, publicacionId: number, usuarioId: number, emoji: EmojiReaccion | null): Promise<ResultadoReaccionCanal> {
    const reacciones = await this.reacciones.de(publicacionId, usuarioId);
    const aviso: AvisoReaccionCanal = { canal_id: canalId, publicacion_id: publicacionId, usuario_id: usuarioId, emoji, reacciones: sinMia(reacciones) };
    this.tiempoReal.aSala(salaCanal(canalId), EVENTOS_CANAL.reaccion, aviso);
    return { canal_id: canalId, publicacion_id: publicacionId, reacciones };
  }

  private vista(publicacion: CanalPublicacion, reacciones: ReaccionResumen[]): PublicacionCanalVista {
    const { autor, ...datos } = publicacion.toJSON() as InferAttributes<CanalPublicacion> & { autor?: UsuarioPublico };
    return { ...datos, autor: autor ?? null, reacciones };
  }
}

/** Para pruebas: la misma lógica con otro difusor (p. ej. con un límite de notificaciones más bajo). */
export function crearCanalPublicacionService(difusor: DifusorCanal, tiempoReal: RealtimeGateway = realtime): CanalPublicacionService {
  return new CanalPublicacionService(
    canalPublicacionRepository,
    canalService,
    canalRepository,
    canalMiembroRepository,
    canalReaccionRepository,
    canalVistaRepository,
    difusor,
    tiempoReal,
    fileStorage,
  );
}

export const canalPublicacionService = crearCanalPublicacionService(difusorCanal);
