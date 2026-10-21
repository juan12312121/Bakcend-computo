import { z } from 'zod';

/** Regla única de contraseña: la usan el registro, el restablecimiento y el cambio con sesión. */
export const contrasenaSchema = (requerida = 'La contraseña es requerida') =>
  z.string({ required_error: requerida, invalid_type_error: 'La contraseña debe ser texto' }).min(6, 'La contraseña debe tener al menos 6 caracteres');

const emailSchema = z.string({ required_error: 'El email es requerido' }).trim().toLowerCase().email('Email inválido');

/** Token del enlace de restablecimiento (base64url); el servicio decide si es válido. */
const tokenSchema = z
  .string({ required_error: 'El token es requerido', invalid_type_error: 'El token debe ser texto' })
  .trim()
  .min(1, 'El token es requerido')
  .max(200, 'El token no es válido');

export const registroSchema = z.object({
  nombre_usuario: z
    .string({ required_error: 'El nombre de usuario es requerido' })
    .trim()
    .min(3, 'El nombre de usuario debe tener entre 3 y 50 caracteres')
    .max(50, 'El nombre de usuario debe tener entre 3 y 50 caracteres')
    .regex(/^[a-zA-Z0-9_]+$/, 'Solo letras, números y guion bajo'),
  email: emailSchema,
  nombre_completo: z
    .string({ required_error: 'El nombre completo es requerido' })
    .trim()
    .min(3, 'El nombre completo debe tener entre 3 y 150 caracteres')
    .max(150),
  contrasena: contrasenaSchema(),
});

export const loginSchema = z.object({
  /** Acepta email o nombre de usuario. */
  email: z.string({ required_error: 'El email o usuario es requerido' }).trim().min(1, 'El email o usuario es requerido'),
  contrasena: z.string({ required_error: 'La contraseña es requerida' }).min(1, 'La contraseña es requerida'),
});

// ---------- Recuperar / cambiar contraseña ----------

export const olvideContrasenaSchema = z.object({ email: emailSchema });

export const validarTokenQuery = z.object({ token: tokenSchema });

export const restablecerContrasenaSchema = z.object({
  token: tokenSchema,
  contrasena: contrasenaSchema('La nueva contraseña es requerida'),
});

export const cambiarContrasenaSchema = z.object({
  actual: z.string({ required_error: 'La contraseña actual es requerida' }).min(1, 'La contraseña actual es requerida'),
  nueva: contrasenaSchema('La nueva contraseña es requerida'),
});

// ---------- Verificar correo ----------

export const verificarCorreoQuery = z.object({ token: tokenSchema });

export type RegistroDto = z.infer<typeof registroSchema>;
export type LoginDto = z.infer<typeof loginSchema>;
export type OlvideContrasenaDto = z.infer<typeof olvideContrasenaSchema>;
export type ValidarTokenQuery = z.infer<typeof validarTokenQuery>;
export type RestablecerContrasenaDto = z.infer<typeof restablecerContrasenaSchema>;
export type CambiarContrasenaDto = z.infer<typeof cambiarContrasenaSchema>;
export type VerificarCorreoQuery = z.infer<typeof verificarCorreoQuery>;
