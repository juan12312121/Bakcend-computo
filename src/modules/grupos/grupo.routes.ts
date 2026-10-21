import { Router } from 'express';
import { idParams, paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { camposUpload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { grupoController as c } from './grupo.controller';
import { actualizarGrupoSchema, crearGrupoSchema, invitacionParams, invitarSchema, responderInvitacionSchema, listarGruposQuery } from './grupo.schemas';

export const grupoRoutes = Router();

// Rutas fijas antes de /:id para que no las capture el parámetro.
grupoRoutes.get('/', auth.opcional, validate({ query: listarGruposQuery }), c.listar);
grupoRoutes.get('/mis-grupos', auth.proteger, c.misGrupos);
grupoRoutes.get('/invitaciones', auth.proteger, c.invitaciones);
grupoRoutes.post(
  '/invitaciones/:invitacion_id/responder',
  auth.proteger,
  validate({ params: invitacionParams, body: responderInvitacionSchema }),
  c.responderInvitacion,
);

grupoRoutes.post('/', auth.proteger, camposUpload.perfil, validate({ body: crearGrupoSchema }), c.crear);
grupoRoutes.get('/:id', auth.opcional, validate({ params: idParams }), c.detalle);
grupoRoutes.post('/:id/unirse', auth.proteger, validate({ params: idParams }), c.unirse);
grupoRoutes.post('/:id/salir', auth.proteger, validate({ params: idParams }), c.salir);
grupoRoutes.get('/:id/publicaciones', auth.opcional, validate({ params: idParams, query: paginacionQuery }), c.publicaciones);
grupoRoutes.post('/:id/invitar', auth.proteger, validate({ params: idParams, body: invitarSchema }), c.invitar);
grupoRoutes.put('/:id', auth.proteger, camposUpload.perfil, validate({ params: idParams, body: actualizarGrupoSchema }), c.actualizar);
