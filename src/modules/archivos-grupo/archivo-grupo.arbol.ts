import type { TipoArchivoGrupo } from '../../infrastructure/database/models';

/** Lo mínimo de una carpeta para recorrer el árbol. */
export interface NodoCarpeta {
  id: number;
  padre_id: number | null;
  nombre: string;
}

export interface Miga {
  id: number;
  nombre: string;
}

/** Migas de pan de la raíz a la carpeta (sin la raíz). Corta si encuentra un ciclo o un padre que no existe. */
export function rutaDe(carpetaId: number | null, carpetas: readonly NodoCarpeta[]): Miga[] {
  const porId = new Map(carpetas.map((c) => [c.id, c]));
  const ruta: Miga[] = [];
  const vistos = new Set<number>();
  let actual = carpetaId !== null ? porId.get(carpetaId) : undefined;
  while (actual && !vistos.has(actual.id)) {
    vistos.add(actual.id);
    ruta.unshift({ id: actual.id, nombre: actual.nombre });
    actual = actual.padre_id !== null ? porId.get(actual.padre_id) : undefined;
  }
  return ruta;
}

/** La carpeta y todas las que tiene adentro (a cualquier profundidad). */
export function descendientes(carpetaId: number, carpetas: readonly NodoCarpeta[]): number[] {
  const hijas = new Map<number, number[]>();
  for (const c of carpetas) if (c.padre_id !== null) hijas.set(c.padre_id, [...(hijas.get(c.padre_id) ?? []), c.id]);
  const resultado: number[] = [];
  const pendientes = [carpetaId];
  while (pendientes.length) {
    const id = pendientes.pop() as number;
    if (resultado.includes(id)) continue;
    resultado.push(id);
    pendientes.push(...(hijas.get(id) ?? []));
  }
  return resultado;
}

/** ¿Mover `carpetaId` dentro de `nuevoPadreId` la metería en sí misma? */
export function creariaCiclo(carpetaId: number, nuevoPadreId: number | null, carpetas: readonly NodoCarpeta[]): boolean {
  return nuevoPadreId !== null && descendientes(carpetaId, carpetas).includes(nuevoPadreId);
}

/** ¿Ya hay otra carpeta con ese nombre (sin distinguir mayúsculas) en el mismo lugar? */
export function nombreOcupado(nombre: string, padreId: number | null, carpetas: readonly NodoCarpeta[], excepto?: number): boolean {
  const buscado = nombre.trim().toLocaleLowerCase('es');
  return carpetas.some((c) => c.padre_id === padreId && c.id !== excepto && c.nombre.trim().toLocaleLowerCase('es') === buscado);
}

/** Tipo de archivo según su MIME (para filtrar, el icono y el visor). */
export function tipoDeArchivo(mimetype: string): TipoArchivoGrupo {
  const mime = mimetype.toLowerCase();
  if (mime.startsWith('image/')) return 'imagen';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf' || mime.startsWith('text/') || mime.includes('word') || mime.includes('excel') || mime.includes('spreadsheet') || mime.includes('powerpoint') || mime.includes('presentation')) {
    return 'documento';
  }
  return 'otro';
}

/** multer entrega el nombre original en latin1: "reuniÃ³n.pdf" → "reunión.pdf". */
export function nombreLegible(original: string): string {
  if (!/[\u0080-ÿ]/.test(original)) return original;
  const decodificado = Buffer.from(original, 'latin1').toString('utf8');
  return decodificado.includes('�') ? original : decodificado;
}
