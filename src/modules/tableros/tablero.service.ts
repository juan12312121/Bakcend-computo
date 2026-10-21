import type { InferAttributes, Sequelize } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  sequelize,
  type Grupo,
  type RolTablero,
  type Sprint,
  type Tablero,
  type TableroColumna,
  type TableroMiembro,
  type TareaActividad,
} from '../../infrastructure/database/models';
import { grupoMiembroRepository, type GrupoMiembroRepository } from '../grupos/grupo-miembro.repository';
import { grupoRepository, type GrupoRepository } from '../grupos/grupo.repository';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { sprintRepository, type SprintRepository } from './sprint.repository';
import { accesoTableros, avisosTablero, EVENTOS_TABLERO, type AccesoTableros, type AvisosTablero } from './tablero.acceso';
import { calcularAcceso, type AccesoTablero } from './tablero.permisos';
import { claveDeTarea, COLUMNAS_POR_PLANTILLA, generarClave } from './tablero.plantillas';
import { armarReporte, type ReporteTablero } from './tablero.reporte';
import {
  columnaRepository,
  etiquetaRepository,
  incluirUsuario,
  tableroMiembroRepository,
  tableroRepository,
  type ColumnaRepository,
  type ContextoUsuario,
  type EtiquetaRepository,
  type TableroMiembroRepository,
  type TableroRepository,
} from './tablero.repository';
import type {
  ActualizarColumnaDto,
  ActualizarEtiquetaDto,
  ActualizarTableroDto,
  CrearColumnaDto,
  CrearEtiquetaDto,
  CrearTableroDto,
  FiltroTareas,
  InvitarMiembroDto,
  ListarTablerosQuery,
} from './tablero.schemas';
import {
  actividadRepository,
  asignadoRepository,
  tareaRepository,
  type ActividadRepository,
  type AsignadoRepository,
  type EtiquetaVista,
  type TareaRepository,
  type TareaTarjeta,
  type UsuarioPublico,
} from './tarea.repository';

export type MiembroVista = InferAttributes<TableroMiembro> & { usuario: UsuarioPublico };

/** Tablero en el listado (tarjeta): datos + mi relación + progreso. */
export type TableroVista = InferAttributes<Tablero> & {
  grupo: Pick<InferAttributes<Grupo>, 'id' | 'nombre' | 'imagen_url'> | null;
  miembros: MiembroVista[];
  mi_rol: RolTablero | null;
  puede_editar: boolean;
  puede_administrar: boolean;
  total_tareas: number;
  tareas_completadas: number;
};

export type ColumnaVista = InferAttributes<TableroColumna> & {
  /** Tareas no archivadas (sin filtros): para mostrar el límite WIP. */
  total_tareas: number;
};

export type ColumnaConTareas = ColumnaVista & { tareas: TareaTarjeta[] };

export interface EpicaResumen {
  id: number;
  numero: number;
  clave: string;
  titulo: string;
}

/** Tablero abierto: columnas con sus tareas (ya filtradas), miembros, etiquetas, sprints y épicas. */
export type TableroDetalle = TableroVista & {
  creador: UsuarioPublico | null;
  columnas: ColumnaConTareas[];
  etiquetas: EtiquetaVista[];
  sprint_activo: InferAttributes<Sprint> | null;
  /** Activo y planeados (para elegir sprint en una tarea). */
  sprints: InferAttributes<Sprint>[];
  epicas: EpicaResumen[];
};

const plano = <T>(registro: { get(opciones: { plain: true }): unknown }) => registro.get({ plain: true }) as T;

export class TableroService extends BaseService<Tablero, TableroRepository> {
  constructor(
    repository: TableroRepository,
    private readonly miembros: TableroMiembroRepository,
    private readonly columnas: ColumnaRepository,
    private readonly etiquetas: EtiquetaRepository,
    private readonly tareas: TareaRepository,
    private readonly asignados: AsignadoRepository,
    private readonly sprints: SprintRepository,
    private readonly actividad: ActividadRepository,
    private readonly grupos: GrupoRepository,
    private readonly grupoMiembros: GrupoMiembroRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly notificaciones: NotificacionService,
    private readonly acceso: AccesoTableros,
    private readonly avisos: AvisosTablero,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  // ---------- Tableros ----------

  /** Personales donde soy miembro + los de grupos donde soy miembro activo (filtro opcional por grupo). */
  async listar(usuarioId: number, filtro: Partial<ListarTablerosQuery> = {}): Promise<TableroVista[]> {
    const contexto = await this.repository.contextoDe(usuarioId);
    const tableros = await this.repository.visibles(contexto, filtro);
    return this.vistas(tableros, usuarioId, contexto);
  }

  /** Crea el tablero con su clave, las columnas de la plantilla y al creador como admin (una transacción). */
  async crear(usuarioId: number, datos: CrearTableroDto): Promise<TableroDetalle> {
    if (datos.grupo_id) {
      await this.grupos.findByIdOrFail(datos.grupo_id);
      if (!(await this.grupoMiembros.esMiembroActivo(datos.grupo_id, usuarioId))) {
        throw new ForbiddenError('Solo los miembros del grupo pueden crear tableros en él');
      }
    }

    const tablero = await this.db.transaction(async (t) => {
      const nuevo = await this.repository.create(
        {
          nombre: datos.nombre,
          descripcion: datos.descripcion ?? null,
          grupo_id: datos.grupo_id ?? null,
          creador_id: usuarioId,
          clave: generarClave(datos.nombre),
          ...(datos.color ? { color: datos.color } : {}),
        },
        t,
      );
      await this.miembros.create({ tablero_id: nuevo.id, usuario_id: usuarioId, rol: 'admin' }, t);
      for (const [posicion, columna] of COLUMNAS_POR_PLANTILLA[datos.plantilla].entries()) {
        await this.columnas.create({ tablero_id: nuevo.id, nombre: columna.nombre, posicion, es_final: columna.es_final ?? false }, t);
      }
      await this.actividad.registrar({ tablero_id: nuevo.id, usuario_id: usuarioId, accion: 'creo_tablero', detalle: `creó el tablero «${nuevo.nombre}»` }, t);
      return nuevo;
    });
    return this.detalle(tablero.id, usuarioId);
  }

  /** Tablero completo; los filtros solo afectan a las tareas de las columnas. */
  async detalle(id: number, usuarioId: number): Promise<TableroDetalle>;
  async detalle(id: number, usuarioId: number, filtro: FiltroTareas): Promise<TableroDetalle>;
  async detalle(id: number, usuarioId: number, filtro: FiltroTareas = {}): Promise<TableroDetalle> {
    const { acceso } = await this.acceso.exigir(id, usuarioId, 'ver');
    const tablero = await this.repository.conRelaciones(id);

    const [columnas, miembros, etiquetas, abiertos, conteo, epicas, progreso] = await Promise.all([
      this.columnas.delTablero(id),
      this.miembros.delTablero(id),
      this.etiquetas.delTablero(id),
      this.sprints.abiertos(id),
      this.tareas.conteoPorColumna(id),
      this.tareas.epicas(id),
      this.tareas.progresoPorTablero([id]),
    ]);
    const sprintActivo = abiertos.find((s) => s.estado === 'activo') ?? null;
    const where = await this.tareas.whereFiltrado(id, filtro, { usuarioId, sprintActivoId: sprintActivo?.id ?? null });
    const tarjetas = await this.tareas.tarjetas(where, tablero.clave);

    const base = plano<InferAttributes<Tablero> & { grupo?: TableroVista['grupo']; creador?: UsuarioPublico }>(tablero);
    return {
      ...this.vista(base, miembros, acceso, progreso.get(id)),
      creador: base.creador ?? null,
      columnas: columnas.map((c) => ({
        ...plano<InferAttributes<TableroColumna>>(c),
        total_tareas: conteo.get(c.id) ?? 0,
        tareas: tarjetas.filter((t) => t.columna_id === c.id),
      })),
      etiquetas: etiquetas.map((e) => plano<EtiquetaVista>(e)),
      sprint_activo: sprintActivo ? plano<InferAttributes<Sprint>>(sprintActivo) : null,
      sprints: abiertos.map((s) => plano<InferAttributes<Sprint>>(s)),
      epicas: epicas.map((e) => ({ id: e.id, numero: e.numero, titulo: e.titulo, clave: claveDeTarea(tablero.clave, e.numero) })),
    };
  }

  /** Nombre, descripción y color: solo administradores. */
  async actualizar(id: number, usuarioId: number, datos: ActualizarTableroDto): Promise<TableroVista> {
    const { tablero } = await this.acceso.exigir(id, usuarioId, 'administrar');
    await this.repository.update(tablero, this.definidos(datos));
    await this.actividad.registrar({ tablero_id: id, usuario_id: usuarioId, accion: 'edito_tablero', detalle: 'editó los datos del tablero' });
    const vista = await this.vistaDe(id, usuarioId);
    this.avisos.emitir(id, EVENTOS_TABLERO.tablero, { motivo: 'datos', tablero: vista }, usuarioId);
    return vista;
  }

  async archivar(id: number, usuarioId: number, archivado: boolean): Promise<TableroVista> {
    const { tablero } = await this.acceso.exigir(id, usuarioId, 'administrar');
    if (tablero.archivado !== archivado) {
      await this.repository.update(tablero, { archivado });
      await this.actividad.registrar({
        tablero_id: id,
        usuario_id: usuarioId,
        accion: archivado ? 'archivo_tablero' : 'desarchivo_tablero',
        detalle: archivado ? 'archivó el tablero' : 'restauró el tablero',
      });
    }
    const vista = await this.vistaDe(id, usuarioId);
    this.avisos.emitir(id, EVENTOS_TABLERO.tablero, { motivo: 'datos', tablero: vista }, usuarioId);
    return vista;
  }

  /** Borra el tablero con todo su contenido (solo administradores). */
  async eliminar(id: number, usuarioId: number): Promise<void> {
    const { tablero } = await this.acceso.exigir(id, usuarioId, 'administrar');
    const tareaIds = (await this.tareas.findAll({ tablero_id: id }, { attributes: ['id'] })).map((t) => t.id);
    await this.db.transaction(async (t) => {
      await this.tareas.eliminarCompleta(tareaIds, t);
      await this.actividad.delete({ tablero_id: id }, t);
      await this.sprints.delete({ tablero_id: id }, t);
      await this.etiquetas.delete({ tablero_id: id }, t);
      await this.columnas.delete({ tablero_id: id }, t);
      await this.miembros.delete({ tablero_id: id }, t);
      await tablero.destroy({ transaction: t });
    });
    this.avisos.emitir(id, EVENTOS_TABLERO.tablero, { motivo: 'eliminado', tablero: null }, usuarioId);
  }

  // ---------- Miembros ----------

  async listarMiembros(id: number, usuarioId: number): Promise<MiembroVista[]> {
    await this.acceso.exigir(id, usuarioId, 'ver');
    return this.miembrosVista(id);
  }

  /** Agrega a alguien al tablero y le avisa (notificación 'invitacion_grupo' con entidad 'tablero'). */
  async invitar(id: number, usuarioId: number, { usuario_id, rol }: InvitarMiembroDto): Promise<MiembroVista[]> {
    const { tablero } = await this.acceso.exigir(id, usuarioId, 'administrar');
    const invitado = await this.usuarios.findByIdOrFail(usuario_id);
    if (await this.miembros.membresia(id, usuario_id)) throw new ConflictError('Esa persona ya es miembro del tablero');

    await this.miembros.create({ tablero_id: id, usuario_id, rol });
    await this.actividad.registrar({ tablero_id: id, usuario_id: usuarioId, accion: 'agrego_miembro', detalle: `agregó a ${invitado.nombre_completo} al tablero` });
    await this.notificaciones.notificar({
      usuario_id,
      de_usuario_id: usuarioId,
      tipo: 'invitacion_grupo',
      entidad_tipo: 'tablero',
      entidad_id: id,
      mensaje: `te agregó al tablero «${tablero.nombre}»`,
    });
    return this.avisarMiembros(id, usuarioId);
  }

  async cambiarRol(id: number, usuarioId: number, miembroId: number, rol: RolTablero): Promise<MiembroVista[]> {
    const { tablero } = await this.acceso.exigir(id, usuarioId, 'administrar');
    const membresia = await this.membresiaOrFail(id, miembroId);
    if (miembroId === tablero.creador_id && rol !== 'admin') throw new BadRequestError('El creador del tablero siempre es administrador');
    if (membresia.rol !== rol) {
      await this.miembros.update(membresia, { rol });
      await this.actividad.registrar({ tablero_id: id, usuario_id: usuarioId, accion: 'cambio_rol', detalle: `cambió el rol de ${membresia.usuario?.nombre_completo ?? 'un miembro'} a ${rol}` });
    }
    return this.avisarMiembros(id, usuarioId);
  }

  async quitarMiembro(id: number, usuarioId: number, miembroId: number): Promise<MiembroVista[]> {
    const { tablero } = await this.acceso.exigir(id, usuarioId, 'administrar');
    if (miembroId === tablero.creador_id) throw new BadRequestError('No se puede quitar al creador del tablero');
    const membresia = await this.membresiaOrFail(id, miembroId);
    await this.sacar(tablero, membresia);
    await this.actividad.registrar({ tablero_id: id, usuario_id: usuarioId, accion: 'quito_miembro', detalle: `quitó a ${membresia.usuario?.nombre_completo ?? 'un miembro'} del tablero` });
    return this.avisarMiembros(id, usuarioId);
  }

  async salir(id: number, usuarioId: number): Promise<void> {
    const tablero = await this.repository.findByIdOrFail(id);
    if (tablero.creador_id === usuarioId) throw new BadRequestError('El creador no puede salir del tablero');
    const membresia = await this.miembros.membresia(id, usuarioId);
    if (!membresia) throw new NotFoundError('Membresía', 'No eres miembro de este tablero');
    await this.sacar(tablero, membresia);
    await this.actividad.registrar({ tablero_id: id, usuario_id: usuarioId, accion: 'salio', detalle: 'salió del tablero' });
    await this.avisarMiembros(id, usuarioId);
  }

  // ---------- Columnas ----------

  async crearColumna(id: number, usuarioId: number, datos: CrearColumnaDto): Promise<ColumnaVista[]> {
    await this.acceso.exigir(id, usuarioId, 'editar');
    const posicion = await this.columnas.siguientePosicion(id);
    await this.columnas.create({ tablero_id: id, nombre: datos.nombre, posicion, limite_wip: datos.limite_wip ?? null, es_final: datos.es_final ?? false });
    await this.actividad.registrar({ tablero_id: id, usuario_id: usuarioId, accion: 'columna', detalle: `creó la columna «${datos.nombre}»` });
    return this.avisarColumnas(id, usuarioId);
  }

  /** Renombrar, límite WIP (null = sin límite) o marcar como final (sus tareas quedan completadas). */
  async editarColumna(id: number, columnaId: number, usuarioId: number, datos: ActualizarColumnaDto): Promise<ColumnaVista[]> {
    await this.acceso.exigir(id, usuarioId, 'editar');
    const columna = await this.columnas.delTableroOrFail(columnaId, id);
    const cambiaFinal = datos.es_final !== undefined && datos.es_final !== columna.es_final;
    await this.db.transaction(async (t) => {
      await this.columnas.update(columna, this.definidos(datos), t);
      if (cambiaFinal) await this.tareas.marcarCompletadasEnColumna(columnaId, datos.es_final === true, t);
    });
    await this.actividad.registrar({ tablero_id: id, usuario_id: usuarioId, accion: 'columna', detalle: `editó la columna «${columna.nombre}»` });
    if (cambiaFinal) this.avisos.emitir(id, EVENTOS_TABLERO.tablero, { motivo: 'tareas' }, usuarioId);
    return this.avisarColumnas(id, usuarioId);
  }

  /** Nuevo orden: hay que mandar TODAS las columnas del tablero. */
  async reordenarColumnas(id: number, usuarioId: number, orden: number[]): Promise<ColumnaVista[]> {
    await this.acceso.exigir(id, usuarioId, 'editar');
    const columnas = await this.columnas.delTablero(id);
    const actuales = new Set(columnas.map((c) => c.id));
    if (orden.length !== actuales.size || new Set(orden).size !== orden.length || !orden.every((c) => actuales.has(c))) {
      throw new BadRequestError('Debes enviar todas las columnas del tablero, sin repetir');
    }
    await this.db.transaction(async (t) => {
      for (const [posicion, columnaId] of orden.entries()) {
        const columna = columnas.find((c) => c.id === columnaId);
        if (columna && columna.posicion !== posicion) await this.columnas.update(columna, { posicion }, t);
      }
    });
    return this.avisarColumnas(id, usuarioId);
  }

  /** Si la columna tiene tareas hay que indicar `moverA` (otra columna del tablero). Siempre queda al menos una. */
  async eliminarColumna(id: number, columnaId: number, usuarioId: number, moverA?: number): Promise<ColumnaVista[]> {
    await this.acceso.exigir(id, usuarioId, 'editar');
    const columnas = await this.columnas.delTablero(id);
    const columna = columnas.find((c) => c.id === columnaId);
    if (!columna) throw new NotFoundError('Columna', 'La columna no existe en este tablero');
    if (columnas.length === 1) throw new BadRequestError('El tablero necesita al menos una columna');

    const conteo = await this.tareas.conteoPorColumna(id, false);
    const total = conteo.get(columnaId) ?? 0;
    let destinoNombre = '';
    if (total > 0) {
      if (!moverA) throw new BadRequestError(`La columna tiene ${total} tareas: indica en mover_a a qué columna pasarlas`);
      const destino = columnas.find((c) => c.id === moverA && c.id !== columnaId);
      if (!destino) throw new BadRequestError('mover_a debe ser otra columna de este tablero');
      if (destino.limite_wip !== null && destino.limite_wip !== undefined) {
        const activas = await this.tareas.conteoPorColumna(id);
        if ((activas.get(destino.id) ?? 0) + (activas.get(columnaId) ?? 0) > destino.limite_wip) {
          throw new ConflictError(`La columna «${destino.nombre}» no admite más de ${destino.limite_wip} tareas`);
        }
      }
      destinoNombre = destino.nombre;
      await this.db.transaction(async (t) => {
        await this.tareas.moverTodas(columnaId, destino, t);
        await columna.destroy({ transaction: t });
      });
    } else {
      await columna.destroy();
    }

    await this.actividad.registrar({
      tablero_id: id,
      usuario_id: usuarioId,
      accion: 'columna',
      detalle: total ? `eliminó la columna «${columna.nombre}» y pasó sus tareas a «${destinoNombre}»` : `eliminó la columna «${columna.nombre}»`,
    });
    if (total) this.avisos.emitir(id, EVENTOS_TABLERO.tablero, { motivo: 'tareas' }, usuarioId);
    return this.avisarColumnas(id, usuarioId);
  }

  // ---------- Etiquetas ----------

  async crearEtiqueta(id: number, usuarioId: number, datos: CrearEtiquetaDto): Promise<EtiquetaVista[]> {
    await this.acceso.exigir(id, usuarioId, 'editar');
    if (await this.etiquetas.exists({ tablero_id: id, nombre: datos.nombre })) throw new ConflictError('Ya existe una etiqueta con ese nombre');
    await this.etiquetas.create({ tablero_id: id, nombre: datos.nombre, color: datos.color });
    return this.avisarEtiquetas(id, usuarioId);
  }

  async editarEtiqueta(id: number, etiquetaId: number, usuarioId: number, datos: ActualizarEtiquetaDto): Promise<EtiquetaVista[]> {
    await this.acceso.exigir(id, usuarioId, 'editar');
    const etiqueta = await this.etiquetas.delTableroOrFail(etiquetaId, id);
    if (datos.nombre && datos.nombre !== etiqueta.nombre && (await this.etiquetas.exists({ tablero_id: id, nombre: datos.nombre }))) {
      throw new ConflictError('Ya existe una etiqueta con ese nombre');
    }
    await this.etiquetas.update(etiqueta, this.definidos(datos));
    return this.avisarEtiquetas(id, usuarioId);
  }

  /** La quita también de todas las tareas que la tenían. */
  async eliminarEtiqueta(id: number, etiquetaId: number, usuarioId: number): Promise<EtiquetaVista[]> {
    await this.acceso.exigir(id, usuarioId, 'editar');
    const etiqueta = await this.etiquetas.delTableroOrFail(etiquetaId, id);
    await this.db.transaction(async (t) => {
      await this.tareas.quitarEtiquetaDeTodas(etiquetaId, t);
      await etiqueta.destroy({ transaction: t });
    });
    return this.avisarEtiquetas(id, usuarioId);
  }

  // ---------- Actividad y reporte ----------

  async actividadDe(id: number, usuarioId: number, paginacion: Paginacion): Promise<Page<TareaActividad>> {
    await this.acceso.exigir(id, usuarioId, 'ver');
    return this.actividad.delTablero(id, paginacion);
  }

  /** Tareas por columna, responsable y prioridad, vencidas y burndown del sprint activo. */
  async reporte(id: number, usuarioId: number): Promise<ReporteTablero> {
    const { tablero } = await this.acceso.exigir(id, usuarioId, 'ver');
    const [columnas, tarjetas, sprint] = await Promise.all([
      this.columnas.delTablero(id),
      this.tareas.tarjetas({ tablero_id: id, archivada: false }, tablero.clave),
      this.sprints.activo(id),
    ]);
    return armarReporte(
      columnas.map((c) => ({ id: c.id, nombre: c.nombre, es_final: c.es_final })),
      tarjetas,
      sprint ? { sprint, tareas: tarjetas.filter((t) => t.sprint_id === sprint.id) } : null,
    );
  }

  // ---------- Apoyo ----------

  /** Arma la vista de varios tableros con permisos y progreso (sin una consulta por tablero). */
  private async vistas(tableros: Tablero[], usuarioId: number, contexto: ContextoUsuario): Promise<TableroVista[]> {
    const progreso = await this.tareas.progresoPorTablero(tableros.map((t) => t.id));
    return tableros.map((tablero) => {
      const acceso = calcularAcceso(
        tablero,
        usuarioId,
        contexto.rolesTablero.get(tablero.id) ?? null,
        tablero.grupo_id ? (contexto.rolesGrupo.get(tablero.grupo_id) ?? null) : null,
      );
      const base = plano<InferAttributes<Tablero> & { grupo?: TableroVista['grupo'] }>(tablero);
      return this.vista(base, tablero.miembros ?? [], acceso, progreso.get(tablero.id));
    });
  }

  private async vistaDe(id: number, usuarioId: number): Promise<TableroVista> {
    const contexto = await this.repository.contextoDe(usuarioId);
    const tablero = await this.repository.findByIdOrFail(id);
    const [vista] = await this.vistas([tablero], usuarioId, contexto);
    return { ...vista, miembros: await this.miembrosVista(id), grupo: tablero.grupo_id ? await this.grupoDe(tablero.grupo_id) : null };
  }

  private vista(
    base: InferAttributes<Tablero> & { grupo?: TableroVista['grupo']; miembros?: unknown; creador?: unknown },
    miembros: TableroMiembro[],
    acceso: AccesoTablero,
    progreso: { total: number; completadas: number } | undefined,
  ): TableroVista {
    const { miembros: _miembros, creador: _creador, ...datos } = base;
    return {
      ...datos,
      grupo: base.grupo ?? null,
      miembros: miembros.map((m) => plano<MiembroVista>(m)),
      mi_rol: acceso.rol,
      puede_editar: acceso.editar,
      puede_administrar: acceso.administrar,
      total_tareas: progreso?.total ?? 0,
      tareas_completadas: progreso?.completadas ?? 0,
    };
  }

  private async grupoDe(grupoId: number): Promise<TableroVista['grupo']> {
    const grupo = await this.grupos.findById(grupoId, { attributes: ['id', 'nombre', 'imagen_url'] });
    return grupo ? { id: grupo.id, nombre: grupo.nombre, imagen_url: grupo.imagen_url ?? null } : null;
  }

  private async miembrosVista(id: number): Promise<MiembroVista[]> {
    return (await this.miembros.delTablero(id)).map((m) => plano<MiembroVista>(m));
  }

  private async membresiaOrFail(tableroId: number, usuarioId: number): Promise<TableroMiembro> {
    const membresia = await this.miembros.findOne({ tablero_id: tableroId, usuario_id: usuarioId }, { include: [incluirUsuario('usuario')] });
    if (!membresia) throw new NotFoundError('Miembro', 'Esa persona no es miembro del tablero');
    return membresia;
  }

  /** Quita la membresía; si ya no puede ver el tablero (tampoco por el grupo), deja de ser responsable de sus tareas. */
  private async sacar(tablero: Tablero, membresia: TableroMiembro): Promise<void> {
    await this.miembros.delete({ id: membresia.id });
    if ((await this.repository.acceso(tablero, membresia.usuario_id)).ver) return;
    const tareaIds = (await this.tareas.findAll({ tablero_id: tablero.id }, { attributes: ['id'] })).map((t) => t.id);
    if (tareaIds.length) await this.asignados.delete({ usuario_id: membresia.usuario_id, tarea_id: tareaIds });
  }

  private async avisarMiembros(id: number, usuarioId: number): Promise<MiembroVista[]> {
    const miembros = await this.miembrosVista(id);
    this.avisos.emitir(id, EVENTOS_TABLERO.tablero, { motivo: 'miembros', miembros }, usuarioId);
    return miembros;
  }

  private async avisarColumnas(id: number, usuarioId: number): Promise<ColumnaVista[]> {
    const [columnas, conteo] = await Promise.all([this.columnas.delTablero(id), this.tareas.conteoPorColumna(id)]);
    const vista = columnas.map((c) => ({ ...plano<InferAttributes<TableroColumna>>(c), total_tareas: conteo.get(c.id) ?? 0 }));
    this.avisos.emitir(id, EVENTOS_TABLERO.columnas, { columnas: vista }, usuarioId);
    return vista;
  }

  private async avisarEtiquetas(id: number, usuarioId: number): Promise<EtiquetaVista[]> {
    const etiquetas = (await this.etiquetas.delTablero(id)).map((e) => plano<EtiquetaVista>(e));
    this.avisos.emitir(id, EVENTOS_TABLERO.tablero, { motivo: 'etiquetas', etiquetas }, usuarioId);
    return etiquetas;
  }

  /** Quita las claves `undefined` (zod deja las opcionales ausentes como undefined). */
  private definidos<T extends object>(datos: T): Partial<T> {
    return Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)) as Partial<T>;
  }
}

export const tableroService = new TableroService(
  tableroRepository,
  tableroMiembroRepository,
  columnaRepository,
  etiquetaRepository,
  tareaRepository,
  asignadoRepository,
  sprintRepository,
  actividadRepository,
  grupoRepository,
  grupoMiembroRepository,
  usuarioRepository,
  notificacionService,
  accesoTableros,
  avisosTablero,
  sequelize,
);
