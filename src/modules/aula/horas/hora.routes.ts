import { Router } from 'express';
import { idParams } from '../../../core/validation/common.schemas';
import { validate } from '../../../core/validation/validate';
import { auth } from '../../../middlewares/AuthGuard';
import { horaController as h } from './hora.controller';
import { editarRegistroSchema, iniciarSchema, registrarSchema, resumenQuery, tareaParams, tarifaSchema } from './hora.schemas';

/** Montar en `/api/horas`: control de horas en las tareas de los tableros. Todo exige sesión. */
export const horaRoutes = Router();

horaRoutes.use(auth.proteger);

// Cronómetro (uno activo por persona)
horaRoutes.get('/activo', h.activo);
horaRoutes.post('/detener', h.detener);

// Por tarea
horaRoutes.get('/tareas/:tarea_id', validate({ params: tareaParams }), h.deTarea);
horaRoutes.post('/tareas/:tarea_id', validate({ params: tareaParams, body: registrarSchema }), h.registrar);
horaRoutes.post('/tareas/:tarea_id/iniciar', validate({ params: tareaParams, body: iniciarSchema }), h.iniciar);

// Mis registros
horaRoutes.put('/registros/:id', validate({ params: idParams, body: editarRegistroSchema }), h.editar);
horaRoutes.delete('/registros/:id', validate({ params: idParams }), h.eliminar);

// Por tablero
horaRoutes.get('/tableros/:id/resumen', validate({ params: idParams, query: resumenQuery }), h.resumen);
horaRoutes.get('/tableros/:id/csv', validate({ params: idParams, query: resumenQuery }), h.csv);
horaRoutes.get('/tableros/:id/tarifas', validate({ params: idParams }), h.tarifas);
horaRoutes.put('/tableros/:id/tarifas', validate({ params: idParams, body: tarifaSchema }), h.fijarTarifa);
