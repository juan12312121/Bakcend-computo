import { z } from 'zod';
import { paramsDe } from '../../core/validation/common.schemas';
import { TIPOS_HISTORIA } from '../../infrastructure/database/models';
import { edicionCampo } from '../publicaciones/edicion-video';

/** Gradientes permitidos para las historias de texto (el frontend los usa con `bg-gradient-to-br`). */
export const FONDOS_HISTORIA = [
  'from-orange-500 to-pink-500',
  'from-pink-500 to-purple-600',
  'from-purple-600 to-indigo-600',
  'from-blue-500 to-cyan-400',
  'from-teal-400 to-emerald-500',
  'from-green-400 to-lime-500',
  'from-yellow-400 to-orange-500',
  'from-red-500 to-rose-600',
  'from-fuchsia-500 to-cyan-500',
  'from-slate-700 to-slate-900',
] as const;
export type FondoHistoria = (typeof FONDOS_HISTORIA)[number];

export const FONDO_POR_DEFECTO: FondoHistoria = 'from-orange-500 to-pink-500';
export const DURACION_POR_DEFECTO = 5;
export const DURACION_MAXIMA = 60;
export const MAX_TEXTO = 500;

/** En multipart los campos vacíos llegan como "": se tratan como ausentes. */
const vacioAIndefinido = (v: unknown) => (v === '' || v === null ? undefined : v);

/**
 * Body de POST / (multipart o JSON). La coherencia tipo ↔ archivo la revisa el servicio,
 * porque el archivo no forma parte del body.
 */
export const crearHistoriaSchema = z
  .object({
    tipo: z.enum(TIPOS_HISTORIA, {
      errorMap: () => ({ message: `El tipo debe ser uno de: ${TIPOS_HISTORIA.join(', ')}` }),
    }),
    texto: z.preprocess(
      vacioAIndefinido,
      z
        .string({ invalid_type_error: 'El texto debe ser texto' })
        .trim()
        .max(MAX_TEXTO, `El texto admite máximo ${MAX_TEXTO} caracteres`)
        .optional(),
    ),
    fondo: z.preprocess(
      vacioAIndefinido,
      z.enum(FONDOS_HISTORIA, { errorMap: () => ({ message: 'El fondo no es uno de los gradientes permitidos' }) }).optional(),
    ),
    duracion_seg: z.preprocess(
      vacioAIndefinido,
      z.coerce
        .number({ invalid_type_error: 'La duración debe ser un número' })
        .int('La duración debe ser un número entero de segundos')
        .min(1, 'La duración mínima es 1 segundo')
        .max(DURACION_MAXIMA, `La duración máxima es ${DURACION_MAXIMA} segundos`)
        .optional(),
    ),
    /** [creadores] Ajustes del editor de video (JSON): recorte, silencio, volumen de la música y texto. */
    edicion: edicionCampo,
  })
  .strip()
  .superRefine((datos, ctx) => {
    if (datos.edicion && datos.tipo !== 'video') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['edicion'], message: 'Los ajustes de video solo aplican a historias de video' });
    }
    if (datos.tipo === 'texto' && !datos.texto) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['texto'], message: 'El texto es requerido en las historias de texto' });
    }
    if (datos.tipo === 'video' && datos.duracion_seg === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['duracion_seg'], message: 'Indica la duración del video en segundos' });
    }
  });

export const usuarioHistoriasParams = paramsDe('usuarioId');

export type CrearHistoriaDto = z.infer<typeof crearHistoriaSchema>;

/** [creadores] `PUT /:id/edicion`: mismos ajustes que en publicaciones (música en el campo `archivo`). */
export { edicionVideoSchema as edicionHistoriaSchema, type EdicionVideoDto as EdicionHistoriaDto } from '../publicaciones/publicacion.schemas';
