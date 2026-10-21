import { Router } from 'express';
import { idParams, paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { marketplaceController as c } from './marketplace.controller';
import {
  CAMPO_FOTOS,
  LIMITES_ANUNCIO,
  actualizarAnuncioSchema,
  buscarAnunciosQuery,
  calificarSchema,
  cambiarEstadoSchema,
  crearAnuncioSchema,
  interesSchema,
  misAnunciosQuery,
  reportarAnuncioSchema,
  reporteIdParams,
  reportesQuery,
  revisarReporteSchema,
  usuarioIdParams,
} from './marketplace.schemas';

/** Hasta 10 fotos en el campo `imagen` (multipart). */
const subirFotos = upload.array(CAMPO_FOTOS, LIMITES_ANUNCIO.fotos);

/** Se monta en /api/marketplace. Buscar y ver no exigen sesión; todo lo demás sí. */
export const marketplaceRoutes = Router();

// Rutas fijas antes de /:id
marketplaceRoutes.get('/', auth.opcional, validate({ query: buscarAnunciosQuery }), c.buscar);
marketplaceRoutes.post('/', auth.proteger, subirFotos, validate({ body: crearAnuncioSchema }), c.crear);
marketplaceRoutes.get('/mios', auth.proteger, validate({ query: misAnunciosQuery }), c.mios);
marketplaceRoutes.get('/guardados', auth.proteger, validate({ query: paginacionQuery }), c.guardados);
marketplaceRoutes.get('/vistos', auth.proteger, validate({ query: paginacionQuery }), c.vistos);
marketplaceRoutes.get('/vendedores/:usuarioId', auth.opcional, validate({ params: usuarioIdParams }), c.vendedor);
marketplaceRoutes.get(
  '/vendedores/:usuarioId/calificaciones',
  auth.opcional,
  validate({ params: usuarioIdParams, query: paginacionQuery }),
  c.calificaciones,
);

// Moderación (solo admin)
marketplaceRoutes.get('/reportes', auth.proteger, auth.soloAdmin, validate({ query: reportesQuery }), c.reportes);
marketplaceRoutes.patch(
  '/reportes/:reporteId',
  auth.proteger,
  auth.soloAdmin,
  validate({ params: reporteIdParams, body: revisarReporteSchema }),
  c.revisarReporte,
);

marketplaceRoutes.get('/:id', auth.opcional, validate({ params: idParams }), c.detalle);
marketplaceRoutes.put('/:id', auth.proteger, subirFotos, validate({ params: idParams, body: actualizarAnuncioSchema }), c.actualizar);
marketplaceRoutes.delete('/:id', auth.proteger, validate({ params: idParams }), c.eliminar);
marketplaceRoutes.patch('/:id/estado', auth.proteger, validate({ params: idParams, body: cambiarEstadoSchema }), c.cambiarEstado);
marketplaceRoutes.post('/:id/renovar', auth.proteger, validate({ params: idParams }), c.renovar);
marketplaceRoutes.post('/:id/guardar', auth.proteger, validate({ params: idParams }), c.guardar);
marketplaceRoutes.post('/:id/interes', auth.proteger, validate({ params: idParams, body: interesSchema }), c.interes);
marketplaceRoutes.get('/:id/interesados', auth.proteger, validate({ params: idParams, query: paginacionQuery }), c.interesados);
marketplaceRoutes.post('/:id/reportar', auth.proteger, validate({ params: idParams, body: reportarAnuncioSchema }), c.reportar);
marketplaceRoutes.post('/:id/calificacion', auth.proteger, validate({ params: idParams, body: calificarSchema }), c.calificar);
