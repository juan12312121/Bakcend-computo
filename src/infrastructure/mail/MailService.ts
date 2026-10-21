/** Correo listo para enviar: siempre con versión HTML y versión de texto plano. */
export interface MensajeCorreo {
  para: string;
  asunto: string;
  html: string;
  texto: string;
}

/**
 * Puerto de salida para mandar correos. Los servicios dependen de esta interfaz
 * (inyectada por constructor), así en pruebas se cambia por un falso sin tocar SMTP.
 */
export interface MailService {
  enviar(mensaje: MensajeCorreo): Promise<void>;
}
