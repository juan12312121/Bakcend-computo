/** Plantillas de tablero, columnas por defecto y clave estilo Jira (piezas puras, sin base de datos). */

export const PLANTILLAS_TABLERO = ['kanban', 'scrum', 'escuela', 'personal'] as const;
export type PlantillaTablero = (typeof PLANTILLAS_TABLERO)[number];

export interface ColumnaPlantilla {
  nombre: string;
  es_final?: boolean;
}

const DESARROLLO: readonly ColumnaPlantilla[] = [
  { nombre: 'Por hacer' },
  { nombre: 'En progreso' },
  { nombre: 'En revisión' },
  { nombre: 'Hecho', es_final: true },
];

/** Columnas con las que nace cada tablero según su plantilla. */
export const COLUMNAS_POR_PLANTILLA: Readonly<Record<PlantillaTablero, readonly ColumnaPlantilla[]>> = {
  kanban: DESARROLLO,
  scrum: DESARROLLO,
  escuela: [{ nombre: 'Pendiente' }, { nombre: 'Haciendo' }, { nombre: 'Entregado', es_final: true }],
  personal: [{ nombre: 'Por hacer' }, { nombre: 'Haciendo' }, { nombre: 'Listo', es_final: true }],
};

/** Palabras que no aportan letra a la clave ("Diseño de la app" → "DA"). */
const PALABRAS_VACIAS = new Set(['DE', 'DEL', 'LA', 'LAS', 'EL', 'LOS', 'Y', 'E', 'EN', 'PARA', 'POR', 'CON', 'UN', 'UNA', 'AL', 'O', 'THE', 'OF', 'AND']);

/** Clave usada cuando el nombre no tiene letras. */
export const CLAVE_POR_DEFECTO = 'TAB';

/**
 * Clave de 2 a 4 letras mayúsculas sin acentos sacada del nombre:
 * una palabra → sus 3 primeras letras ("Trino" → "TRI"); varias → sus iniciales ("Proyecto final web" → "PFW").
 */
export function generarClave(nombre: string): string {
  const palabras = nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .split(/[^A-Z]+/)
    .filter(Boolean);
  const utiles = palabras.filter((p) => !PALABRAS_VACIAS.has(p));
  const base = utiles.length ? utiles : palabras;

  if (!base.length) return CLAVE_POR_DEFECTO;
  if (base.length === 1) return base[0].slice(0, 3).padEnd(2, 'X');
  return base
    .slice(0, 4)
    .map((p) => p[0])
    .join('');
}

/** "TRI" + 12 → "TRI-12". */
export const claveDeTarea = (claveTablero: string, numero: number): string => `${claveTablero}-${numero}`;
