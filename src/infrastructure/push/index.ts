import fs from 'node:fs';
import path from 'node:path';
import type { ServiceAccount } from 'firebase-admin/app';
import { env } from '../../config/env';
import { ConsolaPushService } from './ConsolaPushService';
import type { PushService } from './PushService';

export type { AvisadorPush, MensajePush, PushService, ResultadoPush } from './PushService';
export { ConsolaPushService } from './ConsolaPushService';

type ConfigPush = Pick<typeof env, 'FIREBASE_SERVICE_ACCOUNT' | 'NODE_ENV'>;

/**
 * Firebase solo si `FIREBASE_SERVICE_ACCOUNT` apunta al JSON de la cuenta de servicio;
 * si no, las push se escriben en la consola (y en pruebas no hacen nada).
 */
export function crearPushService(config: ConfigPush = env): PushService {
  const silenciosa = new ConsolaPushService(config.NODE_ENV === 'test' ? null : console.info);
  if (!config.FIREBASE_SERVICE_ACCOUNT) return silenciosa;

  const ruta = path.resolve(__dirname, '../../..', config.FIREBASE_SERVICE_ACCOUNT);
  if (!fs.existsSync(ruta)) {
    console.warn(`[push] No existe ${ruta}; las notificaciones push quedan desactivadas.`);
    return silenciosa;
  }

  const cuenta = JSON.parse(fs.readFileSync(ruta, 'utf8')) as ServiceAccount;
  // Se carga aquí para no arrastrar firebase-admin cuando no se usa.
  const { FirebasePushService } = require('./FirebasePushService') as typeof import('./FirebasePushService');
  return new FirebasePushService(cuenta);
}

export const pushService: PushService = crearPushService();
