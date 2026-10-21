import { Router } from 'express';
import { idParams, paginacionQuery, paramsDe } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { comentarioController as c } from './comentario.controller';
import { actualizarComentarioSchema, crearComentarioSchema } from './comentario.schemas';

export const comentarioRoutes = Router();

comentarioRoutes.post('/', auth.proteger, validate({ body: crearComentarioSchema }), c.crear);
comentarioRoutes.get(
  '/publicacion/:publicacion_id',
  auth.opcional,
  validate({ params: paramsDe('publicacion_id'), query: paginacionQuery }),
  c.dePublicacion,
);
comentarioRoutes.get(
  '/usuario/:usuario_id',
  auth.opcional,
  validate({ params: paramsDe('usuario_id'), query: paginacionQuery }),
  c.deUsuario,
);
comentarioRoutes.get('/:id/respuestas', auth.opcional, validate({ params: idParams, query: paginacionQuery }), c.respuestas);
comentarioRoutes.post('/:id/like', auth.proteger, validate({ params: idParams }), c.alternarLike);
comentarioRoutes.get('/:id', auth.opcional, validate({ params: idParams }), c.obtener);
comentarioRoutes.put('/:id', auth.proteger, validate({ params: idParams, body: actualizarComentarioSchema }), c.actualizar);
comentarioRoutes.delete('/:id', auth.proteger, validate({ params: idParams }), c.eliminar);
