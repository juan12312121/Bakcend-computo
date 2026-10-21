import { Router } from 'express';
import { idParams } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { transmisionController as c } from './transmision.controller';
import { comentariosQuery, crearTransmisionSchema, listarTransmisionesQuery } from './transmision.schemas';

/**
 * Se monta en /api/transmisiones. El video, los comentarios y las reacciones al momento van por Socket.IO
 * con `manejadorTransmisiones`; aquí se inicia, se termina y se consulta.
 */
export const transmisionRoutes = Router();

transmisionRoutes.use(auth.proteger);

transmisionRoutes.get('/', validate({ query: listarTransmisionesQuery }), c.listar);
transmisionRoutes.post('/', validate({ body: crearTransmisionSchema }), c.iniciar);
transmisionRoutes.get('/:id', validate({ params: idParams }), c.detalle);
transmisionRoutes.post('/:id/terminar', validate({ params: idParams }), c.terminar);
transmisionRoutes.get('/:id/comentarios', validate({ params: idParams, query: comentariosQuery }), c.comentarios);
transmisionRoutes.get('/:id/espectadores', validate({ params: idParams }), c.espectadores);
