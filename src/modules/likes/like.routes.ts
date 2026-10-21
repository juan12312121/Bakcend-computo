import { Router } from 'express';
import { paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { likeController as c } from './like.controller';
import { likeSchema, publicacionLikeParams, reaccionesQuery, reaccionSchema } from './like.schemas';

export const likeRoutes = Router();

// Reacciones
likeRoutes.post('/reaccion', auth.proteger, validate({ body: reaccionSchema }), c.reaccionar);
likeRoutes.delete('/reaccion/:publicacion_id', auth.proteger, validate({ params: publicacionLikeParams }), c.quitarReaccion);

// Rutas viejas (equivalen a la reacción 'me_gusta')
likeRoutes.post('/agregar', auth.proteger, validate({ body: likeSchema }), c.agregar);
likeRoutes.delete('/eliminar', auth.proteger, validate({ body: likeSchema }), c.eliminar);
likeRoutes.post('/toggle', auth.proteger, validate({ body: likeSchema }), c.alternar);

likeRoutes.get(
  '/publicacion/:publicacion_id',
  auth.opcional,
  validate({ params: publicacionLikeParams, query: paginacionQuery }),
  c.dePublicacion,
);
likeRoutes.get('/verificar/:publicacion_id', auth.proteger, validate({ params: publicacionLikeParams }), c.verificar);
likeRoutes.get('/total/:publicacion_id', auth.opcional, validate({ params: publicacionLikeParams }), c.total);
likeRoutes.get('/usuario/mis-likes', auth.proteger, validate({ query: paginacionQuery }), c.misLikes);

// Quién reaccionó y resumen por tipo (después de las rutas fijas)
likeRoutes.get(
  '/:publicacion_id/reacciones',
  auth.opcional,
  validate({ params: publicacionLikeParams, query: reaccionesQuery }),
  c.reacciones,
);
likeRoutes.get('/:publicacion_id/resumen', auth.opcional, validate({ params: publicacionLikeParams }), c.resumen);
