import { Router } from 'express';
import { paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { documentoColaborativoController as c } from './documento-colaborativo.controller';
import {
  compartirDocumentoSchema,
  crearDocumentoSchema,
  crearVersionSchema,
  documentoParams,
  exportarQuery,
  grupoDocumentosParams,
  listarDocumentosQuery,
  permisoParams,
  renombrarDocumentoSchema,
  versionParams,
} from './documento-colaborativo.schemas';

/** Documentos colaborativos (`/api/documentos-colaborativos`): todo requiere sesión. La edición en vivo va por Socket.IO. */
export const documentoColaborativoRoutes = Router();

documentoColaborativoRoutes.use(auth.proteger);

// Listas (rutas fijas antes de /:id)
documentoColaborativoRoutes.get('/mios', validate({ query: listarDocumentosQuery }), c.mios);
documentoColaborativoRoutes.get('/compartidos', validate({ query: listarDocumentosQuery }), c.compartidos);
documentoColaborativoRoutes.get('/grupo/:grupoId', validate({ params: grupoDocumentosParams, query: listarDocumentosQuery }), c.delGrupo);

// Documento
documentoColaborativoRoutes.post('/', validate({ body: crearDocumentoSchema }), c.crear);
documentoColaborativoRoutes.get('/:id', validate({ params: documentoParams }), c.detalle);
documentoColaborativoRoutes.patch('/:id', validate({ params: documentoParams, body: renombrarDocumentoSchema }), c.renombrar);
documentoColaborativoRoutes.delete('/:id', validate({ params: documentoParams }), c.eliminar);
documentoColaborativoRoutes.post('/:id/papelera', validate({ params: documentoParams }), c.aPapelera);
documentoColaborativoRoutes.post('/:id/restaurar', validate({ params: documentoParams }), c.restaurar);
documentoColaborativoRoutes.get('/:id/exportar', validate({ params: documentoParams, query: exportarQuery }), c.exportar);

// Compartir (solo personales)
documentoColaborativoRoutes.get('/:id/permisos', validate({ params: documentoParams }), c.permisos);
documentoColaborativoRoutes.put('/:id/permisos', validate({ params: documentoParams, body: compartirDocumentoSchema }), c.compartir);
documentoColaborativoRoutes.delete('/:id/permisos/:usuarioId', validate({ params: permisoParams }), c.quitarPermiso);

// Versiones
documentoColaborativoRoutes.get('/:id/versiones', validate({ params: documentoParams, query: paginacionQuery }), c.versiones);
documentoColaborativoRoutes.post('/:id/versiones', validate({ params: documentoParams, body: crearVersionSchema }), c.crearVersion);
documentoColaborativoRoutes.get('/:id/versiones/:versionId', validate({ params: versionParams }), c.version);
documentoColaborativoRoutes.post('/:id/versiones/:versionId/restaurar', validate({ params: versionParams }), c.restaurarVersion);
