import { Op, type InferAttributes, type Sequelize } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError } from '../../core/errors';
import { sequelize, type Sprint } from '../../infrastructure/database/models';
import { sprintRepository, type SprintRepository } from './sprint.repository';
import { accesoTableros, avisosTablero, EVENTOS_TABLERO, type AccesoTableros, type AvisosTablero } from './tablero.acceso';
import type { NivelAcceso } from './tablero.permisos';
import type { ActualizarSprintDto, CerrarSprintDto, CrearSprintDto, IniciarSprintDto } from './tablero.schemas';
import { actividadRepository, tareaRepository, type ActividadRepository, type TareaRepository, type TareaTarjeta } from './tarea.repository';

/** Duración por defecto de un sprint que se inicia sin fecha de fin. */
export const DIAS_SPRINT = 14;
const MS_DIA = 24 * 60 * 60 * 1000;

export type SprintVista = InferAttributes<Sprint>;

export type SprintConTareas = SprintVista & {
  tareas: TareaTarjeta[];
  puntos_total: number;
  puntos_completados: number;
};

/** Vista Jira: sprints abiertos (activo primero) con sus tareas y el backlog (sin sprint y sin terminar). */
export interface Backlog {
  sprints: SprintConTareas[];
  backlog: TareaTarjeta[];
}

export interface ResultadoCierre {
  sprint: SprintVista;
  /** Tareas sin terminar que cambiaron de sprint. */
  tareas_movidas: number;
  /** A dónde fueron (null = backlog). */
  destino_sprint_id: number | null;
}

const plano = (s: Sprint) => s.get({ plain: true }) as SprintVista;
const ORDEN_NUMERO: [string, string][] = [['numero', 'ASC']];

export class SprintService extends BaseService<Sprint, SprintRepository> {
  constructor(
    repository: SprintRepository,
    private readonly tareas: TareaRepository,
    private readonly actividad: ActividadRepository,
    private readonly acceso: AccesoTableros,
    private readonly avisos: AvisosTablero,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  async listar(tableroId: number, usuarioId: number): Promise<SprintVista[]> {
    await this.acceso.exigir(tableroId, usuarioId, 'ver');
    return (await this.repository.delTablero(tableroId)).map(plano);
  }

  async backlog(tableroId: number, usuarioId: number): Promise<Backlog> {
    const { tablero } = await this.acceso.exigir(tableroId, usuarioId, 'ver');
    const abiertos = await this.repository.abiertos(tableroId);
    const tarjetas = await this.tareas.tarjetas(
      { tablero_id: tableroId, archivada: false, [Op.or]: [{ sprint_id: null }, { sprint_id: { [Op.in]: abiertos.map((s) => s.id) } }] },
      tablero.clave,
      ORDEN_NUMERO,
    );
    const peso = (t: TareaTarjeta) => t.puntos ?? 0;
    return {
      sprints: abiertos.map((sprint) => {
        const tareas = tarjetas.filter((t) => t.sprint_id === sprint.id);
        return {
          ...plano(sprint),
          tareas,
          puntos_total: tareas.reduce((s, t) => s + peso(t), 0),
          puntos_completados: tareas.filter((t) => t.completada_en).reduce((s, t) => s + peso(t), 0),
        };
      }),
      backlog: tarjetas.filter((t) => t.sprint_id === null && !t.completada_en),
    };
  }

  async crear(tableroId: number, usuarioId: number, datos: CrearSprintDto): Promise<SprintVista> {
    await this.acceso.exigir(tableroId, usuarioId, 'editar');
    this.validarFechas(datos.inicio, datos.fin);
    const sprint = await this.repository.create({
      tablero_id: tableroId,
      nombre: datos.nombre,
      objetivo: datos.objetivo ?? null,
      inicio: datos.inicio ?? null,
      fin: datos.fin ?? null,
    });
    await this.registrar(tableroId, usuarioId, 'creo_sprint', `creó el sprint «${sprint.nombre}»`);
    return this.avisar(sprint, usuarioId);
  }

  async actualizar(sprintId: number, usuarioId: number, datos: ActualizarSprintDto): Promise<SprintVista> {
    const sprint = await this.cargar(sprintId, usuarioId, 'editar');
    if (sprint.estado === 'cerrado') throw new BadRequestError('El sprint ya está cerrado');
    this.validarFechas(datos.inicio === undefined ? sprint.inicio : datos.inicio, datos.fin === undefined ? sprint.fin : datos.fin);
    await this.repository.update(sprint, Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)));
    return this.avisar(sprint, usuarioId);
  }

  /** Sus tareas vuelven al backlog. El sprint activo hay que cerrarlo antes. */
  async eliminar(sprintId: number, usuarioId: number): Promise<void> {
    const sprint = await this.cargar(sprintId, usuarioId, 'editar');
    if (sprint.estado === 'activo') throw new BadRequestError('Cierra el sprint antes de eliminarlo');
    await this.db.transaction(async (t) => {
      await this.tareas.moverDeSprint(sprint.id, null, false, t);
      await sprint.destroy({ transaction: t });
    });
    await this.registrar(sprint.tablero_id, usuarioId, 'elimino_sprint', `eliminó el sprint «${sprint.nombre}»`);
    this.avisos.emitir(sprint.tablero_id, EVENTOS_TABLERO.tablero, { motivo: 'sprints' }, usuarioId);
  }

  /** Solo uno activo por tablero (409). Sin fechas: empieza ahora y dura 14 días. */
  async iniciar(sprintId: number, usuarioId: number, datos: IniciarSprintDto): Promise<SprintVista> {
    const sprint = await this.cargar(sprintId, usuarioId, 'editar');
    if (sprint.estado !== 'planeado') throw new BadRequestError('Solo se puede iniciar un sprint planeado');
    const activo = await this.repository.activo(sprint.tablero_id);
    if (activo) throw new ConflictError(`Ya hay un sprint activo en este tablero: «${activo.nombre}»`);

    const inicio = datos.inicio ?? new Date();
    const fin = datos.fin ?? sprint.fin ?? new Date(inicio.getTime() + (DIAS_SPRINT - 1) * MS_DIA);
    this.validarFechas(inicio, fin);
    await this.repository.update(sprint, { estado: 'activo', inicio, fin });
    await this.registrar(sprint.tablero_id, usuarioId, 'inicio_sprint', `inició el sprint «${sprint.nombre}»`);
    return this.avisar(sprint, usuarioId);
  }

  /** Las tareas sin terminar pasan al backlog o al sprint planeado indicado. */
  async cerrar(sprintId: number, usuarioId: number, { mover_a_sprint_id }: CerrarSprintDto): Promise<ResultadoCierre> {
    const sprint = await this.cargar(sprintId, usuarioId, 'editar');
    if (sprint.estado !== 'activo') throw new BadRequestError('Solo se puede cerrar el sprint activo');
    const destino = mover_a_sprint_id ? await this.repository.findOne({ id: mover_a_sprint_id, tablero_id: sprint.tablero_id }) : null;
    if (mover_a_sprint_id && (!destino || destino.estado !== 'planeado')) {
      throw new BadRequestError('Las tareas solo pueden pasar a un sprint planeado de este tablero');
    }

    const movidas = await this.db.transaction(async (t) => {
      const cantidad = await this.tareas.moverDeSprint(sprint.id, destino?.id ?? null, true, t);
      await this.repository.update(sprint, { estado: 'cerrado', fin: sprint.fin ?? new Date() }, t);
      return cantidad;
    });
    const a = destino ? `al sprint «${destino.nombre}»` : 'al backlog';
    await this.registrar(sprint.tablero_id, usuarioId, 'cerro_sprint', `cerró el sprint «${sprint.nombre}» (${movidas} tareas sin terminar pasaron ${a})`);
    return { sprint: await this.avisar(sprint, usuarioId), tareas_movidas: movidas, destino_sprint_id: destino?.id ?? null };
  }

  // ---------- Apoyo ----------

  private async cargar(sprintId: number, usuarioId: number, nivel: NivelAcceso): Promise<Sprint> {
    const sprint = await this.repository.findByIdOrFail(sprintId);
    await this.acceso.exigir(sprint.tablero_id, usuarioId, nivel);
    return sprint;
  }

  private validarFechas(inicio: Date | null | undefined, fin: Date | null | undefined): void {
    if (inicio && fin && new Date(fin).getTime() < new Date(inicio).getTime()) {
      throw new BadRequestError('La fecha de fin no puede ser anterior al inicio');
    }
  }

  private registrar(tableroId: number, usuarioId: number, accion: string, detalle: string) {
    return this.actividad.registrar({ tablero_id: tableroId, usuario_id: usuarioId, accion, detalle });
  }

  /** Avisa a la sala que cambiaron los sprints (el cliente recarga backlog/tablero). */
  private async avisar(sprint: Sprint, usuarioId: number): Promise<SprintVista> {
    await sprint.reload();
    const vista = plano(sprint);
    this.avisos.emitir(sprint.tablero_id, EVENTOS_TABLERO.tablero, { motivo: 'sprints', sprint: vista }, usuarioId);
    return vista;
  }
}

export const sprintService = new SprintService(sprintRepository, tareaRepository, actividadRepository, accesoTableros, avisosTablero, sequelize);
