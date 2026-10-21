import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe } from '../../core/validation/common.schemas';
import { TIPOS_REACCION } from '../../infrastructure/database/models';

export const likeSchema = z.object({
  publicacion_id: idSchema,
});

const tipoReaccion = z.enum(TIPOS_REACCION, { errorMap: () => ({ message: `Reacción inválida (${TIPOS_REACCION.join(', ')})` }) });

/** POST /likes/reaccion: pone o cambia mi reacción. */
export const reaccionSchema = z.object({
  publicacion_id: idSchema,
  tipo: tipoReaccion,
});

export const publicacionLikeParams = paramsDe('publicacion_id');

/** GET /likes/:publicacion_id/reacciones?tipo=jaja */
export const reaccionesQuery = paginacionQuery.extend({
  tipo: z.preprocess((v) => (v === '' ? undefined : v), tipoReaccion.optional()),
});

export type LikeDto = z.infer<typeof likeSchema>;
export type ReaccionDto = z.infer<typeof reaccionSchema>;
export type ReaccionesQuery = z.infer<typeof reaccionesQuery>;
