import { z } from 'zod';
import { textoOpcional } from '../../core/validation/common.schemas';

/** En multipart los booleanos llegan como texto: acepta true/false, 1/0 y 'true'/'false'. */
const booleano = z.preprocess(
  (v) => (v === 1 || v === '1' || v === 'true' ? true : v === 0 || v === '0' || v === 'false' ? false : v),
  z.boolean({ invalid_type_error: 'Debe ser verdadero o falso' }),
);

export const actualizarPerfilSchema = z
  .object({
    nombre_completo: z.string().trim().min(3, 'Mínimo 3 caracteres').max(150).optional(),
    biografia: textoOpcional(500),
    ubicacion: textoOpcional(100),
    carrera: textoOpcional(100),
    /** Al pasar a pública se aceptan solas las solicitudes pendientes. */
    cuenta_privada: booleano.optional(),
  })
  .strip();

export const buscarUsuariosQuery = z.object({
  q: z.string().trim().min(2, 'Escribe al menos 2 caracteres'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const presenciaSchema = z.object({
  en_linea: booleano,
});

export type ActualizarPerfilDto = z.infer<typeof actualizarPerfilSchema>;
export type BuscarUsuariosQuery = z.infer<typeof buscarUsuariosQuery>;
