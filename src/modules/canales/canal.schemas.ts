import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe, textoRequerido } from '../../core/validation/common.schemas';
import { PRIVACIDADES_CANAL } from '../../infrastructure/database/models';

export const NOMBRE_CANAL_MAX = 100;
export const DESCRIPCION_CANAL_MAX = 1000;
export const TEXTO_PUBLICACION_MAX = 4000;

export const canalParams = paramsDe('id');
export const publicacionParams = paramsDe('id', 'publicacionId');
export const administradorParams = paramsDe('id', 'usuarioId');
export const codigoParams = z.object({
  codigo: z
    .string()
    .trim()
    .min(6, 'Enlace de invitación inválido')
    .max(40, 'Enlace de invitación inválido')
    .regex(/^[A-Za-z0-9_-]+$/, 'Enlace de invitación inválido'),
});

/** En multipart los booleanos llegan como texto. */
const booleano = z.preprocess((v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v), z.boolean({
  invalid_type_error: 'Debe ser verdadero o falso',
}));

const privacidad = z.enum(PRIVACIDADES_CANAL, { errorMap: () => ({ message: 'La privacidad debe ser publico o privado' }) });

/** Descripción opcional: vacía = sin descripción. */
const descripcion = z
  .string({ invalid_type_error: 'La descripción debe ser texto' })
  .trim()
  .max(DESCRIPCION_CANAL_MAX, `La descripción admite máximo ${DESCRIPCION_CANAL_MAX} caracteres`)
  .nullable()
  .optional()
  .transform((v) => (v === '' ? null : v));

/** Multipart (foto en `imagen`) o JSON. */
export const crearCanalSchema = z
  .object({
    nombre: textoRequerido('El nombre', NOMBRE_CANAL_MAX),
    descripcion,
    privacidad: privacidad.default('publico'),
  })
  .strip();

/** Solo lo que llegue cambia; `quitar_foto` borra la foto actual (si no llega una nueva en `imagen`). */
export const actualizarCanalSchema = z
  .object({
    nombre: textoRequerido('El nombre', NOMBRE_CANAL_MAX).optional(),
    descripcion,
    privacidad: privacidad.optional(),
    quitar_foto: booleano.optional(),
  })
  .strip();

export const ORDENES_DESCUBRIR = ['populares', 'recientes'] as const;

/** Canales públicos: `q` busca en nombre y descripción; `populares` = más suscriptores, `recientes` = publicaron hace poco. */
export const descubrirQuery = paginacionQuery.extend({
  q: z.string().trim().max(100).optional(),
  orden: z.enum(ORDENES_DESCUBRIR).default('populares'),
});

/** Publicaciones con cursor: las más nuevas primero; `antes_de` = id de la más vieja que ya tengo. */
export const publicacionesQuery = z.object({
  antes_de: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** Multipart (`archivo`: imagen o documento) o JSON. Texto o archivo obligatorio (lo revisa el servicio). */
export const publicarSchema = z
  .object({
    texto: z
      .string({ invalid_type_error: 'El texto debe ser texto' })
      .trim()
      .max(TEXTO_PUBLICACION_MAX, `La publicación admite máximo ${TEXTO_PUBLICACION_MAX} caracteres`)
      .default(''),
  })
  .strip();

export const silencioSchema = z.object({ silenciado: booleano });

export const administradorSchema = z.object({ usuario_id: idSchema });

export type CrearCanalDto = z.infer<typeof crearCanalSchema>;
export type ActualizarCanalDto = z.infer<typeof actualizarCanalSchema>;
export type DescubrirQuery = z.infer<typeof descubrirQuery>;
export type PublicacionesQuery = z.infer<typeof publicacionesQuery>;
export type PublicarDto = z.infer<typeof publicarSchema>;
