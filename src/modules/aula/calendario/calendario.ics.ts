/**
 * Calendario iCalendar (RFC 5545) con varios VEVENT para suscribirse desde Google Calendar, Outlook o el teléfono.
 * Reutiliza el formato de fechas, el escape y el plegado de líneas del .ics de eventos.
 */
import { DURACION_POR_DEFECTO_MS, escaparIcs, fechaIcs, plegarLinea } from '../../eventos/evento.ics';
import type { ElementoCalendario } from './calendario.elementos';

/** Las fechas límite (tareas y entregas) se pintan como un bloque que TERMINA a esa hora. */
export const DURACION_LIMITE_MS = 30 * 60 * 1000;

const PREFIJOS: Readonly<Record<ElementoCalendario['tipo'], string>> = {
  evento: '',
  tarea: 'Tarea: ',
  asignacion: 'Entrega: ',
};

export interface DatosCalendarioIcs {
  nombre: string;
  elementos: ElementoCalendario[];
  /** Base de la app web (para el enlace de cada elemento). */
  urlApp: string;
}

function vevent(elemento: ElementoCalendario, urlApp: string, ahora: Date): (string | null)[] {
  const esLimite = elemento.tipo !== 'evento';
  const inicio = esLimite ? new Date(elemento.inicio.getTime() - DURACION_LIMITE_MS) : elemento.inicio;
  const fin = esLimite ? elemento.inicio : (elemento.fin ?? new Date(elemento.inicio.getTime() + DURACION_POR_DEFECTO_MS));
  const url = `${urlApp.replace(/\/+$/, '')}${elemento.enlace}`;
  const descripcion = [elemento.detalle, `Abrir en TrinoFlow: ${url}`].filter((p): p is string => !!p).join('\n\n');
  return [
    'BEGIN:VEVENT',
    `UID:${elemento.id}@trinoflow`,
    `DTSTAMP:${fechaIcs(ahora)}`,
    `DTSTART:${fechaIcs(inicio)}`,
    `DTEND:${fechaIcs(fin)}`,
    `SUMMARY:${escaparIcs(PREFIJOS[elemento.tipo] + elemento.titulo)}`,
    `DESCRIPTION:${escaparIcs(descripcion)}`,
    elemento.tipo === 'evento' && elemento.detalle ? `LOCATION:${escaparIcs(elemento.detalle)}` : null,
    `URL:${url}`,
    `CATEGORIES:${elemento.tipo.toUpperCase()}`,
    `STATUS:${elemento.cancelado ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
  ];
}

export function generarCalendarioIcs({ nombre, elementos, urlApp }: DatosCalendarioIcs, ahora: Date = new Date()): string {
  const lineas: (string | null)[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TrinoFlow//Calendario del grupo//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escaparIcs(nombre)}`,
    'X-WR-TIMEZONE:UTC',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
    ...elementos.flatMap((e) => vevent(e, urlApp, ahora)),
    'END:VCALENDAR',
  ];
  return lineas.filter((l): l is string => l !== null).map(plegarLinea).join('\r\n') + '\r\n';
}
