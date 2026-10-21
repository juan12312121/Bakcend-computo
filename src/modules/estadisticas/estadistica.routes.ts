import { Router } from 'express';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { estadisticaController as c } from './estadistica.controller';
import { detalleQuery, impresionesSchema, publicacionParams, resumenQuery, usuarioParams } from './estadistica.schemas';

/** Se monta en /api/estadisticas. Todo exige sesión; cada quien ve solo sus propias estadísticas. */
export const estadisticaRoutes = Router();

estadisticaRoutes.use(auth.proteger);

// Registro (lo manda el frontend)
estadisticaRoutes.post('/impresiones', validate({ body: impresionesSchema }), c.impresiones);
estadisticaRoutes.post('/visitas-perfil/:usuarioId', validate({ params: usuarioParams }), c.visitaPerfil);
estadisticaRoutes.post('/clics/:publicacionId', validate({ params: publicacionParams }), c.clic);

// Panel del creador
estadisticaRoutes.get('/resumen', validate({ query: resumenQuery }), c.resumen);
estadisticaRoutes.get('/publicaciones/:publicacionId', validate({ params: publicacionParams, query: detalleQuery }), c.detallePublicacion);
