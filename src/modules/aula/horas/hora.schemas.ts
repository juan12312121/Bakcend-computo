import { z } from 'zod';
import { idSchema, paramsDe } from '../../../core/validation/common.schemas';

export const LIMITES_HORAS = {
  nota: 500,
  /** Un registro no puede pasar de 24 h. */
  minutosPorRegistro: 24 * 60,
  /** Rango máximo de los resúmenes y del CSV. */
  diasResumen: 366,
  /** Tarifa máxima por hora (en la moneda del tablero). */
  tarifa: 1_000_000,
} as const;

/** Margen para registros "hasta ahora" con relojes desfasados. */
export const TOLERANCIA_FUTURO_MS = 5 * 60_000;
const MS_DIA = 24 * 60 * 60 * 1000;

const fecha = (campo: string) =>
  z.coerce.date({ errorMap: () => ({ message: `${campo} no es una fecha válida (usa ISO 8601, p. ej. 2026-10-18T19:00:00Z)` }) });

const nota = z.string({ invalid_type_error: 'La nota debe ser texto' }).trim().max(LIMITES_HORAS.nota, `La nota admite máximo ${LIMITES_HORAS.nota} caracteres`);
const minutos = z
  .number({ invalid_type_error: 'Los minutos deben ser un número' })
  .int('Los minutos deben ser un número entero')
  .min(1, 'Registra al menos 1 minuto')
  .max(LIMITES_HORAS.minutosPorRegistro, 'Un registro no puede pasar de 24 horas');
const facturable = z.boolean({ invalid_type_error: 'facturable debe ser verdadero o falso' });

const booleanoQuery = z.preprocess(
  (v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v),
  z.boolean({ invalid_type_error: 'Debe ser true o false' }),
);

/** Zona horaria IANA válida (para las fechas del CSV). */
const zona = z
  .string()
  .trim()
  .max(64)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('es-MX', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'La zona horaria no es válida (p. ej. America/Mexico_City)');

// ---------- Params ----------

export const tareaParams = paramsDe('tarea_id');

// ---------- Cronómetro y registros ----------

export const iniciarSchema = z
  .object({
    nota: nota.optional(),
    facturable: facturable.optional(),
  })
  .strip();

/**
 * Registro a mano: { inicio, fin } o { minutos, inicio? } (sin inicio = terminó ahora).
 * Siempre termina a más tardar "ahora" y dura de 1 minuto a 24 horas.
 */
export const registrarSchema = z
  .object({
    inicio: fecha('El inicio').optional(),
    fin: fecha('El fin').optional(),
    minutos: minutos.optional(),
    nota: nota.optional(),
    facturable: facturable.optional(),
  })
  .strip()
  .superRefine((datos, ctx) => {
    if (datos.minutos === undefined && (!datos.inicio || !datos.fin)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['minutos'], message: 'Indica los minutos o el inicio y el fin' });
    }
    if (datos.minutos !== undefined && datos.fin) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fin'], message: 'Usa minutos o inicio y fin, no los dos' });
    }
  });

export const editarRegistroSchema = z
  .object({
    inicio: fecha('El inicio').optional(),
    fin: fecha('El fin').optional(),
    minutos: minutos.optional(),
    nota: nota.nullable().optional(),
    facturable: facturable.optional(),
  })
  .strip()
  .refine((datos) => Object.values(datos).some((v) => v !== undefined), { message: 'No hay datos para actualizar' })
  .refine((datos) => !(datos.minutos !== undefined && datos.fin), { message: 'Usa minutos o inicio y fin, no los dos', path: ['fin'] });

// ---------- Resúmenes ----------

export const resumenQuery = z
  .object({
    desde: fecha('desde'),
    hasta: fecha('hasta'),
    usuario_id: idSchema.optional(),
    facturable: booleanoQuery.optional(),
    zona: zona.optional(),
  })
  .superRefine(({ desde, hasta }, ctx) => {
    if (hasta.getTime() <= desde.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hasta'], message: '"hasta" debe ser posterior a "desde"' });
    } else if (hasta.getTime() - desde.getTime() > LIMITES_HORAS.diasResumen * MS_DIA) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hasta'], message: `El rango máximo es de ${LIMITES_HORAS.diasResumen} días` });
    }
  });

/** Tarifa por hora del tablero (usuario_id null/omitido) o de un miembro. tarifa null = quitarla. */
export const tarifaSchema = z.object({
  usuario_id: idSchema.nullable().optional(),
  tarifa: z
    .number({ invalid_type_error: 'La tarifa debe ser un número', required_error: 'La tarifa es requerida (null para quitarla)' })
    .min(0, 'La tarifa no puede ser negativa')
    .max(LIMITES_HORAS.tarifa)
    .nullable(),
  moneda: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/, 'La moneda debe ser un código de 3 letras (MXN, USD...)')
    .optional(),
});

export type IniciarDto = z.infer<typeof iniciarSchema>;
export type RegistrarDto = z.infer<typeof registrarSchema>;
export type EditarRegistroDto = z.infer<typeof editarRegistroSchema>;
export type ResumenQuery = z.infer<typeof resumenQuery>;
export type TarifaDto = z.infer<typeof tarifaSchema>;
