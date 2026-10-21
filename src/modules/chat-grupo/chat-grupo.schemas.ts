import { z } from 'zod';
import { idSchema, paramsDe } from '../../core/validation/common.schemas';
import { duracionAudioSchema, textoMensajeSchema } from '../chat/chat.schemas';

export const grupoIdParams = paramsDe('grupoId');
export const mensajeGrupoParams = paramsDe('grupoId', 'mensajeId');

/** Página de mensajes con cursor: los más nuevos primero; `antes_de` = id del más viejo que ya tengo. */
export const mensajesGrupoQuery = z.object({
  antes_de: idSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

/** Multipart o JSON: texto (≤5000) y/o `archivo` (imagen, documento o audio con `duracion_seg`). */
export const enviarMensajeGrupoSchema = z
  .object({
    texto: textoMensajeSchema,
    duracion_seg: duracionAudioSchema,
  })
  .strip();

export type MensajesGrupoQuery = z.infer<typeof mensajesGrupoQuery>;
export type EnviarMensajeGrupoDto = z.infer<typeof enviarMensajeGrupoSchema>;
