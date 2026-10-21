import { z } from 'zod';
import { idSchema, paramsDe } from '../../core/validation/common.schemas';

export const bloquearSchema = z.object({ usuario_id: idSchema });

export const desbloquearParams = paramsDe('usuarioId');

export type BloquearDto = z.infer<typeof bloquearSchema>;
