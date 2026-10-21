import { z } from 'zod';
import { idSchema } from '../../core/validation/common.schemas';

/** Máximo de usuarios por consulta en lote (igual que el legacy: los demás se ignoran). */
export const MAX_USUARIOS_LOTE = 50;

/** La galería devuelve hasta 100 fotos de publicaciones por defecto (como el legacy) y admite paginar. */
export const galeriaQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(100),
  offset: z.coerce.number().int().min(0).default(0),
});

export const fotosLoteSchema = z.object({
  usuarios_ids: z
    .array(idSchema, {
      required_error: 'Se requiere un arreglo de IDs de usuarios',
      invalid_type_error: 'usuarios_ids debe ser un arreglo',
    })
    .min(1, 'Se requiere al menos un ID de usuario')
    .transform((ids) => [...new Set(ids)].slice(0, MAX_USUARIOS_LOTE)),
});

export type GaleriaQuery = z.infer<typeof galeriaQuery>;
export type FotosLoteDto = z.infer<typeof fotosLoteSchema>;
