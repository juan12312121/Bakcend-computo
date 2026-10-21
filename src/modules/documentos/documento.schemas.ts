import { z } from 'zod';
import { idSchema, paramsDe, textoOpcional } from '../../core/validation/common.schemas';
import { ICONOS_DOCUMENTO } from '../../infrastructure/database/models';
import { idONulo, idOpcional } from '../publicaciones/publicacion.schemas';

export const subirDocumentoSchema = z.object({
  /** Nombre que se mostrará en lugar del nombre original del archivo. */
  nombre_archivo_custom: textoOpcional(255),
  descripcion: textoOpcional(1000),
  publicacion_id: idOpcional,
});

export const actualizarDocumentoSchema = z
  .object({
    nombre_archivo_custom: textoOpcional(255),
    descripcion: textoOpcional(1000),
    icono: z.enum(ICONOS_DOCUMENTO, { errorMap: () => ({ message: 'Ícono inválido' }) }).optional(),
    color: z.string().trim().min(1).max(30).optional(),
    /** null desvincula; un id vincula a otra publicación propia. */
    publicacion_id: idONulo,
  })
  .strip();

export const vincularDocumentoSchema = z.object({
  publicacion_id: idSchema,
});

export const usuarioDocumentosParams = paramsDe('usuario_id');
export const publicacionDocumentosParams = paramsDe('publicacion_id');

export type SubirDocumentoDto = z.infer<typeof subirDocumentoSchema>;
export type ActualizarDocumentoDto = z.infer<typeof actualizarDocumentoSchema>;
