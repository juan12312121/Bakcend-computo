import { Router } from 'express';
import { idParams } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { moderacionController as c } from './moderacion.controller';
import {
  actualizarPalabraSchema,
  bandejaQuery,
  contenidoParams,
  crearPalabraSchema,
  crearReporteSchema,
  estadisticasQuery,
  historialQuery,
  notaSchema,
  palabrasQuery,
  probarTextoSchema,
  resolverSchema,
  suspenderSchema,
  suspensionesQuery,
  usuariosReportadosQuery,
} from './moderacion.schemas';

export const moderacionRoutes = Router();

moderacionRoutes.use(auth.proteger);

// Cualquier usuario con sesión
moderacionRoutes.get('/opciones', c.opciones);
moderacionRoutes.post('/reportes', validate({ body: crearReporteSchema }), c.reportar);

// Solo administradores
const contenido = validate({ params: contenidoParams });
const conId = validate({ params: idParams });

moderacionRoutes.get('/bandeja', auth.soloAdmin, validate({ query: bandejaQuery }), c.bandeja);
moderacionRoutes.get('/contenidos/:tipo/:contenidoId', auth.soloAdmin, contenido, c.detalle);
moderacionRoutes.post(
  '/contenidos/:tipo/:contenidoId/resolver',
  auth.soloAdmin,
  validate({ params: contenidoParams, body: resolverSchema }),
  c.resolver,
);
moderacionRoutes.post('/contenidos/:tipo/:contenidoId/notas', auth.soloAdmin, validate({ params: contenidoParams, body: notaSchema }), c.nota);
moderacionRoutes.get('/historial', auth.soloAdmin, validate({ query: historialQuery }), c.historial);
moderacionRoutes.get('/estadisticas', auth.soloAdmin, validate({ query: estadisticasQuery }), c.estadisticas);
moderacionRoutes.get('/usuarios-reportados', auth.soloAdmin, validate({ query: usuariosReportadosQuery }), c.usuariosReportados);
moderacionRoutes.post('/importar-reportes-publicaciones', auth.soloAdmin, c.importar);

moderacionRoutes.get('/suspensiones', auth.soloAdmin, validate({ query: suspensionesQuery }), c.suspensiones);
moderacionRoutes.post('/usuarios/:id/suspender', auth.soloAdmin, validate({ params: idParams, body: suspenderSchema }), c.suspender);
moderacionRoutes.delete('/usuarios/:id/suspension', auth.soloAdmin, conId, c.levantar);

moderacionRoutes.get('/palabras', auth.soloAdmin, validate({ query: palabrasQuery }), c.listarPalabras);
moderacionRoutes.post('/palabras', auth.soloAdmin, validate({ body: crearPalabraSchema }), c.crearPalabra);
moderacionRoutes.post('/palabras/probar', auth.soloAdmin, validate({ body: probarTextoSchema }), c.probarTexto);
moderacionRoutes.patch('/palabras/:id', auth.soloAdmin, validate({ params: idParams, body: actualizarPalabraSchema }), c.actualizarPalabra);
moderacionRoutes.delete('/palabras/:id', auth.soloAdmin, conId, c.eliminarPalabra);
