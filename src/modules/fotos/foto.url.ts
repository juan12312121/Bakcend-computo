import { env } from '../../config/env';

export type TipoFoto = 'perfil' | 'portada' | 'publicacion';

const CARPETA: Record<TipoFoto, string> = { perfil: 'perfiles', portada: 'portadas', publicacion: 'publicaciones' };

/**
 * URL pública de una imagen. Las de Cloudinary ya vienen completas;
 * las rutas sueltas (datos viejos) se sirven desde `${API_URL}/uploads/...` como en el legacy.
 */
export function urlPublica(clave: string | null | undefined): string | null;
export function urlPublica(clave: string | null | undefined, tipo: TipoFoto): string | null;
export function urlPublica(clave: string | null | undefined, tipo: TipoFoto = 'perfil'): string | null {
  if (!clave) return null;
  if (clave.startsWith('http')) return clave;

  const base = env.API_URL.replace(/\/+$/, '');
  const limpia = clave.replace(/^\/+/, '');
  if (limpia.startsWith('uploads/')) return `${base}/${limpia}`;
  if (/^(perfiles|publicaciones|portadas)\//.test(limpia)) return `${base}/uploads/${limpia}`;
  return `${base}/uploads/${CARPETA[tipo]}/${limpia}`;
}
