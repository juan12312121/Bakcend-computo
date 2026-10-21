import { Router } from 'express';
import { idParams } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { eventoController as c } from './evento.controller';
import {
  actualizarEventoSchema,
  asistenciaSchema,
  asistentesQuery,
  calendarioQuery,
  crearEventoSchema,
  invitarSchema,
  listarEventosQuery,
} from './evento.schemas';

/** Se monta en /api/eventos. Leer no exige sesión (sin sesión solo se ven los públicos). */
export const eventoRoutes = Router();

// Rutas fijas antes de /:id
eventoRoutes.get('/', auth.opcional, validate({ query: listarEventosQuery }), c.listar);
eventoRoutes.get('/calendario', auth.opcional, validate({ query: calendarioQuery }), c.calendario);
// multipart (imagen en `portada`) o JSON
eventoRoutes.post('/', auth.proteger, upload.single('portada'), validate({ body: crearEventoSchema }), c.crear);

eventoRoutes.get('/:id', auth.opcional, validate({ params: idParams }), c.detalle);
eventoRoutes.get('/:id/ics', auth.opcional, validate({ params: idParams }), c.ics);
eventoRoutes.get('/:id/asistentes', auth.opcional, validate({ params: idParams, query: asistentesQuery }), c.asistentes);
eventoRoutes.put('/:id', auth.proteger, upload.single('portada'), validate({ params: idParams, body: actualizarEventoSchema }), c.actualizar);
eventoRoutes.post('/:id/cancelar', auth.proteger, validate({ params: idParams }), c.cancelar);
eventoRoutes.post('/:id/asistencia', auth.proteger, validate({ params: idParams, body: asistenciaSchema }), c.asistencia);
eventoRoutes.post('/:id/invitar', auth.proteger, validate({ params: idParams, body: invitarSchema }), c.invitar);
eventoRoutes.delete('/:id', auth.proteger, validate({ params: idParams }), c.eliminar);
