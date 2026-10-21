import { z } from 'zod';

/** Piezas de validación que comparten todos los módulos. */
export const idSchema = z.coerce.number({ invalid_type_error: 'Debe ser un número' }).int().positive('Debe ser mayor a 0');

export const idParams = z.object({ id: idSchema });

/** Construye params con uno o varios ids: paramsDe('usuario_id', 'seccion_id'). */
export const paramsDe = (...nombres: string[]) =>
  z.object(Object.fromEntries(nombres.map((n) => [n, idSchema])) as Record<string, typeof idSchema>);

export const paginacionQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type Paginacion = z.infer<typeof paginacionQuery>;

export const textoRequerido = (campo: string, max: number) =>
  z
    .string({ required_error: `${campo} es requerido`, invalid_type_error: `${campo} debe ser texto` })
    .trim()
    .min(1, `${campo} es requerido`)
    .max(max, `${campo} admite máximo ${max} caracteres`);

export const textoOpcional = (max: number) => z.string().trim().max(max).optional().nullable();

export const busquedaQuery = paginacionQuery.extend({
  q: z.string().trim().min(1, 'Escribe algo para buscar').max(100),
});
