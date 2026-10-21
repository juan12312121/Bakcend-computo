import type { InferAttributes, Sequelize } from 'sequelize';
import { BaseService } from '../../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError } from '../../../core/errors';
import type { Page } from '../../../core/http/ApiResponse';
import { sequelize, type Asignacion, type Entrega } from '../../../infrastructure/database/models';
import { fileStorage } from '../../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../../infrastructure/storage/FileStorage';
import { notificacionService, type NotificacionService } from '../../notificaciones/notificacion.service';
import { accesoAula, type AccesoAula, type MiembroAula, type RolAula, type UsuarioPublico } from '../aula.acceso';
import { aCsv, nombreArchivo, type ArchivoTexto } from '../aula.csv';
import {
  asignacionRepository,
  conteoVacio,
  entregaRepository,
  type AsignacionRepository,
  type ConteoEntregas,
  type EntregaRepository,
} from './asignacion.repository';
import type {
  ActualizarAsignacionDto,
  CalificarDto,
  CrearAsignacionDto,
  DevolverDto,
  EntregarDto,
  ListarAsignacionesQuery,
} from './asignacion.schemas';
import { armarLibreta, estadoDeAlumno, filasLibretaCsv, puedeEntregar, type EstadoAlumno, type Libreta } from './libreta';

/** Horas antes de la fecha de entrega en que se avisa a quien no ha entregado. */
export const HORAS_RECORDATORIO_ENTREGA = 24;
/** Cada cuánto se buscan asignaciones por vencer. */
export const MINUTOS_RECORDATORIOS_ENTREGA = 15;
/** Margen para no rechazar una fecha de entrega "ahora mismo" por diferencias de reloj. */
const TOLERANCIA_PASADO_MS = 60_000;
const MS_HORA = 60 * 60 * 1000;

type SinInternos<T> = Omit<T, 'archivo_id'>;

export type EntregaVista = SinInternos<InferAttributes<Entrega>> & { alumno?: UsuarioPublico };

/** Conteo para el maestro. */
export interface ResumenEntregas {
  total_alumnos: number;
  por_calificar: number;
  calificadas: number;
  devueltas: number;
  sin_entregar: number;
  /** De lo por calificar, cuántas llegaron tarde. */
  tarde: number;
}

export type AsignacionVista = Omit<SinInternos<InferAttributes<Asignacion>>, 'recordatorio_enviado'> & {
  creador: UsuarioPublico | null;
  vencida: boolean;
  mi_rol: RolAula;
  /** Solo alumnos (null para maestros). */
  mi_estado: EstadoAlumno | null;
  mi_entrega: EntregaVista | null;
  puede_entregar: boolean;
  /** Solo maestros (null para alumnos). */
  resumen: ResumenEntregas | null;
};

/** Fila de la lista de entregas del maestro: cada alumno con su estado (los que faltan, con entrega null). */
export interface FilaEntregas {
  alumno: UsuarioPublico;
  estado: EstadoAlumno;
  entrega: EntregaVista | null;
}

export interface ResumenAula {
  grupo: { id: number; nombre: string; tipo: string };
  mi_rol: RolAula;
  total_alumnos: number;
  total_asignaciones: number;
  /** Alumno: asignaciones que aún puede entregar y no ha entregado (o devueltas). */
  pendientes: number;
  /** Maestro: entregas esperando calificación. */
  por_calificar: number;
}

const plano = <T>(registro: { get(opciones: { plain: true }): unknown }): T => registro.get({ plain: true }) as T;

function vistaEntrega(entrega: Entrega): EntregaVista {
  const { archivo_id: _interno, ...resto } = plano<InferAttributes<Entrega> & { alumno?: UsuarioPublico }>(entrega);
  return resto;
}

function resumenDe(conteo: ConteoEntregas, totalAlumnos: number): ResumenEntregas {
  const porCalificar = conteo.entregada + conteo.tarde;
  return {
    total_alumnos: totalAlumnos,
    por_calificar: porCalificar,
    calificadas: conteo.calificada,
    devueltas: conteo.devuelta,
    sin_entregar: Math.max(0, totalAlumnos - porCalificar - conteo.calificada - conteo.devuelta),
    tarde: conteo.tarde,
  };
}

export class AsignacionService extends BaseService<Asignacion, AsignacionRepository> {
  constructor(
    repository: AsignacionRepository,
    private readonly entregas: EntregaRepository,
    private readonly acceso: AccesoAula,
    private readonly notificaciones: NotificacionService,
    private readonly storage: FileStorage,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  // ---------- Consultas ----------

  /** Mi rol en el aula del grupo y los pendientes del día a día. */
  async resumen(grupoId: number, usuarioId: number): Promise<ResumenAula> {
    const { grupo, rol } = await this.acceso.exigirMiembro(grupoId, usuarioId);
    const [alumnos, asignaciones] = await Promise.all([this.acceso.miembros.idsAlumnos(grupoId), this.repository.todasDelGrupo(grupoId)]);
    const ids = asignaciones.map((a) => a.id);
    let pendientes = 0;
    let porCalificar = 0;
    if (rol === 'alumno') {
      const mias = await this.entregas.delAlumnoEn(usuarioId, ids);
      pendientes = asignaciones.filter((a) => {
        const estado = estadoDeAlumno(mias.get(a.id));
        return (estado === 'pendiente' || estado === 'devuelta') && puedeEntregar(a, mias.get(a.id));
      }).length;
    } else {
      const conteos = await this.entregas.conteos(ids, alumnos);
      for (const conteo of conteos.values()) porCalificar += conteo.entregada + conteo.tarde;
    }
    return {
      grupo: { id: grupo.id, nombre: grupo.nombre, tipo: grupo.tipo ?? 'comunidad' },
      mi_rol: rol,
      total_alumnos: alumnos.length,
      total_asignaciones: asignaciones.length,
      pendientes,
      por_calificar: porCalificar,
    };
  }

  async listar(grupoId: number, usuarioId: number, { cuando, limit, offset }: ListarAsignacionesQuery): Promise<Page<AsignacionVista>> {
    const miembro = await this.acceso.exigirMiembro(grupoId, usuarioId);
    const page = await this.repository.delGrupo(grupoId, cuando, { limit, offset });
    return { ...page, items: await this.vistas(page.items, miembro, usuarioId) };
  }

  async detalle(id: number, usuarioId: number): Promise<AsignacionVista> {
    const asignacion = await this.repository.findByIdOrFail(id);
    const miembro = await this.acceso.exigirMiembro(asignacion.grupo_id, usuarioId);
    const [vista] = await this.vistas([asignacion], miembro, usuarioId);
    return vista;
  }

  /** Maestro: todos los alumnos activos con su estado (los que faltan aparecen como "pendiente"). */
  async entregasDe(id: number, usuarioId: number): Promise<FilaEntregas[]> {
    const asignacion = await this.repository.findByIdOrFail(id);
    await this.acceso.exigirMaestro(asignacion.grupo_id, usuarioId);
    const [alumnos, entregas] = await Promise.all([this.acceso.miembros.alumnos(asignacion.grupo_id), this.entregas.deAsignacion(id)]);
    const porAlumno = new Map(entregas.map((e) => [e.alumno_id, e]));
    return alumnos.map((alumno) => {
      const entrega = porAlumno.get(alumno.id);
      return { alumno, estado: estadoDeAlumno(entrega), entrega: entrega ? vistaEntrega(entrega) : null };
    });
  }

  /** Libreta del grupo: el maestro ve a todos; un alumno, solo su fila. */
  async libreta(grupoId: number, usuarioId: number, ahora: Date = new Date()): Promise<Libreta & { mi_rol: RolAula }> {
    const { rol } = await this.acceso.exigirMiembro(grupoId, usuarioId);
    const asignaciones = await this.repository.todasDelGrupo(grupoId);
    let alumnos = await this.acceso.miembros.alumnos(grupoId);
    if (rol === 'alumno') alumnos = alumnos.filter((a) => a.id === usuarioId);
    const entregas = await this.entregas.deAsignaciones(asignaciones.map((a) => a.id));
    const libreta = armarLibreta(
      asignaciones.map((a) => ({ id: a.id, titulo: a.titulo, fecha_entrega: a.fecha_entrega, puntos_maximos: a.puntos_maximos })),
      alumnos,
      entregas,
      ahora,
    );
    // Un alumno no ve los promedios de los demás.
    if (rol === 'alumno') return { ...libreta, promedio_grupo: null, por_asignacion: [], mi_rol: rol };
    return { ...libreta, mi_rol: rol };
  }

  /** CSV de la libreta (solo maestros). */
  async libretaCsv(grupoId: number, usuarioId: number): Promise<ArchivoTexto> {
    const { grupo } = await this.acceso.exigirMaestro(grupoId, usuarioId);
    const libreta = await this.libreta(grupoId, usuarioId);
    return { nombre: `libreta-${nombreArchivo(grupo.nombre)}.csv`, tipo: 'text/csv; charset=utf-8', contenido: aCsv(filasLibretaCsv(libreta)) };
  }

  // ---------- Maestro: asignaciones ----------

  crear(grupoId: number, usuarioId: number, datos: CrearAsignacionDto): Promise<AsignacionVista>;
  crear(grupoId: number, usuarioId: number, datos: CrearAsignacionDto, archivo: ArchivoSubido | undefined): Promise<AsignacionVista>;
  async crear(grupoId: number, usuarioId: number, datos: CrearAsignacionDto, archivo?: ArchivoSubido): Promise<AsignacionVista> {
    const miembro = await this.acceso.exigirMaestro(grupoId, usuarioId);
    this.validarFechaFutura(datos.fecha_entrega);
    const creada = await this.repository.create({
      grupo_id: grupoId,
      creador_id: usuarioId,
      titulo: datos.titulo,
      instrucciones: datos.instrucciones ?? null,
      fecha_entrega: datos.fecha_entrega,
      puntos_maximos: datos.puntos_maximos,
      acepta_tardias: datos.acepta_tardias,
      ...this.camposArchivo(archivo),
    });
    for (const alumnoId of await this.acceso.miembros.idsAlumnos(grupoId)) {
      await this.notificaciones.notificar({
        usuario_id: alumnoId,
        de_usuario_id: usuarioId,
        tipo: 'asignacion_nueva',
        entidad_tipo: 'asignacion',
        entidad_id: creada.id,
        mensaje: `dejó la tarea «${creada.titulo}» en ${miembro.grupo.nombre}`,
      });
    }
    const [vista] = await this.vistas([await this.repository.findByIdOrFail(creada.id)], miembro, usuarioId);
    return vista;
  }

  actualizar(id: number, usuarioId: number, datos: ActualizarAsignacionDto): Promise<AsignacionVista>;
  actualizar(id: number, usuarioId: number, datos: ActualizarAsignacionDto, archivo: ArchivoSubido | undefined): Promise<AsignacionVista>;
  async actualizar(id: number, usuarioId: number, datos: ActualizarAsignacionDto, archivo?: ArchivoSubido): Promise<AsignacionVista> {
    const asignacion = await this.repository.findByIdOrFail(id);
    const miembro = await this.acceso.exigirMaestro(asignacion.grupo_id, usuarioId);
    const { quitar_archivo, ...cambios } = datos;
    if (!archivo && !quitar_archivo && !Object.values(cambios).some((v) => v !== undefined)) throw new BadRequestError('No hay datos para actualizar');

    if (cambios.puntos_maximos !== undefined) {
      const masAltos = await this.entregas.puntosMasAltos(id);
      if (masAltos !== null && cambios.puntos_maximos < masAltos) {
        throw new BadRequestError(`Ya hay calificaciones de ${masAltos} puntos: los puntos máximos no pueden ser menores`);
      }
    }
    const nuevaFecha = cambios.fecha_entrega && cambios.fecha_entrega.getTime() !== new Date(asignacion.fecha_entrega).getTime();
    const anterior = asignacion.archivo_id ?? asignacion.archivo_url;
    const conArchivo = archivo ? this.camposArchivo(archivo) : quitar_archivo ? this.camposArchivo(undefined) : {};

    await this.repository.update(asignacion, {
      ...Object.fromEntries(Object.entries(cambios).filter(([, v]) => v !== undefined)),
      ...conArchivo,
      // Con fecha nueva en el futuro se vuelve a recordar.
      ...(nuevaFecha ? { recordatorio_enviado: false } : {}),
    });
    if (anterior && (archivo || quitar_archivo)) await this.storage.eliminar(anterior);

    const [vista] = await this.vistas([await this.repository.findByIdOrFail(id)], miembro, usuarioId);
    return vista;
  }

  /** Borra la asignación con sus entregas y los archivos de todas. */
  async eliminar(id: number, usuarioId: number): Promise<void> {
    const asignacion = await this.repository.findByIdOrFail(id);
    await this.acceso.exigirMaestro(asignacion.grupo_id, usuarioId);
    const archivos = await this.entregas.archivosDe(id);
    const propio = asignacion.archivo_id ?? asignacion.archivo_url;
    await this.db.transaction(async (t) => {
      await this.entregas.delete({ asignacion_id: id }, t);
      await asignacion.destroy({ transaction: t });
    });
    for (const archivo of [propio, ...archivos]) if (archivo) await this.storage.eliminar(archivo);
  }

  // ---------- Alumno: entregar ----------

  entregar(id: number, alumnoId: number, datos: EntregarDto): Promise<AsignacionVista>;
  entregar(id: number, alumnoId: number, datos: EntregarDto, archivo: ArchivoSubido | undefined): Promise<AsignacionVista>;
  async entregar(id: number, alumnoId: number, datos: EntregarDto, archivo?: ArchivoSubido): Promise<AsignacionVista> {
    const asignacion = await this.repository.findByIdOrFail(id);
    const miembro = await this.acceso.exigirMiembro(asignacion.grupo_id, alumnoId, 'alumno');
    const previa = await this.entregas.deAlumno(id, alumnoId);
    const ahora = new Date();

    if (previa?.estado === 'calificada') throw new ConflictError('Esta tarea ya fue calificada: solo puedes volver a entregar si el maestro te la devuelve');
    if (!puedeEntregar(asignacion, previa, ahora)) throw new BadRequestError('La fecha de entrega ya pasó y esta tarea no acepta entregas tardías');
    if (!archivo && !datos.comentario && !previa?.archivo_url) throw new BadRequestError('Adjunta un archivo o escribe un comentario');

    const tarde = ahora.getTime() > new Date(asignacion.fecha_entrega).getTime();
    const campos = {
      estado: tarde ? ('tarde' as const) : ('entregada' as const),
      fue_tarde: tarde,
      comentario: datos.comentario ?? null,
      entregada_en: ahora,
      puntos: null,
      calificada_en: null,
      calificada_por: null,
      ...(archivo ? this.camposArchivo(archivo) : {}),
    };
    const anterior = previa && archivo ? (previa.archivo_id ?? previa.archivo_url) : null;
    if (previa) await this.entregas.update(previa, { ...campos, intentos: previa.intentos + 1 });
    else await this.entregas.create({ asignacion_id: id, alumno_id: alumnoId, ...campos, ...(archivo ? {} : this.camposArchivo(undefined)) });
    if (anterior) await this.storage.eliminar(anterior);

    const verbo = previa ? 'volvió a entregar' : 'entregó';
    await this.notificaciones.notificar({
      usuario_id: asignacion.creador_id,
      de_usuario_id: alumnoId,
      tipo: 'entrega_recibida',
      entidad_tipo: 'asignacion',
      entidad_id: id,
      mensaje: `${verbo} «${asignacion.titulo}»${tarde ? ' (tarde)' : ''}`,
    });
    const [vista] = await this.vistas([asignacion], miembro, alumnoId);
    return vista;
  }

  // ---------- Maestro: calificar / devolver ----------

  /** Califica a un alumno (aunque no haya entregado: p. ej. un 0). */
  async calificar(id: number, alumnoId: number, maestroId: number, { puntos, retroalimentacion }: CalificarDto): Promise<FilaEntregas> {
    const asignacion = await this.repository.findByIdOrFail(id);
    await this.acceso.exigirMaestro(asignacion.grupo_id, maestroId);
    await this.asegurarAlumno(asignacion.grupo_id, alumnoId);
    if (puntos > asignacion.puntos_maximos) throw new BadRequestError(`Los puntos no pueden ser más de ${asignacion.puntos_maximos}`);

    const campos = { estado: 'calificada' as const, puntos, calificada_en: new Date(), calificada_por: maestroId };
    const previa = await this.entregas.deAlumno(id, alumnoId);
    const conRetro = retroalimentacion !== undefined ? { retroalimentacion } : {};
    if (previa) await this.entregas.update(previa, { ...campos, ...conRetro });
    else await this.entregas.create({ asignacion_id: id, alumno_id: alumnoId, intentos: 0, ...campos, ...conRetro });

    await this.notificaciones.notificar({
      usuario_id: alumnoId,
      de_usuario_id: maestroId,
      tipo: 'entrega_calificada',
      entidad_tipo: 'asignacion',
      entidad_id: id,
      mensaje: `calificó «${asignacion.titulo}»: ${puntos}/${asignacion.puntos_maximos}`,
    });
    return this.filaDe(id, alumnoId);
  }

  /** Devuelve la entrega para corregir (quita los puntos; el alumno puede volver a entregar aunque haya vencido). */
  async devolver(id: number, alumnoId: number, maestroId: number, { retroalimentacion }: DevolverDto): Promise<FilaEntregas> {
    const asignacion = await this.repository.findByIdOrFail(id);
    await this.acceso.exigirMaestro(asignacion.grupo_id, maestroId);
    const entrega = await this.entregas.deAlumno(id, alumnoId);
    if (!entrega || !entrega.entregada_en) throw new BadRequestError('Este alumno aún no ha entregado nada que devolver');
    await this.entregas.update(entrega, { estado: 'devuelta', puntos: null, retroalimentacion, calificada_en: null, calificada_por: maestroId });
    await this.notificaciones.notificar({
      usuario_id: alumnoId,
      de_usuario_id: maestroId,
      tipo: 'entrega_calificada',
      entidad_tipo: 'asignacion',
      entidad_id: id,
      mensaje: `te devolvió «${asignacion.titulo}» para corregir`,
    });
    return this.filaDe(id, alumnoId);
  }

  // ---------- Recordatorios ----------

  /**
   * Avisa (24 h antes) a los alumnos que no han entregado o tienen la entrega devuelta. Marca la asignación como
   * recordada aunque nadie falte. Devuelve cuántos avisos se mandaron.
   */
  async enviarRecordatorios(ahora: Date = new Date()): Promise<number> {
    const asignaciones = await this.repository.porVencer(ahora, new Date(ahora.getTime() + HORAS_RECORDATORIO_ENTREGA * MS_HORA));
    let enviados = 0;
    for (const asignacion of asignaciones) {
      await this.repository.update(asignacion, { recordatorio_enviado: true });
      const alCorriente = await this.entregas.alumnosAlCorriente(asignacion.id);
      for (const alumnoId of await this.acceso.miembros.idsAlumnos(asignacion.grupo_id)) {
        if (alCorriente.has(alumnoId)) continue;
        const aviso = await this.notificaciones.notificar({
          usuario_id: alumnoId,
          de_usuario_id: asignacion.creador_id,
          tipo: 'tarea_vence',
          entidad_tipo: 'asignacion',
          entidad_id: asignacion.id,
          mensaje: `te recuerda que «${asignacion.titulo}» se entrega en menos de 24 horas`,
        });
        if (aviso) enviados++;
      }
    }
    return enviados;
  }

  // ---------- Apoyo ----------

  /** Arma la vista según el rol: el alumno recibe su entrega; el maestro, el conteo de entregas. */
  private async vistas(asignaciones: Asignacion[], { rol }: MiembroAula, usuarioId: number, ahora: Date = new Date()): Promise<AsignacionVista[]> {
    if (!asignaciones.length) return [];
    const ids = asignaciones.map((a) => a.id);
    const grupoId = asignaciones[0].grupo_id;
    const mias = rol === 'alumno' ? await this.entregas.delAlumnoEn(usuarioId, ids) : new Map<number, Entrega>();
    let conteos = new Map<number, ConteoEntregas>();
    let totalAlumnos = 0;
    if (rol === 'maestro') {
      const alumnos = await this.acceso.miembros.idsAlumnos(grupoId);
      totalAlumnos = alumnos.length;
      conteos = await this.entregas.conteos(ids, alumnos);
    }
    return asignaciones.map((a) => {
      const { archivo_id: _archivo, recordatorio_enviado: _recordatorio, creador, ...datos } = plano<InferAttributes<Asignacion> & { creador?: UsuarioPublico }>(a);
      const mia = mias.get(a.id) ?? null;
      return {
        ...datos,
        creador: creador ?? null,
        vencida: new Date(a.fecha_entrega).getTime() < ahora.getTime(),
        mi_rol: rol,
        mi_estado: rol === 'alumno' ? estadoDeAlumno(mia) : null,
        mi_entrega: mia ? vistaEntrega(mia) : null,
        puede_entregar: rol === 'alumno' && puedeEntregar(a, mia, ahora),
        resumen: rol === 'maestro' ? resumenDe(conteos.get(a.id) ?? conteoVacio(), totalAlumnos) : null,
      };
    });
  }

  private async filaDe(asignacionId: number, alumnoId: number): Promise<FilaEntregas> {
    const entrega = await this.entregas.conAlumno(asignacionId, alumnoId);
    const vista = vistaEntrega(entrega);
    return { alumno: vista.alumno as UsuarioPublico, estado: estadoDeAlumno(entrega), entrega: vista };
  }

  private async asegurarAlumno(grupoId: number, alumnoId: number): Promise<void> {
    if ((await this.acceso.rolDe(grupoId, alumnoId)) !== 'alumno') throw new ForbiddenError('Esa persona no es alumno activo de este grupo');
  }

  private validarFechaFutura(fecha: Date): void {
    if (fecha.getTime() < Date.now() - TOLERANCIA_PASADO_MS) throw new BadRequestError('La fecha de entrega debe ser en el futuro');
  }

  /** Columnas del archivo (o vacías para quitarlo). */
  private camposArchivo(archivo: ArchivoSubido | undefined) {
    return {
      archivo_url: archivo?.url ?? null,
      archivo_id: archivo?.id ?? null,
      archivo_nombre: archivo?.nombreOriginal ?? null,
      archivo_tipo: archivo?.mimetype ?? null,
    };
  }
}

export const asignacionService = new AsignacionService(asignacionRepository, entregaRepository, accesoAula, notificacionService, fileStorage, sequelize);

/** Una pasada de recordatorios de entregas (la usa el temporizador y las pruebas). */
export function enviarRecordatoriosEntregas(): Promise<number>;
export function enviarRecordatoriosEntregas(ahora: Date): Promise<number>;
export function enviarRecordatoriosEntregas(ahora: Date = new Date()): Promise<number> {
  return asignacionService.enviarRecordatorios(ahora);
}

/**
 * Programa los recordatorios de entregas (cada 15 min por defecto). `unref()` evita que el temporizador
 * mantenga vivo el proceso. Se llama una vez al arrancar el servidor.
 */
export function programarRecordatoriosEntregas(): NodeJS.Timeout;
export function programarRecordatoriosEntregas(intervaloMs: number): NodeJS.Timeout;
export function programarRecordatoriosEntregas(intervaloMs: number = MINUTOS_RECORDATORIOS_ENTREGA * 60_000): NodeJS.Timeout {
  const temporizador = setInterval(() => {
    enviarRecordatoriosEntregas().catch((error: Error) => console.warn('No se pudieron enviar los recordatorios de entregas:', error.message));
  }, intervaloMs);
  temporizador.unref();
  return temporizador;
}
