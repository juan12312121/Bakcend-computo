import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../../config/env';
import { TooManyRequestsError } from '../../core/errors';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { authController as c } from './auth.controller';
import {
  cambiarContrasenaSchema,
  loginSchema,
  olvideContrasenaSchema,
  registroSchema,
  restablecerContrasenaSchema,
  validarTokenQuery,
  verificarCorreoQuery,
} from './auth.schemas';

/** Freno contra fuerza bruta en login, registro y recuperación de contraseña. */
const limitador = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX_REQUESTS,
  skip: () => env.NODE_ENV === 'test',
  handler: (_req, _res, next) => next(new TooManyRequestsError()),
});

export const authRoutes = Router();

authRoutes.post('/registro', limitador, validate({ body: registroSchema }), c.registro);
authRoutes.post('/login', limitador, validate({ body: loginSchema }), c.login);
authRoutes.post('/logout', auth.proteger, c.logout);
authRoutes.get('/verificar', auth.proteger, c.verificar);

// ---------- Contraseña ----------
authRoutes.post('/olvide-contrasena', limitador, validate({ body: olvideContrasenaSchema }), c.olvideContrasena);
authRoutes.get('/restablecer-contrasena/validar', limitador, validate({ query: validarTokenQuery }), c.validarRestablecimiento);
authRoutes.post('/restablecer-contrasena', limitador, validate({ body: restablecerContrasenaSchema }), c.restablecerContrasena);
authRoutes.put('/contrasena', auth.proteger, validate({ body: cambiarContrasenaSchema }), c.cambiarContrasena);

// ---------- Verificar correo ----------
authRoutes.get('/verificar-correo', limitador, validate({ query: verificarCorreoQuery }), c.verificarCorreo);
authRoutes.post('/reenviar-verificacion', auth.proteger, c.reenviarVerificacion);
