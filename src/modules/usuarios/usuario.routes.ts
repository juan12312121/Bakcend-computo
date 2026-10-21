import { Router } from 'express';
import { idParams } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { camposUpload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { usuarioController as c } from './usuario.controller';
import { actualizarPerfilSchema, buscarUsuariosQuery, presenciaSchema } from './usuario.schemas';

export const usuarioRoutes = Router();

usuarioRoutes.use(auth.proteger);

usuarioRoutes.get('/me', c.miPerfil);
usuarioRoutes.put('/me', camposUpload.perfil, validate({ body: actualizarPerfilSchema }), c.actualizarPerfil);
usuarioRoutes.delete('/me', c.eliminarCuenta);
usuarioRoutes.put('/me/actividad', validate({ body: presenciaSchema }), c.presencia);
usuarioRoutes.post('/me/heartbeat', c.heartbeat);
usuarioRoutes.get('/me/seguidores/activos', c.seguidoresEnLinea);
usuarioRoutes.get('/activos', c.enLinea);
usuarioRoutes.get('/buscar', validate({ query: buscarUsuariosQuery }), c.buscar);
usuarioRoutes.get('/:id', validate({ params: idParams }), c.perfil);
