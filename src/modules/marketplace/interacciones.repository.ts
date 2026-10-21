import { Op, fn, col, type Transaction, type WhereOptions, type Attributes } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  Anuncio,
  AnuncioGuardado,
  AnuncioInteresado,
  AnuncioReporte,
  AnuncioVisita,
  CalificacionVendedor,
  Usuario,
  type EstadoAnuncio,
  type EstadoReporteAnuncio,
} from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import { includesAnuncio } from './anuncio.repository';

/** Condición sobre el anuncio incluido (vendedores ocultos y estados). */
function whereAnuncio(ocultos: number[], estados?: EstadoAnuncio[]): WhereOptions<Attributes<Anuncio>> {
  return {
    ...(ocultos.length ? { vendedor_id: { [Op.notIn]: ocultos } } : {}),
    ...(estados ? { estado: estados } : {}),
  };
}

// ---------- Guardados ----------

export class AnuncioGuardadoRepository extends BaseRepository<AnuncioGuardado> {
  protected readonly entidad = 'Guardado';

  constructor() {
    super(AnuncioGuardado);
  }

  de(anuncioId: number, usuarioId: number, transaction?: Transaction): Promise<AnuncioGuardado | null> {
    return AnuncioGuardado.findOne({ where: { anuncio_id: anuncioId, usuario_id: usuarioId }, transaction });
  }

  /** De la lista, cuáles guardó el usuario. */
  async guardadosEntre(usuarioId: number, anuncioIds: number[]): Promise<Set<number>> {
    if (!anuncioIds.length) return new Set();
    const filas = await this.findAll({ usuario_id: usuarioId, anuncio_id: anuncioIds }, { attributes: ['anuncio_id'] });
    return new Set(filas.map((f) => f.anuncio_id));
  }

  /** Quiénes guardaron el anuncio (para avisarles que se vendió). */
  async usuariosDe(anuncioId: number): Promise<number[]> {
    const filas = await this.findAll({ anuncio_id: anuncioId }, { attributes: ['usuario_id'] });
    return filas.map((f) => f.usuario_id);
  }

  /** Mis guardados, el más reciente primero (sin vendedores ocultos). */
  async paginarDe(usuarioId: number, ocultos: number[], paginacion: Paginacion): Promise<Page<Anuncio>> {
    const page = await this.paginate({ usuario_id: usuarioId }, paginacion, {
      include: [{ model: Anuncio, as: 'anuncio', required: true, where: whereAnuncio(ocultos), include: includesAnuncio() }],
      order: [['fecha_creacion', 'DESC'], ['id', 'DESC']],
    });
    return { ...page, items: page.items.map((g) => g.anuncio!) };
  }
}

// ---------- Visitas ----------

export class AnuncioVisitaRepository extends BaseRepository<AnuncioVisita> {
  protected readonly entidad = 'Visita';

  constructor() {
    super(AnuncioVisita);
  }

  /** Crea la visita o renueva su fecha. true si es la primera vez que la persona lo ve. */
  async registrar(anuncioId: number, usuarioId: number): Promise<boolean> {
    const existente = await this.findOne({ anuncio_id: anuncioId, usuario_id: usuarioId });
    if (existente) {
      existente.changed('fecha_actualizacion', true);
      await existente.update({ fecha_actualizacion: new Date() });
      return false;
    }
    await this.create({ anuncio_id: anuncioId, usuario_id: usuarioId });
    return true;
  }

  /** Vistos recientemente: lo último que abrí, visible y aún disponible. */
  async recientesDe(usuarioId: number, ocultos: number[], estados: EstadoAnuncio[], paginacion: Paginacion): Promise<Page<Anuncio>> {
    const page = await this.paginate({ usuario_id: usuarioId }, paginacion, {
      include: [{ model: Anuncio, as: 'anuncio', required: true, where: whereAnuncio(ocultos, estados), include: includesAnuncio() }],
      order: [['fecha_actualizacion', 'DESC'], ['id', 'DESC']],
    });
    return { ...page, items: page.items.map((v) => v.anuncio!) };
  }
}

// ---------- Interesados ----------

export interface InteresadoEnAnuncio {
  usuario: Usuario;
  chat_id: number | null;
  desde: Date;
}

export class AnuncioInteresadoRepository extends BaseRepository<AnuncioInteresado> {
  protected readonly entidad = 'Interesado';

  constructor() {
    super(AnuncioInteresado);
  }

  de(anuncioId: number, usuarioId: number): Promise<AnuncioInteresado | null> {
    return this.findOne({ anuncio_id: anuncioId, usuario_id: usuarioId });
  }

  async paginarDe(anuncioId: number, ocultos: number[], paginacion: Paginacion): Promise<Page<InteresadoEnAnuncio>> {
    const page = await this.paginate(
      { anuncio_id: anuncioId, ...(ocultos.length ? { usuario_id: { [Op.notIn]: ocultos } } : {}) },
      paginacion,
      {
        include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO], where: { activo: true } }],
        order: [['fecha_creacion', 'DESC'], ['id', 'DESC']],
      },
    );
    return { ...page, items: page.items.map((f) => ({ usuario: f.usuario!, chat_id: f.chat_id, desde: f.fecha_creacion })) };
  }
}

// ---------- Reportes ----------

export interface FiltroReportes {
  estado?: EstadoReporteAnuncio;
  anuncio_id?: number;
}

export class AnuncioReporteRepository extends BaseRepository<AnuncioReporte> {
  protected readonly entidad = 'Reporte';

  constructor() {
    super(AnuncioReporte);
  }

  /** Para el panel de moderación: el más reciente primero, con el anuncio (y su vendedor) y quien reportó. */
  paginarFiltrado(filtro: FiltroReportes, paginacion: Paginacion): Promise<Page<AnuncioReporte>> {
    return this.paginate({ ...filtro }, paginacion, {
      include: [
        {
          model: Anuncio,
          as: 'anuncio',
          attributes: ['id', 'titulo', 'estado', 'vendedor_id', 'precio', 'modo_precio', 'moneda'],
          include: [{ model: Usuario, as: 'vendedor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
        },
        { model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
      ],
      order: [['fecha_creacion', 'DESC'], ['id', 'DESC']],
    });
  }
}

// ---------- Calificaciones ----------

export interface ResumenCalificaciones {
  /** Promedio con un decimal; null si aún no tiene. */
  promedio: number | null;
  total: number;
}

export class CalificacionVendedorRepository extends BaseRepository<CalificacionVendedor> {
  protected readonly entidad = 'Calificación';

  constructor() {
    super(CalificacionVendedor);
  }

  protected override opcionesPorDefecto() {
    return { include: [{ model: Usuario, as: 'comprador', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }] };
  }

  async resumen(vendedorId: number): Promise<ResumenCalificaciones> {
    const fila = (await CalificacionVendedor.findOne({
      where: { vendedor_id: vendedorId },
      attributes: [
        [fn('AVG', col('puntuacion')), 'promedio'],
        [fn('COUNT', col('id')), 'total'],
      ],
      raw: true,
    })) as unknown as { promedio: number | string | null; total: number | string } | null;
    const total = Number(fila?.total ?? 0);
    return { promedio: total ? Math.round(Number(fila?.promedio) * 10) / 10 : null, total };
  }

  paginarDe(vendedorId: number, ocultos: number[], paginacion: Paginacion): Promise<Page<CalificacionVendedor>> {
    return this.paginate(
      { vendedor_id: vendedorId, ...(ocultos.length ? { comprador_id: { [Op.notIn]: ocultos } } : {}) },
      paginacion,
      { order: [['fecha_creacion', 'DESC'], ['id', 'DESC']] },
    );
  }

  /** Las calificaciones sobreviven al anuncio borrado. */
  desligarAnuncio(anuncioId: number, transaction: Transaction): Promise<[number]> {
    return CalificacionVendedor.update({ anuncio_id: null }, { where: { anuncio_id: anuncioId }, transaction });
  }
}

export const anuncioGuardadoRepository = new AnuncioGuardadoRepository();
export const anuncioVisitaRepository = new AnuncioVisitaRepository();
export const anuncioInteresadoRepository = new AnuncioInteresadoRepository();
export const anuncioReporteRepository = new AnuncioReporteRepository();
export const calificacionVendedorRepository = new CalificacionVendedorRepository();
