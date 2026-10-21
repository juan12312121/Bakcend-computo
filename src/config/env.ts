import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_URL: z.string().url().default('http://localhost:3000'),
  FRONTEND_URL: z.string().url().default('http://localhost:4200'),
  /** Orígenes extra permitidos por CORS, separados por coma (p. ej. la web servida en la IP de la red). */
  CORS_ORIGINS: z
    .string()
    .default('')
    .transform((v) => v.split(',').map((o) => o.trim()).filter(Boolean)),

  DB_DIALECT: z.enum(['mysql', 'sqlite']).default('mysql'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('redstudent_db'),
  DB_STORAGE: z.string().default(':memory:'),
  DB_LOGGING: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET debe tener al menos 16 caracteres'),
  JWT_EXPIRE: z.string().default('7d'),

  CLOUDINARY_URL: z.string().optional(),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),

  /** Correo (recuperar contraseña). Sin EMAIL_HOST/EMAIL_USER, los correos se escriben en la consola. */
  EMAIL_HOST: z.string().optional(),
  EMAIL_PORT: z.coerce.number().int().positive().default(587),
  EMAIL_USER: z.string().optional(),
  EMAIL_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default('TrinoFlow <noreply@trinoflow.local>'),

  /**
   * Notificaciones push: ruta (relativa a backend/) del JSON de la cuenta de servicio de Firebase.
   * Sin ella, las push se escriben en la consola.
   */
  FIREBASE_SERVICE_ACCOUNT: z.string().optional(),

  MAX_FILE_SIZE: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  /** Videos de historias (más pesados que las imágenes). */
  MAX_VIDEO_SIZE: z.coerce.number().int().positive().default(50 * 1024 * 1024),
  MAX_FILES_PER_REQUEST: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(1000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const detalle = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  throw new Error(`Variables de entorno inválidas:\n${detalle}`);
}

export const env = Object.freeze(parsed.data);
export type Env = typeof env;
