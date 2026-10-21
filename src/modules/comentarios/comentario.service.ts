import type { Attributes } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type Comentario, type Publicacion } from '../../infrastructure/database/models';
import { realtime, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { mencionService, type MencionService } from '../menciones/mencion.service';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { comentarioRepository, type ComentarioRepository } from './comentario.repository';
import type { ActualizarComentarioDto, CrearComentarioDto } from './comentario.schemas';
import { asegurarTextoPermitido } from '../moderacion/palabras.service';

/** Evento Socket.IO que el feed y el detalle usan para refrescar el conteo. */
export const EVENTO_NUEVO_COMENTARIO = 'new_comment';
/** Socket.IO a todos: { comentario_id, publicacion_id, total_likes }. */
export const EVENTO_LIKE_COMENTARIO = 'comentario_like_update';

/** Comentario listo para el frontend: con autor, contadores y si le di like. */
export type ComentarioVista = Attributes<Comentario> & { autor?: unknown; yo_di_like: boolean };

export interface EstadoLikeComentario {
  comentario_id: number;
  publicacion_id: number;
  yo_di_like: boolean;
  total_likes: number;
}

export class ComentarioService extends BaseService<Comentario, ComentarioRepository> {
  constructor(
    repository: ComentarioRepository,
    private readonly publicaciones: PublicacionRepository,
    private readonly notificaciones: NotificacionService,
    private readonly tiempoReal: RealtimeGateway,
    private readonly menciones: MencionService,
  ) {
    super(repository);
  }

  /**
   * Comentar (o responder) exige poder ver la publicación. Una respuesta a una respuesta se cuelga del
   * comentario de primer nivel (un solo nivel). Suma contadores, avisa y emite en vivo.
   */
  async crear(usuarioId: number, { publicacion_id, texto, padre_id }: CrearComentarioDto): Promise<ComentarioVista> {
    texto = await asegurarTextoPermitido(texto, 'comentario');
    const publicacion = await this.publicaciones.findVisibleOrFail(publicacion_id, usuarioId);
    const padre = padre_id ? await this.padreDe(padre_id, publicacion_id) : null;

    const id = await sequelize.transaction(async (transaction) => {
      const creado = await this.repository.create({ publicacion_id, usuario_id: usuarioId, texto, padre_id: padre?.id ?? null }, transaction);
      await this.publicaciones.ajustarContador(publicacion_id, 'total_comentarios', +1, transaction);
      if (padre) await this.repository.ajustarContador(padre.id, 'total_respuestas', +1, transaction);
      return creado.id;
    });

    await this.avisarNuevo(publicacion, usuarioId, id, padre);
    await this.menciones.notificar(texto, usuarioId, { publicacion_id, comentario_id: id });

    const comentario = await this.vista(await this.repository.findByIdOrFail(id), usuarioId);
    this.tiempoReal.aTodos(EVENTO_NUEVO_COMENTARIO, comentario);
    return comentario;
  }

  /** Comentarios de primer nivel con `total_respuestas`, `total_likes` y `yo_di_like`. */
  async dePublicacion(publicacionId: number, usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<ComentarioVista>> {
    await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    return this.paginaVista(await this.repository.dePublicacion(publicacionId, paginacion), usuarioId);
  }

  /** Respuestas de un comentario (más viejas primero). */
  async respuestas(comentarioId: number, usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<ComentarioVista>> {
    await this.visible(comentarioId, usuarioId);
    return this.paginaVista(await this.repository.respuestas(comentarioId, paginacion), usuarioId);
  }

  async deUsuario(autorId: number, usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<ComentarioVista>> {
    const visibles = await this.publicaciones.filtroVisibles(usuarioId);
    return this.paginaVista(await this.repository.deUsuario(autorId, visibles, paginacion), usuarioId);
  }

  /** Un comentario suelto solo se muestra si su publicación es visible (si no, 404). */
  async obtenerVisible(id: number, usuarioId?: number): Promise<ComentarioVista> {
    return this.vista((await this.visible(id, usuarioId)).comentario, usuarioId);
  }

  /** Solo el autor del comentario puede editarlo; avisa solo a los mencionados nuevos. */
  async actualizar(id: number, usuarioId: number, { texto }: ActualizarComentarioDto): Promise<ComentarioVista> {
    texto = await asegurarTextoPermitido(texto, 'comentario');
    const comentario = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(comentario.usuario_id, usuarioId, 'No tienes permiso para editar este comentario');
    const anterior = comentario.texto;
    const actualizado = await this.repository.update(comentario, { texto });
    await this.menciones.notificarNuevas(texto, anterior, usuarioId, { publicacion_id: comentario.publicacion_id, comentario_id: id });
    return this.vista(actualizado, usuarioId);
  }

  /** Like en un comentario: lo da o lo quita (toggle) y mantiene `total_likes`. */
  async alternarLike(id: number, usuarioId: number): Promise<EstadoLikeComentario> {
    const { comentario } = await this.visible(id, usuarioId);
    const dar = !(await this.repository.yaDiLike(id, usuarioId));
    await sequelize.transaction((transaction) => this.repository.fijarLike(id, usuarioId, dar, transaction));

    const aviso = {
      usuario_id: comentario.usuario_id,
      de_usuario_id: usuarioId,
      tipo: 'like_comentario' as const,
      publicacion_id: comentario.publicacion_id,
      entidad_tipo: 'comentario' as const,
      entidad_id: id,
    };
    if (dar) await this.notificaciones.notificar({ ...aviso, mensaje: 'le gustó tu comentario' });
    else await this.notificaciones.retirar(aviso);

    const { total_likes } = await this.repository.findByIdOrFail(id, { include: [] });
    const estado = { comentario_id: id, publicacion_id: comentario.publicacion_id, yo_di_like: dar, total_likes };
    this.tiempoReal.aTodos(EVENTO_LIKE_COMENTARIO, { comentario_id: id, publicacion_id: comentario.publicacion_id, total_likes });
    return estado;
  }

  /**
   * Borra el autor del comentario o el autor de la publicación. Un comentario de primer nivel se lleva sus respuestas;
   * se descuentan de la publicación (y del padre si era respuesta) y se retiran los avisos que ya no aplican.
   */
  async eliminar(id: number, usuarioId: number): Promise<void> {
    const comentario = await this.repository.findByIdOrFail(id);
    const publicacion = await this.publicaciones.findById(comentario.publicacion_id, { include: [] });
    const esAutorPublicacion = publicacion?.usuario_id === usuarioId;
    if (comentario.usuario_id !== usuarioId && !esAutorPublicacion) {
      throw new ForbiddenError('No tienes permiso para eliminar este comentario');
    }

    const respuestas = comentario.padre_id ? [] : await this.repository.respuestasDe(id);
    const padre = comentario.padre_id ? await this.repository.findById(comentario.padre_id, { include: [] }) : null;
    const ids = [id, ...respuestas.map((r) => r.id)];

    await sequelize.transaction(async (transaction) => {
      await this.repository.borrarConLikes(ids, transaction);
      if (padre) await this.repository.ajustarContador(padre.id, 'total_respuestas', -1, transaction);
      if (publicacion) await this.publicaciones.ajustarContador(publicacion.id, 'total_comentarios', -ids.length, transaction);
    });
    if (!publicacion) return;

    // Avisos de respuesta: la borrada (a su padre) y las que se fueron con este comentario (a su autor).
    const respondidas = [
      ...(padre ? [{ de: comentario.usuario_id, para: padre.usuario_id, entidad: id }] : []),
      ...respuestas.map((r) => ({ de: r.usuario_id, para: comentario.usuario_id, entidad: r.id })),
    ];
    for (const r of respondidas) {
      await this.notificaciones.retirar({
        usuario_id: r.para,
        de_usuario_id: r.de,
        tipo: 'respuesta_comentario',
        publicacion_id: publicacion.id,
        entidad_tipo: 'comentario',
        entidad_id: r.entidad,
      });
    }

    // Quien ya no tiene ningún comentario ahí deja de figurar en el aviso que recibió el autor.
    const autores = new Set([comentario.usuario_id, ...respuestas.map((r) => r.usuario_id)]);
    for (const autor of autores) {
      if ((await this.repository.contar(publicacion.id, autor)) > 0) continue;
      await this.notificaciones.retirar({ usuario_id: publicacion.usuario_id, de_usuario_id: autor, tipo: 'comment', publicacion_id: publicacion.id });
    }
  }

  // ---------- Internos ----------

  /** El comentario y su publicación, si el usuario puede verla (si no, 404). */
  private async visible(id: number, usuarioId?: number): Promise<{ comentario: Comentario; publicacion: Publicacion }> {
    const comentario = await this.repository.findByIdOrFail(id);
    const publicacion = await this.publicaciones.findById(comentario.publicacion_id, { include: [] });
    if (!publicacion || !(await this.publicaciones.puedeVer(publicacion, usuarioId))) throw new NotFoundError('Comentario');
    return { comentario, publicacion };
  }

  /** Comentario al que se responde: debe ser de la misma publicación; si es respuesta, se usa su padre. */
  private async padreDe(padreId: number, publicacionId: number): Promise<Comentario> {
    const padre = await this.repository.findById(padreId, { include: [] });
    if (!padre) throw new NotFoundError('Comentario', 'El comentario al que respondes no existe');
    if (padre.publicacion_id !== publicacionId) throw new BadRequestError('El comentario al que respondes no es de esta publicación');
    return padre.padre_id ? this.repository.findByIdOrFail(padre.padre_id, { include: [] }) : padre;
  }

  /** 'comment' al autor de la publicación y 'respuesta_comentario' al autor del comentario respondido (sin duplicar). */
  private async avisarNuevo(publicacion: Publicacion, usuarioId: number, comentarioId: number, padre: Comentario | null): Promise<void> {
    if (padre) {
      await this.notificaciones.notificar({
        usuario_id: padre.usuario_id,
        de_usuario_id: usuarioId,
        tipo: 'respuesta_comentario',
        mensaje: 'respondió a tu comentario',
        publicacion_id: publicacion.id,
        entidad_tipo: 'comentario',
        entidad_id: comentarioId,
      });
      if (padre.usuario_id === publicacion.usuario_id) return;
    }
    await this.notificaciones.notificar({
      usuario_id: publicacion.usuario_id,
      de_usuario_id: usuarioId,
      tipo: 'comment',
      mensaje: 'comentó tu publicación',
      publicacion_id: publicacion.id,
    });
  }

  private vista(comentario: Comentario, usuarioId?: number): Promise<ComentarioVista>;
  private vista(comentarios: Comentario[], usuarioId?: number): Promise<ComentarioVista[]>;
  private async vista(entrada: Comentario | Comentario[], usuarioId?: number): Promise<ComentarioVista | ComentarioVista[]> {
    const lista = Array.isArray(entrada) ? entrada : [entrada];
    const conLike = usuarioId ? await this.repository.conMiLike(usuarioId, lista.map((c) => c.id)) : new Set<number>();
    const vistas = lista.map((c) => ({ ...c.toJSON(), yo_di_like: conLike.has(c.id) }));
    return Array.isArray(entrada) ? vistas : vistas[0];
  }

  private async paginaVista(page: Page<Comentario>, usuarioId?: number): Promise<Page<ComentarioVista>> {
    return { ...page, items: await this.vista(page.items, usuarioId) };
  }
}

export const comentarioService = new ComentarioService(
  comentarioRepository,
  publicacionRepository,
  notificacionService,
  realtime,
  mencionService,
);
