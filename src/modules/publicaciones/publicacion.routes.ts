import { Router } from 'express';
import { idParams, paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { camposUpload, upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { publicacionController as c } from './publicacion.controller';
import {
  actualizarPublicacionSchema,
  buscarPublicacionesQuery,
  crearPublicacionSchema,
  edicionVideoSchema,
  feedQuery,
  programadasQuery,
  programarSchema,
  usuarioParams,
} from './publicacion.schemas';

export const publicacionRoutes = Router();

// Rutas específicas antes de /:id
publicacionRoutes.get('/buscar', auth.proteger, validate({ query: buscarPublicacionesQuery }), c.buscar);
publicacionRoutes.get('/categorias', c.categorias);
publicacionRoutes.get('/categorias/totales', auth.opcional, c.categoriasConTotales);
publicacionRoutes.get('/visibilidades', c.visibilidades);
publicacionRoutes.get('/reels', auth.opcional, validate({ query: paginacionQuery }), c.reels);
// [creadores] Programadas y borradores (solo su autor)
publicacionRoutes.get('/programadas', auth.proteger, validate({ query: programadasQuery }), c.programadas);
publicacionRoutes.get('/mis-publicaciones', auth.proteger, validate({ query: paginacionQuery }), c.misPublicaciones);
publicacionRoutes.get(
  '/usuario/:usuarioId',
  auth.opcional,
  validate({ params: usuarioParams, query: paginacionQuery }),
  c.deUsuario,
);

publicacionRoutes.post('/', auth.proteger, camposUpload.publicacion, validate({ body: crearPublicacionSchema }), c.crear);
publicacionRoutes.put(
  '/:id',
  auth.proteger,
  camposUpload.publicacion,
  validate({ params: idParams, body: actualizarPublicacionSchema }),
  c.actualizar,
);
publicacionRoutes.put('/:id/programacion', auth.proteger, validate({ params: idParams, body: programarSchema }), c.programar);
publicacionRoutes.post('/:id/cancelar-programacion', auth.proteger, validate({ params: idParams }), c.cancelarProgramacion);
publicacionRoutes.post('/:id/publicar', auth.proteger, validate({ params: idParams }), c.publicarAhora);
// [creadores] Editor de video: recorte, silencio, texto y música (audio en el campo `archivo`)
publicacionRoutes.put(
  '/:id/edicion',
  auth.proteger,
  upload.single('archivo'),
  validate({ params: idParams, body: edicionVideoSchema }),
  c.editarVideo,
);
publicacionRoutes.post('/:id/vista', auth.opcional, validate({ params: idParams }), c.registrarVista);
publicacionRoutes.delete('/:id', auth.proteger, validate({ params: idParams }), c.eliminar);

// Generales al final
publicacionRoutes.get('/', auth.opcional, validate({ query: feedQuery }), c.feed);
publicacionRoutes.get('/:id', auth.opcional, validate({ params: idParams }), c.detalle);

