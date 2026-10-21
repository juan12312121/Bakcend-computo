import { Op, type Transaction } from 'sequelize';
import { BaseRepository, type OpcionesConsulta } from '../../core/domain/BaseRepository';
import { Historia, HistoriaDestacada, HistoriaDestacadaItem } from '../../infrastructure/database/models';

/** Columnas de la historia que hacen falta para pintar una portada. */
const ATRIBUTOS_PORTADA = ['id', 'tipo', 'media_url', 'media_original_url', 'texto', 'fondo'] as const;

/**
 * Colecciones de historias destacadas y las historias que contiene cada una.
 * Las consultas de listado traen las historias (solo columnas de portada) para armar la portada y el total.
 */
export class DestacadaRepository extends BaseRepository<HistoriaDestacada> {
  protected readonly entidad = 'Destacada';

  constructor() {
    super(HistoriaDestacada);
  }

  /** Portada elegida + historias en orden (solo lo necesario para la portada). */
  protected override opcionesPorDefecto(): OpcionesConsulta<HistoriaDestacada> {
    return {
      include: [
        { model: Historia, as: 'portadaHistoria', attributes: [...ATRIBUTOS_PORTADA] },
        {
          model: HistoriaDestacadaItem,
          as: 'items',
          attributes: ['id', 'historia_id', 'orden'],
          include: [{ model: Historia, as: 'historia', attributes: [...ATRIBUTOS_PORTADA] }],
        },
      ],
      order: [
        ['orden', 'ASC'],
        ['id', 'ASC'],
        [{ model: HistoriaDestacadaItem, as: 'items' }, 'orden', 'ASC'],
        [{ model: HistoriaDestacadaItem, as: 'items' }, 'id', 'ASC'],
      ],
    };
  }

  /** Destacadas de un perfil en su orden. */
  deUsuario(usuarioId: number): Promise<HistoriaDestacada[]> {
    return this.findAll({ usuario_id: usuarioId });
  }

  /** Historias completas de una destacada, en orden de reproducción. */
  async historiasDe(destacadaId: number): Promise<Historia[]> {
    const items = await HistoriaDestacadaItem.findAll({
      where: { destacada_id: destacadaId },
      include: [{ model: Historia, as: 'historia', required: true }],
      order: [
        ['orden', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    return items.map((i) => i.historia as Historia);
  }

  /** Siguiente posición libre en el perfil. */
  async siguienteOrden(usuarioId: number): Promise<number> {
    const maximo = (await HistoriaDestacada.max('orden', { where: { usuario_id: usuarioId } })) as number | null;
    return maximo === null || maximo === undefined ? 0 : Number(maximo) + 1;
  }

  /** Cambia el contenido de la destacada por `historiaIds` (en ese orden). */
  async reemplazarItems(destacadaId: number, historiaIds: number[], transaction: Transaction): Promise<void> {
    await HistoriaDestacadaItem.destroy({ where: { destacada_id: destacadaId }, transaction });
    if (!historiaIds.length) return;
    await HistoriaDestacadaItem.bulkCreate(
      historiaIds.map((historia_id, orden) => ({ destacada_id: destacadaId, historia_id, orden })),
      { transaction },
    );
  }

  /** Agrega una historia al final (si ya estaba no hace nada). Devuelve si la agregó. */
  async agregarItem(destacadaId: number, historiaId: number): Promise<boolean> {
    if (await HistoriaDestacadaItem.count({ where: { destacada_id: destacadaId, historia_id: historiaId } })) return false;
    const maximo = (await HistoriaDestacadaItem.max('orden', { where: { destacada_id: destacadaId } })) as number | null;
    await HistoriaDestacadaItem.create({ destacada_id: destacadaId, historia_id: historiaId, orden: maximo === null ? 0 : Number(maximo) + 1 });
    return true;
  }

  /** Quita una historia de la destacada; devuelve cuántas quitó (0 o 1). */
  quitarItem(destacadaId: number, historiaId: number): Promise<number> {
    return HistoriaDestacadaItem.destroy({ where: { destacada_id: destacadaId, historia_id: historiaId } });
  }

  contarItems(destacadaId: number): Promise<number> {
    return HistoriaDestacadaItem.count({ where: { destacada_id: destacadaId } });
  }

  /** Ids de las destacadas en las que está cada historia. */
  async destacadasDe(historiaIds: number[]): Promise<Map<number, number[]>> {
    const mapa = new Map<number, number[]>();
    if (!historiaIds.length) return mapa;
    const items = await HistoriaDestacadaItem.findAll({
      where: { historia_id: { [Op.in]: historiaIds } },
      attributes: ['historia_id', 'destacada_id'],
    });
    for (const item of items) mapa.set(item.historia_id, [...(mapa.get(item.historia_id) ?? []), item.destacada_id]);
    return mapa;
  }

  /** Al borrar una historia: la saca de todas las destacadas y deja de ser portada. */
  async quitarHistoriaDeTodas(historiaId: number, transaction: Transaction): Promise<void> {
    await HistoriaDestacadaItem.destroy({ where: { historia_id: historiaId }, transaction });
    await HistoriaDestacada.update({ portada_historia_id: null }, { where: { portada_historia_id: historiaId }, transaction });
  }

  /** Aplica el orden del perfil: la posición de cada id en `ids` (solo las del usuario). */
  async reordenar(usuarioId: number, ids: number[], transaction: Transaction): Promise<void> {
    for (const [orden, id] of ids.entries()) {
      await HistoriaDestacada.update({ orden }, { where: { id, usuario_id: usuarioId }, transaction });
    }
  }
}

export const destacadaRepository = new DestacadaRepository();
