import { z } from 'zod';
import { idSchema, paginacionQuery, textoOpcional } from '../../core/validation/common.schemas';

/** Motivo opcional que queda en la bitácora de seguridad. */
export const motivoSchema = z.object({ motivo: textoOpcional(500) }).strip();

/** Suspender: motivo y, opcional, días (sin días = permanente). Al reactivar los días se ignoran. */
export const suspensionSchema = z
  .object({ motivo: textoOpcional(500), dias: z.coerce.number().int().min(1).max(3650).optional().nullable() })
  .strip();

export const logsQuery = paginacionQuery.extend({
  evento: z.string().trim().min(1).max(100).optional(),
  usuario_id: idSchema.optional(),
});

export type SuspensionDto = z.infer<typeof suspensionSchema>;
export type MotivoDto = z.infer<typeof motivoSchema>;
export type LogsQuery = z.infer<typeof logsQuery>;
