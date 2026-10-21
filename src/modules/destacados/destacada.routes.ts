import { Router } from 'express';
import { idParams } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { destacadaController as c } from './destacada.controller';
import {
  actualizarDestacadaSchema,
  agregarHistoriaSchema,
  crearDestacadaSchema,
  destacadaHistoriaParams,
  ordenDestacadasSchema,
  usuarioParams,
} from './destacada.schemas';

/** Se monta en /api/destacadas. Ver las de un perfil no exige sesión (sin sesión, solo cuentas públicas). */
export const destacadaRoutes = Router();

// Rutas fijas antes de /:id
destacadaRoutes.get('/mias', auth.proteger, c.mias);
destacadaRoutes.get('/usuario/:usuarioId', auth.opcional, validate({ params: usuarioParams }), c.deUsuario);
destacadaRoutes.put('/orden', auth.proteger, validate({ body: ordenDestacadasSchema }), c.reordenar);
// JSON o multipart (imagen de portada opcional en `portada`)
destacadaRoutes.post('/', auth.proteger, upload.single('portada'), validate({ body: crearDestacadaSchema }), c.crear);

destacadaRoutes.get('/:id', auth.opcional, validate({ params: idParams }), c.detalle);
destacadaRoutes.put('/:id', auth.proteger, upload.single('portada'), validate({ params: idParams, body: actualizarDestacadaSchema }), c.actualizar);
destacadaRoutes.post('/:id/historias', auth.proteger, validate({ params: idParams, body: agregarHistoriaSchema }), c.agregarHistoria);
destacadaRoutes.delete('/:id/historias/:historiaId', auth.proteger, validate({ params: destacadaHistoriaParams }), c.quitarHistoria);
destacadaRoutes.delete('/:id', auth.proteger, validate({ params: idParams }), c.eliminar);
