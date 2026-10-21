import { Router } from 'express';
import { idParams, paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { CAMPO_DOCUMENTO, documentoController as c } from './documento.controller';
import {
  actualizarDocumentoSchema,
  publicacionDocumentosParams,
  subirDocumentoSchema,
  usuarioDocumentosParams,
  vincularDocumentoSchema,
} from './documento.schemas';

export const documentoRoutes = Router();

const archivo = upload.single(CAMPO_DOCUMENTO);

// Rutas específicas antes de /:id
documentoRoutes.get('/mis-documentos', auth.proteger, validate({ query: paginacionQuery }), c.misDocumentos);
documentoRoutes.get(
  '/usuario/:usuario_id',
  auth.opcional,
  validate({ params: usuarioDocumentosParams, query: paginacionQuery }),
  c.deUsuario,
);
documentoRoutes.get('/publicacion/:publicacion_id', auth.proteger, validate({ params: publicacionDocumentosParams }), c.dePublicacion);

documentoRoutes.post('/', auth.proteger, archivo, validate({ body: subirDocumentoSchema }), c.subir);
documentoRoutes.patch('/:id/vincular', auth.proteger, validate({ params: idParams, body: vincularDocumentoSchema }), c.vincular);
documentoRoutes.patch('/:id/desvincular', auth.proteger, validate({ params: idParams }), c.desvincular);
documentoRoutes.put('/:id', auth.proteger, archivo, validate({ params: idParams, body: actualizarDocumentoSchema }), c.actualizar);
documentoRoutes.delete('/:id', auth.proteger, validate({ params: idParams }), c.eliminar);

// Listado completo: solo administradores
documentoRoutes.get('/', auth.proteger, auth.soloAdmin, validate({ query: paginacionQuery }), c.todos);
documentoRoutes.get('/:id', auth.opcional, validate({ params: idParams }), c.obtener);

// Si algo falla después de subir el archivo, se borra de Cloudinary
