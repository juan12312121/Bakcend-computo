import { z } from 'zod';
import { idSchema } from '../../core/validation/common.schemas';

export const MIN_OPCIONES = 2;
export const MAX_OPCIONES = 6;

const opcion = z
  .string({ invalid_type_error: 'Cada opción debe ser texto' })
  .trim()
  .min(1, 'Las opciones no pueden estar vacías')
  .max(120, 'Cada opción admite máximo 120 caracteres');

export const crearEncuestaSchema = z
  .object({
    publicacion_id: idSchema,
    opciones: z
      .array(opcion, { required_error: 'Las opciones son requeridas' })
      .min(MIN_OPCIONES, `Agrega al menos ${MIN_OPCIONES} opciones`)
      .max(MAX_OPCIONES, `Máximo ${MAX_OPCIONES} opciones`)
      .refine((lista) => new Set(lista.map((o) => o.toLowerCase())).size === lista.length, 'Las opciones no se pueden repetir'),
    multiple: z.boolean({ invalid_type_error: 'multiple debe ser verdadero o falso' }).default(false),
    cierra_en: z.coerce
      .date({ invalid_type_error: 'Fecha de cierre inválida' })
      .refine((fecha) => fecha.getTime() > Date.now(), 'La fecha de cierre debe ser futura')
      .nullable()
      .optional(),
  })
  .strip();

export const votarSchema = z
  .object({
    opcion_ids: z
      .array(idSchema, { required_error: 'Elige al menos una opción' })
      .min(1, 'Elige al menos una opción')
      .max(MAX_OPCIONES)
      .refine((ids) => new Set(ids).size === ids.length, 'No repitas opciones'),
  })
  .strip();

export type CrearEncuestaDto = z.infer<typeof crearEncuestaSchema>;
export type VotarDto = z.infer<typeof votarSchema>;
