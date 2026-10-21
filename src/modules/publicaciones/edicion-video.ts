import { z } from 'zod';
import type { EdicionVideo, TextoVideo } from '../../infrastructure/database/models';
import type { ArchivoSubido } from '../../infrastructure/storage/FileStorage';

/**
 * Ajustes del editor de video que se aplican al reproducir con transformaciones de Cloudinary
 * (el navegador no puede recortar ni mezclar audio dentro del archivo). Lo usan publicaciones e historias.
 *
 * Cómo se arma la URL de reproducción (`urlReproduccion`), a partir de la URL original
 * `https://res.cloudinary.com/<nube>/video/upload/v123/trino/videos/video-1.mp4`:
 *
 *   https://res.cloudinary.com/<nube>/video/upload/<componentes separados por "/">/v123/trino/videos/video-1.mp4
 *
 * con los componentes en este orden (solo los que apliquen):
 *  1. Recorte:  `so_<inicio>,eo_<fin>` (segundos, hasta 2 decimales; uno solo si falta el otro).
 *  2. Silencio: `e_volume:mute` (quita el audio original; va antes de la música para no silenciarla).
 *  3. Música:   `l_audio:<public_id con ":" en lugar de "/">/du_<duración>,e_volume:<volumen-100>/fl_layer_apply,so_0`
 *               (la pista empieza con el clip, dura lo mismo que el clip recortado si se conoce, y su volumen
 *               va de -100 = muda a 0 = original).
 *  4. Texto:    `l_text:Arial_<tamaño>_bold:<texto codificado>,co_rgb:<hex>/fl_layer_apply,g_center,x_<dx>,y_<dy>`
 *               (texto con encodeURIComponent y comas/diagonales escapadas dos veces: %252C y %252F;
 *               `dx`/`dy` = desplazamiento del centro en fracciones del video, -0.5 a 0.5).
 * Si la URL no es de Cloudinary (o no hay ajustes) se devuelve tal cual.
 */

/** Volumen de la música si no se indica (0-100). */
export const VOLUMEN_MUSICA_POR_DEFECTO = 80;

export const SIN_EDICION: Readonly<EdicionVideo> = Object.freeze({
  recorte_inicio: null,
  recorte_fin: null,
  silenciar: false,
  musica_url: null,
  musica_s3: null,
  musica_volumen: VOLUMEN_MUSICA_POR_DEFECTO,
  texto: null,
});

const segundos = z.coerce.number({ invalid_type_error: 'Debe ser un número de segundos' }).min(0, 'No puede ser negativo').max(3600);
const fraccion = z.coerce.number().min(0).max(1);

export const textoVideoSchema = z.object({
  contenido: z.string().trim().min(1, 'Escribe el texto').max(120, 'El texto del video admite máximo 120 caracteres'),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser hexadecimal (#rrggbb)')
    .default('#ffffff'),
  tamano: z.coerce.number().int().min(12).max(160).default(64),
  x: fraccion.default(0.5),
  y: fraccion.default(0.5),
});

/** En multipart el objeto llega como texto JSON: se convierte antes de validar. */
const desdeJson = (v: unknown) => {
  if (v === '' || v === 'null' || v === null) return null;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const bandera = z.preprocess((v) => (v === 'true' || v === '1' || v === 1 ? true : v === 'false' || v === '0' || v === '' ? false : v), z.boolean());
const opcional = <T extends z.ZodTypeAny>(esquema: T) => z.preprocess((v) => (v === '' || v === 'null' ? null : v), esquema.nullable().optional());

/**
 * Ajustes que manda el editor (al crear, como JSON en el campo `edicion`, o en `PUT /:id/edicion`).
 * La música no viaja aquí: se sube como archivo.
 */
export const ajustesVideoSchema = z
  .object({
    recorte_inicio: opcional(segundos),
    recorte_fin: opcional(segundos),
    silenciar: bandera.optional(),
    musica_volumen: z.preprocess((v) => (v === '' ? undefined : v), z.coerce.number().int().min(0).max(100).optional()),
    texto: z.preprocess(desdeJson, textoVideoSchema.nullable().optional()),
  })
  .strip()
  .superRefine((datos, ctx) => {
    const { recorte_inicio: inicio, recorte_fin: fin } = datos;
    if (inicio != null && fin != null && fin - inicio < 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recorte_fin'], message: 'El recorte debe durar al menos 1 segundo' });
    }
  });

export type AjustesVideoDto = z.infer<typeof ajustesVideoSchema>;

/** Campo `edicion` del formulario de creación (JSON en texto o en objeto). */
export const edicionCampo = z.preprocess((v) => desdeJson(v) ?? undefined, ajustesVideoSchema.optional());

/** Mezcla los ajustes nuevos sobre los que ya tenía (lo no enviado se conserva). */
export function combinarEdicion(actual: EdicionVideo | null | undefined, ajustes: AjustesVideoDto): EdicionVideo {
  const base = { ...SIN_EDICION, ...(actual ?? {}) };
  return {
    ...base,
    ...(ajustes.recorte_inicio !== undefined ? { recorte_inicio: ajustes.recorte_inicio } : {}),
    ...(ajustes.recorte_fin !== undefined ? { recorte_fin: ajustes.recorte_fin } : {}),
    ...(ajustes.silenciar !== undefined ? { silenciar: ajustes.silenciar } : {}),
    ...(ajustes.musica_volumen !== undefined ? { musica_volumen: ajustes.musica_volumen } : {}),
    ...(ajustes.texto !== undefined ? { texto: (ajustes.texto as TextoVideo | null) ?? null } : {}),
  };
}

/** Duración en segundos del clip recortado (null si no se recortó el final). */
export function duracionRecortada(edicion: EdicionVideo | null | undefined): number | null {
  if (!edicion || edicion.recorte_fin == null) return null;
  return Math.max(1, Math.round(edicion.recorte_fin - (edicion.recorte_inicio ?? 0)));
}

/** true si la edición cambia algo al reproducir. */
export function tieneAjustes(edicion: EdicionVideo | null | undefined): boolean {
  if (!edicion) return false;
  return edicion.recorte_inicio != null || edicion.recorte_fin != null || edicion.silenciar || !!edicion.musica_s3 || !!edicion.texto;
}

const RE_CLOUDINARY = /^(https?:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)$/i;

const numero = (n: number) => String(Math.round(n * 100) / 100);

/** Codifica el texto de `l_text:` como pide Cloudinary (comas y diagonales escapadas dos veces). */
export function textoParaCloudinary(texto: string): string {
  return encodeURIComponent(texto).replace(/%2C/gi, '%252C').replace(/%2F/gi, '%252F');
}

/** Componentes de transformación (en orden) para una edición. */
export function componentesEdicion(edicion: EdicionVideo): string[] {
  const componentes: string[] = [];
  const { recorte_inicio: inicio, recorte_fin: fin } = edicion;
  const recorte = [inicio != null && inicio > 0 ? `so_${numero(inicio)}` : null, fin != null ? `eo_${numero(fin)}` : null].filter(Boolean);
  if (recorte.length) componentes.push(recorte.join(','));
  if (edicion.silenciar) componentes.push('e_volume:mute');

  if (edicion.musica_s3) {
    const capa = `l_audio:${edicion.musica_s3.replace(/\//g, ':')}`;
    const duracion = fin != null ? fin - (inicio ?? 0) : null;
    const ajustes = [duracion != null ? `du_${numero(duracion)}` : null, `e_volume:${Math.round(edicion.musica_volumen) - 100}`].filter(Boolean);
    componentes.push(capa, ajustes.join(','), 'fl_layer_apply,so_0');
  }

  if (edicion.texto) {
    const { contenido, color, tamano, x, y } = edicion.texto;
    componentes.push(`l_text:Arial_${Math.round(tamano)}_bold:${textoParaCloudinary(contenido)},co_rgb:${color.replace('#', '').toLowerCase()}`);
    componentes.push(`fl_layer_apply,g_center,x_${numero(x - 0.5)},y_${numero(y - 0.5)}`);
  }
  return componentes;
}

/** URL con la que se reproduce el video ya editado (ver el comentario del archivo). */
export function urlReproduccion(original: string, edicion: EdicionVideo | null | undefined): string {
  const partes = RE_CLOUDINARY.exec(original);
  if (!partes || !edicion || !tieneAjustes(edicion)) return original;
  return `${partes[1]}${componentesEdicion(edicion).join('/')}/${partes[2]}`;
}

/** Miniatura JPG del primer cuadro de un video de Cloudinary (null si no es de Cloudinary). */
export function miniaturaVideo(original: string | null | undefined): string | null {
  const partes = original ? RE_CLOUDINARY.exec(original) : null;
  if (!partes) return null;
  return `${partes[1]}so_0/${partes[2].replace(/\.[a-z0-9]+$/i, '')}.jpg`;
}

/** Aplica la música nueva o la quita. Devuelve la edición resultante y el public_id de la pista que hay que borrar. */
export function aplicarMusica(
  edicion: EdicionVideo,
  anterior: EdicionVideo | null | undefined,
  musica: ArchivoSubido | undefined,
  quitar: boolean | undefined,
): { edicion: EdicionVideo; reemplazada: string | null } {
  const previa = anterior?.musica_s3 ?? null;
  if (musica) return { edicion: { ...edicion, musica_url: musica.url, musica_s3: musica.id }, reemplazada: previa };
  if (quitar) return { edicion: { ...edicion, musica_url: null, musica_s3: null }, reemplazada: previa };
  return { edicion, reemplazada: null };
}
