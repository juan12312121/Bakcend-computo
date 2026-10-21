import { Op, type Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { Encuesta, EncuestaOpcion, EncuestaVoto } from '../../infrastructure/database/models';

/** Encuestas con sus opciones (en su posición) y los votos de cada usuario. */
export class EncuestaRepository extends BaseRepository<Encuesta> {
  protected readonly entidad = 'Encuesta';

  constructor() {
    super(Encuesta);
  }

  /** Toda encuesta se lee con sus opciones ordenadas. */
  protected override opcionesPorDefecto() {
    return {
      include: [{ model: EncuestaOpcion, as: 'opciones' }],
      order: [
        [{ model: EncuestaOpcion, as: 'opciones' }, 'posicion', 'ASC'],
        [{ model: EncuestaOpcion, as: 'opciones' }, 'id', 'ASC'],
      ] as never,
    };
  }

  deUnaPublicacion(publicacionId: number): Promise<Encuesta | null> {
    return this.findOne({ publicacion_id: publicacionId });
  }

  /** Encuestas de varias publicaciones en una sola consulta. */
  dePublicaciones(publicacionIds: number[]): Promise<Encuesta[]> {
    if (!publicacionIds.length) return Promise.resolve([]);
    return this.findAll({ publicacion_id: publicacionIds });
  }

  /** Crea la encuesta y sus opciones (dentro de la transacción del servicio). */
  async crearConOpciones(
    datos: { publicacion_id: number; multiple: boolean; cierra_en: Date | null },
    opciones: string[],
    transaction: Transaction,
  ): Promise<number> {
    const encuesta = await this.create(datos, transaction);
    await EncuestaOpcion.bulkCreate(
      opciones.map((texto, posicion) => ({ encuesta_id: encuesta.id, texto, posicion })),
      { transaction },
    );
    return encuesta.id;
  }

  /** Ids de opciones votadas por el usuario en cada encuesta (una consulta para todas). */
  async misVotos(encuestaIds: number[], usuarioId: number): Promise<Map<number, number[]>> {
    const mapa = new Map<number, number[]>();
    if (!encuestaIds.length) return mapa;
    const votos = await EncuestaVoto.findAll({
      where: { encuesta_id: encuestaIds, usuario_id: usuarioId },
      attributes: ['encuesta_id', 'opcion_id'],
      order: [['opcion_id', 'ASC']],
    });
    for (const v of votos) mapa.set(v.encuesta_id, [...(mapa.get(v.encuesta_id) ?? []), v.opcion_id]);
    return mapa;
  }

  /**
   * Reemplaza los votos del usuario por `opcionIds` (vacío = retirar) y ajusta los contadores:
   * cada opción suma/resta 1 y la encuesta cuenta votantes (no votos).
   * Devuelve cuántos votos tenía antes.
   */
  async reemplazarVotos(encuestaId: number, usuarioId: number, opcionIds: number[], transaction: Transaction): Promise<number> {
    const previos = await EncuestaVoto.findAll({ where: { encuesta_id: encuestaId, usuario_id: usuarioId }, transaction });
    if (previos.length) {
      await EncuestaOpcion.decrement('total_votos', {
        by: 1,
        where: { id: previos.map((v) => v.opcion_id), total_votos: { [Op.gt]: 0 } },
        transaction,
      });
      await EncuestaVoto.destroy({ where: { encuesta_id: encuestaId, usuario_id: usuarioId }, transaction });
    }
    if (opcionIds.length) {
      await EncuestaVoto.bulkCreate(
        opcionIds.map((opcion_id) => ({ encuesta_id: encuestaId, opcion_id, usuario_id: usuarioId })),
        { transaction },
      );
      await EncuestaOpcion.increment('total_votos', { by: 1, where: { id: opcionIds }, transaction });
    }

    const votante = (opcionIds.length ? 1 : 0) - (previos.length ? 1 : 0);
    if (votante > 0) await Encuesta.increment('total_votos', { by: 1, where: { id: encuestaId }, transaction });
    if (votante < 0) {
      await Encuesta.decrement('total_votos', { by: 1, where: { id: encuestaId, total_votos: { [Op.gt]: 0 } }, transaction });
    }
    return previos.length;
  }
}

export const encuestaRepository = new EncuestaRepository();
