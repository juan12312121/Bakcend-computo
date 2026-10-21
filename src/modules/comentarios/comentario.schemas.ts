import { z } from 'zod';
import { idSchema, textoRequerido } from '../../core/validation/common.schemas';

const texto = textoRequerido('El comentario', 1000);

/** `padre_id` opcional: si se responde a una respuesta, se cuelga del comentario de primer nivel. */
export const crearComentarioSchema = z
  .object({ publicacion_id: idSchema, texto, padre_id: idSchema.nullable().optional() })
  .strip();

export const actualizarComentarioSchema = z.object({ texto }).strip();

export type CrearComentarioDto = z.infer<typeof crearComentarioSchema>;
export type ActualizarComentarioDto = z.infer<typeof actualizarComentarioSchema>;
