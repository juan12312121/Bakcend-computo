import { Router } from 'express';
import { idParams, paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { subidaHistoria, upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { historiaController as c } from './historia.controller';
import { crearHistoriaSchema, edicionHistoriaSchema, usuarioHistoriasParams } from './historia.schemas';

export const historiaRoutes = Router();

historiaRoutes.use(auth.proteger);

historiaRoutes.get('/fondos', c.fondos);
historiaRoutes.get('/', c.bandeja);
// [creadores] Archivo de mis historias (antes de /:id)
historiaRoutes.get('/archivo', validate({ query: paginacionQuery }), c.archivo);
// multipart (campo `media`) o JSON para las de texto
historiaRoutes.post('/', subidaHistoria, validate({ body: crearHistoriaSchema }), c.crear);
historiaRoutes.get('/usuario/:usuarioId', validate({ params: usuarioHistoriasParams }), c.deUsuario);
historiaRoutes.post('/:id/vista', validate({ params: idParams }), c.marcarVista);
historiaRoutes.get('/:id/vistas', validate({ params: idParams, query: paginacionQuery }), c.vistas);
historiaRoutes.put('/:id/edicion', upload.single('archivo'), validate({ params: idParams, body: edicionHistoriaSchema }), c.editarVideo);
historiaRoutes.delete('/:id', validate({ params: idParams }), c.eliminar);
