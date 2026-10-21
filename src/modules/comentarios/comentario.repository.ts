import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Comentario, ComentarioLike, Publicacion, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

export type ContadorComentario = 'total_likes' | 'total_respuestas';

export class ComentarioRepository extends BaseRepository<Comentario> {
  protected readonly entidad = 'Comentario';

  constructor() {
    super(Comentario);
  }

  private static autor() {
    return { model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] };
  }

  /** Cada comentario viaja con los datos públicos de su autor, del más reciente al más antiguo. */
  protected override opcionesPorDefecto() {
    return {
      include: [ComentarioRepository.autor()],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ] as [string, string][],
    };
  }

  /** Solo los de primer nivel (las respuestas se piden aparte), más recientes primero. */
  dePublicacion(publicacionId: number, paginacion: Paginacion): Promise<Page<Comentario>> {
    return this.paginate({ publicacion_id: publicacionId, padre_id: null }, paginacion);
  }

  /** Respuestas de un comentario, de la más vieja a la más nueva (se leen como conversación). */
  respuestas(padreId: number, paginacion: Paginacion): Promise<Page<Comentario>> {
    return this.paginate({ padre_id: padreId }, paginacion, {
      order: [
        ['fecha_creacion', 'ASC'],
        ['id', 'ASC'],
      ],
    });
  }

  /** Ids de las respuestas de un comentario (para borrarlas con él). */
  async respuestasDe(padreId: number): Promise<Comentario[]> {
    return this.findAll({ padre_id: padreId }, { attributes: ['id', 'usuario_id'], include: [] });
  }

  /** Comentarios de un usuario, solo sobre publicaciones que el visitante puede ver. */
  deUsuario(usuarioId: number, visibles: WhereOptions<Publicacion>, paginacion: Paginacion): Promise<Page<Comentario>> {
    return this.paginate({ usuario_id: usuarioId }, paginacion, {
      include: [
        ComentarioRepository.autor(),
        { model: Publicacion, as: 'publicacion', attributes: [], where: visibles, required: true },
      ],
    });
  }

  /** contar(publicacion) → todos sus comentarios; contar(publicacion, usuario) → solo los de esa persona. */
  contar(publicacionId: number): Promise<number>;
  contar(publicacionId: number, usuarioId: number): Promise<number>;
  contar(publicacionId: number, usuarioId?: number): Promise<number> {
    return this.count({ publicacion_id: publicacionId, ...(usuarioId ? { usuario_id: usuarioId } : {}) });
  }

  async ajustarContador(id: number, campo: ContadorComentario, delta: number, transaction?: Transaction): Promise<void> {
    if (delta > 0) await Comentario.increment(campo, { by: delta, where: { id }, transaction });
    else if (delta < 0) await Comentario.decrement(campo, { by: -delta, where: { id, [campo]: { [Op.gt]: 0 } }, transaction });
  }

  /** Borra los comentarios indicados junto con sus likes. */
  async borrarConLikes(ids: number[], transaction: Transaction): Promise<void> {
    await ComentarioLike.destroy({ where: { comentario_id: ids }, transaction });
    await Comentario.destroy({ where: { id: ids }, transaction });
  }

  // ---------- Likes en comentarios ----------

  async yaDiLike(comentarioId: number, usuarioId: number): Promise<boolean> {
    return (await ComentarioLike.count({ where: { comentario_id: comentarioId, usuario_id: usuarioId } })) > 0;
  }

  /** De una lista de comentarios, a cuáles les di like (una consulta). */
  async conMiLike(usuarioId: number, comentarioIds: number[]): Promise<Set<number>> {
    if (!comentarioIds.length) return new Set();
    const likes = await ComentarioLike.findAll({
      where: { usuario_id: usuarioId, comentario_id: comentarioIds },
      attributes: ['comentario_id'],
    });
    return new Set(likes.map((l) => l.comentario_id));
  }

  /** Da (true) o quita (false) el like y mueve el contador en la misma transacción. */
  async fijarLike(comentarioId: number, usuarioId: number, dar: boolean, transaction: Transaction): Promise<void> {
    if (dar) {
      await ComentarioLike.create({ comentario_id: comentarioId, usuario_id: usuarioId }, { transaction });
      await this.ajustarContador(comentarioId, 'total_likes', +1, transaction);
    } else {
      await ComentarioLike.destroy({ where: { comentario_id: comentarioId, usuario_id: usuarioId }, transaction });
      await this.ajustarContador(comentarioId, 'total_likes', -1, transaction);
    }
  }
}

export const comentarioRepository = new ComentarioRepository();
