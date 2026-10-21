import { z } from 'zod';
import { busquedaQuery, idSchema, paginacionQuery, paramsDe, textoRequerido } from '../../core/validation/common.schemas';
import { CATEGORIAS, VISIBILIDADES } from '../../infrastructure/database/models';
import { ajustesVideoSchema, edicionCampo } from './edicion-video';

/** En multipart todo llega como texto: '' o 'null' cuentan como "no enviado". */
const vacioAUndefined = (v: unknown) => (v === '' || v === 'null' || v === null ? undefined : v);

/** Id opcional que tolera los valores vacíos de un formulario multipart. */
export const idOpcional = z.preprocess(vacioAUndefined, idSchema.optional());

/** Id que además acepta null explícito (para quitar una relación). */
export const idONulo = z.preprocess((v) => (v === '' || v === 'null' ? null : v), idSchema.nullable().optional());

const categoria = z.enum(CATEGORIAS, { errorMap: () => ({ message: 'Categoría inválida' }) });
const visibilidad = z.enum(VISIBILIDADES, { errorMap: () => ({ message: 'Visibilidad inválida' }) });

/** Duración máxima de un video de publicación / reel (segundos). */
export const DURACION_VIDEO_MAXIMA = 180;

/** Segundos del video (1-180); en multipart llega como texto. */
const videoDuracion = z.preprocess(
  vacioAUndefined,
  z.coerce
    .number({ invalid_type_error: 'La duración del video debe ser un número' })
    .int('La duración del video debe ser en segundos enteros')
    .min(1, 'La duración del video debe ser de al menos 1 segundo')
    .max(DURACION_VIDEO_MAXIMA, `El video no puede durar más de ${DURACION_VIDEO_MAXIMA} segundos`)
    .optional(),
);

/** Bandera de formulario: true / 'true' / '1' → true. */
const bandera = z.preprocess((v) => (v === 'true' || v === '1' || v === 1 ? true : v === 'false' || v === '0' || v === '' ? false : v), z.boolean().optional());

/** Tipos de contenido por los que se puede filtrar el feed. */
export const TIPOS_FEED = ['video'] as const;
export const ORDENES_FEED = ['recientes', 'populares'] as const;

// ---------- [creadores] Programar publicaciones ----------

/** Hasta cuántos días adelante se puede programar (6 meses). */
export const DIAS_MAXIMOS_PROGRAMACION = 183;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Fecha y hora futura (ISO) de hasta 6 meses. */
const fechaProgramada = z.coerce
  .date({ invalid_type_error: 'La fecha programada no es válida', required_error: 'Indica cuándo se publica' })
  .refine((fecha) => fecha.getTime() > Date.now(), 'La fecha programada debe ser futura')
  .refine((fecha) => fecha.getTime() <= Date.now() + DIAS_MAXIMOS_PROGRAMACION * MS_POR_DIA, 'Solo se puede programar hasta 6 meses adelante');

export const crearPublicacionSchema = z
  .object({
    contenido: textoRequerido('El contenido', 5000),
    categoria: z.preprocess(vacioAUndefined, categoria.default('General')),
    visibilidad: z.preprocess(vacioAUndefined, visibilidad.default('publico')),
    grupo_id: idOpcional,
    video_duracion: videoDuracion,
    /** [creadores] Si viene, queda programada y sale sola a esa hora. */
    programada_para: z.preprocess(vacioAUndefined, fechaProgramada.optional()),
    /** [creadores] Guardar como borrador (solo la ve su autor). */
    borrador: bandera,
    /** [creadores] Ajustes del editor de video (JSON): recorte, silencio, volumen de la música y texto. */
    edicion: edicionCampo,
  })
  .superRefine((datos, ctx) => {
    if (datos.borrador && datos.programada_para) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['programada_para'], message: 'Un borrador no lleva fecha programada' });
    }
  });

/** `PUT /:id/programacion`: programa (o reprograma) una programada o un borrador. */
export const programarSchema = z.object({ programada_para: fechaProgramada }).strip();

export const ESTADOS_NO_PUBLICADOS = ['programada', 'borrador'] as const;
export type EstadoNoPublicado = (typeof ESTADOS_NO_PUBLICADOS)[number];

/** `GET /programadas?estado=programada|borrador`. */
export const programadasQuery = paginacionQuery.extend({
  estado: z.preprocess(vacioAUndefined, z.enum(ESTADOS_NO_PUBLICADOS, { errorMap: () => ({ message: 'Estado inválido' }) }).default('programada')),
});

/** `PUT /:id/edicion` (multipart con la música en `archivo`): ajustes del editor de video. */
export const edicionVideoSchema = ajustesVideoSchema.and(z.object({ quitar_musica: bandera }).strip());

export const actualizarPublicacionSchema = z
  .object({
    contenido: z.preprocess(vacioAUndefined, textoRequerido('El contenido', 5000).optional()),
    categoria: z.preprocess(vacioAUndefined, categoria.optional()),
    visibilidad: z.preprocess(vacioAUndefined, visibilidad.optional()),
    video_duracion: videoDuracion,
    /** Quita el video actual (sin subir otro). */
    quitar_video: bandera,
  })
  .strip();

export const usuarioParams = paramsDe('usuarioId');

export const buscarPublicacionesQuery = busquedaQuery;

/** Feed: paginación + filtro opcional por categoría y por tipo (`?tipo=video`). */
export const feedQuery = paginacionQuery.extend({
  categoria: z.preprocess(vacioAUndefined, categoria.optional()),
  tipo: z.preprocess(vacioAUndefined, z.enum(TIPOS_FEED, { errorMap: () => ({ message: 'Tipo inválido' }) }).optional()),
  /** recientes (por defecto) | populares (misma puntuación que Reels). */
  orden: z.preprocess(vacioAUndefined, z.enum(ORDENES_FEED, { errorMap: () => ({ message: 'Orden inválido' }) }).default('recientes')),
  /** true → solo con imagen o video. */
  con_media: bandera,
});

export type TipoFeed = (typeof TIPOS_FEED)[number];

export type CrearPublicacionDto = z.infer<typeof crearPublicacionSchema>;
export type ProgramarDto = z.infer<typeof programarSchema>;
export type ProgramadasQuery = z.infer<typeof programadasQuery>;
export type EdicionVideoDto = z.infer<typeof edicionVideoSchema>;
export type ActualizarPublicacionDto = z.infer<typeof actualizarPublicacionSchema>;
export type BuscarPublicacionesQuery = z.infer<typeof buscarPublicacionesQuery>;
export type FeedQuery = z.infer<typeof feedQuery>;
