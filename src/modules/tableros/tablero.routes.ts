import { Router } from 'express';
import { idParams, paginacionQuery } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { sprintController as s } from './sprint.controller';
import { tableroController as c } from './tablero.controller';
import {
  actualizarColumnaSchema,
  actualizarEtiquetaSchema,
  actualizarItemSchema,
  actualizarSprintSchema,
  actualizarTableroSchema,
  actualizarTareaSchema,
  asignarSchema,
  cambiarRolSchema,
  cerrarSprintSchema,
  checklistParams,
  columnaParams,
  comentarioParams,
  comentarioSchema,
  crearColumnaSchema,
  crearEtiquetaSchema,
  crearItemSchema,
  crearSprintSchema,
  crearTableroSchema,
  crearTareaSchema,
  eliminarColumnaQuery,
  etiquetaParams,
  etiquetarSchema,
  filtroTareasQuery,
  iniciarSprintSchema,
  invitarMiembroSchema,
  listarTablerosQuery,
  listarTareasQuery,
  miembroParams,
  moverTareaSchema,
  reordenarColumnasSchema,
  sprintParams,
  tareaEtiquetaParams,
  tareaParams,
  tareaUsuarioParams,
} from './tablero.schemas';
import { tareaController as t } from './tarea.controller';

/** Montar en `/api/tableros`. Todo exige sesión. */
export const tableroRoutes = Router();

tableroRoutes.use(auth.proteger);

// ---------- Rutas fijas (antes de /:id) ----------
tableroRoutes.get('/', validate({ query: listarTablerosQuery }), c.listar);
tableroRoutes.post('/', validate({ body: crearTableroSchema }), c.crear);
tableroRoutes.get('/mis-tareas', t.misTareas);

// ---------- Tareas (por id de tarea) ----------
tableroRoutes.get('/tareas/:tarea_id', validate({ params: tareaParams }), t.detalle);
tableroRoutes.put('/tareas/:tarea_id', validate({ params: tareaParams, body: actualizarTareaSchema }), t.actualizar);
tableroRoutes.delete('/tareas/:tarea_id', validate({ params: tareaParams }), t.eliminar);
tableroRoutes.post('/tareas/:tarea_id/mover', validate({ params: tareaParams, body: moverTareaSchema }), t.mover);
tableroRoutes.post('/tareas/:tarea_id/archivar', validate({ params: tareaParams }), t.archivar);
tableroRoutes.post('/tareas/:tarea_id/desarchivar', validate({ params: tareaParams }), t.desarchivar);
tableroRoutes.get('/tareas/:tarea_id/actividad', validate({ params: tareaParams, query: paginacionQuery }), t.actividad);
tableroRoutes.post('/tareas/:tarea_id/asignados', validate({ params: tareaParams, body: asignarSchema }), t.asignar);
tableroRoutes.delete('/tareas/:tarea_id/asignados/:usuario_id', validate({ params: tareaUsuarioParams }), t.desasignar);
tableroRoutes.post('/tareas/:tarea_id/etiquetas', validate({ params: tareaParams, body: etiquetarSchema }), t.etiquetar);
tableroRoutes.delete('/tareas/:tarea_id/etiquetas/:etiqueta_id', validate({ params: tareaEtiquetaParams }), t.quitarEtiqueta);
tableroRoutes.post('/tareas/:tarea_id/checklist', validate({ params: tareaParams, body: crearItemSchema }), t.agregarItem);
tableroRoutes.put('/tareas/:tarea_id/checklist/:item_id', validate({ params: checklistParams, body: actualizarItemSchema }), t.editarItem);
tableroRoutes.delete('/tareas/:tarea_id/checklist/:item_id', validate({ params: checklistParams }), t.eliminarItem);
tableroRoutes.post('/tareas/:tarea_id/comentarios', validate({ params: tareaParams, body: comentarioSchema }), t.comentar);
tableroRoutes.put('/tareas/:tarea_id/comentarios/:comentario_id', validate({ params: comentarioParams, body: comentarioSchema }), t.editarComentario);
tableroRoutes.delete('/tareas/:tarea_id/comentarios/:comentario_id', validate({ params: comentarioParams }), t.eliminarComentario);

// ---------- Sprints (por id de sprint) ----------
tableroRoutes.put('/sprints/:sprint_id', validate({ params: sprintParams, body: actualizarSprintSchema }), s.actualizar);
tableroRoutes.delete('/sprints/:sprint_id', validate({ params: sprintParams }), s.eliminar);
tableroRoutes.post('/sprints/:sprint_id/iniciar', validate({ params: sprintParams, body: iniciarSprintSchema }), s.iniciar);
tableroRoutes.post('/sprints/:sprint_id/cerrar', validate({ params: sprintParams, body: cerrarSprintSchema }), s.cerrar);

// ---------- Un tablero ----------
tableroRoutes.get('/:id', validate({ params: idParams, query: filtroTareasQuery }), c.detalle);
tableroRoutes.put('/:id', validate({ params: idParams, body: actualizarTableroSchema }), c.actualizar);
tableroRoutes.delete('/:id', validate({ params: idParams }), c.eliminar);
tableroRoutes.post('/:id/archivar', validate({ params: idParams }), c.archivar);
tableroRoutes.post('/:id/desarchivar', validate({ params: idParams }), c.desarchivar);
tableroRoutes.get('/:id/reporte', validate({ params: idParams }), c.reporte);
tableroRoutes.get('/:id/actividad', validate({ params: idParams, query: paginacionQuery }), c.actividad);

// Miembros
tableroRoutes.get('/:id/miembros', validate({ params: idParams }), c.miembros);
tableroRoutes.post('/:id/miembros', validate({ params: idParams, body: invitarMiembroSchema }), c.invitar);
tableroRoutes.put('/:id/miembros/:usuario_id', validate({ params: miembroParams, body: cambiarRolSchema }), c.cambiarRol);
tableroRoutes.delete('/:id/miembros/:usuario_id', validate({ params: miembroParams }), c.quitarMiembro);
tableroRoutes.post('/:id/salir', validate({ params: idParams }), c.salir);

// Columnas (el orden va antes de /:columna_id)
tableroRoutes.post('/:id/columnas', validate({ params: idParams, body: crearColumnaSchema }), c.crearColumna);
tableroRoutes.put('/:id/columnas/orden', validate({ params: idParams, body: reordenarColumnasSchema }), c.reordenarColumnas);
tableroRoutes.put('/:id/columnas/:columna_id', validate({ params: columnaParams, body: actualizarColumnaSchema }), c.editarColumna);
tableroRoutes.delete('/:id/columnas/:columna_id', validate({ params: columnaParams, query: eliminarColumnaQuery }), c.eliminarColumna);

// Etiquetas
tableroRoutes.post('/:id/etiquetas', validate({ params: idParams, body: crearEtiquetaSchema }), c.crearEtiqueta);
tableroRoutes.put('/:id/etiquetas/:etiqueta_id', validate({ params: etiquetaParams, body: actualizarEtiquetaSchema }), c.editarEtiqueta);
tableroRoutes.delete('/:id/etiquetas/:etiqueta_id', validate({ params: etiquetaParams }), c.eliminarEtiqueta);

// Tareas del tablero
tableroRoutes.get('/:id/tareas', validate({ params: idParams, query: listarTareasQuery }), t.listar);
tableroRoutes.post('/:id/tareas', validate({ params: idParams, body: crearTareaSchema }), t.crear);

// Sprints y backlog
tableroRoutes.get('/:id/backlog', validate({ params: idParams }), s.backlog);
tableroRoutes.get('/:id/sprints', validate({ params: idParams }), s.listar);
tableroRoutes.post('/:id/sprints', validate({ params: idParams, body: crearSprintSchema }), s.crear);
