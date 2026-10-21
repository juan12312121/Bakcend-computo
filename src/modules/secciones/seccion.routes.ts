import { Router } from 'express';
import { idParams, paramsDe } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { seccionController as c } from './seccion.controller';
import { actualizarSeccionSchema, crearSeccionSchema, postSeccionSchema } from './seccion.schemas';

export const seccionRoutes = Router();

/** La sesión se verifica antes de multer: sin token no se sube nada a Cloudinary. */
const portada = upload.single('imagen_portada');

// ---------- Públicas ----------
seccionRoutes.get('/usuario/:usuario_id', validate({ params: paramsDe('usuario_id') }), c.deUsuario);
seccionRoutes.get(
  '/usuario/:usuario_id/seccion/:seccion_id',
  auth.opcional,
  validate({ params: paramsDe('usuario_id', 'seccion_id') }),
  c.verPublica,
);

// ---------- Propias ----------
seccionRoutes.post('/', auth.proteger, portada, validate({ body: crearSeccionSchema }), c.crear);
seccionRoutes.get('/', auth.proteger, c.misSecciones);
seccionRoutes.get('/mis-secciones', auth.proteger, c.misSecciones);

seccionRoutes.post('/posts/agregar', auth.proteger, validate({ body: postSeccionSchema }), c.agregarPost);
seccionRoutes.post('/posts/quitar', auth.proteger, validate({ body: postSeccionSchema }), c.quitarPost);
seccionRoutes.get('/posts/:publicacion_id', auth.proteger, validate({ params: paramsDe('publicacion_id') }), c.seccionesDePost);

seccionRoutes.get('/:id', auth.proteger, validate({ params: idParams }), c.ver);
seccionRoutes.put('/:id', auth.proteger, portada, validate({ params: idParams, body: actualizarSeccionSchema }), c.actualizar);
seccionRoutes.delete('/:id', auth.proteger, validate({ params: idParams }), c.eliminar);
