import { Router } from 'express';
import { validate } from '../../core/validation/validate';
import { upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { archivoGrupoController as c } from './archivo-grupo.controller';
import {
  actualizarArchivoSchema,
  actualizarCarpetaSchema,
  archivoParams,
  buscarArchivosQuery,
  contenidoQuery,
  crearCarpetaSchema,
  grupoArchivosParams,
  subirArchivoSchema,
} from './archivo-grupo.schemas';

/** Carpeta compartida de los grupos (`/api/archivos-grupo`): solo miembros activos. */
export const archivoGrupoRoutes = Router();

archivoGrupoRoutes.use(auth.proteger);

// Del grupo
archivoGrupoRoutes.get('/grupo/:grupoId', validate({ params: grupoArchivosParams, query: contenidoQuery }), c.contenido);
archivoGrupoRoutes.get('/grupo/:grupoId/carpetas', validate({ params: grupoArchivosParams }), c.arbol);
archivoGrupoRoutes.get('/grupo/:grupoId/buscar', validate({ params: grupoArchivosParams, query: buscarArchivosQuery }), c.buscar);
archivoGrupoRoutes.get('/grupo/:grupoId/uso', validate({ params: grupoArchivosParams }), c.uso);
archivoGrupoRoutes.post('/grupo/:grupoId/carpetas', validate({ params: grupoArchivosParams, body: crearCarpetaSchema }), c.crearCarpeta);
archivoGrupoRoutes.post(
  '/grupo/:grupoId/archivos',
  upload.single('archivo'),
  validate({ params: grupoArchivosParams, body: subirArchivoSchema }),
  c.subir,
);

// Carpetas
archivoGrupoRoutes.patch('/carpetas/:id', validate({ params: archivoParams, body: actualizarCarpetaSchema }), c.actualizarCarpeta);
archivoGrupoRoutes.delete('/carpetas/:id', validate({ params: archivoParams }), c.eliminarCarpeta);

// Archivos
archivoGrupoRoutes.get('/:id', validate({ params: archivoParams }), c.detalle);
archivoGrupoRoutes.patch('/:id', validate({ params: archivoParams, body: actualizarArchivoSchema }), c.actualizar);
archivoGrupoRoutes.delete('/:id', validate({ params: archivoParams }), c.eliminar);
