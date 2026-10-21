import { z } from 'zod';

/** `/usuario/:nombre`: acepta "@ana" o "ana". */
export const nombreUsuarioParams = z.object({
  nombre: z
    .string()
    .transform((v) => v.trim().replace(/^@/, ''))
    .refine((v) => /^[A-Za-z0-9_]{3,50}$/.test(v), 'Nombre de usuario inválido'),
});

/** Autocompletado de @: `q` puede venir vacío (sugiere primero a quienes sigo). */
export const sugerenciasQuery = z.object({
  q: z
    .string()
    .max(51, 'Máximo 50 caracteres')
    .optional()
    .transform((v) => (v ?? '').trim().replace(/^@/, '').replace(/[^A-Za-z0-9_ ]/g, '')),
});

export type SugerenciasQuery = z.infer<typeof sugerenciasQuery>;
