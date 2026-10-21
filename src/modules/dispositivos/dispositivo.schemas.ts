import { z } from 'zod';
import { PLATAFORMAS_DISPOSITIVO } from '../../infrastructure/database/models';

const tokenSchema = z
  .string({ required_error: 'El token es requerido' })
  .trim()
  .min(20, 'El token no es válido')
  .max(400, 'El token no es válido');

export const registrarDispositivoSchema = z.object({
  token: tokenSchema,
  plataforma: z.enum(PLATAFORMAS_DISPOSITIVO, { errorMap: () => ({ message: 'Plataforma no válida' }) }).default('android'),
});

export const tokenParams = z.object({ token: tokenSchema });

export type RegistrarDispositivoDto = z.infer<typeof registrarDispositivoSchema>;
