import { Op, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { Publicacion, PublicacionSeccion, Seccion, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

export class SeccionRepository extends BaseRepository<Seccion> {
  protected readonly entidad = 'Sección';

  constructor() {
    super(Seccion);
  }

  deUsuario(usuarioId: number): Promise<Seccion[]> {
    return this.findAll(
      { usuario_id: usuarioId },
      {
        order: [
          ['fecha_creacion', 'DESC'],
          ['id', 'DESC'],
        ],
      },
    );
  }

  /** existeNombre(usuario, nombre) al crear; existeNombre(usuario, nombre, id) al renombrar (ignora la propia). */
  existeNombre(usuarioId: number, nombre: string): Promise<boolean>;
  existeNombre(usuarioId: number, nombre: string, excluirId: number): Promise<boolean>;
  existeNombre(usuarioId: number, nombre: string, excluirId?: number): Promise<boolean> {
    return this.exists({ usuario_id: usuarioId, nombre, ...(excluirId ? { id: { [Op.ne]: excluirId } } : {}) });
  }

  /**
   * Publicaciones de la sección (siempre del dueño), con su autor.
   * publicaciones(seccion) → todas (vista del dueño); publicaciones(seccion, visibles) → filtradas para un visitante.
   */
  publicaciones(seccion: Seccion): Promise<Publicacion[]>;
  publicaciones(seccion: Seccion, visibles: WhereOptions<Publicacion>): Promise<Publicacion[]>;
  async publicaciones(seccion: Seccion, visibles: WhereOptions<Publicacion> = {}): Promise<Publicacion[]> {
    const relaciones = await PublicacionSeccion.findAll({ where: { seccion_id: seccion.id }, attributes: ['publicacion_id'] });
    if (!relaciones.length) return [];
    return Publicacion.findAll({
      where: { [Op.and]: [{ id: relaciones.map((r) => r.publicacion_id), usuario_id: seccion.usuario_id }, visibles] },
      include: [{ model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ],
    });
  }

  /** Secciones (del usuario) en las que está una publicación. */
  async dePublicacion(publicacionId: number, usuarioId: number): Promise<Seccion[]> {
    const relaciones = await PublicacionSeccion.findAll({ where: { publicacion_id: publicacionId }, attributes: ['seccion_id'] });
    if (!relaciones.length) return [];
    return this.findAll({ id: relaciones.map((r) => r.seccion_id), usuario_id: usuarioId }, { order: [['nombre', 'ASC']] });
  }

  async tienePublicacion(seccionId: number, publicacionId: number): Promise<boolean> {
    return (await PublicacionSeccion.count({ where: { seccion_id: seccionId, publicacion_id: publicacionId } })) > 0;
  }

  async agregarPublicacion(seccionId: number, publicacionId: number, transaction: Transaction): Promise<void> {
    await PublicacionSeccion.create({ seccion_id: seccionId, publicacion_id: publicacionId }, { transaction });
  }

  /** Devuelve cuántas relaciones borró (0 si la publicación no estaba en la sección). */
  quitarPublicacion(seccionId: number, publicacionId: number, transaction: Transaction): Promise<number> {
    return PublicacionSeccion.destroy({ where: { seccion_id: seccionId, publicacion_id: publicacionId }, transaction });
  }

  /** Recalcula total_posts contando las relaciones reales (no se desincroniza aunque falle un paso). */
  async recontarPosts(seccionId: number, transaction: Transaction): Promise<number> {
    const total = await PublicacionSeccion.count({ where: { seccion_id: seccionId }, transaction });
    await Seccion.update({ total_posts: total }, { where: { id: seccionId }, transaction });
    return total;
  }

  async eliminarConRelaciones(seccion: Seccion, transaction: Transaction): Promise<void> {
    await PublicacionSeccion.destroy({ where: { seccion_id: seccion.id }, transaction });
    await seccion.destroy({ transaction });
  }
}

export const seccionRepository = new SeccionRepository();
