import { col, fn, Op, type Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { Hashtag, Publicacion, PublicacionHashtag } from '../../infrastructure/database/models';

/** Hashtag con cuántas publicaciones públicas recientes lo usan (tendencias). */
export interface HashtagConRecientes {
  hashtag: Hashtag;
  recientes: number;
}

export class HashtagRepository extends BaseRepository<Hashtag> {
  protected readonly entidad = 'Hashtag';

  constructor() {
    super(Hashtag);
  }

  porNombre(nombre: string): Promise<Hashtag | null> {
    return this.findOne({ nombre });
  }

  /**
   * Deja enlazada la publicación exactamente con estos temas (ya normalizados): crea los Hashtag que falten,
   * agrega/quita enlaces y ajusta `total_publicaciones`. Con `[]` quita todos (al borrar la publicación).
   */
  async sincronizar(publicacionId: number, nombres: string[], transaction?: Transaction): Promise<void> {
    const actuales = await PublicacionHashtag.findAll({ where: { publicacion_id: publicacionId }, attributes: ['hashtag_id'], transaction });
    const idsActuales = new Set(actuales.map((e) => e.hashtag_id));
    const deseados = nombres.length ? await this.obtenerOCrear(nombres, transaction) : [];
    const idsDeseados = new Set(deseados.map((h) => h.id));

    const agregar = [...idsDeseados].filter((id) => !idsActuales.has(id));
    const quitar = [...idsActuales].filter((id) => !idsDeseados.has(id));
    if (agregar.length) {
      await PublicacionHashtag.bulkCreate(
        agregar.map((hashtag_id) => ({ publicacion_id: publicacionId, hashtag_id })),
        { transaction },
      );
      await Hashtag.increment('total_publicaciones', { by: 1, where: { id: agregar }, transaction });
    }
    if (quitar.length) {
      await PublicacionHashtag.destroy({ where: { publicacion_id: publicacionId, hashtag_id: quitar }, transaction });
      await Hashtag.decrement('total_publicaciones', {
        by: 1,
        where: { id: quitar, total_publicaciones: { [Op.gt]: 0 } },
        transaction,
      });
    }
  }

  /** Los Hashtag de esos nombres; crea los que no existan (sin chocar si otro los creó al mismo tiempo). */
  private async obtenerOCrear(nombres: string[], transaction?: Transaction): Promise<Hashtag[]> {
    const existentes = await Hashtag.findAll({ where: { nombre: nombres }, transaction });
    const conocidos = new Set(existentes.map((h) => h.nombre));
    const faltan = nombres.filter((n) => !conocidos.has(n));
    if (!faltan.length) return existentes;
    await Hashtag.bulkCreate(faltan.map((nombre) => ({ nombre })), { transaction, ignoreDuplicates: true });
    return Hashtag.findAll({ where: { nombre: nombres }, transaction });
  }

  /** Top por publicaciones públicas creadas desde `desde`. */
  async tendencias(desde: Date, limite: number): Promise<HashtagConRecientes[]> {
    const conteo = fn('COUNT', col('publicaciones.id'));
    const filas = await Hashtag.findAll({
      attributes: ['id', 'nombre', 'total_publicaciones', 'fecha_creacion', [conteo, 'recientes']],
      include: [
        {
          model: Publicacion,
          as: 'publicaciones',
          attributes: [],
          through: { attributes: [] },
          where: { fecha_creacion: { [Op.gte]: desde }, visibilidad: 'publico', oculto: false },
          required: true,
        },
      ],
      group: ['Hashtag.id', 'Hashtag.nombre', 'Hashtag.total_publicaciones', 'Hashtag.fecha_creacion'],
      order: [
        [conteo, 'DESC'],
        ['total_publicaciones', 'DESC'],
        ['nombre', 'ASC'],
      ],
      limit: limite,
      subQuery: false,
    });
    return filas.map((hashtag) => ({
      hashtag,
      recientes: Number((hashtag.get({ plain: true }) as { recientes?: number | string }).recientes ?? 0),
    }));
  }

  /** Respaldo de tendencias: los más usados de siempre, sin los ids indicados. */
  masUsados(limite: number, excluir: number[] = []): Promise<Hashtag[]> {
    return this.findAll(
      { total_publicaciones: { [Op.gt]: 0 }, ...(excluir.length ? { id: { [Op.notIn]: excluir } } : {}) },
      { limit: limite, order: [['total_publicaciones', 'DESC'], ['nombre', 'ASC']] },
    );
  }

  /** Autocompletado: temas que empiezan con el prefijo, los más usados primero. */
  buscar(prefijo: string, limite: number): Promise<Hashtag[]> {
    return this.findAll(
      { nombre: { [Op.like]: `${prefijo}%` }, total_publicaciones: { [Op.gt]: 0 } },
      { limit: limite, order: [['total_publicaciones', 'DESC'], ['nombre', 'ASC']] },
    );
  }

  /** Ids de las publicaciones enlazadas a un tema. */
  async idsPublicaciones(hashtagId: number): Promise<number[]> {
    const enlaces = await PublicacionHashtag.findAll({ where: { hashtag_id: hashtagId }, attributes: ['publicacion_id'] });
    return enlaces.map((e) => e.publicacion_id);
  }
}

export const hashtagRepository = new HashtagRepository();
