/** Largo permitido de un #tema (sin el '#'). */
export const HASHTAG_MIN = 2;
export const HASHTAG_MAX = 50;
/** Tope de temas distintos que se enlazan por publicación. */
export const MAX_HASHTAGS_POR_PUBLICACION = 30;

/**
 * `#tema`: letras (con acentos y ñ), dígitos y _, de 2 a 50 caracteres.
 * No cuenta pegado a otra palabra (a#b) ni dentro de una URL con ancla (/#parte) ni como entidad HTML (&#39;).
 */
const PATRON_HASHTAG = /(?<![\p{L}\p{N}_&#/])#([\p{L}\p{N}_]{2,50})(?![\p{L}\p{N}_])/gu;
const URL = /https?:\/\/\S+/g;

/** Normaliza un nombre de tema: sin '#', sin espacios y en minúsculas. */
export function normalizarHashtag(nombre: string): string {
  return nombre.trim().replace(/^#+/, '').toLocaleLowerCase('es');
}

export function esHashtagValido(nombre: string): boolean {
  return new RegExp(`^[\\p{L}\\p{N}_]{${HASHTAG_MIN},${HASHTAG_MAX}}$`, 'u').test(nombre);
}

/** Temas de un texto en minúsculas y sin repetir (en el orden en que aparecen). Ignora los que están dentro de URLs. */
export function extraerHashtags(texto: string | null | undefined): string[] {
  if (!texto) return [];
  const sinUrls = texto.replace(URL, ' ');
  const temas = new Set<string>();
  for (const [, tema] of sinUrls.matchAll(PATRON_HASHTAG)) {
    temas.add(normalizarHashtag(tema));
    if (temas.size >= MAX_HASHTAGS_POR_PUBLICACION) break;
  }
  return [...temas];
}
