import { env } from '../../config/env';
import { ConsolaMailService } from './ConsolaMailService';
import type { MailService } from './MailService';
import { SmtpMailService } from './SmtpMailService';

export type { MailService, MensajeCorreo } from './MailService';
export { SmtpMailService, type ConfiguracionSmtp } from './SmtpMailService';
export { ConsolaMailService } from './ConsolaMailService';
export * from './plantillas';

type ConfigCorreo = Pick<typeof env, 'EMAIL_HOST' | 'EMAIL_PORT' | 'EMAIL_USER' | 'EMAIL_PASSWORD' | 'EMAIL_FROM'>;

/** SMTP solo si hay servidor y usuario configurados; si no, los correos salen en la consola. */
export function crearMailService(config: ConfigCorreo = env): MailService {
  if (config.EMAIL_HOST && config.EMAIL_USER) {
    return new SmtpMailService({
      host: config.EMAIL_HOST,
      port: config.EMAIL_PORT,
      user: config.EMAIL_USER,
      password: config.EMAIL_PASSWORD,
      from: config.EMAIL_FROM,
    });
  }
  return new ConsolaMailService();
}

export const mailService: MailService = crearMailService();
