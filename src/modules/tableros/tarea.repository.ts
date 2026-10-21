import { Op, type InferAttributes, type Transaction, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import { NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  EtiquetaTablero,
  Tablero,
  Tarea,
  TareaActividad,
  TareaAsignado,
  TareaChecklist,
  TareaComentario,
  TareaEtiqueta,
  Usuario,
} from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import { incluirUsuario } from './tablero.repository';
import { claveDeTarea } from './tablero.plantillas';
import type { FiltroTareas } from './tablero.schemas';

export type UsuarioPublico = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]>;
export type EtiquetaVista = InferAttributes<EtiquetaTablero>;

/** Tarea tal como se pinta en una tarjeta del Kanban, en la lista o en el backlog. */
export type TareaTarjeta = InferAttributes<Tarea> & {
  /** "TRI-12". */
  clave: string;
  asignados: UsuarioPublico[];
  etiquetas: EtiquetaVista[];
  checklist_total: number;
  checklist_hechos: number;
  total_comentarios: number;
};

/** Datos del tablero que acompañan a una tarea fuera de él ("Mis tareas"). */
export type TableroResumen = Pick<InferAttributes<Tablero>, 'id' | 'nombre' | 'clave' | 'color'>;

/** Tarea con su tablero cargado (asociación definida en models/index.ts). */
type TareaConTablero = Tarea & { tablero?: Tablero };

const ORDEN_TABLERO: [string, string][] = [
  ['posicion', 'ASC'],
  ['id', 'ASC'],
];

/** Búsqueda "contiene" para LIKE. */
const textoLike = (texto: string) => `%${texto}%`;

const includesTarjeta = () => [
  { model: Usuario, as: 'asignados', attributes: [...ATRIBUTOS_USUARIO_PUBLICO], through: { attributes: [] } },
  { model: EtiquetaTablero, as: 'etiquetas', attributes: ['id', 'tablero_id', 'nombre', 'color'], through: { attributes: [] } },
];

export interface ContextoFiltro {
  usuarioId: number;
  /** Id del sprint activo del tablero (para `sprint=activo`). */
  sprintActivoId: number | null;
}

export class TareaRepository extends BaseRepository<Tarea> {
  protected readonly entidad = 'Tarea';

  constructor() {
    super(Tarea);
  }

  // ---------- Tarjetas ----------

  /** Tarjetas de un tablero que cumplen `where`, en el orden del Kanban. */
  tarjetas(where: WhereOptions<Tarea>, claveTablero: string): Promise<TareaTarjeta[]>;
  tarjetas(where: WhereOptions<Tarea>, claveTablero: string, orden: [string, string][]): Promise<TareaTarjeta[]>;
  async tarjetas(where: WhereOptions<Tarea>, claveTablero: string, orden: [string, string][] = ORDEN_TABLERO): Promise<TareaTarjeta[]> {
    const tareas = await Tarea.findAll({ where, include: includesTarjeta(), order: orden });
    return this.aTarjetas(tareas, () => claveTablero);
  }

  /** Una tarjeta por id (404 si no existe). */
  async tarjeta(id: number, claveTablero: string): Promise<TareaTarjeta> {
    const [tarjeta] = await this.tarjetas({ id }, claveTablero);
    if (!tarjeta) throw new NotFoundError(this.entidad);
    return tarjeta;
  }

  /** Página de tarjetas (vista de lista), por número descendente. */
  async paginaTarjetas(where: WhereOptions<Tarea>, claveTablero: string, { limit, offset }: Paginacion): Promise<Page<TareaTarjeta>> {
    const { rows, count } = await Tarea.findAndCountAll({
      where,
      include: includesTarjeta(),
      order: [['numero', 'DESC']],
      limit,
      offset,
      distinct: true,
    });
    return { items: await this.aTarjetas(rows, () => claveTablero), total: count, limit, offset };
  }

  /** Tarjetas de varios tableros con los datos de cada tablero (para "Mis tareas"); `whereTablero` filtra los tableros. */
  async tarjetasConTablero(where: WhereOptions<Tarea>, whereTablero: WhereOptions<Tablero>): Promise<(TareaTarjeta & { tablero: TableroResumen })[]> {
    const tareas = (await Tarea.findAll({
      where,
      include: [...includesTarjeta(), { model: Tablero, as: 'tablero', attributes: ['id', 'nombre', 'clave', 'color'], where: whereTablero, required: true }],
    })) as TareaConTablero[];
    const tarjetas = await this.aTarjetas(tareas, (t) => (t as TareaConTablero).tablero?.clave ?? '');
    return tarjetas.map((tarjeta, i) => {
      const tablero = tareas[i].tablero;
      return {
        ...tarjeta,
        tablero: { id: tablero?.id ?? tarjeta.tablero_id, nombre: tablero?.nombre ?? '', clave: tablero?.clave ?? '', color: tablero?.color ?? '' },
      };
    });
  }

  private async aTarjetas(tareas: Tarea[], claveDe: (t: Tarea) => string): Promise<TareaTarjeta[]> {
    const { checklist, comentarios } = await this.conteos(tareas.map((t) => t.id));
    return tareas.map((t) => {
      const plano = t.get({ plain: true }) as TareaTarjeta & { tablero?: unknown };
      delete plano.tablero;
      const items = checklist.get(t.id) ?? { total: 0, hechos: 0 };
      return {
        ...plano,
        clave: claveDeTarea(claveDe(t), t.numero),
        asignados: (t.asignados ?? []).map((u) => u.get({ plain: true }) as UsuarioPublico),
        etiquetas: (t.etiquetas ?? []).map((e) => e.get({ plain: true }) as EtiquetaVista),
        checklist_total: items.total,
        checklist_hechos: items.hechos,
        total_comentarios: comentarios.get(t.id) ?? 0,
      };
    });
  }

  /** Progreso del checklist y número de comentarios de varias tareas (2 consultas agrupadas). */
  private async conteos(ids: number[]) {
    const checklist = new Map<number, { total: number; hechos: number }>();
    const comentarios = new Map<number, number>();
    if (!ids.length) return { checklist, comentarios };

    const [items, notas] = await Promise.all([
      TareaChecklist.count({ where: { tarea_id: ids }, group: ['tarea_id', 'hecho'] }),
      TareaComentario.count({ where: { tarea_id: ids }, group: ['tarea_id'] }),
    ]);
    for (const fila of items) {
      const id = Number(fila.tarea_id);
      const actual = checklist.get(id) ?? { total: 0, hechos: 0 };
      const cantidad = Number(fila.count);
      actual.total += cantidad;
      if (fila.hecho === true || Number(fila.hecho) === 1) actual.hechos += cantidad;
      checklist.set(id, actual);
    }
    for (const fila of notas) comentarios.set(Number(fila.tarea_id), Number(fila.count));
    return { checklist, comentarios };
  }

  // ---------- Filtros ----------

  /** Arma el `where` de un tablero con los filtros de la barra (texto, asignado, etiqueta, tipo, prioridad, sprint, vencidas). */
  async whereFiltrado(tableroId: number, filtro: FiltroTareas, contexto: ContextoFiltro): Promise<WhereOptions<Tarea>> {
    const condiciones: WhereOptions<Tarea>[] = [{ tablero_id: tableroId, archivada: false }];

    const texto = filtro.q?.trim();
    if (texto) {
      const numero = /^(?:[a-z]+-)?(\d+)$/i.exec(texto);
      const opciones: WhereOptions<Tarea>[] = [{ titulo: { [Op.like]: textoLike(texto) } }, { descripcion: { [Op.like]: textoLike(texto) } }];
      if (numero) opciones.push({ numero: Number(numero[1]) });
      condiciones.push({ [Op.or]: opciones });
    }
    if (filtro.asignado !== undefined) {
      const usuarioId = filtro.asignado === 'yo' ? contexto.usuarioId : filtro.asignado;
      const filas = await TareaAsignado.findAll({ where: { usuario_id: usuarioId }, attributes: ['tarea_id'] });
      condiciones.push({ id: { [Op.in]: filas.map((f) => f.tarea_id) } });
    }
    if (filtro.etiqueta !== undefined) {
      const filas = await TareaEtiqueta.findAll({ where: { etiqueta_id: filtro.etiqueta }, attributes: ['tarea_id'] });
      condiciones.push({ id: { [Op.in]: filas.map((f) => f.tarea_id) } });
    }
    if (filtro.tipo) condiciones.push({ tipo: filtro.tipo });
    if (filtro.prioridad) condiciones.push({ prioridad: filtro.prioridad });
    if (filtro.sprint === 'backlog') condiciones.push({ sprint_id: null });
    else if (filtro.sprint === 'activo') condiciones.push({ sprint_id: contexto.sprintActivoId ?? -1 });
    else if (filtro.sprint !== undefined) condiciones.push({ sprint_id: filtro.sprint });
    if (filtro.vencidas) condiciones.push({ fecha_limite: { [Op.lt]: new Date() }, completada_en: null });

    return { [Op.and]: condiciones };
  }

  // ---------- Posiciones ----------

  async maxPosicion(columnaId: number, transaction?: Transaction): Promise<number | null> {
    return Tarea.max<number | null, Tarea>('posicion', { where: { columna_id: columnaId }, transaction });
  }

  /** Tareas no archivadas de una columna (para el límite WIP). */
  contarEnColumna(columnaId: number): Promise<number> {
    return this.count({ columna_id: columnaId, archivada: false });
  }

  /** Tareas (incluye archivadas) por columna de un tablero. */
  async conteoPorColumna(tableroId: number, soloActivas = true): Promise<Map<number, number>> {
    const filas = await Tarea.count({ where: { tablero_id: tableroId, ...(soloActivas ? { archivada: false } : {}) }, group: ['columna_id'] });
    return new Map(filas.map((f) => [Number(f.columna_id), Number(f.count)]));
  }

  /** Renumera 1..n las posiciones de una columna (cuando dos vecinas quedan demasiado juntas). */
  async renumerar(columnaId: number, transaction: Transaction): Promise<void> {
    const tareas = await Tarea.findAll({ where: { columna_id: columnaId }, order: ORDEN_TABLERO, attributes: ['id', 'posicion'], transaction });
    for (const [i, tarea] of tareas.entries()) {
      if (tarea.posicion !== i + 1) await tarea.update({ posicion: i + 1 }, { transaction });
    }
  }

  /** Pasa todas las tareas de una columna al final de otra (al borrar la columna), ajustando `completada_en`. */
  async moverTodas(desdeId: number, destino: { id: number; es_final: boolean }, transaction: Transaction): Promise<number> {
    const tareas = await Tarea.findAll({ where: { columna_id: desdeId }, order: ORDEN_TABLERO, transaction });
    const base = (await this.maxPosicion(destino.id, transaction)) ?? 0;
    const ahora = new Date();
    for (const [i, tarea] of tareas.entries()) {
      await tarea.update(
        { columna_id: destino.id, posicion: base + i + 1, completada_en: destino.es_final ? (tarea.completada_en ?? ahora) : null },
        { transaction },
      );
    }
    return tareas.length;
  }

  /** Una columna pasó a ser (o dejó de ser) final: sus tareas quedan completadas (o vuelven a pendientes). */
  async marcarCompletadasEnColumna(columnaId: number, completadas: boolean, transaction: Transaction): Promise<void> {
    if (completadas) await Tarea.update({ completada_en: new Date() }, { where: { columna_id: columnaId, completada_en: null }, transaction });
    else await Tarea.update({ completada_en: null }, { where: { columna_id: columnaId }, transaction });
  }

  /** Las tareas de una épica que deja de existir (o de ser épica) quedan sin épica. */
  async soltarHijas(epicaId: number, transaction: Transaction): Promise<void> {
    await Tarea.update({ epica_id: null }, { where: { epica_id: epicaId }, transaction });
  }

  async quitarEtiquetaDeTodas(etiquetaId: number, transaction: Transaction): Promise<void> {
    await TareaEtiqueta.destroy({ where: { etiqueta_id: etiquetaId }, transaction });
  }

  /** Pasa las tareas de un sprint a otro (o al backlog con null). Devuelve cuántas movió. */
  async moverDeSprint(desdeId: number, haciaId: number | null, soloPendientes: boolean, transaction: Transaction): Promise<number> {
    const [movidas] = await Tarea.update(
      { sprint_id: haciaId },
      { where: { sprint_id: desdeId, ...(soloPendientes ? { completada_en: null } : {}) }, transaction },
    );
    return movidas;
  }

  /** Total y completadas (no archivadas) de varios tableros. */
  async progresoPorTablero(tableroIds: number[]): Promise<Map<number, { total: number; completadas: number }>> {
    const progreso = new Map<number, { total: number; completadas: number }>();
    if (!tableroIds.length) return progreso;
    const [totales, hechas] = await Promise.all([
      Tarea.count({ where: { tablero_id: tableroIds, archivada: false }, group: ['tablero_id'] }),
      Tarea.count({ where: { tablero_id: tableroIds, archivada: false, completada_en: { [Op.ne]: null } }, group: ['tablero_id'] }),
    ]);
    for (const fila of totales) progreso.set(Number(fila.tablero_id), { total: Number(fila.count), completadas: 0 });
    for (const fila of hechas) {
      const actual = progreso.get(Number(fila.tablero_id));
      if (actual) actual.completadas = Number(fila.count);
    }
    return progreso;
  }

  /** Borra una tarea con todo lo que cuelga de ella (responsables, etiquetas, checklist, comentarios). */
  async eliminarCompleta(tareaIds: number[], transaction: Transaction): Promise<void> {
    if (!tareaIds.length) return;
    const where = { tarea_id: tareaIds };
    // En secuencia: una transacción usa una sola conexión.
    await TareaAsignado.destroy({ where, transaction });
    await TareaEtiqueta.destroy({ where, transaction });
    await TareaChecklist.destroy({ where, transaction });
    await TareaComentario.destroy({ where, transaction });
    await TareaActividad.update({ tarea_id: null }, { where, transaction });
    await Tarea.update({ epica_id: null }, { where: { epica_id: tareaIds }, transaction });
    await Tarea.destroy({ where: { id: tareaIds }, transaction });
  }

  // ---------- Consultas especiales ----------

  /** Ids de las tareas asignadas a un usuario. */
  async idsAsignadasA(usuarioId: number): Promise<number[]> {
    const filas = await TareaAsignado.findAll({ where: { usuario_id: usuarioId }, attributes: ['tarea_id'] });
    return filas.map((f) => f.tarea_id);
  }

  /** Sin terminar, sin aviso enviado y con fecha límite en el rango (para los recordatorios). */
  porVencer(desde: Date, hasta: Date): Promise<Tarea[]> {
    return Tarea.findAll({
      where: {
        completada_en: null,
        archivada: false,
        recordatorio_enviado: false,
        fecha_limite: { [Op.gt]: desde, [Op.lte]: hasta },
      },
      include: [
        { model: Usuario, as: 'asignados', attributes: ['id'], through: { attributes: [] } },
        { model: Tablero, as: 'tablero', attributes: ['id', 'clave', 'creador_id', 'archivado'] },
      ],
    });
  }

  /** Épicas del tablero (para elegir una al editar). */
  epicas(tableroId: number): Promise<Tarea[]> {
    return this.findAll({ tablero_id: tableroId, tipo: 'epica', archivada: false }, { attributes: ['id', 'numero', 'titulo'], order: [['numero', 'ASC']] });
  }
}

export class AsignadoRepository extends BaseRepository<TareaAsignado> {
  protected readonly entidad = 'Responsable';

  constructor() {
    super(TareaAsignado);
  }

  idsDe(tareaId: number): Promise<number[]> {
    return this.findAll({ tarea_id: tareaId }, { attributes: ['usuario_id'] }).then((filas) => filas.map((f) => f.usuario_id));
  }
}

export class TareaEtiquetaRepository extends BaseRepository<TareaEtiqueta> {
  protected readonly entidad = 'Etiqueta de la tarea';

  constructor() {
    super(TareaEtiqueta);
  }
}

export class ChecklistRepository extends BaseRepository<TareaChecklist> {
  protected readonly entidad = 'Elemento del checklist';

  constructor() {
    super(TareaChecklist);
  }

  deTarea(tareaId: number): Promise<TareaChecklist[]> {
    return this.findAll(
      { tarea_id: tareaId },
      {
        order: [
          ['posicion', 'ASC'],
          ['id', 'ASC'],
        ],
      },
    );
  }

  async deTareaOrFail(id: number, tareaId: number): Promise<TareaChecklist> {
    const item = await this.findOne({ id, tarea_id: tareaId });
    if (!item) throw new NotFoundError(this.entidad, 'El elemento no existe en esta tarea');
    return item;
  }

  async siguientePosicion(tareaId: number): Promise<number> {
    const maxima = await TareaChecklist.max<number | null, TareaChecklist>('posicion', { where: { tarea_id: tareaId } });
    return (maxima ?? -1) + 1;
  }
}

export class ComentarioTareaRepository extends BaseRepository<TareaComentario> {
  protected readonly entidad = 'Comentario';

  constructor() {
    super(TareaComentario);
  }

  protected override opcionesPorDefecto() {
    return { include: [incluirUsuario('autor')] };
  }

  deTarea(tareaId: number): Promise<TareaComentario[]> {
    return this.findAll(
      { tarea_id: tareaId },
      {
        order: [
          ['fecha_creacion', 'ASC'],
          ['id', 'ASC'],
        ],
      },
    );
  }

  async deTareaOrFail(id: number, tareaId: number): Promise<TareaComentario> {
    const comentario = await this.findOne({ id, tarea_id: tareaId });
    if (!comentario) throw new NotFoundError(this.entidad, 'El comentario no existe en esta tarea');
    return comentario;
  }
}

export interface NuevaActividad {
  tablero_id: number;
  tarea_id?: number | null;
  usuario_id: number;
  accion: string;
  detalle: string;
}

export class ActividadRepository extends BaseRepository<TareaActividad> {
  protected readonly entidad = 'Actividad';

  constructor() {
    super(TareaActividad);
  }

  protected override opcionesPorDefecto() {
    return {
      include: [incluirUsuario('usuario')],
      order: [
        ['fecha_creacion', 'DESC'],
        ['id', 'DESC'],
      ] as [string, string][],
    };
  }

  registrar(datos: NuevaActividad): Promise<TareaActividad>;
  registrar(datos: NuevaActividad, transaction: Transaction): Promise<TareaActividad>;
  registrar(datos: NuevaActividad, transaction?: Transaction): Promise<TareaActividad> {
    return this.create({ ...datos, tarea_id: datos.tarea_id ?? null }, transaction as Transaction);
  }

  delTablero(tableroId: number, paginacion: Paginacion): Promise<Page<TareaActividad>> {
    return this.paginate({ tablero_id: tableroId }, paginacion);
  }

  deTarea(tareaId: number, paginacion: Paginacion): Promise<Page<TareaActividad>> {
    return this.paginate({ tarea_id: tareaId }, paginacion);
  }

  recientesDeTarea(tareaId: number, limite: number): Promise<TareaActividad[]> {
    return this.findAll({ tarea_id: tareaId }, { limit: limite });
  }
}

export const tareaRepository = new TareaRepository();
export const asignadoRepository = new AsignadoRepository();
export const tareaEtiquetaRepository = new TareaEtiquetaRepository();
export const checklistRepository = new ChecklistRepository();
export const comentarioTareaRepository = new ComentarioTareaRepository();
export const actividadRepository = new ActividadRepository();
