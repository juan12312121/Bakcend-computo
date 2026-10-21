import { BaseService } from '../../core/domain/BaseService';
import { ConflictError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type Like, type Publicacion, type TipoReaccion } from '../../infrastructure/database/models';
import { realtime, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import type { ResumenReaccion } from '../publicaciones/publicacion-extras';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { likeRepository, type LikeRepository } from './like.repository';
import { mensajeReaccion } from './reacciones';

/** Lo que responden las rutas viejas de like (mismo formato que el legacy). */
export interface EstadoLike {
  publicacion_id: number;
  liked: boolean;
  usuario_dio_like: boolean;
  total_likes: number;
}

/** Lo que responden las rutas de reacciones. */
export interface EstadoReaccion {
  publicacion_id: number;
  /** Mi reacción (null sin sesión o si no reaccioné). */
  mi_reaccion: TipoReaccion | null;
  usuario_dio_like: boolean;
  /** Total de reacciones de todos los tipos. */
  total_likes: number;
  reacciones: ResumenReaccion[];
}

/** Socket.IO `like_update`: a todos en cada alta, cambio o baja de una reacción. */
export interface AvisoReaccion {
  publicacion_id: number;
  total: number;
  /** Quién reaccionó y con qué (null si la quitó). */
  usuario_id: number;
  tipo: TipoReaccion | null;
  reacciones: ResumenReaccion[];
}

export const EVENTO_LIKE = 'like_update';

export class LikeService extends BaseService<Like, LikeRepository> {
  constructor(
    repository: LikeRepository,
    private readonly publicaciones: PublicacionRepository,
    private readonly notificaciones: NotificacionService,
    private readonly realtime: RealtimeGateway,
  ) {
    super(repository);
  }

  // ---------- Reacciones ----------

  /** Pone o cambia mi reacción (hay que poder ver la publicación). Repetir la misma no hace nada. */
  async reaccionar(publicacionId: number, usuarioId: number, tipo: TipoReaccion): Promise<EstadoReaccion> {
    const publicacion = await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    const actual = await this.repository.deUsuarioEn(publicacionId, usuarioId);
    if (actual?.tipo === tipo) return this.estadoReaccion(publicacionId, tipo);
    return this.poner(publicacion, usuarioId, tipo, actual);
  }

  /** Quita mi reacción (404 si no tenía). */
  async quitarReaccion(publicacionId: number, usuarioId: number): Promise<EstadoReaccion> {
    const publicacion = await this.publicaciones.findByIdOrFail(publicacionId);
    if (!(await this.repository.existe(publicacionId, usuarioId))) {
      throw new NotFoundError('Reacción', 'No has reaccionado a esta publicación');
    }
    return this.retirar(publicacion, usuarioId);
  }

  /** Quién reaccionó (opcionalmente de un tipo), con su reacción. */
  async reacciones(publicacionId: number, paginacion: Paginacion, tipo?: TipoReaccion, usuarioId?: number): Promise<Page<Like>> {
    await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    return this.repository.dePublicacion(publicacionId, paginacion, tipo);
  }

  /** Resumen por tipo + mi reacción. */
  async resumen(publicacionId: number, usuarioId?: number): Promise<EstadoReaccion> {
    await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    const mia = usuarioId ? await this.repository.deUsuarioEn(publicacionId, usuarioId) : null;
    return this.estadoReaccion(publicacionId, mia?.tipo ?? null);
  }

  // ---------- Rutas viejas (equivalen a 'me_gusta') ----------

  /** Da like: hay que poder ver la publicación y no haber reaccionado antes. */
  async agregar(publicacionId: number, usuarioId: number): Promise<EstadoLike> {
    const publicacion = await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    if (await this.repository.existe(publicacionId, usuarioId)) throw new ConflictError('Ya diste like a esta publicación');
    return aEstadoLike(await this.poner(publicacion, usuarioId, 'me_gusta', null));
  }

  async quitar(publicacionId: number, usuarioId: number): Promise<EstadoLike> {
    const publicacion = await this.publicaciones.findByIdOrFail(publicacionId);
    if (!(await this.repository.existe(publicacionId, usuarioId))) throw new NotFoundError('Like', 'No has dado like a esta publicación');
    return aEstadoLike(await this.retirar(publicacion, usuarioId));
  }

  /** Da o quita el like según el estado actual (cualquier reacción cuenta como "tiene like"). */
  async alternar(publicacionId: number, usuarioId: number): Promise<EstadoLike> {
    const publicacion = await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    const estado = (await this.repository.existe(publicacionId, usuarioId))
      ? await this.retirar(publicacion, usuarioId)
      : await this.poner(publicacion, usuarioId, 'me_gusta', null);
    return aEstadoLike(estado);
  }

  async verificar(publicacionId: number, usuarioId: number): Promise<EstadoLike> {
    await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    const liked = await this.repository.existe(publicacionId, usuarioId);
    return { publicacion_id: publicacionId, liked, usuario_dio_like: liked, total_likes: await this.repository.total(publicacionId) };
  }

  async total(publicacionId: number, usuarioId?: number): Promise<{ publicacion_id: number; total: number; total_likes: number }> {
    await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    const total = await this.repository.total(publicacionId);
    return { publicacion_id: publicacionId, total, total_likes: total };
  }

  async dePublicacion(publicacionId: number, paginacion: Paginacion, usuarioId?: number): Promise<Page<Like>> {
    await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    return this.repository.dePublicacion(publicacionId, paginacion);
  }

  misLikes(usuarioId: number, paginacion: Paginacion): Promise<Page<Like>> {
    return this.repository.deUsuario(usuarioId, paginacion);
  }

  // ---------- Internos ----------

  /** Crea la reacción (con el contador, en transacción) o cambia su tipo; reemplaza el aviso al autor. */
  private async poner(publicacion: Publicacion, usuarioId: number, tipo: TipoReaccion, actual: Like | null): Promise<EstadoReaccion> {
    if (actual) {
      await this.repository.update(actual, { tipo });
      await this.retirarAviso(publicacion, usuarioId);
    } else {
      await sequelize.transaction(async (transaction) => {
        await this.repository.create({ publicacion_id: publicacion.id, usuario_id: usuarioId, tipo }, transaction);
        await this.publicaciones.ajustarContador(publicacion.id, 'total_likes', +1, transaction);
      });
    }
    await this.notificaciones.notificar({
      usuario_id: publicacion.usuario_id,
      de_usuario_id: usuarioId,
      tipo: tipo === 'me_gusta' ? 'like' : 'reaccion',
      publicacion_id: publicacion.id,
      mensaje: mensajeReaccion(tipo),
    });
    return this.emitir(publicacion.id, usuarioId, tipo);
  }

  private async retirar(publicacion: Publicacion, usuarioId: number): Promise<EstadoReaccion> {
    await sequelize.transaction(async (transaction) => {
      await this.repository.delete({ publicacion_id: publicacion.id, usuario_id: usuarioId }, transaction);
      await this.publicaciones.ajustarContador(publicacion.id, 'total_likes', -1, transaction);
    });
    await this.retirarAviso(publicacion, usuarioId);
    return this.emitir(publicacion.id, usuarioId, null);
  }

  /** La notificación de la reacción anterior pudo ser 'like' o 'reaccion'. */
  private async retirarAviso(publicacion: Publicacion, usuarioId: number): Promise<void> {
    for (const tipo of ['like', 'reaccion'] as const) {
      await this.notificaciones.retirar({ usuario_id: publicacion.usuario_id, de_usuario_id: usuarioId, tipo, publicacion_id: publicacion.id });
    }
  }

  /** Avisa a todos el nuevo total y el resumen para que los contadores se actualicen en vivo. */
  private async emitir(publicacionId: number, usuarioId: number, tipo: TipoReaccion | null): Promise<EstadoReaccion> {
    const estado = await this.estadoReaccion(publicacionId, tipo);
    const aviso: AvisoReaccion = { publicacion_id: publicacionId, total: estado.total_likes, usuario_id: usuarioId, tipo, reacciones: estado.reacciones };
    this.realtime.aTodos(EVENTO_LIKE, aviso);
    return estado;
  }

  private async estadoReaccion(publicacionId: number, miReaccion: TipoReaccion | null): Promise<EstadoReaccion> {
    const reacciones = (await this.repository.resumen([publicacionId])).get(publicacionId) ?? [];
    return {
      publicacion_id: publicacionId,
      mi_reaccion: miReaccion,
      usuario_dio_like: miReaccion !== null,
      total_likes: reacciones.reduce((suma, r) => suma + r.total, 0),
      reacciones,
    };
  }
}

function aEstadoLike({ publicacion_id, usuario_dio_like, total_likes }: EstadoReaccion): EstadoLike {
  return { publicacion_id, liked: usuario_dio_like, usuario_dio_like, total_likes };
}

export const likeService = new LikeService(likeRepository, publicacionRepository, notificacionService, realtime);
