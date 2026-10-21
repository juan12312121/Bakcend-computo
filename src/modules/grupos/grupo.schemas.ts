import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe, textoOpcional, textoRequerido } from '../../core/validation/common.schemas';
import { TIPOS_GRUPO } from '../../infrastructure/database/models';

/** En multipart los booleanos llegan como texto: "true" / "1" / "false" / "0". */
const booleanoFlexible = z.preprocess(
  (v) => (v === 'true' || v === '1' || v === 1 ? true : v === 'false' || v === '0' || v === 0 ? false : v),
  z.boolean({ invalid_type_error: 'Debe ser verdadero o falso' }),
);

const privacidad = z.enum(['publico', 'privado'], { errorMap: () => ({ message: 'La privacidad debe ser publico o privado' }) });

/** Para qué es el grupo: comunidad, escuela, trabajo, ocio o eventos. */
const tipo = z.enum(TIPOS_GRUPO, { errorMap: () => ({ message: `El tipo debe ser uno de: ${TIPOS_GRUPO.join(', ')}` }) });

export const crearGrupoSchema = z
  .object({
    nombre: textoRequerido('El nombre', 100),
    descripcion: textoOpcional(2000),
    privacidad: privacidad.default('publico'),
    req_aprobacion: booleanoFlexible.default(false),
    tipo: tipo.default('comunidad'),
  })
  .strip();

export const actualizarGrupoSchema = z
  .object({
    nombre: z.string().trim().min(1, 'El nombre no puede quedar vacío').max(100, 'El nombre admite máximo 100 caracteres').optional(),
    descripcion: textoOpcional(2000),
    privacidad: privacidad.optional(),
    req_aprobacion: booleanoFlexible.optional(),
    tipo: tipo.optional(),
  })
  .strip();

/** GET /grupos?tipo=trabajo&q=ventas */
export const listarGruposQuery = paginacionQuery.extend({
  tipo: tipo.optional(),
  /** Busca en el nombre y la descripción (mín. 2 caracteres). */
  q: z.string().trim().min(2, 'Escribe al menos 2 caracteres').max(100).optional(),
});

export const invitarSchema = z.object({
  usuario_id: idSchema,
});

export const responderInvitacionSchema = z.object({
  accion: z.enum(['aceptar', 'rechazar'], { errorMap: () => ({ message: 'La acción debe ser aceptar o rechazar' }) }),
});

export const invitacionParams = paramsDe('invitacion_id');

export type CrearGrupoDto = z.infer<typeof crearGrupoSchema>;
export type ActualizarGrupoDto = z.infer<typeof actualizarGrupoSchema>;
export type ListarGruposQuery = z.infer<typeof listarGruposQuery>;
export type InvitarDto = z.infer<typeof invitarSchema>;
export type ResponderInvitacionDto = z.infer<typeof responderInvitacionSchema>;
