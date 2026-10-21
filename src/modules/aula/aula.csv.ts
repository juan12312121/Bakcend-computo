/**
 * CSV que abre bien en Excel y Google Sheets: UTF-8 con BOM, separador coma, líneas CRLF y comillas cuando hace falta.
 * Los textos que empiezan con = + - @ se prefijan con ' para que la hoja no los ejecute como fórmula.
 */

export type CeldaCsv = string | number | boolean | null | undefined;

const BOM = '﻿';
const PELIGROSOS = /^[=+\-@\t\r]/;

export function celdaCsv(valor: CeldaCsv): string {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'number') return Number.isFinite(valor) ? String(valor) : '';
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  const texto = PELIGROSOS.test(valor) ? `'${valor}` : valor;
  return /[",\r\n]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto;
}

export function aCsv(filas: CeldaCsv[][]): string {
  return BOM + filas.map((fila) => fila.map(celdaCsv).join(',')).join('\r\n') + '\r\n';
}

/** Nombre de archivo seguro: "Libreta Matemáticas 3°" → "libreta-matematicas-3". */
export function nombreArchivo(base: string): string {
  const limpio = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return limpio || 'archivo';
}

/** Redondea a n decimales (para importes y promedios). */
export const redondear = (valor: number, decimales = 2): number => {
  const factor = 10 ** decimales;
  return Math.round(valor * factor) / factor;
};

/** Archivo de texto que devuelven los controladores de exportación. */
export interface ArchivoTexto {
  nombre: string;
  tipo: string;
  contenido: string;
}
