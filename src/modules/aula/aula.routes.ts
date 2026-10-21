import { Router } from 'express';
import { idParams } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { upload } from '../../infrastructure/storage/upload';
import { auth } from '../../middlewares/AuthGuard';
import { asignacionController as a } from './asignaciones/asignacion.controller';
import {
  actualizarAsignacionSchema,
  alumnoParams,
  calificarSchema,
  crearAsignacionSchema,
  devolverSchema,
  entregarSchema,
  grupoParams,
  listarAsignacionesQuery,
} from './asignaciones/asignacion.schemas';
import { calendarioController as c } from './calendario/calendario.controller';
import { calendarioQuery, icsParams } from './calendario/calendario.schemas';

/**
 * Montar en `/api/aula`: calendario compartido del grupo y tareas con entrega (escuela).
 * Todo exige sesión salvo el .ics de suscripción (lleva un token secreto en la URL).
 */
export const aulaRoutes = Router();

// Suscripción (Google Calendar no manda sesión)
aulaRoutes.get('/ics/:token/grupos/:grupo_id.ics', validate({ params: icsParams }), c.ics);

aulaRoutes.use(auth.proteger);

// ---------- Grupo ----------
aulaRoutes.get('/grupos/:grupo_id', validate({ params: grupoParams }), a.resumen);
aulaRoutes.get('/grupos/:grupo_id/calendario', validate({ params: grupoParams, query: calendarioQuery }), c.elementos);
aulaRoutes.get('/grupos/:grupo_id/calendario/suscripcion', validate({ params: grupoParams }), c.suscripcion);
aulaRoutes.post('/grupos/:grupo_id/calendario/suscripcion/regenerar', validate({ params: grupoParams }), c.regenerar);
aulaRoutes.get('/grupos/:grupo_id/asignaciones', validate({ params: grupoParams, query: listarAsignacionesQuery }), a.listar);
// multipart (archivo de apoyo en `archivo`) o JSON
aulaRoutes.post('/grupos/:grupo_id/asignaciones', upload.single('archivo'), validate({ params: grupoParams, body: crearAsignacionSchema }), a.crear);
aulaRoutes.get('/grupos/:grupo_id/libreta', validate({ params: grupoParams }), a.libreta);
aulaRoutes.get('/grupos/:grupo_id/libreta/csv', validate({ params: grupoParams }), a.libretaCsv);

// ---------- Una asignación ----------
aulaRoutes.get('/asignaciones/:id', validate({ params: idParams }), a.detalle);
aulaRoutes.put('/asignaciones/:id', upload.single('archivo'), validate({ params: idParams, body: actualizarAsignacionSchema }), a.actualizar);
aulaRoutes.delete('/asignaciones/:id', validate({ params: idParams }), a.eliminar);
aulaRoutes.get('/asignaciones/:id/entregas', validate({ params: idParams }), a.entregas);
// Alumno: multipart con `archivo` y/o `comentario`
aulaRoutes.post('/asignaciones/:id/entrega', upload.single('archivo'), validate({ params: idParams, body: entregarSchema }), a.entregar);
// Maestro
aulaRoutes.post('/asignaciones/:id/entregas/:alumno_id/calificar', validate({ params: alumnoParams, body: calificarSchema }), a.calificar);
aulaRoutes.post('/asignaciones/:id/entregas/:alumno_id/devolver', validate({ params: alumnoParams, body: devolverSchema }), a.devolver);
