import { Op, col, fn, literal, type Attributes, type CreationAttributes, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  Boleto,
  Evento,
  EventoStaff,
  OrdenBoleto,
  TipoBoleto,
  Usuario,
  type EstadoBoleto,
  type EstadoOrden,
} from '../../infrastructure/database/models';
import { DURACION_POR_DEFECTO_MS } from '../eventos/evento.ics';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

/** Datos del evento que viajan dentro de un boleto. */
export const ATRIBUTOS_EVENTO_BOLETO = [
  'id',
  'titulo',
  'inicio',
  'fin',
  'lugar',
  'enlace',
  'modalidad',
  'portada_url',
  'cancelado',
  'moneda',
  'creador_id',
  'grupo_id',
] as const;
export const ATRIBUTOS_TIPO_BOLETO = ['id', 'nombre', 'precio_centavos'] as const;

/** Estados que cuentan como boleto "vendido" (emitido y vigente). */
export const ESTADOS_VENDIDOS: EstadoBoleto[] = ['valido', 'usado'];

const usuarioPublico = (as: string, requerido = true) => ({ model: Usuario, as, attributes: [...ATRIBUTOS_USUARIO_PUBLICO], required: requerido });

// ---------- Tipos de boleto ----------

export class TipoBoletoRepository extends BaseRepository<TipoBoleto> {
  protected readonly entidad = 'Tipo de boleto';

  constructor() {
    super(TipoBoleto);
  }

  deEvento(eventoId: number): Promise<TipoBoleto[]>;
  deEvento(eventoId: number, incluirInactivos: boolean): Promise<TipoBoleto[]>;
  deEvento(eventoId: number, incluirInactivos = false): Promise<TipoBoleto[]> {
    return this.findAll(
      { evento_id: eventoId, ...(incluirInactivos ? {} : { activo: true }) },
      {
        order: [
          ['orden', 'ASC'],
          ['id', 'ASC'],
        ],
      },
    );
  }

  /**
   * Aparta `cantidad` lugares con UNA sola sentencia condicional (`vendidos + n <= cupo`): dos compras al mismo
   * tiempo nunca pasan del cupo, y dentro de una transacción de MySQL la fila queda bloqueada hasta el commit.
   * false = no alcanza el cupo o el tipo está inactivo.
   */
  async reservar(id: number, cantidad: number): Promise<boolean>;
  async reservar(id: number, cantidad: number, transaction: Transaction): Promise<boolean>;
  async reservar(id: number, cantidad: number, transaction?: Transaction): Promise<boolean> {
    const n = Math.trunc(cantidad);
    if (n <= 0) return false;
    const [afectadas] = await TipoBoleto.update(
      { vendidos: literal(`vendidos + ${n}`) },
      {
        where: { id, activo: true, [Op.or]: [{ cupo: null }, { cupo: { [Op.gte]: literal(`vendidos + ${n}`) } }] },
        transaction,
      },
    );
    return afectadas === 1;
  }

  /** Devuelve lugares apartados (orden fallida o vencida, boletos reembolsados). Nunca baja de 0. */
  async liberar(id: number, cantidad: number, transaction?: Transaction): Promise<void> {
    const n = Math.trunc(cantidad);
    if (n <= 0) return;
    await TipoBoleto.update(
      { vendidos: literal(`CASE WHEN vendidos >= ${n} THEN vendidos - ${n} ELSE 0 END`) },
      { where: { id }, transaction },
    );
  }
}

// ---------- Órdenes ----------

export interface IngresoPorTipo {
  tipo_boleto_id: number;
  ordenes: number;
  total_centavos: number;
}

export class OrdenBoletoRepository extends BaseRepository<OrdenBoleto> {
  protected readonly entidad = 'Orden';

  constructor() {
    super(OrdenBoleto);
  }

  /** Orden con su evento y tipo (para mostrarla). */
  conDetalle(id: number): Promise<OrdenBoleto | null> {
    return this.findById(id, {
      include: [
        { model: Evento, as: 'evento', attributes: [...ATRIBUTOS_EVENTO_BOLETO] },
        { model: TipoBoleto, as: 'tipo', attributes: [...ATRIBUTOS_TIPO_BOLETO] },
      ],
    });
  }

  /**
   * Cambia el estado solo si la orden sigue en uno de los estados esperados (una sola sentencia):
   * así un webhook repetido o dos avisos simultáneos no procesan la orden dos veces.
   */
  async pasarAEstado(id: number, desde: EstadoOrden[], cambios: Partial<Attributes<OrdenBoleto>>): Promise<boolean>;
  async pasarAEstado(id: number, desde: EstadoOrden[], cambios: Partial<Attributes<OrdenBoleto>>, transaction: Transaction): Promise<boolean>;
  async pasarAEstado(id: number, desde: EstadoOrden[], cambios: Partial<Attributes<OrdenBoleto>>, transaction?: Transaction): Promise<boolean> {
    const [afectadas] = await OrdenBoleto.update(cambios, { where: { id, estado: desde }, transaction });
    return afectadas === 1;
  }

  /** Pendientes cuyo plazo de pago ya pasó. */
  vencidas(ahora: Date): Promise<OrdenBoleto[]> {
    return this.findAll({ estado: 'pendiente', expira_en: { [Op.lt]: ahora } }, { limit: 200 });
  }

  /** Boletos de un tipo que la persona tiene apartados en órdenes pendientes. */
  async pendientesDe(usuarioId: number, tipoId: number): Promise<number> {
    const total = await OrdenBoleto.sum('cantidad', { where: { usuario_id: usuarioId, tipo_boleto_id: tipoId, estado: 'pendiente' } });
    return Number(total) || 0;
  }

  async ingresosPorTipo(eventoId: number): Promise<IngresoPorTipo[]> {
    const filas = (await OrdenBoleto.findAll({
      where: { evento_id: eventoId, estado: 'pagada' },
      attributes: ['tipo_boleto_id', [fn('COUNT', col('id')), 'ordenes'], [fn('SUM', col('total_centavos')), 'total_centavos']],
      group: ['tipo_boleto_id'],
      raw: true,
    })) as unknown as { tipo_boleto_id: number; ordenes: number | string; total_centavos: number | string | null }[];
    return filas.map((f) => ({ tipo_boleto_id: Number(f.tipo_boleto_id), ordenes: Number(f.ordenes), total_centavos: Number(f.total_centavos) || 0 }));
  }

  /** ¿Hay cobros de dinero real sin reembolsar? (impide borrar el evento). */
  pagosSinReembolsar(eventoId: number): Promise<boolean> {
    return this.exists({ evento_id: eventoId, estado: 'pagada', total_centavos: { [Op.gt]: 0 } });
  }
}

// ---------- Boletos ----------

export interface ConteoPorTipo {
  tipo_boleto_id: number;
  vendidos: number;
  escaneados: number;
}

export class BoletoRepository extends BaseRepository<Boleto> {
  protected readonly entidad = 'Boleto';

  constructor() {
    super(Boleto);
  }

  /** Detalle completo: dueño, quién lo escaneó, tipo y evento. */
  completo(id: number): Promise<Boleto | null>;
  completo(where: WhereOptions<Attributes<Boleto>>): Promise<Boleto | null>;
  completo(objetivo: number | WhereOptions<Attributes<Boleto>>): Promise<Boleto | null> {
    const opciones = { include: this.includesCompletos() };
    return typeof objetivo === 'number' ? this.findById(objetivo, opciones) : this.findOne(objetivo, opciones);
  }

  /** Boletos de una orden que siguen siendo de la persona (pudo transferir alguno). */
  deOrden(ordenId: number, usuarioId: number): Promise<Boleto[]> {
    return this.findAll({ orden_id: ordenId, usuario_id: usuarioId }, { include: this.includesCompletos(), order: [['id', 'ASC']] });
  }

  crearVarios(datos: CreationAttributes<Boleto>[], transaction: Transaction): Promise<Boleto[]> {
    return Boleto.bulkCreate(datos, { transaction });
  }

  /** Marca usado solo si sigue válido (una sentencia): de dos escaneos simultáneos, solo uno gana. */
  async marcarUsado(id: number, staffId: number, ahora: Date): Promise<boolean> {
    const [afectadas] = await Boleto.update({ estado: 'usado', usado_en: ahora, usado_por: staffId }, { where: { id, estado: 'valido' } });
    return afectadas === 1;
  }

  /** Pasa a `estado` los boletos vigentes de una orden; devuelve cuántos cambió. */
  async cambiarEstadoDeOrden(ordenId: number, estado: EstadoBoleto, transaction?: Transaction): Promise<number> {
    const [afectadas] = await Boleto.update({ estado }, { where: { orden_id: ordenId, estado: ['valido'] }, transaction });
    return afectadas;
  }

  /** Boletos vigentes (válidos o usados) de la persona en el evento, dentro de una transacción. */
  vigentesDe(eventoId: number, usuarioId: number, transaction?: Transaction): Promise<number> {
    return Boleto.count({ where: { evento_id: eventoId, usuario_id: usuarioId, estado: ESTADOS_VENDIDOS }, transaction });
  }

  /** Boletos de un tipo que tiene la persona (válidos o usados). */
  cuantosTiene(usuarioId: number, tipoId: number): Promise<number> {
    return this.count({ usuario_id: usuarioId, tipo_boleto_id: tipoId, estado: ESTADOS_VENDIDOS });
  }

  async conteoPorTipo(eventoId: number): Promise<ConteoPorTipo[]> {
    const filas = (await Boleto.findAll({
      where: { evento_id: eventoId, estado: ESTADOS_VENDIDOS },
      attributes: ['tipo_boleto_id', 'estado', [fn('COUNT', col('id')), 'total']],
      group: ['tipo_boleto_id', 'estado'],
      raw: true,
    })) as unknown as { tipo_boleto_id: number; estado: EstadoBoleto; total: number | string }[];

    const porTipo = new Map<number, ConteoPorTipo>();
    for (const fila of filas) {
      const tipoId = Number(fila.tipo_boleto_id);
      const conteo = porTipo.get(tipoId) ?? { tipo_boleto_id: tipoId, vendidos: 0, escaneados: 0 };
      conteo.vendidos += Number(fila.total);
      if (fila.estado === 'usado') conteo.escaneados += Number(fila.total);
      porTipo.set(tipoId, conteo);
    }
    return [...porTipo.values()];
  }

  /** Mis boletos con su evento y tipo; próximos (del más cercano) o pasados (del más reciente). */
  mios(usuarioId: number, cuando: 'proximos' | 'pasados' | 'todos', paginacion: Paginacion, ahora: Date = new Date()): Promise<Page<Boleto>> {
    const corte = new Date(ahora.getTime() - DURACION_POR_DEFECTO_MS);
    const filtroEvento: WhereOptions<Attributes<Evento>> | undefined =
      cuando === 'proximos'
        ? { [Op.or]: [{ fin: { [Op.gte]: ahora } }, { fin: null, inicio: { [Op.gte]: corte } }] }
        : cuando === 'pasados'
          ? { [Op.or]: [{ fin: { [Op.lt]: ahora } }, { fin: null, inicio: { [Op.lt]: corte } }] }
          : undefined;
    const direccion = cuando === 'pasados' ? 'DESC' : 'ASC';
    return this.paginate({ usuario_id: usuarioId }, paginacion, {
      include: [
        { model: Evento, as: 'evento', attributes: [...ATRIBUTOS_EVENTO_BOLETO], where: filtroEvento, required: true },
        { model: TipoBoleto, as: 'tipo', attributes: [...ATRIBUTOS_TIPO_BOLETO] },
        usuarioPublico('dueno'),
      ],
      order: [
        [{ model: Evento, as: 'evento' }, 'inicio', direccion],
        ['id', 'ASC'],
      ],
    });
  }

  /** Lista para el panel del organizador (con búsqueda por nombre del dueño). */
  deEvento(eventoId: number, filtro: { estado?: EstadoBoleto; q?: string }, paginacion: Paginacion): Promise<Page<Boleto>> {
    const patron = filtro.q ? `%${filtro.q}%` : null;
    return this.paginate({ evento_id: eventoId, ...(filtro.estado ? { estado: filtro.estado } : {}) }, paginacion, {
      include: [
        {
          ...usuarioPublico('dueno'),
          ...(patron ? { where: { [Op.or]: [{ nombre_completo: { [Op.like]: patron } }, { nombre_usuario: { [Op.like]: patron } }] } } : {}),
        },
        usuarioPublico('escaneador', false),
        { model: TipoBoleto, as: 'tipo', attributes: [...ATRIBUTOS_TIPO_BOLETO] },
      ],
      order: [['id', 'ASC']],
    });
  }

  /** Todos los boletos del evento (para el CSV), con tope de seguridad. */
  todosDeEvento(eventoId: number): Promise<Boleto[]> {
    return this.findAll(
      { evento_id: eventoId },
      {
        include: [usuarioPublico('dueno'), usuarioPublico('escaneador', false), { model: TipoBoleto, as: 'tipo', attributes: [...ATRIBUTOS_TIPO_BOLETO] }],
        order: [['id', 'ASC']],
        limit: 20_000,
      },
    );
  }

  private includesCompletos() {
    return [
      usuarioPublico('dueno'),
      usuarioPublico('escaneador', false),
      { model: TipoBoleto, as: 'tipo', attributes: [...ATRIBUTOS_TIPO_BOLETO] },
      { model: Evento, as: 'evento', attributes: [...ATRIBUTOS_EVENTO_BOLETO] },
    ];
  }
}

// ---------- Staff ----------

export class EventoStaffRepository extends BaseRepository<EventoStaff> {
  protected readonly entidad = 'Staff';

  constructor() {
    super(EventoStaff);
  }

  deEvento(eventoId: number): Promise<EventoStaff[]> {
    return this.findAll({ evento_id: eventoId }, { include: [usuarioPublico('usuario')], order: [['id', 'ASC']] });
  }

  esStaff(eventoId: number, usuarioId: number): Promise<boolean> {
    return this.exists({ evento_id: eventoId, usuario_id: usuarioId });
  }

  async idsDe(eventoId: number): Promise<number[]> {
    const filas = await this.findAll({ evento_id: eventoId }, { attributes: ['usuario_id'] });
    return filas.map((f) => f.usuario_id);
  }
}

export const tipoBoletoRepository = new TipoBoletoRepository();
export const ordenBoletoRepository = new OrdenBoletoRepository();
export const boletoRepository = new BoletoRepository();
export const eventoStaffRepository = new EventoStaffRepository();
