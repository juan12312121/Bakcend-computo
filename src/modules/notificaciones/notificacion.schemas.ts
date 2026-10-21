import { z } from 'zod';
import { paginacionQuery, paramsDe } from '../../core/validation/common.schemas';

export const streamParams = paramsDe('usuarioId');

export const listarNotificacionesQuery = paginacionQuery;

export const limpiarAntiguasQuery = z.object({
  dias: z.coerce.number().int().min(1, 'Mínimo 1 día').max(365, 'Máximo 365 días').default(30),
});

export type LimpiarAntiguasQuery = z.infer<typeof limpiarAntiguasQuery>;
