import { z } from 'zod';
import { paginacionQuery, paramsDe } from '../../../core/validation/common.schemas';

export const LIMITES_ASIGNACION = {
  titulo: 200,
  instrucciones: 10_000,
  comentario: 5_000,
  retroalimentacion: 5_000,
  puntosMaximos: 10_000,
} as const;

// ---------- Piezas ----------

/** En multipart todo llega como texto y "" significa "no lo mandé". */
const vacioAIndefinido = (v: unknown) => (v === '' || v === null ? undefined : v);
/** Al editar, "" (multipart) o null (JSON) borra el valor. */
const vacioANulo = (v: unknown) => (v === '' ? null : v);

/** "true" / "1" / "false" / "0" de multipart o de la query. */
export const booleanoFlexible = z.preprocess(
  (v) => (v === 'true' || v === '1' || v === 1 ? true : v === 'false' || v === '0' || v === 0 ? false : v),
  z.boolean({ invalid_type_error: 'Debe ser verdadero o falso' }),
);

const titulo = z
  .string({ required_error: 'El título es requerido', invalid_type_error: 'El título debe ser texto' })
  .trim()
  .min(1, 'El título es requerido')
  .max(LIMITES_ASIGNACION.titulo, `El título admite máximo ${LIMITES_ASIGNACION.titulo} caracteres`);

const textoLibre = (campo: string, max: number) =>
  z.string({ invalid_type_error: `${campo} debe ser texto` }).trim().max(max, `${campo} admite máximo ${max} caracteres`);

const fechaEntrega = z.coerce.date({
  errorMap: () => ({ message: 'La fecha de entrega no es válida (usa ISO 8601, p. ej. 2026-10-18T23:59:00Z)' }),
});

const puntosMaximos = z.coerce
  .number({ invalid_type_error: 'Los puntos deben ser un número' })
  .int('Los puntos deben ser un número entero')
  .min(1, 'Los puntos mínimos son 1')
  .max(LIMITES_ASIGNACION.puntosMaximos, `Los puntos máximos son ${LIMITES_ASIGNACION.puntosMaximos}`);

// ---------- Params ----------

export const grupoParams = paramsDe('grupo_id');
export const alumnoParams = paramsDe('id', 'alumno_id');

// ---------- Asignaciones ----------

/** JSON o multipart (archivo de apoyo opcional en `archivo`). */
export const crearAsignacionSchema = z.object({
  titulo,
  instrucciones: z.preprocess(vacioAIndefinido, textoLibre('Las instrucciones', LIMITES_ASIGNACION.instrucciones).optional()),
  fecha_entrega: fechaEntrega,
  puntos_maximos: z.preprocess(vacioAIndefinido, puntosMaximos.default(100)),
  acepta_tardias: z.preprocess(vacioAIndefinido, booleanoFlexible.default(true)),
});

export const actualizarAsignacionSchema = z
  .object({
    titulo: z.preprocess(vacioAIndefinido, titulo.optional()),
    instrucciones: z.preprocess(vacioANulo, textoLibre('Las instrucciones', LIMITES_ASIGNACION.instrucciones).nullable().optional()),
    fecha_entrega: z.preprocess(vacioAIndefinido, fechaEntrega.optional()),
    puntos_maximos: z.preprocess(vacioAIndefinido, puntosMaximos.optional()),
    acepta_tardias: z.preprocess(vacioAIndefinido, booleanoFlexible.optional()),
    /** true borra el archivo de apoyo (si no se manda uno nuevo). */
    quitar_archivo: z.preprocess(vacioAIndefinido, booleanoFlexible.optional()),
  })
  .strip();

export const CUANDO_ASIGNACIONES = ['todas', 'proximas', 'pasadas'] as const;

export const listarAsignacionesQuery = paginacionQuery.extend({
  cuando: z.enum(CUANDO_ASIGNACIONES, { errorMap: () => ({ message: `cuando debe ser ${CUANDO_ASIGNACIONES.join(', ')}` }) }).default('todas'),
});

// ---------- Entregas ----------

/** Multipart con `archivo` y/o `comentario` (al menos uno, contando el archivo que ya estaba). */
export const entregarSchema = z.object({
  comentario: z.preprocess(vacioAIndefinido, textoLibre('El comentario', LIMITES_ASIGNACION.comentario).optional()),
});

export const calificarSchema = z.object({
  puntos: z.coerce
    .number({ invalid_type_error: 'Los puntos deben ser un número', required_error: 'Los puntos son requeridos' })
    .min(0, 'Los puntos no pueden ser negativos')
    .max(LIMITES_ASIGNACION.puntosMaximos)
    .transform((v) => Math.round(v * 100) / 100),
  retroalimentacion: z.preprocess(vacioANulo, textoLibre('La retroalimentación', LIMITES_ASIGNACION.retroalimentacion).nullable().optional()),
});

export const devolverSchema = z.object({
  retroalimentacion: z.preprocess(
    vacioAIndefinido,
    textoLibre('La retroalimentación', LIMITES_ASIGNACION.retroalimentacion).min(1, 'Explica qué hay que corregir'),
  ),
});

export type CrearAsignacionDto = z.infer<typeof crearAsignacionSchema>;
export type ActualizarAsignacionDto = z.infer<typeof actualizarAsignacionSchema>;
export type ListarAsignacionesQuery = z.infer<typeof listarAsignacionesQuery>;
export type EntregarDto = z.infer<typeof entregarSchema>;
export type CalificarDto = z.infer<typeof calificarSchema>;
export type DevolverDto = z.infer<typeof devolverSchema>;
