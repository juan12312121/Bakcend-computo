import { z } from 'zod';
import { idSchema } from '../../../core/validation/common.schemas';

export { calendarioQuery, DIAS_MAXIMOS_CALENDARIO } from '../../eventos/evento.schemas';

/** `/ics/:token/grupos/:grupo_id.ics` (token de 48 caracteres hexadecimales). */
export const icsParams = z.object({
  token: z.string().regex(/^[a-f0-9]{48}$/, 'El enlace del calendario no es válido'),
  grupo_id: idSchema,
});
