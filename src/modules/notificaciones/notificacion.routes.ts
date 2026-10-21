import { Router } from 'express';
import { idParams } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { notificacionController as c } from './notificacion.controller';
import { limpiarAntiguasQuery, listarNotificacionesQuery, streamParams } from './notificacion.schemas';

export const notificacionRoutes = Router();

// SSE: EventSource no manda headers, el token llega en ?token= (va antes de auth.proteger)
notificacionRoutes.get('/stream/:usuarioId', auth.porQuery, validate({ params: streamParams }), c.stream);

notificacionRoutes.use(auth.proteger);

notificacionRoutes.get('/', validate({ query: listarNotificacionesQuery }), c.listar);
notificacionRoutes.get('/no-leidas', validate({ query: listarNotificacionesQuery }), c.noLeidas);
notificacionRoutes.get('/contador', c.contador);
notificacionRoutes.get('/sse/stats', auth.soloAdmin, c.estadisticasStream);

notificacionRoutes.put('/leer-todas', c.marcarTodasLeidas);
notificacionRoutes.put('/:id/leer', validate({ params: idParams }), c.marcarLeida);

// Ruta fija antes de /:id
notificacionRoutes.delete('/limpiar-antiguas', validate({ query: limpiarAntiguasQuery }), c.limpiarAntiguas);
notificacionRoutes.delete('/:id', validate({ params: idParams }), c.eliminar);
