import { z } from 'zod';
import type { CampoError } from '../../core/errors';
import { idSchema, paginacionQuery, textoRequerido } from '../../core/validation/common.schemas';
import {
  CATEGORIAS_EVENTO,
  ESTADOS_ASISTENCIA,
  MODALIDADES_EVENTO,
  VISIBILIDADES_EVENTO,
  type ModalidadEvento,
  type VisibilidadEvento,
} from '../../infrastructure/database/models';

export const LIMITES_EVENTO = {
  titulo: 150,
  descripcion: 5000,
  lugar: 200,
  enlace: 500,
  cupo: 100_000,
  invitadosPorPeticion: 50,
} as const;

/** Rango máximo que acepta GET /calendario. */
export const DIAS_MAXIMOS_CALENDARIO = 62;
/** Margen para no rechazar un evento "ahora mismo" por diferencias de reloj. */
export const TOLERANCIA_PASADO_MS = 60_000;

const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Respuestas que el usuario puede dar (la de "invitado" la pone el sistema al invitar). */
export const RESPUESTAS_ASISTENCIA = ['voy', 'interesado', 'no_voy'] as const;
export type RespuestaAsistencia = (typeof RESPUESTAS_ASISTENCIA)[number];

export const FILTROS_MIOS = ['creados', 'voy', 'interesado', 'invitado'] as const;
export type FiltroMios = (typeof FILTROS_MIOS)[number];

export const CUANDO_EVENTOS = ['proximos', 'pasados', 'todos'] as const;

// ---------- Piezas ----------

/** En multipart todo llega como texto y "" significa "no lo mandé". */
const vacioAIndefinido = (v: unknown) => (v === '' || v === null ? undefined : v);
/** Al editar, "" (multipart) o null (JSON) borra el valor. */
const vacioANulo = (v: unknown) => (v === '' ? null : v);

/** "true" / "1" / "false" / "0" de multipart. */
const booleanoFlexible = z.preprocess(
  (v) => (v === 'true' || v === '1' || v === 1 ? true : v === 'false' || v === '0' || v === 0 ? false : v),
  z.boolean({ invalid_type_error: 'Debe ser verdadero o falso' }),
);

const enumCon = <T extends readonly [string, ...string[]]>(valores: T, campo: string) =>
  z.enum(valores, { errorMap: () => ({ message: `${campo} debe ser uno de: ${valores.join(', ')}` }) });

const fecha = (campo: string) =>
  z.coerce.date({ errorMap: () => ({ message: `${campo} no es una fecha válida (usa ISO 8601, p. ej. 2026-10-18T19:00:00Z)` }) });

const texto = (campo: string, max: number) =>
  z.string({ invalid_type_error: `${campo} debe ser texto` }).trim().max(max, `${campo} admite máximo ${max} caracteres`);

const enlace = z
  .string({ invalid_type_error: 'El enlace debe ser texto' })
  .trim()
  .max(LIMITES_EVENTO.enlace, `El enlace admite máximo ${LIMITES_EVENTO.enlace} caracteres`)
  .url('El enlace debe ser una URL válida (https://...)')
  .refine((v) => /^https?:\/\//i.test(v), 'El enlace debe empezar con http:// o https://');

const cupo = z.coerce
  .number({ invalid_type_error: 'El cupo debe ser un número' })
  .int('El cupo debe ser un número entero')
  .min(1, 'El cupo mínimo es 1')
  .max(LIMITES_EVENTO.cupo, `El cupo máximo es ${LIMITES_EVENTO.cupo}`);

// ---------- Reglas entre campos (las usan crear y editar) ----------

export interface DatosCoherencia {
  modalidad: ModalidadEvento;
  lugar?: string | null;
  enlace?: string | null;
  inicio: Date;
  fin?: Date | null;
  visibilidad?: VisibilidadEvento;
  grupo_id?: number | null;
}

/** fin > inicio, presencial/híbrido con lugar, en línea/híbrido con enlace, visibilidad "grupo" solo con grupo. */
export function erroresDeCoherencia(datos: DatosCoherencia): CampoError[] {
  const errores: CampoError[] = [];
  if (datos.fin && datos.fin.getTime() <= datos.inicio.getTime()) {
    errores.push({ campo: 'fin', mensaje: 'La fecha de fin debe ser posterior al inicio' });
  }
  if (datos.modalidad !== 'en_linea' && !datos.lugar) {
    errores.push({
      campo: 'lugar',
      mensaje: datos.modalidad === 'presencial' ? 'Un evento presencial necesita el lugar' : 'Un evento híbrido necesita el lugar',
    });
  }
  if (datos.modalidad !== 'presencial' && !datos.enlace) {
    errores.push({
      campo: 'enlace',
      mensaje: datos.modalidad === 'en_linea' ? 'Un evento en línea necesita el enlace de la reunión' : 'Un evento híbrido necesita el enlace de la reunión',
    });
  }
  if (datos.visibilidad === 'grupo' && !datos.grupo_id) {
    errores.push({ campo: 'visibilidad', mensaje: 'Solo los eventos de un grupo pueden ser visibles para "grupo"' });
  }
  return errores;
}

export const enElPasado = (inicio: Date, ahora = Date.now()) => inicio.getTime() < ahora - TOLERANCIA_PASADO_MS;

// ---------- Body ----------

/** POST / (JSON o multipart con la imagen en `portada`). */
export const crearEventoSchema = z
  .object({
    titulo: textoRequerido('El título', LIMITES_EVENTO.titulo),
    descripcion: z.preprocess(vacioAIndefinido, texto('La descripción', LIMITES_EVENTO.descripcion).optional()),
    modalidad: z.preprocess(vacioAIndefinido, enumCon(MODALIDADES_EVENTO, 'La modalidad').default('presencial')),
    categoria: z.preprocess(vacioAIndefinido, enumCon(CATEGORIAS_EVENTO, 'La categoría').default('social')),
    /** Si no viene: "grupo" cuando hay grupo_id, si no "publico". */
    visibilidad: z.preprocess(vacioAIndefinido, enumCon(VISIBILIDADES_EVENTO, 'La visibilidad').optional()),
    lugar: z.preprocess(vacioAIndefinido, texto('El lugar', LIMITES_EVENTO.lugar).optional()),
    enlace: z.preprocess(vacioAIndefinido, enlace.optional()),
    inicio: fecha('La fecha de inicio'),
    fin: z.preprocess(vacioAIndefinido, fecha('La fecha de fin').optional()),
    cupo: z.preprocess(vacioAIndefinido, cupo.optional()),
    grupo_id: z.preprocess(vacioAIndefinido, idSchema.optional()),
  })
  .strip()
  .superRefine((datos, ctx) => {
    if (enElPasado(datos.inicio)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['inicio'], message: 'La fecha de inicio no puede estar en el pasado' });
    }
    for (const { campo, mensaje } of erroresDeCoherencia(datos)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [campo], message: mensaje });
    }
  });

/**
 * PUT /:id: todo opcional. descripcion / lugar / enlace / fin / cupo aceptan null (o "" en multipart) para borrarlos.
 * La coherencia se revisa en el servicio contra el evento ya guardado.
 */
export const actualizarEventoSchema = z
  .object({
    titulo: z.preprocess(
      vacioAIndefinido,
      z.string().trim().min(1, 'El título no puede quedar vacío').max(LIMITES_EVENTO.titulo, `El título admite máximo ${LIMITES_EVENTO.titulo} caracteres`).optional(),
    ),
    descripcion: z.preprocess(vacioANulo, texto('La descripción', LIMITES_EVENTO.descripcion).nullable().optional()),
    modalidad: z.preprocess(vacioAIndefinido, enumCon(MODALIDADES_EVENTO, 'La modalidad').optional()),
    categoria: z.preprocess(vacioAIndefinido, enumCon(CATEGORIAS_EVENTO, 'La categoría').optional()),
    visibilidad: z.preprocess(vacioAIndefinido, enumCon(VISIBILIDADES_EVENTO, 'La visibilidad').optional()),
    lugar: z.preprocess(vacioANulo, texto('El lugar', LIMITES_EVENTO.lugar).nullable().optional()),
    enlace: z.preprocess(vacioANulo, enlace.nullable().optional()),
    inicio: z.preprocess(vacioAIndefinido, fecha('La fecha de inicio').optional()),
    fin: z.preprocess(vacioANulo, fecha('La fecha de fin').nullable().optional()),
    cupo: z.preprocess(vacioANulo, cupo.nullable().optional()),
    /** true: quita la portada actual (si no se manda una nueva). */
    quitar_portada: z.preprocess(vacioAIndefinido, booleanoFlexible.optional()),
  })
  .strip();

export const asistenciaSchema = z.object({
  estado: enumCon(RESPUESTAS_ASISTENCIA, 'El estado'),
});

export const invitarSchema = z.object({
  usuario_ids: z
    .array(idSchema, { required_error: 'Indica a quién invitar', invalid_type_error: 'usuario_ids debe ser una lista de ids' })
    .min(1, 'Indica al menos un usuario')
    .max(LIMITES_EVENTO.invitadosPorPeticion, `Máximo ${LIMITES_EVENTO.invitadosPorPeticion} invitados por vez`),
});

// ---------- Query ----------

export const listarEventosQuery = paginacionQuery.extend({
  categoria: enumCon(CATEGORIAS_EVENTO, 'La categoría').optional(),
  /** Filtran por la fecha de inicio. */
  desde: fecha('desde').optional(),
  hasta: fecha('hasta').optional(),
  grupo_id: idSchema.optional(),
  texto: z.string().trim().min(1, 'Escribe algo para buscar').max(100).optional(),
  /** Requiere sesión. */
  mios: enumCon(FILTROS_MIOS, 'mios').optional(),
  /** proximos (por defecto): los que no han terminado, del más cercano al más lejano · pasados: los terminados, del más reciente. */
  cuando: enumCon(CUANDO_EVENTOS, 'cuando').default('proximos'),
});

export const calendarioQuery = z
  .object({
    desde: fecha('desde'),
    hasta: fecha('hasta'),
  })
  .superRefine(({ desde, hasta }, ctx) => {
    if (hasta.getTime() <= desde.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hasta'], message: '"hasta" debe ser posterior a "desde"' });
    } else if (hasta.getTime() - desde.getTime() > DIAS_MAXIMOS_CALENDARIO * MS_POR_DIA) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hasta'], message: `El rango máximo es de ${DIAS_MAXIMOS_CALENDARIO} días` });
    }
  });

export const asistentesQuery = paginacionQuery.extend({
  estado: enumCon(ESTADOS_ASISTENCIA, 'El estado').default('voy'),
});

export type CrearEventoDto = z.infer<typeof crearEventoSchema>;
export type ActualizarEventoDto = z.infer<typeof actualizarEventoSchema>;
export type AsistenciaDto = z.infer<typeof asistenciaSchema>;
export type InvitarEventoDto = z.infer<typeof invitarSchema>;
export type ListarEventosQuery = z.infer<typeof listarEventosQuery>;
export type CalendarioQuery = z.infer<typeof calendarioQuery>;
export type AsistentesQuery = z.infer<typeof asistentesQuery>;
