/**
 * Archivo iCalendar (RFC 5545) con un solo VEVENT, para agregar el evento a Google Calendar, Outlook o el calendario
 * del teléfono. Fechas en UTC ("20261018T190000Z"), líneas CRLF y plegadas a 75 bytes.
 */

/** Si el evento no tiene fin, se asume que dura esto. */
export const DURACION_POR_DEFECTO_MS = 2 * 60 * 60 * 1000;

const MAXIMO_BYTES_LINEA = 75;

export interface DatosIcs {
  id: number;
  titulo: string;
  descripcion: string | null;
  lugar: string | null;
  enlace: string | null;
  inicio: Date;
  fin: Date | null;
  cancelado: boolean;
  /** Página del evento en la app. */
  url: string;
  organizador?: string | null;
  actualizado?: Date | null;
}

/** 2026-10-18T19:00:00.000Z → 20261018T190000Z */
export function fechaIcs(fecha: Date): string {
  return fecha.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escapa \ ; , y saltos de línea en valores de texto. */
export function escaparIcs(texto: string): string {
  return texto.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Parte una línea en trozos de máximo 75 bytes; las continuaciones empiezan con un espacio. */
export function plegarLinea(linea: string): string {
  const trozos: string[] = [];
  let actual = '';
  let bytes = 0;
  for (const caracter of linea) {
    const tamano = Buffer.byteLength(caracter, 'utf8');
    if (bytes + tamano > MAXIMO_BYTES_LINEA) {
      trozos.push(actual);
      actual = ' ';
      bytes = 1;
    }
    actual += caracter;
    bytes += tamano;
  }
  trozos.push(actual);
  return trozos.join('\r\n');
}

export function generarIcs(datos: DatosIcs, ahora: Date = new Date()): string {
  const fin = datos.fin ?? new Date(datos.inicio.getTime() + DURACION_POR_DEFECTO_MS);
  const descripcion = [
    datos.descripcion,
    datos.organizador && `Organiza: ${datos.organizador}`,
    datos.enlace && `Enlace: ${datos.enlace}`,
    `Más información: ${datos.url}`,
  ]
    .filter((parte): parte is string => !!parte)
    .join('\n\n');
  const lugar = datos.lugar ?? datos.enlace;

  const lineas = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//TrinoFlow//Eventos//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:evento-${datos.id}@trinoflow`,
    `DTSTAMP:${fechaIcs(ahora)}`,
    datos.actualizado ? `LAST-MODIFIED:${fechaIcs(datos.actualizado)}` : null,
    `DTSTART:${fechaIcs(datos.inicio)}`,
    `DTEND:${fechaIcs(fin)}`,
    `SUMMARY:${escaparIcs(datos.titulo)}`,
    `DESCRIPTION:${escaparIcs(descripcion)}`,
    lugar ? `LOCATION:${escaparIcs(lugar)}` : null,
    `URL:${datos.enlace ?? datos.url}`,
    `STATUS:${datos.cancelado ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lineas.filter((l): l is string => l !== null).map(plegarLinea).join('\r\n') + '\r\n';
}
