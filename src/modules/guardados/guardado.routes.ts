import { Router } from 'express';
import { paginacionQuery, paramsDe } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { guardadoController as c } from './guardado.controller';

export const guardadoRoutes = Router();

guardadoRoutes.get('/', auth.proteger, validate({ query: paginacionQuery }), c.mias);
guardadoRoutes.post('/:publicacion_id', auth.proteger, validate({ params: paramsDe('publicacion_id') }), c.alternar);
