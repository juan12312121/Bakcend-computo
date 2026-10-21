import { Router } from 'express';
import { paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { reaccionSchema } from '../chat/reacciones';
import { canalController as c } from './canal.controller';
import {
  actualizarCanalSchema,
  administradorParams,
  administradorSchema,
  canalParams,
  codigoParams,
  crearCanalSchema,
  descubrirQuery,
  publicacionParams,
  publicacionesQuery,
  publicarSchema,
  silencioSchema,
} from './canal.schemas';

/**
 * Canales tipo Telegram (`/api/canales`). Leer canales públicos no exige sesión; todo lo demás sí.
 * Foto del canal en `imagen` (multipart); adjunto de una publicación en `archivo` (imagen o documento).
 */
export const canalRoutes = Router();

// Rutas fijas antes de /:id
canalRoutes.get('/', auth.opcional, validate({ query: descubrirQuery }), c.descubrir);
canalRoutes.get('/mios', auth.proteger, validate({ query: paginacionQuery }), c.mios);
canalRoutes.get('/invitacion/:codigo', auth.opcional, validate({ params: codigoParams }), c.invitacion);
canalRoutes.post('/invitacion/:codigo', auth.proteger, validate({ params: codigoParams }), c.unirse);
canalRoutes.post('/', auth.proteger, upload.single('imagen'), validate({ body: crearCanalSchema }), c.crear);

canalRoutes.get('/:id', auth.opcional, validate({ params: canalParams }), c.detalle);
canalRoutes.put('/:id', auth.proteger, upload.single('imagen'), validate({ params: canalParams, body: actualizarCanalSchema }), c.actualizar);
canalRoutes.delete('/:id', auth.proteger, validate({ params: canalParams }), c.eliminar);
canalRoutes.post('/:id/enlace', auth.proteger, validate({ params: canalParams }), c.regenerarEnlace);

canalRoutes.post('/:id/suscripcion', auth.proteger, validate({ params: canalParams }), c.suscribirse);
canalRoutes.delete('/:id/suscripcion', auth.proteger, validate({ params: canalParams }), c.salir);
canalRoutes.put('/:id/silencio', auth.proteger, validate({ params: canalParams, body: silencioSchema }), c.silenciar);
canalRoutes.put('/:id/leer', auth.proteger, validate({ params: canalParams }), c.leer);

canalRoutes.get('/:id/administradores', auth.opcional, validate({ params: canalParams }), c.administradores);
canalRoutes.post('/:id/administradores', auth.proteger, validate({ params: canalParams, body: administradorSchema }), c.agregarAdministrador);
canalRoutes.delete('/:id/administradores/:usuarioId', auth.proteger, validate({ params: administradorParams }), c.quitarAdministrador);
canalRoutes.get('/:id/suscriptores', auth.proteger, validate({ params: canalParams, query: paginacionQuery }), c.suscriptores);

canalRoutes.get('/:id/publicaciones', auth.opcional, validate({ params: canalParams, query: publicacionesQuery }), c.listarPublicaciones);
canalRoutes.post(
  '/:id/publicaciones',
  auth.proteger,
  upload.single('archivo'),
  validate({ params: canalParams, body: publicarSchema }),
  c.publicar,
);
canalRoutes.delete('/:id/publicaciones/:publicacionId', auth.proteger, validate({ params: publicacionParams }), c.eliminarPublicacion);
canalRoutes.put('/:id/publicaciones/:publicacionId/reaccion', auth.proteger, validate({ params: publicacionParams, body: reaccionSchema }), c.reaccionar);
canalRoutes.delete('/:id/publicaciones/:publicacionId/reaccion', auth.proteger, validate({ params: publicacionParams }), c.quitarReaccion);
