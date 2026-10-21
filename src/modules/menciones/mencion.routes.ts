import { Router } from 'express';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { mencionController as c } from './mencion.controller';
import { nombreUsuarioParams, sugerenciasQuery } from './mencion.schemas';

export const mencionRoutes = Router();

mencionRoutes.get('/usuario/:nombre', validate({ params: nombreUsuarioParams }), c.usuarioPorNombre);
mencionRoutes.get('/sugerencias', auth.proteger, validate({ query: sugerenciasQuery }), c.sugerencias);
