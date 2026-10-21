import { Router } from 'express';
import { paramsDe } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { fotoController as c } from './foto.controller';
import { fotosLoteSchema, galeriaQuery } from './foto.schemas';

export const fotoRoutes = Router();

const usuarioParams = paramsDe('usuario_id');

fotoRoutes.get('/mis-fotos', auth.proteger, validate({ query: galeriaQuery }), c.misFotos);
fotoRoutes.get('/usuario/:usuario_id', auth.opcional, validate({ params: usuarioParams, query: galeriaQuery }), c.deUsuario);
fotoRoutes.get('/usuario/:usuario_id/foto-perfil-simple', validate({ params: usuarioParams }), c.fotoPerfil);
fotoRoutes.post('/usuarios/fotos-batch', validate({ body: fotosLoteSchema }), c.fotosPerfilLote);
