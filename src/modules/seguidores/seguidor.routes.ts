import { Router } from 'express';
import { paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { seguidorController as c } from './seguidor.controller';
import { listarRelacionQuery, seguirSchema, solicitudParams, usuarioParams } from './seguidor.schemas';

export const seguidorRoutes = Router();

seguidorRoutes.use(auth.proteger);

// Acciones
seguidorRoutes.post('/seguir', validate({ body: seguirSchema }), c.seguir);
seguidorRoutes.delete('/dejar-de-seguir', validate({ body: seguirSchema }), c.dejarDeSeguir);
seguidorRoutes.post('/toggle', validate({ body: seguirSchema }), c.toggle);

// Solicitudes de seguimiento (cuenta privada)
seguidorRoutes.get('/solicitudes', validate({ query: paginacionQuery }), c.solicitudes);
seguidorRoutes.post('/solicitudes/:seguidorId/aceptar', validate({ params: solicitudParams }), c.aceptarSolicitud);
seguidorRoutes.delete('/solicitudes/:seguidorId', validate({ params: solicitudParams }), c.rechazarSolicitud);

// Consultas
const listado = validate({ params: usuarioParams, query: listarRelacionQuery });
seguidorRoutes.get('/estadisticas/:usuario_id', validate({ params: usuarioParams }), c.estadisticas);
seguidorRoutes.get('/seguidos/:usuario_id', listado, c.seguidos);
seguidorRoutes.get('/siguiendo/:usuario_id', listado, c.seguidos); // alias de /seguidos
seguidorRoutes.get('/seguidores/:usuario_id', listado, c.seguidores);
seguidorRoutes.get('/verificar/:usuario_id', validate({ params: usuarioParams }), c.verificar);
