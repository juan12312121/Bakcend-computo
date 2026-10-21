import { col, fn, Op, where, type Transaction } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Publicacion, Reporte, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Fila agregada: cuántos reportes tiene una publicación. */
interface ConteoFila {
  publicacion_id: number;
  total: number | string;
}

const TOTAL = fn('COUNT', col('id'));

export class ReporteRepository extends BaseRepository<Reporte> {
  protected readonly entidad = 'Reporte';

  constructor() {
    super(Reporte);
  }

  /** Cada reporte se lee con los datos públicos de quien reportó, más reciente primero. */
  protected override opcionesPorDefecto() {
    return {
      include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
      order: [['fecha_reporte', 'DESC']] as [string, string][],
    };
  }

  contarDePublicacion(publicacionId: number): Promise<number>;
  contarDePublicacion(publicacionId: number, transaction: Transaction): Promise<number>;
  contarDePublicacion(publicacionId: number, transaction?: Transaction): Promise<number> {
    return Reporte.count({ where: { publicacion_id: publicacionId }, transaction });
  }

  /** Reportes por publicación (opcionalmente solo las que llegan a `minimo`). */
  conteoPorPublicacion(): Promise<Map<number, number>>;
  conteoPorPublicacion(minimo: number): Promise<Map<number, number>>;
  conteoPorPublicacion(minimo: number, transaction: Transaction): Promise<Map<number, number>>;
  async conteoPorPublicacion(minimo = 1, transaction?: Transaction): Promise<Map<number, number>> {
    const filas = (await Reporte.findAll({
      attributes: ['publicacion_id', [TOTAL, 'total']],
      group: ['publicacion_id'],
      having: where(TOTAL, { [Op.gte]: minimo }),
      raw: true,
      transaction,
    })) as unknown as ConteoFila[];
    return new Map(filas.map((f) => [f.publicacion_id, Number(f.total)]));
  }

  /** Página de publicaciones reportadas, de la más reportada a la menos. */
  async resumenPaginado({ limit, offset }: Paginacion): Promise<{ filas: { publicacion_id: number; total: number }[]; total: number }> {
    const [filas, total] = await Promise.all([
      Reporte.findAll({
        attributes: ['publicacion_id', [TOTAL, 'total']],
        group: ['publicacion_id'],
        order: [
          [TOTAL, 'DESC'],
          ['publicacion_id', 'DESC'],
        ],
        limit,
        offset,
        raw: true,
      }) as unknown as Promise<ConteoFila[]>,
      Reporte.count({ distinct: true, col: 'publicacion_id' }),
    ]);
    return { filas: filas.map((f) => ({ publicacion_id: f.publicacion_id, total: Number(f.total) })), total };
  }

  /** Motivos distintos con que se reportó cada publicación. */
  async motivosDe(publicacionIds: number[]): Promise<Map<number, string[]>> {
    const filas = await Reporte.findAll({
      where: { publicacion_id: { [Op.in]: publicacionIds } },
      attributes: ['publicacion_id', 'motivo'],
      group: ['publicacion_id', 'motivo'],
      raw: true,
    });
    const motivos = new Map<number, string[]>();
    filas.forEach((f) => motivos.set(f.publicacion_id, [...(motivos.get(f.publicacion_id) ?? []), f.motivo]));
    return motivos;
  }

  /** Todos los reportes con su publicación (para copiarlos a la bandeja común de moderación). */
  todosConPublicacion(): Promise<Reporte[]> {
    return this.findAll({}, { include: [{ model: Publicacion, as: 'publicacion', required: false }], order: [['id', 'ASC']] });
  }

  /** Publicaciones del autor que la moderación ocultó (ocultas y con `ids` de muchas denuncias). */
  contarOcultadasDelAutor(autorId: number, ids: number[], transaction: Transaction): Promise<number> {
    if (!ids.length) return Promise.resolve(0);
    return Publicacion.count({ where: { id: { [Op.in]: ids }, usuario_id: autorId, oculto: true }, transaction });
  }
}

export const reporteRepository = new ReporteRepository();
