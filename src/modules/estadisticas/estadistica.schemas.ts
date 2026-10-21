import { z } from 'zod';
import { idSchema, paramsDe } from '../../core/validation/common.schemas';

/** Rangos del panel del creador (días hacia atrás, contando hoy). */
export const RANGOS_DIAS = [7, 28, 90] as const;
export type RangoDias = (typeof RANGOS_DIAS)[number];

/** Máximo de publicaciones por lote de impresiones. */
export const MAX_LOTE_IMPRESIONES = 100;

/**
 * Diferencia con UTC del navegador en minutos, como `new Date().getTimezoneOffset()` (México: 360).
 * Solo se usa para las mejores horas y días; los totales por día usan la hora del servidor.
 */
const zona = z.coerce.number().int().min(-840).max(840).default(0);

export const impresionesSchema = z
  .object({
    publicacion_ids: z
      .array(idSchema, { required_error: 'Manda las publicaciones vistas', invalid_type_error: 'publicacion_ids debe ser una lista' })
      .min(1, 'Manda al menos una publicación')
      .max(MAX_LOTE_IMPRESIONES, `Máximo ${MAX_LOTE_IMPRESIONES} publicaciones por lote`)
      .transform((ids) => [...new Set(ids)]),
  })
  .strip();

export const resumenQuery = z.object({
  dias: z.coerce
    .number()
    .int()
    .refine((d) => (RANGOS_DIAS as readonly number[]).includes(d), `El rango debe ser ${RANGOS_DIAS.join(', ')} días`)
    .default(28)
    .transform((d) => d as RangoDias),
  zona,
});

export const detalleQuery = z.object({ zona });

export const usuarioParams = paramsDe('usuarioId');
export const publicacionParams = paramsDe('publicacionId');

export type ImpresionesDto = z.infer<typeof impresionesSchema>;
export type ResumenQuery = z.infer<typeof resumenQuery>;
export type DetalleQuery = z.infer<typeof detalleQuery>;
