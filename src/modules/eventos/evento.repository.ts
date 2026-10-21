import { Op, type Attributes, type Order, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Evento, EventoAsistente, Grupo, Usuario, type EstadoAsistencia } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import { DURACION_POR_DEFECTO_MS } from './evento.ics';

/** Datos del grupo que viajan dentro de un evento. */
export const ATRIBUTOS_GRUPO_EVENTO = ['id', 'nombre', 'imagen_url', 'privacidad'] as const;

/** Tope de seguridad para las consultas sin paginar (calendario). */
export const MAXIMO_SIN_PAGINAR = 500;

/** Qué contador desnormalizado mueve cada estado de asistencia. */
const CONTADOR_POR_ESTADO: Partial<Record<EstadoAsistencia, 'total_asistentes' | 'total_interesados'>> = {
  voy: 'total_asistentes',
  interesado: 'total_interesados',
};

type WhereEvento = WhereOptions<Attributes<Evento>>;

/** Lo que alcanza a ver un usuario (lo arma el servicio con 4 consultas chicas). */
export interface AlcanceUsuario {
  usuarioId: number;
  /** A quiénes sigo con estado "aceptado". */
  seguidos: number[];
  /** Grupos donde soy miembro activo. */
  grupos: number[];
  /** Grupos donde soy admin o moderador (ven y editan todos los eventos del grupo). */
  gruposModerados: number[];
  /** Eventos donde tengo fila (invitado, voy, interesado, no voy). */
  conFila: number[];
}

/** Filtros combinables para listados y calendario. */
export interface FiltroEventos {
  /** Sin alcance = anónimo: solo públicos. */
  alcance?: AlcanceUsuario;
  ahora: Date;
  cuando?: 'proximos' | 'pasados' | 'todos';
  categoria?: string;
  grupo_id?: number;
  creador_id?: number;
  /** Solo estos eventos. */
  ids?: number[];
  /** Por fecha de inicio. */
  desde?: Date;
  hasta?: Date;
  /** Eventos que se cruzan con el rango (calendario). */
  rango?: { desde: Date; hasta: Date };
  texto?: string;
}

export class EventoRepository extends BaseRepository<Evento> {
  protected readonly entidad = 'Evento';

  constructor() {
    super(Evento);
  }

  /** Todo evento se lee con su organizador y, si tiene, su grupo. */
  protected override opcionesPorDefecto() {
    return {
      include: [
        { model: Usuario, as: 'creador', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
        { model: Grupo, as: 'grupo', attributes: [...ATRIBUTOS_GRUPO_EVENTO], required: false },
      ],
    };
  }

  /** Pasados: del más reciente al más viejo; lo demás, del más cercano al más lejano. */
  buscar(filtro: FiltroEventos, paginacion: Paginacion): Promise<Page<Evento>> {
    return this.paginate(this.where(filtro), paginacion, { order: this.orden(filtro.cuando === 'pasados' ? 'DESC' : 'ASC') });
  }

  /** Sin paginar (con tope), ordenados por inicio. */
  todos(filtro: FiltroEventos): Promise<Evento[]> {
    return this.findAll(this.where(filtro), { order: this.orden('ASC'), limit: MAXIMO_SIN_PAGINAR });
  }

  /** No cancelados, sin recordatorio y que empiezan dentro de (desde, hasta]. */
  porEmpezar(desde: Date, hasta: Date): Promise<Evento[]> {
    return this.findAll(
      { cancelado: false, recordatorio_enviado: false, inicio: { [Op.gt]: desde, [Op.lte]: hasta } },
      { include: [], order: this.orden('ASC') },
    );
  }

  /** Contadores actuales (dentro de la transacción, para revisar el cupo). */
  async totales(id: number, transaction?: Transaction): Promise<{ total_asistentes: number; total_interesados: number }> {
    const fila = await Evento.findByPk(id, { attributes: ['total_asistentes', 'total_interesados'], transaction });
    return { total_asistentes: fila?.total_asistentes ?? 0, total_interesados: fila?.total_interesados ?? 0 };
  }

  /** Mueve total_asistentes / total_interesados según el cambio de estado de una persona. */
  async ajustarTotales(id: number, anterior: EstadoAsistencia | null, nuevo: EstadoAsistencia | null, transaction: Transaction): Promise<void> {
    const quitar = anterior ? CONTADOR_POR_ESTADO[anterior] : undefined;
    const sumar = nuevo ? CONTADOR_POR_ESTADO[nuevo] : undefined;
    if (quitar === sumar) return;
    if (quitar) await Evento.decrement(quitar, { by: 1, where: { id, [quitar]: { [Op.gt]: 0 } }, transaction });
    if (sumar) await Evento.increment(sumar, { by: 1, where: { id }, transaction });
  }

  // ---------- Armado de filtros ----------

  /** Regla de visibilidad: publico · seguidores (aceptados) · grupo (miembros activos) · privado (creador + invitados). */
  filtroVisibles(alcance?: AlcanceUsuario): WhereEvento {
    if (!alcance) return { visibilidad: 'publico' };
    const opciones: WhereEvento[] = [{ visibilidad: 'publico' }, { creador_id: alcance.usuarioId }];
    if (alcance.seguidos.length) opciones.push({ visibilidad: 'seguidores', creador_id: alcance.seguidos });
    if (alcance.grupos.length) opciones.push({ visibilidad: 'grupo', grupo_id: alcance.grupos });
    if (alcance.gruposModerados.length) opciones.push({ grupo_id: alcance.gruposModerados });
    if (alcance.conFila.length) opciones.push({ id: alcance.conFila });
    return { [Op.or]: opciones };
  }

  /** Un evento sin fin "termina" DURACION_POR_DEFECTO_MS después de empezar. */
  private filtroCuando(cuando: 'proximos' | 'pasados', ahora: Date): WhereEvento {
    const corte = new Date(ahora.getTime() - DURACION_POR_DEFECTO_MS);
    return cuando === 'proximos'
      ? { [Op.or]: [{ fin: { [Op.gte]: ahora } }, { fin: null, inicio: { [Op.gte]: corte } }] }
      : { [Op.or]: [{ fin: { [Op.lt]: ahora } }, { fin: null, inicio: { [Op.lt]: corte } }] };
  }

  private where(filtro: FiltroEventos): WhereEvento {
    const condiciones: WhereEvento[] = [this.filtroVisibles(filtro.alcance)];
    if (filtro.cuando && filtro.cuando !== 'todos') condiciones.push(this.filtroCuando(filtro.cuando, filtro.ahora));
    if (filtro.categoria) condiciones.push({ categoria: filtro.categoria as Evento['categoria'] });
    if (filtro.grupo_id) condiciones.push({ grupo_id: filtro.grupo_id });
    if (filtro.creador_id) condiciones.push({ creador_id: filtro.creador_id });
    if (filtro.ids) condiciones.push({ id: filtro.ids.length ? filtro.ids : [0] });
    if (filtro.desde) condiciones.push({ inicio: { [Op.gte]: filtro.desde } });
    if (filtro.hasta) condiciones.push({ inicio: { [Op.lte]: filtro.hasta } });
    if (filtro.rango) {
      const { desde, hasta } = filtro.rango;
      condiciones.push({ inicio: { [Op.lt]: hasta } });
      condiciones.push({ [Op.or]: [{ fin: { [Op.gte]: desde } }, { fin: null, inicio: { [Op.gte]: desde } }] });
    }
    if (filtro.texto) {
      const patron = `%${filtro.texto}%`;
      condiciones.push({
        [Op.or]: [{ titulo: { [Op.like]: patron } }, { descripcion: { [Op.like]: patron } }, { lugar: { [Op.like]: patron } }],
      });
    }
    return { [Op.and]: condiciones };
  }

  private orden(direccion: 'ASC' | 'DESC'): Order {
    return [
      ['inicio', direccion],
      ['id', direccion],
    ];
  }
}

/** Una persona en la lista de asistentes con su estado. */
export interface AsistenteDeEvento {
  usuario: Usuario;
  estado: EstadoAsistencia;
  invitado_por: number | null;
  desde: Date;
}

export class EventoAsistenteRepository extends BaseRepository<EventoAsistente> {
  protected readonly entidad = 'Asistencia';

  constructor() {
    super(EventoAsistente);
  }

  de(eventoId: number, usuarioId: number): Promise<EventoAsistente | null>;
  de(eventoId: number, usuarioId: number, transaction: Transaction): Promise<EventoAsistente | null>;
  de(eventoId: number, usuarioId: number, transaction?: Transaction): Promise<EventoAsistente | null> {
    return EventoAsistente.findOne({ where: { evento_id: eventoId, usuario_id: usuarioId }, transaction });
  }

  /** Mi estado en cada uno de los eventos indicados. */
  async estadosDe(usuarioId: number, eventoIds: number[]): Promise<Map<number, EstadoAsistencia>> {
    if (!eventoIds.length) return new Map();
    const filas = await this.findAll({ usuario_id: usuarioId, evento_id: eventoIds }, { attributes: ['evento_id', 'estado'] });
    return new Map(filas.map((f) => [f.evento_id, f.estado]));
  }

  /** Eventos donde tengo fila (cualquier estado) o uno en concreto. */
  async idsEventosDe(usuarioId: number): Promise<number[]>;
  async idsEventosDe(usuarioId: number, estado: EstadoAsistencia): Promise<number[]>;
  async idsEventosDe(usuarioId: number, estado?: EstadoAsistencia): Promise<number[]> {
    const filas = await this.findAll({ usuario_id: usuarioId, ...(estado ? { estado } : {}) }, { attributes: ['evento_id'] });
    return filas.map((f) => f.evento_id);
  }

  /** Ids de quienes tienen alguno de los estados (para avisarles). */
  async usuariosCon(eventoId: number, estados: EstadoAsistencia[]): Promise<number[]> {
    const filas = await this.findAll({ evento_id: eventoId, estado: estados }, { attributes: ['usuario_id'] });
    return filas.map((f) => f.usuario_id);
  }

  /** De la lista, quiénes ya tienen fila en el evento. */
  async yaRegistrados(eventoId: number, usuarioIds: number[]): Promise<Set<number>> {
    if (!usuarioIds.length) return new Set();
    const filas = await this.findAll({ evento_id: eventoId, usuario_id: usuarioIds }, { attributes: ['usuario_id'] });
    return new Set(filas.map((f) => f.usuario_id));
  }

  /** Primeras personas con "voy" (para la fila de avatares). */
  async vistaPrevia(eventoId: number, cantidad: number): Promise<Usuario[]> {
    const filas = await EventoAsistente.findAll({
      where: { evento_id: eventoId, estado: 'voy' },
      include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO], where: { activo: true } }],
      order: [['fecha_creacion', 'ASC'], ['id', 'ASC']],
      limit: cantidad,
    });
    return filas.map((f) => f.usuario!);
  }

  async paginarPorEstado(eventoId: number, estado: EstadoAsistencia, paginacion: Paginacion): Promise<Page<AsistenteDeEvento>> {
    const page = await this.paginate({ evento_id: eventoId, estado }, paginacion, {
      include: [{ model: Usuario, as: 'usuario', attributes: [...ATRIBUTOS_USUARIO_PUBLICO], where: { activo: true } }],
      order: [['fecha_creacion', 'ASC'], ['id', 'ASC']],
    });
    return {
      ...page,
      items: page.items.map((f) => ({ usuario: f.usuario!, estado: f.estado, invitado_por: f.invitado_por, desde: f.fecha_creacion })),
    };
  }
}

export const eventoRepository = new EventoRepository();
export const eventoAsistenteRepository = new EventoAsistenteRepository();
