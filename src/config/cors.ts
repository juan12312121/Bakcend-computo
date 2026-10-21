import { env } from './env';

/** Orígenes de la app nativa (Capacitor): el WebView sirve la app como localhost. */
const APP_NATIVA = ['http://localhost', 'https://localhost', 'capacitor://localhost'];

/**
 * Orígenes que pueden llamar a la API y conectarse por Socket.IO:
 * la web (FRONTEND_URL), la app nativa y los extra de CORS_ORIGINS (separados por coma).
 */
export const origenesPermitidos: readonly string[] = [
  ...new Set([env.FRONTEND_URL, 'http://127.0.0.1:4200', ...APP_NATIVA, ...env.CORS_ORIGINS]),
];
