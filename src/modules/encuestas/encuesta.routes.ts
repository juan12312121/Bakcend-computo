import { Router } from 'express';
import { idParams } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { encuestaController as c } from './encuesta.controller';
import { crearEncuestaSchema, votarSchema } from './encuesta.schemas';

export const encuestaRoutes = Router();

encuestaRoutes.post('/', auth.proteger, validate({ body: crearEncuestaSchema }), c.crear);
encuestaRoutes.post('/:id/votar', auth.proteger, validate({ params: idParams, body: votarSchema }), c.votar);
encuestaRoutes.delete('/:id/voto', auth.proteger, validate({ params: idParams }), c.quitarVoto);
encuestaRoutes.get('/:id', auth.opcional, validate({ params: idParams }), c.obtener);
