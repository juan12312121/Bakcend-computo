/**
 * Posición decimal de una tarea dentro de su columna: se inserta entre dos vecinas sin renumerar las demás.
 * - entre dos → punto medio
 * - solo la de arriba → +1 · solo la de abajo → -1
 * - sin vecinas → al final (`ultima` + 1)
 */
export function posicionEntre(anterior: number | null, siguiente: number | null, ultima: number | null): number {
  if (anterior !== null && siguiente !== null) return (anterior + siguiente) / 2;
  if (anterior !== null) return anterior + 1;
  if (siguiente !== null) return siguiente - 1;
  return (ultima ?? 0) + 1;
}

/** Hueco mínimo entre vecinas: por debajo se renumera la columna para no perder precisión. */
export const HUECO_MINIMO = 1e-6;

export function necesitaRenumerar(anterior: number | null, siguiente: number | null): boolean {
  return anterior !== null && siguiente !== null && Math.abs(siguiente - anterior) < HUECO_MINIMO;
}
