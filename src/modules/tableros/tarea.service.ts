import { Op, type InferAttributes, type Sequelize } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  sequelize,
  type Sprint,
  type Tablero,
  type TableroColumna,
  type Tarea,
  type TareaActividad,
  type TareaChecklist,
  type TareaComentario,
} from '../../infrastructure/database/models';
import type { AvisadorPush } from '../../infrastructure/push';
import { dispositivoService } from '../dispositivos/dispositivo.service';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { sprintRepository, type SprintRepository } from './sprint.repository';
import { accesoTableros, avisosTablero, EVENTOS_TABLERO, type AccesoTableros, type AvisosTablero } from './tablero.acceso';
import type { AccesoTablero, NivelAcceso } from './tablero.permisos';
import { claveDeTarea } from './tablero.plantillas';
import {
  columnaRepository,
  etiquetaRepository,
  tableroRepository,
  type ColumnaRepository,
  type EtiquetaRepository,
  type TableroRepository,
} from './tablero.repository';
import type { ActualizarItemDto, ActualizarTareaDto, CrearTareaDto, ListarTareasQuery, MoverTareaDto } from './tablero.schemas';
import { necesitaRenumerar, posicionEntre } from './tarea.posicion';
import {
  actividadRepository,
  asignadoRepository,
  checklistRepository,
  comentarioTareaRepository,
  tareaEtiquetaRepository,
  tareaRepository,
  type ActividadRepository,
  type AsignadoRepository,
  type ChecklistRepository,
  type ComentarioTareaRepository,
  type TableroResumen,
  type TareaEtiquetaRepository,
  type TareaRepository,
  type TareaTarjeta,
  type UsuarioPublico,
} from './tarea.repository';

/** Horas antes del vencimiento en que se avisa a los responsables. */
export const HORAS_RECORDATORIO = 24;
/** Cada cuánto se buscan tareas por vencer. */
export const MINUTOS_RECORDATORIOS = 15;
/** Actividad reciente que viaja en el detalle de una tarea. */
const ACTIVIDAD_EN_DETALLE = 20;

const MS_HORA = 60 * 60 * 1000;

/** Nombre legible de cada campo editable (para la actividad "editó TRI-3: prioridad, fecha límite"). */
const NOMBRES_CAMPOS: Readonly<Record<keyof ActualizarTareaDto, string>> = {
  titulo: 'título',
  descripcion: 'descripción',
  tipo: 'tipo',
  prioridad: 'prioridad',
  puntos: 'puntos',
  fecha_limite: 'fecha límite',
  epica_id: 'épica',
  sprint_id: 'sprint',
};

export type ComentarioVista = InferAttributes<TareaComentario> & { autor: UsuarioPublico };
export type ActividadVista = InferAttributes<TareaActividad> & { usuario: UsuarioPublico };

/** Todo lo de una tarea para el panel de detalle. */
export type TareaDetalle = TareaTarjeta & {
  tablero: TableroResumen & { grupo_id: number | null };
  creador: UsuarioPublico | null;
  columna: Pick<InferAttributes<TableroColumna>, 'id' | 'nombre' | 'es_final'>;
  sprint: Pick<InferAttributes<Sprint>, 'id' | 'nombre' | 'estado'> | null;
  epica: { id: number; numero: number; clave: string; titulo: string } | null;
  checklist: InferAttributes<TareaChecklist>[];
  comentarios: ComentarioVista[];
  actividad: ActividadVista[];
  puede_editar: boolean;
  puede_administrar: boolean;
};

/** Tarea de "Mis tareas": tarjeta + datos de su tablero. */
export type TareaConTablero = TareaTarjeta & { tablero: TableroResumen };

interface TareaCargada {
  tarea: Tarea;
  tablero: Tablero;
  acceso: AccesoTablero;
  clave: string;
}

const plano = <T>(registro: { get(opciones: { plain: true }): unknown }) => registro.get({ plain: true }) as T;
const iguales = (a: unknown, b: unknown) => {
  const normal = (v: unknown) => (v instanceof Date ? v.getTime() : (v ?? null));
  return normal(a) === normal(b);
};

export class TareaService extends BaseService<Tarea, TareaRepository> {
  constructor(
    repository: TareaRepository,
    private readonly tableros: TableroRepository,
    private readonly columnas: ColumnaRepository,
    private readonly etiquetas: EtiquetaRepository,
    private readonly sprints: SprintRepository,
    private readonly asignados: AsignadoRepository,
    private readonly tareaEtiquetas: TareaEtiquetaRepository,
    private readonly checklist: ChecklistRepository,
    private readonly comentarios: ComentarioTareaRepository,
    private readonly actividad: ActividadRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly notificaciones: NotificacionService,
    private readonly push: AvisadorPush,
    private readonly acceso: AccesoTableros,
    private readonly avisos: AvisosTablero,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  // ---------- Consultas ----------

  /** Vista de lista: tareas del tablero con filtros, paginadas (más recientes primero). */
  async listar(tableroId: number, usuarioId: number, { limit, offset, ...filtro }: ListarTareasQuery): Promise<Page<TareaTarjeta>> {
    const { tablero } = await this.acceso.exigir(tableroId, usuarioId, 'ver');
    const sprintActivo = await this.sprints.activo(tableroId);
    const where = await this.repository.whereFiltrado(tableroId, filtro, { usuarioId, sprintActivoId: sprintActivo?.id ?? null });
    return this.repository.paginaTarjetas(where, tablero.clave, { limit, offset });
  }

  async detalle(tareaId: number, usuarioId: number): Promise<TareaDetalle> {
    const { tarea, tablero, acceso, clave } = await this.cargar(tareaId, usuarioId, 'ver');
    const [tarjeta, creador, columna, sprint, epica, checklist, comentarios, actividad] = await Promise.all([
      this.repository.tarjeta(tarea.id, tablero.clave),
      this.usuarios.findById(tarea.creador_id),
      this.columnas.findByIdOrFail(tarea.columna_id),
      tarea.sprint_id ? this.sprints.findById(tarea.sprint_id) : null,
      tarea.epica_id ? this.repository.findById(tarea.epica_id) : null,
      this.checklist.deTarea(tarea.id),
      this.comentarios.deTarea(tarea.id),
      this.actividad.recientesDeTarea(tarea.id, ACTIVIDAD_EN_DETALLE),
    ]);
    return {
      ...tarjeta,
      clave,
      tablero: { id: tablero.id, nombre: tablero.nombre, clave: tablero.clave, color: tablero.color, grupo_id: tablero.grupo_id ?? null },
      creador: creador
        ? {
            id: creador.id,
            nombre_usuario: creador.nombre_usuario,
            nombre_completo: creador.nombre_completo,
            foto_perfil_url: creador.foto_perfil_url,
            carrera: creador.carrera,
          }
        : null,
      columna: { id: columna.id, nombre: columna.nombre, es_final: columna.es_final },
      sprint: sprint ? { id: sprint.id, nombre: sprint.nombre, estado: sprint.estado } : null,
      epica: epica ? { id: epica.id, numero: epica.numero, titulo: epica.titulo, clave: claveDeTarea(tablero.clave, epica.numero) } : null,
      checklist: checklist.map((i) => plano<InferAttributes<TareaChecklist>>(i)),
      comentarios: comentarios.map((c) => plano<ComentarioVista>(c)),
      actividad: actividad.map((a) => plano<ActividadVista>(a)),
      puede_editar: acceso.editar,
      puede_administrar: acceso.administrar,
    };
  }

  async actividadDe(tareaId: number, usuarioId: number, paginacion: Paginacion): Promise<Page<TareaActividad>> {
    await this.cargar(tareaId, usuarioId, 'ver');
    return this.actividad.deTarea(tareaId, paginacion);
  }

  /** Asignadas a mí, sin terminar ni archivar, de tableros que puedo ver; por fecha límite (sin fecha al final). */
  async misTareas(usuarioId: number): Promise<TareaConTablero[]> {
    const ids = await this.repository.idsAsignadasA(usuarioId);
    if (!ids.length) return [];
    const contexto = await this.tableros.contextoDe(usuarioId);
    const tareas = await this.repository.tarjetasConTablero(
      { id: { [Op.in]: ids }, completada_en: null, archivada: false },
      { [Op.and]: [this.tableros.alcance(contexto), { archivado: false }] },
    );
    const tiempo = (t: TareaTarjeta) => (t.fecha_limite ? new Date(t.fecha_limite).getTime() : Number.POSITIVE_INFINITY);
    return tareas.sort((a, b) => tiempo(a) - tiempo(b) || a.tablero_id - b.tablero_id || a.numero - b.numero);
  }

  // ---------- Crear, editar, mover ----------

  /** Numera con el contador del tablero (transacción) y la pone al final de la columna (o de la primera). */
  async crear(tableroId: number, usuarioId: number, datos: CrearTareaDto): Promise<TareaTarjeta> {
    const { tablero } = await this.acceso.exigir(tableroId, usuarioId, 'editar');
    const columna = datos.columna_id ? await this.columnas.delTableroOrFail(datos.columna_id, tableroId) : (await this.columnas.delTablero(tableroId))[0];
    if (!columna) throw new BadRequestError('El tablero no tiene columnas');
    await this.validarRelaciones(tablero, datos);
    const responsables = [...new Set(datos.asignados ?? [])];
    for (const id of responsables) await this.validarResponsable(tablero, id);
    const etiquetaIds = [...new Set(datos.etiquetas ?? [])];
    for (const id of etiquetaIds) await this.etiquetas.delTableroOrFail(id, tableroId);
    await this.verificarWip(columna);

    const tarea = await this.db.transaction(async (t) => {
      const numero = await this.tableros.siguienteNumero(tableroId, t);
      const posicion = ((await this.repository.maxPosicion(columna.id, t)) ?? 0) + 1;
      const nueva = await this.repository.create(
        {
          tablero_id: tableroId,
          columna_id: columna.id,
          sprint_id: datos.sprint_id ?? null,
          numero,
          titulo: datos.titulo,
          descripcion: datos.descripcion ?? null,
          tipo: datos.tipo,
          prioridad: datos.prioridad,
          puntos: datos.puntos ?? null,
          fecha_limite: datos.fecha_limite ?? null,
          posicion,
          creador_id: usuarioId,
          epica_id: datos.epica_id ?? null,
          completada_en: columna.es_final ? new Date() : null,
        },
        t,
      );
      for (const id of responsables) await this.asignados.create({ tarea_id: nueva.id, usuario_id: id }, t);
      for (const id of etiquetaIds) await this.tareaEtiquetas.create({ tarea_id: nueva.id, etiqueta_id: id }, t);
      await this.actividad.registrar(
        { tablero_id: tableroId, tarea_id: nueva.id, usuario_id: usuarioId, accion: 'creo', detalle: `creó ${claveDeTarea(tablero.clave, numero)} «${datos.titulo}»` },
        t,
      );
      return nueva;
    });

    const clave = claveDeTarea(tablero.clave, tarea.numero);
    for (const id of responsables) await this.avisarAsignacion(tarea, clave, id, usuarioId);
    await this.tableros.tocar(tableroId);
    return this.emitirTarjeta(tablero, tarea.id, EVENTOS_TABLERO.tareaCreada, usuarioId);
  }

  async actualizar(tareaId: number, usuarioId: number, datos: ActualizarTareaDto): Promise<TareaTarjeta> {
    const { tarea, tablero, clave } = await this.cargar(tareaId, usuarioId, 'editar');
    await this.validarRelaciones(tablero, datos, tarea.id);

    const campos = (Object.keys(NOMBRES_CAMPOS) as (keyof ActualizarTareaDto)[]).filter(
      (campo) => datos[campo] !== undefined && !iguales(datos[campo], tarea[campo]),
    );
    if (!campos.length) return this.repository.tarjeta(tarea.id, tablero.clave);

    const cambios: Partial<InferAttributes<Tarea>> = Object.fromEntries(campos.map((c) => [c, datos[c]]));
    if (campos.includes('fecha_limite')) cambios.recordatorio_enviado = false;
    const dejaDeSerEpica = tarea.tipo === 'epica' && datos.tipo !== undefined && datos.tipo !== 'epica';

    await this.db.transaction(async (t) => {
      await this.repository.update(tarea, cambios, t);
      if (dejaDeSerEpica) await this.repository.soltarHijas(tarea.id, t);
      await this.actividad.registrar(
        { tablero_id: tablero.id, tarea_id: tarea.id, usuario_id: usuarioId, accion: 'edito', detalle: `editó ${clave}: ${campos.map((c) => NOMBRES_CAMPOS[c]).join(', ')}` },
        t,
      );
    });
    return this.emitirTarjeta(tablero, tarea.id, EVENTOS_TABLERO.tareaActualizada, usuarioId);
  }

  /**
   * Mueve a otra columna (o reordena en la misma) entre dos vecinas. Respeta el límite WIP (409),
   * y al entrar a una columna final la marca como completada (al salir lo limpia).
   */
  async mover(tareaId: number, usuarioId: number, datos: MoverTareaDto): Promise<TareaTarjeta> {
    const { tarea, tablero, clave } = await this.cargar(tareaId, usuarioId, 'editar');
    const destino = await this.columnas.delTableroOrFail(datos.columna_id, tablero.id);
    const columnaOrigenId = tarea.columna_id;
    const cambiaColumna = destino.id !== columnaOrigenId;
    if (cambiaColumna && !tarea.archivada) await this.verificarWip(destino);

    const vecina = async (id: number | null | undefined) => {
      if (!id) return null;
      if (id === tarea.id) throw new BadRequestError('Una tarea no puede ser su propia vecina');
      const encontrada = await this.repository.findOne({ id, columna_id: destino.id });
      if (!encontrada) throw new BadRequestError('La tarea vecina no está en esa columna');
      return encontrada;
    };
    const anterior = await vecina(datos.anterior_id);
    const siguiente = await vecina(datos.siguiente_id);

    await this.db.transaction(async (t) => {
      if (necesitaRenumerar(anterior?.posicion ?? null, siguiente?.posicion ?? null)) {
        await this.repository.renumerar(destino.id, t);
        await anterior?.reload({ transaction: t });
        await siguiente?.reload({ transaction: t });
      }
      const ultima = anterior || siguiente ? null : await this.repository.maxPosicion(destino.id, t);
      const posicion = posicionEntre(anterior?.posicion ?? null, siguiente?.posicion ?? null, ultima);
      const completada_en = destino.es_final ? (tarea.completada_en ?? new Date()) : null;
      await this.repository.update(tarea, { columna_id: destino.id, posicion, completada_en }, t);
      if (cambiaColumna) {
        await this.actividad.registrar(
          { tablero_id: tablero.id, tarea_id: tarea.id, usuario_id: usuarioId, accion: 'movio', detalle: `movió ${clave} a ${destino.nombre}` },
          t,
        );
      }
    });

    if (cambiaColumna) {
      for (const id of await this.asignados.idsDe(tarea.id)) {
        await this.notificaciones.notificar({
          usuario_id: id,
          de_usuario_id: usuarioId,
          tipo: 'tarea_movida',
          entidad_tipo: 'tarea',
          entidad_id: tarea.id,
          mensaje: `movió la tarea ${clave} «${tarea.titulo}» a ${destino.nombre}`,
        });
      }
    }
    const tarjeta = await this.repository.tarjeta(tarea.id, tablero.clave);
    this.avisos.emitir(tablero.id, EVENTOS_TABLERO.tareaMovida, { tarea: tarjeta, columna_origen_id: columnaOrigenId }, usuarioId);
    return tarjeta;
  }

  async archivar(tareaId: number, usuarioId: number, archivada: boolean): Promise<TareaTarjeta> {
    const { tarea, tablero, clave } = await this.cargar(tareaId, usuarioId, 'editar');
    if (tarea.archivada === archivada) return this.repository.tarjeta(tarea.id, tablero.clave);
    if (!archivada) await this.verificarWip(await this.columnas.findByIdOrFail(tarea.columna_id));
    await this.repository.update(tarea, { archivada });
    await this.registrar(tarea, usuarioId, archivada ? 'archivo' : 'desarchivo', archivada ? `archivó ${clave}` : `restauró ${clave}`);
    return this.emitirTarjeta(tablero, tarea.id, EVENTOS_TABLERO.tareaActualizada, usuarioId);
  }

  /** Solo quien la creó o un administrador del tablero. */
  async eliminar(tareaId: number, usuarioId: number): Promise<void> {
    const { tarea, tablero, acceso, clave } = await this.cargar(tareaId, usuarioId, 'editar');
    if (tarea.creador_id !== usuarioId && !acceso.administrar) {
      throw new ForbiddenError('Solo quien creó la tarea o un administrador del tablero puede eliminarla');
    }
    await this.db.transaction(async (t) => {
      await this.repository.eliminarCompleta([tarea.id], t);
      await this.actividad.registrar({ tablero_id: tablero.id, usuario_id: usuarioId, accion: 'elimino', detalle: `eliminó ${clave} «${tarea.titulo}»` }, t);
    });
    this.avisos.emitir(tablero.id, EVENTOS_TABLERO.tareaEliminada, { tarea_id: tarea.id, columna_id: tarea.columna_id }, usuarioId);
  }

  // ---------- Responsables y etiquetas ----------

  /** El responsable debe poder ver el tablero; recibe la notificación 'tarea_asignada'. */
  async asignar(tareaId: number, usuarioId: number, responsableId: number): Promise<TareaTarjeta> {
    const { tarea, tablero, clave } = await this.cargar(tareaId, usuarioId, 'editar');
    const responsable = await this.validarResponsable(tablero, responsableId);
    if (await this.asignados.exists({ tarea_id: tarea.id, usuario_id: responsableId })) throw new ConflictError('Ya es responsable de esta tarea');

    await this.asignados.create({ tarea_id: tarea.id, usuario_id: responsableId });
    await this.registrar(tarea, usuarioId, 'asigno', `asignó ${clave} a ${responsable.nombre_completo}`);
    await this.avisarAsignacion(tarea, clave, responsableId, usuarioId);
    return this.emitirTarjeta(tablero, tarea.id, EVENTOS_TABLERO.tareaActualizada, usuarioId);
  }

  async desasignar(tareaId: number, usuarioId: number, responsableId: number): Promise<TareaTarjeta> {
    const { tarea, tablero, clave } = await this.cargar(tareaId, usuarioId, 'editar');
    const borrados = await this.asignados.delete({ tarea_id: tarea.id, usuario_id: responsableId });
    if (!borrados) throw new NotFoundError('Responsable', 'Esa persona no es responsable de esta tarea');
    const responsable = await this.usuarios.findById(responsableId);
    await this.registrar(tarea, usuarioId, 'desasigno', `quitó a ${responsable?.nombre_completo ?? 'alguien'} de ${clave}`);
    return this.emitirTarjeta(tablero, tarea.id, EVENTOS_TABLERO.tareaActualizada, usuarioId);
  }

  async etiquetar(tareaId: number, usuarioId: number, etiquetaId: number): Promise<TareaTarjeta> {
    const { tarea, tablero, clave } = await this.cargar(tareaId, usuarioId, 'editar');
    const etiqueta = await this.etiquetas.delTableroOrFail(etiquetaId, tablero.id);
    if (await this.tareaEtiquetas.exists({ tarea_id: tarea.id, etiqueta_id: etiquetaId })) throw new ConflictError('La tarea ya tiene esa etiqueta');
    await this.tareaEtiquetas.create({ tarea_id: tarea.id, etiqueta_id: etiquetaId });
    await this.registrar(tarea, usuarioId, 'etiqueto', `agregó la etiqueta «${etiqueta.nombre}» a ${clave}`);
    return this.emitirTarjeta(tablero, tarea.id, EVENTOS_TABLERO.tareaActualizada, usuarioId);
  }

  async quitarEtiqueta(tareaId: number, usuarioId: number, etiquetaId: number): Promise<TareaTarjeta> {
    const { tarea, tablero } = await this.cargar(tareaId, usuarioId, 'editar');
    const borrados = await this.tareaEtiquetas.delete({ tarea_id: tarea.id, etiqueta_id: etiquetaId });
    if (!borrados) throw new NotFoundError('Etiqueta', 'La tarea no tiene esa etiqueta');
    return this.emitirTarjeta(tablero, tarea.id, EVENTOS_TABLERO.tareaActualizada, usuarioId);
  }

  // ---------- Checklist ----------

  async agregarItem(tareaId: number, usuarioId: number, texto: string): Promise<InferAttributes<TareaChecklist>[]> {
    const { tarea, tablero } = await this.cargar(tareaId, usuarioId, 'editar');
    const posicion = await this.checklist.siguientePosicion(tarea.id);
    await this.checklist.create({ tarea_id: tarea.id, texto, posicion });
    return this.checklistActualizado(tablero, tarea.id, usuarioId);
  }

  async editarItem(tareaId: number, itemId: number, usuarioId: number, datos: ActualizarItemDto): Promise<InferAttributes<TareaChecklist>[]> {
    const { tarea, tablero, clave } = await this.cargar(tareaId, usuarioId, 'editar');
    const item = await this.checklist.deTareaOrFail(itemId, tarea.id);
    const completa = datos.hecho === true && !item.hecho;
    await this.checklist.update(item, Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)));
    if (completa) await this.registrar(tarea, usuarioId, 'checklist', `completó «${item.texto}» en ${clave}`);
    return this.checklistActualizado(tablero, tarea.id, usuarioId);
  }

  async eliminarItem(tareaId: number, itemId: number, usuarioId: number): Promise<InferAttributes<TareaChecklist>[]> {
    const { tarea, tablero } = await this.cargar(tareaId, usuarioId, 'editar');
    const item = await this.checklist.deTareaOrFail(itemId, tarea.id);
    await item.destroy();
    return this.checklistActualizado(tablero, tarea.id, usuarioId);
  }

  // ---------- Comentarios ----------

  /** Cualquiera que vea el tablero puede comentar (también los observadores). Avisa a responsables y creador. */
  async comentar(tareaId: number, usuarioId: number, texto: string): Promise<ComentarioVista> {
    const { tarea, tablero, clave } = await this.cargar(tareaId, usuarioId, 'ver');
    const comentario = await this.comentarios.create({ tarea_id: tarea.id, usuario_id: usuarioId, texto });
    await this.registrar(tarea, usuarioId, 'comento', `comentó en ${clave}`);

    const destinatarios = new Set([...(await this.asignados.idsDe(tarea.id)), tarea.creador_id]);
    destinatarios.delete(usuarioId);
    for (const id of destinatarios) {
      await this.notificaciones.notificar({
        usuario_id: id,
        de_usuario_id: usuarioId,
        tipo: 'tarea_comentario',
        entidad_tipo: 'tarea',
        entidad_id: tarea.id,
        mensaje: `comentó en la tarea ${clave} «${tarea.titulo}»`,
      });
    }
    await this.emitirTarjeta(tablero, tarea.id, EVENTOS_TABLERO.tareaActualizada, usuarioId);
    return plano<ComentarioVista>(await this.comentarios.findByIdOrFail(comentario.id));
  }

  async editarComentario(tareaId: number, comentarioId: number, usuarioId: number, texto: string): Promise<ComentarioVista> {
    const { tarea } = await this.cargar(tareaId, usuarioId, 'ver');
    const comentario = await this.comentarios.deTareaOrFail(comentarioId, tarea.id);
    this.asegurarDueno(comentario.usuario_id, usuarioId, 'Solo puedes editar tus comentarios');
    await this.comentarios.update(comentario, { texto });
    return plano<ComentarioVista>(await this.comentarios.findByIdOrFail(comentario.id));
  }

  /** El autor o un administrador del tablero. */
  async eliminarComentario(tareaId: number, comentarioId: number, usuarioId: number): Promise<void> {
    const { tarea, tablero, acceso } = await this.cargar(tareaId, usuarioId, 'ver');
    const comentario = await this.comentarios.deTareaOrFail(comentarioId, tarea.id);
    if (comentario.usuario_id !== usuarioId && !acceso.administrar) throw new ForbiddenError('Solo puedes eliminar tus comentarios');
    await comentario.destroy();
    await this.emitirTarjeta(tablero, tarea.id, EVENTOS_TABLERO.tareaActualizada, usuarioId);
  }

  // ---------- Recordatorios ----------

  /**
   * Una pasada: tareas sin terminar que vencen en las próximas 24 h y aún sin aviso → 'tarea_vence' a sus responsables.
   * `notificar` no avisa de uno mismo: si el único posible emisor es el propio responsable, se manda solo la push.
   * Devuelve cuántos avisos se enviaron.
   */
  async enviarRecordatorios(ahora: Date = new Date()): Promise<number> {
    const tareas = (await this.repository.porVencer(ahora, new Date(ahora.getTime() + HORAS_RECORDATORIO * MS_HORA))) as (Tarea & {
      tablero?: Tablero;
    })[];
    let enviados = 0;
    for (const tarea of tareas) {
      const tablero = tarea.tablero;
      const responsables = tarea.asignados ?? [];
      if (!tablero || tablero.archivado || !responsables.length) continue;
      const clave = claveDeTarea(tablero.clave, tarea.numero);

      for (const { id } of responsables) {
        const emisor = [tarea.creador_id, tablero.creador_id].find((otro) => otro !== id);
        if (emisor !== undefined) {
          await this.notificaciones.notificar({
            usuario_id: id,
            de_usuario_id: emisor,
            tipo: 'tarea_vence',
            entidad_tipo: 'tarea',
            entidad_id: tarea.id,
            mensaje: `te recuerda que la tarea ${clave} «${tarea.titulo}» vence en menos de 24 horas`,
          });
        } else {
          await this.push.avisar(id, {
            titulo: 'TrinoFlow',
            cuerpo: `La tarea ${clave} «${tarea.titulo}» vence en menos de 24 horas`,
            datos: { tipo: 'tarea_vence', entidad_tipo: 'tarea', entidad_id: String(tarea.id) },
          });
        }
        enviados++;
      }
      await this.repository.update(tarea, { recordatorio_enviado: true });
    }
    return enviados;
  }

  // ---------- Apoyo ----------

  /** Carga la tarea y exige el nivel de permiso en su tablero. */
  private async cargar(tareaId: number, usuarioId: number, nivel: NivelAcceso): Promise<TareaCargada> {
    const tarea = await this.repository.findByIdOrFail(tareaId);
    const { tablero, acceso } = await this.acceso.exigir(tarea.tablero_id, usuarioId, nivel);
    return { tarea, tablero, acceso, clave: claveDeTarea(tablero.clave, tarea.numero) };
  }

  /** La épica debe ser una tarea tipo 'epica' del mismo tablero; el sprint, uno no cerrado del mismo tablero. */
  private async validarRelaciones(tablero: Tablero, datos: { epica_id?: number | null; sprint_id?: number | null }, tareaId?: number): Promise<void> {
    if (datos.epica_id) {
      if (datos.epica_id === tareaId) throw new BadRequestError('Una tarea no puede ser su propia épica');
      const epica = await this.repository.findOne({ id: datos.epica_id, tablero_id: tablero.id });
      if (!epica || epica.tipo !== 'epica') throw new BadRequestError('La épica debe ser una tarea de tipo épica de este tablero');
    }
    if (datos.sprint_id) {
      const sprint = await this.sprints.findOne({ id: datos.sprint_id, tablero_id: tablero.id });
      if (!sprint) throw new BadRequestError('El sprint no existe en este tablero');
      if (sprint.estado === 'cerrado') throw new BadRequestError('No se pueden agregar tareas a un sprint cerrado');
    }
  }

  private async validarResponsable(tablero: Tablero, usuarioId: number) {
    const usuario = await this.usuarios.findByIdOrFail(usuarioId);
    if (!(await this.tableros.acceso(tablero, usuarioId)).ver) throw new BadRequestError('Esa persona no tiene acceso al tablero');
    return usuario;
  }

  private async verificarWip(columna: TableroColumna): Promise<void> {
    if (columna.limite_wip === null || columna.limite_wip === undefined) return;
    if ((await this.repository.contarEnColumna(columna.id)) >= columna.limite_wip) {
      throw new ConflictError(`La columna «${columna.nombre}» llegó a su límite de ${columna.limite_wip} tareas`);
    }
  }

  private avisarAsignacion(tarea: Tarea, clave: string, responsableId: number, usuarioId: number) {
    return this.notificaciones.notificar({
      usuario_id: responsableId,
      de_usuario_id: usuarioId,
      tipo: 'tarea_asignada',
      entidad_tipo: 'tarea',
      entidad_id: tarea.id,
      mensaje: `te asignó la tarea ${clave} «${tarea.titulo}»`,
    });
  }

  private registrar(tarea: Tarea, usuarioId: number, accion: string, detalle: string) {
    return this.actividad.registrar({ tablero_id: tarea.tablero_id, tarea_id: tarea.id, usuario_id: usuarioId, accion, detalle });
  }

  /** Recarga la tarjeta y la manda a la sala del tablero. */
  private async emitirTarjeta(tablero: Tablero, tareaId: number, evento: (typeof EVENTOS_TABLERO)[keyof typeof EVENTOS_TABLERO], usuarioId: number) {
    const tarjeta = await this.repository.tarjeta(tareaId, tablero.clave);
    this.avisos.emitir(tablero.id, evento, { tarea: tarjeta }, usuarioId);
    return tarjeta;
  }

  private async checklistActualizado(tablero: Tablero, tareaId: number, usuarioId: number): Promise<InferAttributes<TareaChecklist>[]> {
    await this.emitirTarjeta(tablero, tareaId, EVENTOS_TABLERO.tareaActualizada, usuarioId);
    return (await this.checklist.deTarea(tareaId)).map((i) => plano<InferAttributes<TareaChecklist>>(i));
  }
}

export const tareaService = new TareaService(
  tareaRepository,
  tableroRepository,
  columnaRepository,
  etiquetaRepository,
  sprintRepository,
  asignadoRepository,
  tareaEtiquetaRepository,
  checklistRepository,
  comentarioTareaRepository,
  actividadRepository,
  usuarioRepository,
  notificacionService,
  dispositivoService,
  accesoTableros,
  avisosTablero,
  sequelize,
);

/** Una pasada de recordatorios (la usa el temporizador y las pruebas). */
export function enviarRecordatoriosTareas(): Promise<number>;
export function enviarRecordatoriosTareas(ahora: Date): Promise<number>;
export function enviarRecordatoriosTareas(ahora: Date = new Date()): Promise<number> {
  return tareaService.enviarRecordatorios(ahora);
}

/**
 * Programa los recordatorios de tareas por vencer (cada 15 min por defecto). `unref()` evita que el
 * temporizador mantenga vivo el proceso. Se llama una vez al arrancar el servidor.
 */
export function programarRecordatoriosTareas(): NodeJS.Timeout;
export function programarRecordatoriosTareas(intervaloMs: number): NodeJS.Timeout;
export function programarRecordatoriosTareas(intervaloMs: number = MINUTOS_RECORDATORIOS * 60_000): NodeJS.Timeout {
  const temporizador = setInterval(() => {
    enviarRecordatoriosTareas().catch((error: Error) => console.warn('No se pudieron enviar los recordatorios de tareas:', error.message));
  }, intervaloMs);
  temporizador.unref();
  return temporizador;
}
