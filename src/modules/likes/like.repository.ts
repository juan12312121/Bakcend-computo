import { col, fn } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Like, Publicacion, Usuario, type TipoReaccion } from '../../infrastructure/database/models';
import type { ResumenReaccion } from '../publicaciones/publicacion-extras';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import { ordenarResumen } from './reacciones';

const MAS_RECIENTES: [string, string][] = [
  ['fecha_creacion', 'DESC'],
  ['id', 'DESC'],
];

/** Columnas de la publicación que acompañan a "mis likes". */
const ATRIBUTOS_PUBLICACION_RESUMEN = [
  'id',
  'usuario_id',
  'contenido',
  'imagen_url',
  'categoria',
  'color_categoria',
  'total_likes',
  'total_comentarios',
  'total_compartidos',
  'fecha_creacion',
] as const;

interface FilaConteo {
  publicacion_id: number;
  tipo: TipoReaccion;
  total: number | string;
}

/** Cada fila de `likes` es una reacción (un like de antes es 'me_gusta'). */
export class LikeRepository extends BaseRepository<Like> {
  protected readonly entidad = 'Like';

  constructor() {
    super(Like);
  }

  existe(publicacionId: number, usuarioId: number): Promise<boolean> {
    return this.exists({ publicacion_id: publicacionId, usuario_id: usuarioId });
  }

  /** La reacción del usuario en una publicación (o null). */
  deUsuarioEn(publicacionId: number, usuarioId: number): Promise<Like | null> {
    return this.findOne({ publicacion_id: publicacionId, usuario_id: usuarioId });
  }

  total(publicacionId: number): Promise<number> {
    return this.count({ publicacion_id: publicacionId });
  }

  quitar(publicacionId: number, usuarioId: number): Promise<number> {
    return this.delete({ publicacion_id: publicacionId, usuario_id: usuarioId });
  }

  /** Quién reaccionó (datos públicos y tipo), los más recientes primero; opcionalmente de un solo tipo. */
  dePublicacion(publicacionId: number, paginacion: Paginacion): Promise<Page<Like>>;
  dePublicacion(publicacionId: number, paginacion: Paginacion, tipo: TipoReaccion | undefined): Promise<Page<Like>>;
  dePublicacion(publicacionId: number, paginacion: Paginacion, tipo?: TipoReaccion): Promise<Page<Like>> {
    return this.paginate({ publicacion_id: publicacionId, ...(tipo ? { tipo } : {}) }, paginacion, {
      include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
      order: MAS_RECIENTES,
    });
  }

  /** Likes que dio el usuario, con un resumen de cada publicación. */
  deUsuario(usuarioId: number, paginacion: Paginacion): Promise<Page<Like>> {
    return this.paginate({ usuario_id: usuarioId }, paginacion, {
      include: [{ model: Publicacion, as: 'publicacion', attributes: [...ATRIBUTOS_PUBLICACION_RESUMEN] }],
      order: MAS_RECIENTES,
    });
  }

  /** De una lista de publicaciones, cuáles tienen reacción del usuario (para marcar `usuario_dio_like`). */
  async publicacionesConLike(usuarioId: number, publicacionIds: number[]): Promise<Set<number>> {
    return new Set((await this.misReacciones(usuarioId, publicacionIds)).keys());
  }

  /** Mi reacción en cada publicación de la lista (una sola consulta). */
  async misReacciones(usuarioId: number, publicacionIds: number[]): Promise<Map<number, TipoReaccion>> {
    if (!publicacionIds.length) return new Map();
    const likes = await this.findAll(
      { usuario_id: usuarioId, publicacion_id: publicacionIds },
      { attributes: ['publicacion_id', 'tipo'] },
    );
    return new Map(likes.map((l) => [l.publicacion_id, l.tipo]));
  }

  /** Resumen por tipo de cada publicación (una sola consulta agrupada para toda la lista). */
  async resumen(publicacionIds: number[]): Promise<Map<number, ResumenReaccion[]>> {
    if (!publicacionIds.length) return new Map();
    const filas = (await Like.findAll({
      attributes: ['publicacion_id', 'tipo', [fn('COUNT', col('id')), 'total']],
      where: { publicacion_id: publicacionIds },
      group: ['publicacion_id', 'tipo'],
      raw: true,
    })) as unknown as FilaConteo[];

    const conteos = new Map<number, Partial<Record<TipoReaccion, number>>>();
    for (const fila of filas) {
      const id = Number(fila.publicacion_id);
      conteos.set(id, { ...conteos.get(id), [fila.tipo]: Number(fila.total) });
    }
    return new Map([...conteos].map(([id, c]) => [id, ordenarResumen(c)]));
  }
}

export const likeRepository = new LikeRepository();
