import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe } from '../../core/validation/common.schemas';

export const iniciarChatSchema = z.object({
  receptorId: idSchema,
});

/** Notas de voz: de 1 segundo a 5 minutos. */
export const DURACION_AUDIO_MAX_SEG = 300;

/** Duración de una nota de voz (en multipart llega como texto). */
export const duracionAudioSchema = z.coerce
  .number({ invalid_type_error: 'La duración debe ser un número' })
  .int('La duración debe ser un número entero de segundos')
  .min(1, 'La nota de voz debe durar al menos 1 segundo')
  .max(DURACION_AUDIO_MAX_SEG, `La nota de voz admite máximo ${DURACION_AUDIO_MAX_SEG} segundos`)
  .optional();

/** Texto de un mensaje: puede ir vacío si viene archivo (lo revisa el servicio). */
export const textoMensajeSchema = z
  .string({ invalid_type_error: 'El texto debe ser texto' })
  .trim()
  .max(5000, 'El mensaje admite máximo 5000 caracteres')
  .default('');

/** En multipart todo llega como texto. `duracion_seg` solo aplica cuando `archivo` es un audio. */
export const enviarMensajeSchema = z
  .object({
    chatId: idSchema,
    texto: textoMensajeSchema,
    duracion_seg: duracionAudioSchema,
  })
  .strip();

export const chatIdParams = paramsDe('chatId');
export const mensajeIdParams = paramsDe('mensajeId');

/** Los chats se leen por páginas desde el mensaje más reciente (50 por defecto, como el legacy). */
export const mensajesQuery = paginacionQuery.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export type IniciarChatDto = z.infer<typeof iniciarChatSchema>;
export type EnviarMensajeDto = z.infer<typeof enviarMensajeSchema>;
