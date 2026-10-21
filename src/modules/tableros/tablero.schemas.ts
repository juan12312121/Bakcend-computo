import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe, textoOpcional, textoRequerido } from '../../core/validation/common.schemas';
import { PRIORIDADES_TAREA, ROLES_TABLERO, TIPOS_TAREA } from '../../infrastructure/database/models';
import { PLANTILLAS_TABLERO } from './tablero.plantillas';

// ---------- Piezas ----------

/** En la query los booleanos llegan como texto. */
const booleanoQuery = z.preprocess(
  (v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v),
  z.boolean({ invalid_type_error: 'Debe ser true o false' }),
);

/** Gradiente de Tailwind: "from-orange-400 to-orange-600" (opcional "via-..."). */
const colorTablero = z
  .string()
  .trim()
  .regex(/^from-[a-z]+-\d{2,3}( via-[a-z]+-\d{2,3})? to-[a-z]+-\d{2,3}$/, 'El color no es válido');

/** Fondo de Tailwind: "bg-sky-500". */
const colorEtiqueta = z.string().trim().regex(/^bg-[a-z]+-\d{2,3}$/, 'El color no es válido');

/** Fecha opcional que acepta null para borrarla (sin que null se convierta en 1970). */
const fechaOpcional = z.union([z.null(), z.coerce.date({ errorMap: () => ({ message: 'La fecha no es válida' }) })]).optional();

const idNulo = idSchema.nullable().optional();

const tipoTarea = z.enum(TIPOS_TAREA, { errorMap: () => ({ message: `El tipo debe ser ${TIPOS_TAREA.join(', ')}` }) });
const prioridad = z.enum(PRIORIDADES_TAREA, { errorMap: () => ({ message: `La prioridad debe ser ${PRIORIDADES_TAREA.join(', ')}` }) });
const rolTablero = z.enum(ROLES_TABLERO, { errorMap: () => ({ message: `El rol debe ser ${ROLES_TABLERO.join(', ')}` }) });
const puntos = z.number({ invalid_type_error: 'Los puntos deben ser un número' }).int().min(0).max(1000).nullable().optional();

const conAlgunDato = <T extends z.ZodRawShape>(forma: T) =>
  z
    .object(forma)
    .strip()
    .refine((datos) => Object.values(datos).some((v) => v !== undefined), { message: 'No hay datos para actualizar' });

// ---------- Params ----------

export const columnaParams = paramsDe('id', 'columna_id');
export const etiquetaParams = paramsDe('id', 'etiqueta_id');
export const miembroParams = paramsDe('id', 'usuario_id');
export const tareaParams = paramsDe('tarea_id');
export const tareaUsuarioParams = paramsDe('tarea_id', 'usuario_id');
export const tareaEtiquetaParams = paramsDe('tarea_id', 'etiqueta_id');
export const checklistParams = paramsDe('tarea_id', 'item_id');
export const comentarioParams = paramsDe('tarea_id', 'comentario_id');
export const sprintParams = paramsDe('sprint_id');

// ---------- Tableros ----------

export const crearTableroSchema = z
  .object({
    nombre: textoRequerido('El nombre', 100),
    descripcion: textoOpcional(2000),
    grupo_id: idNulo,
    color: colorTablero.optional(),
    plantilla: z.enum(PLANTILLAS_TABLERO, { errorMap: () => ({ message: `La plantilla debe ser ${PLANTILLAS_TABLERO.join(', ')}` }) }).default('kanban'),
  })
  .strip();

export const actualizarTableroSchema = conAlgunDato({
  nombre: z.string().trim().min(1, 'El nombre no puede quedar vacío').max(100, 'El nombre admite máximo 100 caracteres').optional(),
  descripcion: textoOpcional(2000),
  color: colorTablero.optional(),
});

export const listarTablerosQuery = z.object({
  grupo_id: idSchema.optional(),
  /** true: solo los archivados; por defecto solo los activos. */
  archivados: booleanoQuery.default(false),
});

// ---------- Miembros ----------

export const invitarMiembroSchema = z.object({ usuario_id: idSchema, rol: rolTablero.default('miembro') });
export const cambiarRolSchema = z.object({ rol: rolTablero });

// ---------- Columnas ----------

const limiteWip = z.number({ invalid_type_error: 'El límite debe ser un número' }).int().min(1, 'El límite debe ser al menos 1').max(999).nullable().optional();

export const crearColumnaSchema = z
  .object({ nombre: textoRequerido('El nombre', 60), limite_wip: limiteWip, es_final: z.boolean().optional() })
  .strip();

export const actualizarColumnaSchema = conAlgunDato({
  nombre: z.string().trim().min(1, 'El nombre no puede quedar vacío').max(60).optional(),
  limite_wip: limiteWip,
  es_final: z.boolean().optional(),
});

export const reordenarColumnasSchema = z.object({
  columnas: z.array(idSchema).min(1, 'Indica el nuevo orden de las columnas'),
});

export const eliminarColumnaQuery = z.object({ mover_a: idSchema.optional() });

// ---------- Etiquetas ----------

export const crearEtiquetaSchema = z.object({ nombre: textoRequerido('El nombre', 40), color: colorEtiqueta.default('bg-gray-500') }).strip();
export const actualizarEtiquetaSchema = conAlgunDato({
  nombre: z.string().trim().min(1, 'El nombre no puede quedar vacío').max(40).optional(),
  color: colorEtiqueta.optional(),
});

// ---------- Tareas ----------

export const filtroTareasQuery = z.object({
  /** Texto en título o descripción, o la clave ("TRI-12" / "12"). */
  q: z.string().trim().max(100).optional(),
  /** Id de usuario o "yo". */
  asignado: z.union([z.literal('yo'), idSchema]).optional(),
  etiqueta: idSchema.optional(),
  tipo: tipoTarea.optional(),
  prioridad: prioridad.optional(),
  /** "backlog" (sin sprint), "activo" (sprint activo) o el id de un sprint. */
  sprint: z.union([z.enum(['backlog', 'activo']), idSchema]).optional(),
  vencidas: booleanoQuery.optional(),
});

export const listarTareasQuery = paginacionQuery.merge(filtroTareasQuery);

export const crearTareaSchema = z
  .object({
    titulo: textoRequerido('El título', 200),
    descripcion: textoOpcional(10000),
    /** Sin columna: la primera del tablero. */
    columna_id: idSchema.optional(),
    tipo: tipoTarea.default('tarea'),
    prioridad: prioridad.default('media'),
    puntos,
    fecha_limite: fechaOpcional,
    epica_id: idNulo,
    sprint_id: idNulo,
    asignados: z.array(idSchema).max(20).optional(),
    etiquetas: z.array(idSchema).max(20).optional(),
  })
  .strip();

export const actualizarTareaSchema = conAlgunDato({
  titulo: z.string().trim().min(1, 'El título no puede quedar vacío').max(200).optional(),
  descripcion: textoOpcional(10000),
  tipo: tipoTarea.optional(),
  prioridad: prioridad.optional(),
  puntos,
  fecha_limite: fechaOpcional,
  epica_id: idNulo,
  sprint_id: idNulo,
});

export const moverTareaSchema = z.object({
  columna_id: idSchema,
  /** Tarea que queda justo arriba (null/ausente = va primero). */
  anterior_id: idNulo,
  /** Tarea que queda justo abajo (null/ausente = va al final). */
  siguiente_id: idNulo,
});

export const asignarSchema = z.object({ usuario_id: idSchema });
export const etiquetarSchema = z.object({ etiqueta_id: idSchema });

export const crearItemSchema = z.object({ texto: textoRequerido('El texto', 300) }).strip();
export const actualizarItemSchema = conAlgunDato({
  texto: z.string().trim().min(1, 'El texto no puede quedar vacío').max(300).optional(),
  hecho: z.boolean().optional(),
  posicion: z.number().int().min(0).optional(),
});

export const comentarioSchema = z.object({ texto: textoRequerido('El comentario', 5000) }).strip();

// ---------- Sprints ----------

export const crearSprintSchema = z
  .object({ nombre: textoRequerido('El nombre', 80), objetivo: textoOpcional(2000), inicio: fechaOpcional, fin: fechaOpcional })
  .strip();

export const actualizarSprintSchema = conAlgunDato({
  nombre: z.string().trim().min(1, 'El nombre no puede quedar vacío').max(80).optional(),
  objetivo: textoOpcional(2000),
  inicio: fechaOpcional,
  fin: fechaOpcional,
});

export const iniciarSprintSchema = z.object({ inicio: fechaOpcional, fin: fechaOpcional }).strip();

export const cerrarSprintSchema = z.object({
  /** Sprint planeado que recibe las tareas sin terminar; null/ausente = al backlog. */
  mover_a_sprint_id: idNulo,
});

// ---------- DTOs ----------

export type CrearTableroDto = z.infer<typeof crearTableroSchema>;
export type ActualizarTableroDto = z.infer<typeof actualizarTableroSchema>;
export type ListarTablerosQuery = z.infer<typeof listarTablerosQuery>;
export type InvitarMiembroDto = z.infer<typeof invitarMiembroSchema>;
export type CrearColumnaDto = z.infer<typeof crearColumnaSchema>;
export type ActualizarColumnaDto = z.infer<typeof actualizarColumnaSchema>;
export type CrearEtiquetaDto = z.infer<typeof crearEtiquetaSchema>;
export type ActualizarEtiquetaDto = z.infer<typeof actualizarEtiquetaSchema>;
export type FiltroTareas = z.infer<typeof filtroTareasQuery>;
export type ListarTareasQuery = z.infer<typeof listarTareasQuery>;
export type CrearTareaDto = z.infer<typeof crearTareaSchema>;
export type ActualizarTareaDto = z.infer<typeof actualizarTareaSchema>;
export type MoverTareaDto = z.infer<typeof moverTareaSchema>;
export type ActualizarItemDto = z.infer<typeof actualizarItemSchema>;
export type CrearSprintDto = z.infer<typeof crearSprintSchema>;
export type ActualizarSprintDto = z.infer<typeof actualizarSprintSchema>;
export type IniciarSprintDto = z.infer<typeof iniciarSprintSchema>;
export type CerrarSprintDto = z.infer<typeof cerrarSprintSchema>;
