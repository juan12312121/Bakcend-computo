import { z } from 'zod';
import { idSchema, textoRequerido } from '../../core/validation/common.schemas';

/** En multipart los campos vacíos llegan como "": se tratan como no enviados. */
const opcional = (max: number) =>
  z.preprocess((v) => (v === '' || v === null ? undefined : v), z.string().trim().min(1).max(max, `Máximo ${max} caracteres`).optional());

const nombre = textoRequerido('El nombre', 100);

export const crearSeccionSchema = z
  .object({
    nombre,
    icono: opcional(50),
    color: opcional(100),
  })
  .strip();

export const actualizarSeccionSchema = z
  .object({
    nombre: nombre.optional(),
    icono: opcional(50),
    color: opcional(100),
  })
  .strip();

export const postSeccionSchema = z.object({
  seccion_id: idSchema,
  publicacion_id: idSchema,
});

export type CrearSeccionDto = z.infer<typeof crearSeccionSchema>;
export type ActualizarSeccionDto = z.infer<typeof actualizarSeccionSchema>;
export type PostSeccionDto = z.infer<typeof postSeccionSchema>;
