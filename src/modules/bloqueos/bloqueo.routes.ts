import { Router } from 'express';
import { paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { bloqueoController as c } from './bloqueo.controller';
import { bloquearSchema, desbloquearParams } from './bloqueo.schemas';

/** `/api/bloqueos` (todo con sesión). */
export const bloqueoRoutes = Router();

bloqueoRoutes.use(auth.proteger);

bloqueoRoutes.get('/', validate({ query: paginacionQuery }), c.listar);
bloqueoRoutes.post('/', validate({ body: bloquearSchema }), c.bloquear);
bloqueoRoutes.delete('/:usuarioId', validate({ params: desbloquearParams }), c.desbloquear);
