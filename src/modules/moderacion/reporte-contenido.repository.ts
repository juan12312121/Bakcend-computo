import { col, fn, Op, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  ReporteContenido,
  Usuario,
  type EstadoReporte,
  type MotivoReporte,
  type TipoContenidoReportable,
} from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Un contenido reportado se identifica por su tipo y su id. */
export interface ClaveContenido {
  tipo: TipoContenidoReportable;
  contenido_id: number;
}

export interface FiltrosBandeja {
  tipo?: TipoContenidoReportable;
  estado: EstadoReporte;
  motivo?: MotivoReporte;
}

/** Fila agregada de la bandeja: cuántos reportes tiene un contenido y cuándo llegó el último. */
export interface GrupoReportes extends ClaveContenido {
  total: number;
  ultimo: Date;
}

interface FilaGrupo {
  tipo: TipoContenidoReportable;
  contenido_id: number;
  total: number | string;
  ultimo: Date | string;
}

interface FilaConteo {
  clave: string | number | null;
  total: number | string;
}

const TOTAL = fn('COUNT', col('id'));
const ULTIMO = fn('MAX', col('fecha_creacion'));
const ULTIMA_RESOLUCION = fn('MAX', col('fecha_resolucion'));

/** Columnas del autor/reportante en la bandeja (incluye si está suspendido). */
export const ATRIBUTOS_USUARIO_MODERACION = [...ATRIBUTOS_USUARIO_PUBLICO, 'suspendido'] as const;

export class ReporteContenidoRepository extends BaseRepository<ReporteContenido> {
  protected readonly entidad = 'Reporte';

  constructor() {
    super(ReporteContenido);
  }

  /** Cada reporte se lee con quien reportó y el autor del contenido, más reciente primero. */
  protected override opcionesPorDefecto() {
    return {
      include: [
        { model: Usuario, as: 'reportante', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
        { model: Usuario, as: 'autor', attributes: [...ATRIBUTOS_USUARIO_MODERACION] },
      ],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ] as [string, string][],
    };
  }

  /** Página de contenidos agrupados (pendientes: más reportados primero; resueltos: más recientes primero). */
  async gruposPaginados(filtros: FiltrosBandeja, { limit, offset }: Paginacion): Promise<{ filas: GrupoReportes[]; total: number }> {
    const where = this.whereBandeja(filtros);
    const orden =
      filtros.estado === 'pendiente'
        ? [
            [TOTAL, 'DESC'],
            [ULTIMO, 'DESC'],
          ]
        : [
            [ULTIMA_RESOLUCION, 'DESC'],
            [ULTIMO, 'DESC'],
          ];
    const [filas, grupos] = await Promise.all([
      ReporteContenido.findAll({
        where,
        attributes: ['tipo', 'contenido_id', [TOTAL, 'total'], [ULTIMO, 'ultimo']],
        group: ['tipo', 'contenido_id'],
        order: orden as never,
        limit,
        offset,
        raw: true,
      }) as unknown as Promise<FilaGrupo[]>,
      ReporteContenido.count({ where, group: ['tipo', 'contenido_id'] }),
    ]);
    return {
      filas: filas.map((f) => ({ tipo: f.tipo, contenido_id: Number(f.contenido_id), total: Number(f.total), ultimo: new Date(f.ultimo) })),
      total: grupos.length,
    };
  }

  /** Reportes de varios contenidos (opcionalmente de un estado), con reportante y autor. */
  deContenidos(claves: ClaveContenido[]): Promise<ReporteContenido[]>;
  deContenidos(claves: ClaveContenido[], estado: EstadoReporte): Promise<ReporteContenido[]>;
  deContenidos(claves: ClaveContenido[], estado?: EstadoReporte): Promise<ReporteContenido[]> {
    if (!claves.length) return Promise.resolve([]);
    return this.findAll({
      [Op.or]: claves.map((c) => ({ tipo: c.tipo, contenido_id: c.contenido_id })),
      ...(estado ? { estado } : {}),
    } as WhereOptions<ReporteContenido>);
  }

  /** Reportes pendientes de un contenido (sin includes, para resolverlos). */
  pendientesDe({ tipo, contenido_id }: ClaveContenido): Promise<ReporteContenido[]> {
    return this.findAll({ tipo, contenido_id, estado: 'pendiente' }, { include: [] });
  }

  contarPendientesDe({ tipo, contenido_id }: ClaveContenido): Promise<number> {
    return this.count({ tipo, contenido_id, estado: 'pendiente' });
  }

  /** Marca resueltos o descartados los pendientes de un contenido. Devuelve cuántos cambió. */
  async cerrarPendientes(clave: ClaveContenido, estado: Exclude<EstadoReporte, 'pendiente'>, adminId: number | null, transaction?: Transaction): Promise<number> {
    const [cambiados] = await ReporteContenido.update(
      { estado, resuelto_por: adminId, fecha_resolucion: new Date() },
      { where: { tipo: clave.tipo, contenido_id: clave.contenido_id, estado: 'pendiente' }, transaction },
    );
    return cambiados;
  }

  /** Contenidos distintos pendientes por tipo. */
  async pendientesPorTipo(): Promise<Map<TipoContenidoReportable, number>> {
    const grupos = (await ReporteContenido.count({ where: { estado: 'pendiente' }, group: ['tipo', 'contenido_id'] })) as unknown as {
      tipo: TipoContenidoReportable;
    }[];
    const porTipo = new Map<TipoContenidoReportable, number>();
    grupos.forEach((g) => porTipo.set(g.tipo, (porTipo.get(g.tipo) ?? 0) + 1));
    return porTipo;
  }

  /** Reportes cerrados desde una fecha (para la gráfica por día). */
  cerradosDesde(desde: Date): Promise<ReporteContenido[]> {
    return this.findAll(
      { estado: { [Op.in]: ['resuelto', 'descartado'] }, fecha_resolucion: { [Op.gte]: desde } },
      { attributes: ['id', 'tipo', 'contenido_id', 'estado', 'fecha_resolucion'], include: [], order: [['fecha_resolucion', 'ASC']] },
    );
  }

  /** Motivos con su cantidad de reportes (todos o desde una fecha), del más común al menos. */
  async conteoMotivos(desde?: Date): Promise<{ motivo: MotivoReporte; total: number }[]> {
    const filas = (await ReporteContenido.findAll({
      where: desde ? { fecha_creacion: { [Op.gte]: desde } } : {},
      attributes: [['motivo', 'clave'], [TOTAL, 'total']],
      group: ['motivo'],
      order: [[TOTAL, 'DESC']],
      raw: true,
    })) as unknown as FilaConteo[];
    return filas.map((f) => ({ motivo: f.clave as MotivoReporte, total: Number(f.total) }));
  }

  /** Autores con más reportes recibidos (todos los estados). */
  async autoresMasReportados(limite: number): Promise<{ autor_id: number; total: number }[]> {
    const filas = (await ReporteContenido.findAll({
      where: { autor_id: { [Op.ne]: null } },
      attributes: [['autor_id', 'clave'], [TOTAL, 'total']],
      group: ['autor_id'],
      order: [
        [TOTAL, 'DESC'],
        ['autor_id', 'ASC'],
      ],
      limit: limite,
      raw: true,
    })) as unknown as FilaConteo[];
    return filas.map((f) => ({ autor_id: Number(f.clave), total: Number(f.total) }));
  }

  /** Reportes por autor con un estado (p. ej. pendientes de los autores más reportados). */
  async conteoPorAutor(autorIds: number[], estado: EstadoReporte): Promise<Map<number, number>> {
    if (!autorIds.length) return new Map();
    const filas = (await ReporteContenido.findAll({
      where: { autor_id: { [Op.in]: autorIds }, estado },
      attributes: [['autor_id', 'clave'], [TOTAL, 'total']],
      group: ['autor_id'],
      raw: true,
    })) as unknown as FilaConteo[];
    return new Map(filas.map((f) => [Number(f.clave), Number(f.total)]));
  }

  /** Contenidos distintos reportados de cada autor. */
  async contenidosPorAutor(autorIds: number[]): Promise<Map<number, number>> {
    if (!autorIds.length) return new Map();
    const grupos = (await ReporteContenido.count({
      where: { autor_id: { [Op.in]: autorIds } },
      group: ['autor_id', 'tipo', 'contenido_id'],
    })) as unknown as { autor_id: number }[];
    const porAutor = new Map<number, number>();
    grupos.forEach((g) => porAutor.set(Number(g.autor_id), (porAutor.get(Number(g.autor_id)) ?? 0) + 1));
    return porAutor;
  }

  private whereBandeja({ tipo, estado, motivo }: FiltrosBandeja): WhereOptions<ReporteContenido> {
    return { estado, ...(tipo ? { tipo } : {}), ...(motivo ? { motivo } : {}) };
  }
}

export const reporteContenidoRepository = new ReporteContenidoRepository();
