import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe } from '../../core/validation/common.schemas';

/** Body de seguir / dejar de seguir / toggle. */
export const seguirSchema = z.object({ seguido_id: idSchema });

export const usuarioParams = paramsDe('usuario_id');

/** `:seguidorId` = id del usuario que mandó la solicitud. */
export const solicitudParams = paramsDe('seguidorId');

export const listarRelacionQuery = paginacionQuery;

export type SeguirDto = z.infer<typeof seguirSchema>;
