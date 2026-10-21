import { Router } from 'express';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { llamadaController as c } from './llamada.controller';
import { grupoIdParams, historialQuery } from './llamada.schemas';

/**
 * Se monta en /api/llamadas. La llamada en sí (sonar, contestar, SDP, ICE) va por Socket.IO con `manejadorLlamadas`;
 * aquí solo el historial, la configuración ICE y la llamada en curso de un grupo.
 */
export const llamadaRoutes = Router();

llamadaRoutes.use(auth.proteger);

llamadaRoutes.get('/', validate({ query: historialQuery }), c.historial);
llamadaRoutes.get('/ice', c.ice);
llamadaRoutes.get('/grupos/:grupoId/activa', validate({ params: grupoIdParams }), c.activaDeGrupo);
