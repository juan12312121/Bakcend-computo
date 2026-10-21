import nodemailer, { type Transporter } from 'nodemailer';
import type { MailService, MensajeCorreo } from './MailService';

export interface ConfiguracionSmtp {
  host: string;
  port: number;
  user: string;
  password?: string;
  /** Remitente, p. ej. "TrinoFlow <noreply@trinoflow.com>". */
  from: string;
}

/** Envío real por SMTP con nodemailer (el transporte se crea una vez y se reutiliza). */
export class SmtpMailService implements MailService {
  private readonly transporte: Transporter;

  constructor(private readonly config: ConfiguracionSmtp) {
    this.transporte = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      // 465 usa TLS directo; 587/25 negocian STARTTLS.
      secure: config.port === 465,
      auth: { user: config.user, pass: config.password },
    });
  }

  async enviar({ para, asunto, html, texto }: MensajeCorreo): Promise<void> {
    await this.transporte.sendMail({ from: this.config.from, to: para, subject: asunto, html, text: texto });
  }
}
