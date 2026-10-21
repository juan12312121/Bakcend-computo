/**
 * Formato único del calendario del grupo: eventos, tareas de tableros con fecha límite y entregas de asignaciones.
 * Funciones puras (reciben registros ya leídos).
 */
import type { Asignacion, Evento } from '../../../infrastructure/database/models';
import type { EstadoAlumno } from '../asignaciones/libreta';
import type { TareaConTablero } from './calendario.repository';

export const TIPOS_ELEMENTO = ['evento', 'tarea', 'asignacion'] as const;
export type TipoElemento = (typeof TIPOS_ELEMENTO)[number];

/** Color por tipo (hex, sirve igual en la web y en el .ics). */
export const COLORES_CALENDARIO: Readonly<Record<TipoElemento, string>> = {
  evento: '#f97316',
  tarea: '#0ea5e9',
  asignacion: '#8b5cf6',
};

export interface ElementoCalendario {
  /** Único entre tipos: "evento-3", "tarea-12", "asignacion-5". */
  id: string;
  tipo: TipoElemento;
  entidad_id: number;
  titulo: string;
  /** Evento: inicio. Tarea / asignación: fecha límite. */
  inicio: Date;
  /** Solo eventos (null = sin fin). */
  fin: Date | null;
  color: string;
  /** Ruta de la app: "/eventos/3", "/tableros/4?tarea=12", "/asignaciones/5". */
  enlace: string;
  /** Lugar del evento, "TRI-12 · Tablero", "100 puntos"... */
  detalle: string | null;
  cancelado: boolean;
  /** Tarea terminada (columna final) o entrega ya hecha por mí. */
  completado: boolean;
  /** Asignación vista por un alumno: su estado; si no, null. */
  estado: EstadoAlumno | null;
}

export function deEvento(evento: Evento): ElementoCalendario {
  const lugar = evento.modalidad === 'en_linea' ? 'En línea' : evento.lugar;
  return {
    id: `evento-${evento.id}`,
    tipo: 'evento',
    entidad_id: evento.id,
    titulo: evento.titulo,
    inicio: new Date(evento.inicio),
    fin: evento.fin ? new Date(evento.fin) : null,
    color: COLORES_CALENDARIO.evento,
    enlace: `/eventos/${evento.id}`,
    detalle: lugar ?? null,
    cancelado: evento.cancelado,
    completado: false,
    estado: null,
  };
}

export function deTarea(tarea: TareaConTablero): ElementoCalendario {
  const clave = tarea.tablero ? `${tarea.tablero.clave}-${tarea.numero}` : `#${tarea.numero}`;
  return {
    id: `tarea-${tarea.id}`,
    tipo: 'tarea',
    entidad_id: tarea.id,
    titulo: tarea.titulo,
    inicio: new Date(tarea.fecha_limite ?? 0),
    fin: null,
    color: COLORES_CALENDARIO.tarea,
    enlace: `/tableros/${tarea.tablero_id}?tarea=${tarea.id}`,
    detalle: tarea.tablero ? `${clave} · ${tarea.tablero.nombre}` : clave,
    cancelado: false,
    completado: !!tarea.completada_en,
    estado: null,
  };
}

export function deAsignacion(asignacion: Asignacion, estado: EstadoAlumno | null): ElementoCalendario {
  return {
    id: `asignacion-${asignacion.id}`,
    tipo: 'asignacion',
    entidad_id: asignacion.id,
    titulo: asignacion.titulo,
    inicio: new Date(asignacion.fecha_entrega),
    fin: null,
    color: COLORES_CALENDARIO.asignacion,
    enlace: `/asignaciones/${asignacion.id}`,
    detalle: `${asignacion.puntos_maximos} puntos`,
    cancelado: false,
    completado: estado !== null && estado !== 'pendiente' && estado !== 'devuelta',
    estado,
  };
}

/** Por inicio y, a la misma hora, eventos → tareas → entregas. */
export function ordenarElementos(elementos: ElementoCalendario[]): ElementoCalendario[] {
  return [...elementos].sort(
    (a, b) => a.inicio.getTime() - b.inicio.getTime() || TIPOS_ELEMENTO.indexOf(a.tipo) - TIPOS_ELEMENTO.indexOf(b.tipo) || a.entidad_id - b.entidad_id,
  );
}
