import type { MailService, MensajeCorreo } from './MailService';

/**
 * Para desarrollo sin SMTP: en lugar de enviar, escribe el correo (versión texto) en la consola,
 * así se puede copiar el enlace de restablecimiento a mano.
 */
export class ConsolaMailService implements MailService {
  constructor(private readonly escribir: (linea: string) => void = console.info) {}

  async enviar({ para, asunto, texto }: MensajeCorreo): Promise<void> {
    this.escribir(['', '──────── Correo (sin SMTP configurado) ────────', `Para:   ${para}`, `Asunto: ${asunto}`, '', texto, '─'.repeat(47)].join('\n'));
  }
}
