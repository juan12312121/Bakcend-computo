import { z } from 'zod';
import { idSchema, paginacionQuery, textoOpcional, textoRequerido } from '../../core/validation/common.schemas';
import {
  ACCIONES_MODERACION,
  ACCIONES_PALABRA,
  COINCIDENCIAS_PALABRA,
  CONTEXTOS_TEXTO,
  ESTADOS_REPORTE,
  MOTIVOS_REPORTE,
  TIPOS_CONTENIDO_REPORTABLE,
} from '../../infrastructure/database/models';

/** Acciones que el admin puede pedir al resolver (levantar_suspension va por su propia ruta). */
export const ACCIONES_RESOLVER = ['descartar', 'ocultar', 'borrar', 'advertir', 'suspender'] as const;
export type AccionResolver = (typeof ACCIONES_RESOLVER)[number];

export const MAX_DIAS_SUSPENSION = 3650;

const tipoContenido = z.enum(TIPOS_CONTENIDO_REPORTABLE, {
  errorMap: () => ({ message: `El tipo debe ser uno de: ${TIPOS_CONTENIDO_REPORTABLE.join(', ')}` }),
});
const motivo = z.enum(MOTIVOS_REPORTE, {
  errorMap: () => ({ message: `El motivo es requerido y debe ser uno de: ${MOTIVOS_REPORTE.join(', ')}` }),
});
const contexto = z.enum(CONTEXTOS_TEXTO, { errorMap: () => ({ message: `El contexto debe ser uno de: ${CONTEXTOS_TEXTO.join(', ')}` }) });
const booleanoQuery = z.enum(['true', 'false']).transform((v) => v === 'true');
const dias = z.coerce.number().int().min(1, 'Mínimo 1 día').max(MAX_DIAS_SUSPENSION, `Máximo ${MAX_DIAS_SUSPENSION} días`);

// ---------- Reportes ----------

export const crearReporteSchema = z.object({
  tipo: tipoContenido,
  /** Id del contenido reportado (para 'usuario', el id del usuario). */
  id: idSchema,
  motivo,
  descripcion: textoOpcional(500),
});

// ---------- Bandeja ----------

export const contenidoParams = z.object({ tipo: tipoContenido, contenidoId: idSchema });

export const bandejaQuery = paginacionQuery.extend({
  tipo: tipoContenido.optional(),
  estado: z.enum(ESTADOS_REPORTE).default('pendiente'),
  motivo: motivo.optional(),
});

export const resolverSchema = z
  .object({
    acciones: z.array(z.enum(ACCIONES_RESOLVER)).min(1, 'Elige al menos una acción').max(ACCIONES_RESOLVER.length),
    /** Texto de la advertencia para el autor (requerido con 'advertir'). */
    mensaje: textoOpcional(1000),
    /** Días de suspensión; sin días = permanente. */
    dias: dias.optional().nullable(),
    /** Nota interna que queda junto al contenido. */
    nota: textoOpcional(2000),
    /** Avisar a quienes reportaron que se resolvió (por defecto sí). */
    avisar_reportantes: z.boolean().default(true),
  })
  .superRefine((datos, ctx) => {
    const acciones = new Set(datos.acciones);
    if (acciones.size !== datos.acciones.length) ctx.addIssue({ code: 'custom', path: ['acciones'], message: 'Hay acciones repetidas' });
    if (acciones.has('descartar') && acciones.size > 1) {
      ctx.addIssue({ code: 'custom', path: ['acciones'], message: 'Descartar no se combina con otras acciones' });
    }
    if (acciones.has('ocultar') && acciones.has('borrar')) {
      ctx.addIssue({ code: 'custom', path: ['acciones'], message: 'Elige ocultar o borrar, no las dos' });
    }
    if (acciones.has('advertir') && !datos.mensaje) {
      ctx.addIssue({ code: 'custom', path: ['mensaje'], message: 'Escribe el mensaje de la advertencia' });
    }
  });

export const notaSchema = z.object({ texto: textoRequerido('La nota', 2000) });

// ---------- Historial, estadísticas y suspensiones ----------

export const historialQuery = paginacionQuery.extend({
  accion: z.enum(ACCIONES_MODERACION).optional(),
  tipo: tipoContenido.optional(),
  contenido_id: idSchema.optional(),
  admin_id: idSchema.optional(),
  autor_id: idSchema.optional(),
});

export const estadisticasQuery = z.object({
  dias: z.coerce.number().int().min(1).max(90).default(14),
});

export const usuariosReportadosQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const suspenderSchema = z.object({
  dias: dias.optional().nullable(),
  motivo: textoOpcional(500),
});

export const suspensionesQuery = paginacionQuery.extend({
  activas: booleanoQuery.default('true'),
});

// ---------- Palabras prohibidas ----------

const aplicaA = z.array(contexto).min(1, 'Elige al menos dónde aplica').transform((lista) => [...new Set(lista)]);

export const crearPalabraSchema = z.object({
  palabra: textoRequerido('La palabra', 100),
  coincidencia: z.enum(COINCIDENCIAS_PALABRA).default('exacta'),
  accion: z.enum(ACCIONES_PALABRA).default('censurar'),
  aplica_a: aplicaA.optional(),
  activa: z.boolean().optional(),
});

export const actualizarPalabraSchema = z
  .object({
    palabra: textoRequerido('La palabra', 100).optional(),
    coincidencia: z.enum(COINCIDENCIAS_PALABRA).optional(),
    accion: z.enum(ACCIONES_PALABRA).optional(),
    aplica_a: aplicaA.optional(),
    activa: z.boolean().optional(),
  })
  .refine((d) => Object.values(d).some((v) => v !== undefined), { message: 'No hay cambios' });

export const palabrasQuery = paginacionQuery.extend({
  q: z.string().trim().min(1).max(100).optional(),
  accion: z.enum(ACCIONES_PALABRA).optional(),
  activa: booleanoQuery.optional(),
});

export const probarTextoSchema = z.object({
  texto: textoRequerido('El texto', 5000),
  contexto: contexto.default('publicacion'),
});

export type CrearReporteContenidoDto = z.infer<typeof crearReporteSchema>;
export type BandejaQuery = z.infer<typeof bandejaQuery>;
export type ResolverDto = z.infer<typeof resolverSchema>;
export type NotaDto = z.infer<typeof notaSchema>;
export type HistorialQuery = z.infer<typeof historialQuery>;
export type EstadisticasQuery = z.infer<typeof estadisticasQuery>;
export type UsuariosReportadosQuery = z.infer<typeof usuariosReportadosQuery>;
export type SuspenderDto = z.infer<typeof suspenderSchema>;
export type SuspensionesQuery = z.infer<typeof suspensionesQuery>;
export type CrearPalabraDto = z.infer<typeof crearPalabraSchema>;
export type ActualizarPalabraDto = z.infer<typeof actualizarPalabraSchema>;
export type PalabrasQuery = z.infer<typeof palabrasQuery>;
export type ProbarTextoDto = z.infer<typeof probarTextoSchema>;
