/** Plantillas de correo de TrinoFlow (HTML sencillo con estilos en línea, compatible con clientes de correo). */
import type { MensajeCorreo } from './MailService';

const MARCA = {
  nombre: 'TrinoFlow',
  naranja: '#f97316',
  turquesa: '#2dd4bf',
  texto: '#1f2937',
  suave: '#6b7280',
  fondo: '#f3f4f6',
} as const;

/** Evita que un nombre de usuario con < > & rompa (o inyecte) el HTML del correo. */
export function escaparHtml(texto: string): string {
  return texto
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface Boton {
  texto: string;
  url: string;
}

/** Marco común: franja con el degradado de la marca, tarjeta blanca y pie. */
function plantillaBase(titulo: string, parrafosHtml: string[], boton?: Boton, notaHtml?: string): string {
  const botonHtml = boton
    ? `<p style="text-align:center;margin:32px 0;">
         <a href="${escaparHtml(boton.url)}" style="background:${MARCA.naranja};color:#ffffff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:8px;display:inline-block;">${escaparHtml(boton.texto)}</a>
       </p>`
    : '';

  return `<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escaparHtml(titulo)}</title></head>
<body style="margin:0;padding:0;background:${MARCA.fondo};font-family:Arial,Helvetica,sans-serif;color:${MARCA.texto};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${MARCA.fondo};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;">
        <tr><td style="background:${MARCA.naranja};background-image:linear-gradient(90deg,${MARCA.naranja},${MARCA.turquesa});padding:20px 28px;">
          <span style="color:#ffffff;font-size:22px;font-weight:bold;">${MARCA.nombre}</span>
        </td></tr>
        <tr><td style="padding:28px;">
          <h1 style="font-size:20px;margin:0 0 16px;color:${MARCA.texto};">${escaparHtml(titulo)}</h1>
          ${parrafosHtml.map((p) => `<p style="font-size:15px;line-height:1.6;margin:0 0 12px;">${p}</p>`).join('\n          ')}
          ${botonHtml}
          ${notaHtml ? `<p style="font-size:13px;line-height:1.5;color:${MARCA.suave};margin:0;">${notaHtml}</p>` : ''}
        </td></tr>
        <tr><td style="border-top:3px solid ${MARCA.turquesa};padding:16px 28px;font-size:12px;color:${MARCA.suave};">
          Este correo se envió automáticamente desde ${MARCA.nombre}. No respondas a este mensaje.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export interface DatosRestablecer {
  para: string;
  nombre: string;
  enlace: string;
  minutosVigencia: number;
}

/** Correo con el enlace para elegir una contraseña nueva. */
export function correoRestablecerContrasena({ para, nombre, enlace, minutosVigencia }: DatosRestablecer): MensajeCorreo {
  const asunto = `Restablece tu contraseña de ${MARCA.nombre}`;
  const vigencia = minutosVigencia % 60 === 0 ? `${minutosVigencia / 60} hora(s)` : `${minutosVigencia} minutos`;

  const html = plantillaBase(
    'Restablece tu contraseña',
    [
      `Hola, <strong>${escaparHtml(nombre)}</strong>.`,
      'Recibimos una solicitud para restablecer la contraseña de tu cuenta. Da clic en el botón para elegir una nueva.',
      `El enlace vence en <strong>${vigencia}</strong> y solo se puede usar una vez.`,
    ],
    { texto: 'Elegir nueva contraseña', url: enlace },
    `Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${escaparHtml(enlace)}" style="color:${MARCA.turquesa};word-break:break-all;">${escaparHtml(enlace)}</a><br><br>Si tú no lo pediste, ignora este correo: tu contraseña no cambiará.`,
  );

  const texto = [
    `Hola, ${nombre}.`,
    '',
    'Recibimos una solicitud para restablecer la contraseña de tu cuenta de TrinoFlow.',
    'Abre este enlace para elegir una nueva:',
    enlace,
    '',
    `El enlace vence en ${vigencia} y solo se puede usar una vez.`,
    'Si tú no lo pediste, ignora este correo: tu contraseña no cambiará.',
  ].join('\n');

  return { para, asunto, html, texto };
}

export interface DatosVerificarEmail {
  para: string;
  nombre: string;
  enlace: string;
  horasVigencia: number;
}

/** Correo de bienvenida con el enlace para verificar el email de la cuenta. */
export function correoVerificarEmail({ para, nombre, enlace, horasVigencia }: DatosVerificarEmail): MensajeCorreo {
  const asunto = `Verifica tu correo de ${MARCA.nombre}`;
  const vigencia = `${horasVigencia} hora${horasVigencia === 1 ? '' : 's'}`;

  const html = plantillaBase(
    'Verifica tu correo',
    [
      `Hola, <strong>${escaparHtml(nombre)}</strong>. ¡Qué gusto tenerte en ${MARCA.nombre}!`,
      'Para confirmar que este correo es tuyo, da clic en el botón.',
      `El enlace vence en <strong>${vigencia}</strong> y solo se puede usar una vez.`,
    ],
    { texto: 'Verificar mi correo', url: enlace },
    `Si el botón no funciona, copia este enlace en tu navegador:<br><a href="${escaparHtml(enlace)}" style="color:${MARCA.turquesa};word-break:break-all;">${escaparHtml(enlace)}</a><br><br>Si tú no creaste esta cuenta, ignora este correo.`,
  );

  const texto = [
    `Hola, ${nombre}.`,
    '',
    `Gracias por unirte a ${MARCA.nombre}. Para confirmar que este correo es tuyo, abre este enlace:`,
    enlace,
    '',
    `El enlace vence en ${vigencia} y solo se puede usar una vez.`,
    'Si tú no creaste esta cuenta, ignora este correo.',
  ].join('\n');

  return { para, asunto, html, texto };
}
