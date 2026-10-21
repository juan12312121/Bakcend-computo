import { Router } from 'express';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { dispositivoController as c } from './dispositivo.controller';
import { registrarDispositivoSchema, tokenParams } from './dispositivo.schemas';

export const dispositivoRoutes = Router();

dispositivoRoutes.use(auth.proteger);

dispositivoRoutes.post('/', validate({ body: registrarDispositivoSchema }), c.registrar);
dispositivoRoutes.delete('/:token', validate({ params: tokenParams }), c.quitar);
