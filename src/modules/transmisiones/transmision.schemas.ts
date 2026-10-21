import { z } from 'zod';
import { idSchema, paginacionQuery, textoRequerido } from '../../core/validation/common.schemas';

/**
 * El anfitrión manda su video a cada espectador por separado (malla uno-a-muchos): con ~20 personas
 * ya se satura la subida de un teléfono. Para audiencias grandes hace falta un servidor de medios (SFU) como LiveKit.
 */
export const MAXIMO_ESPECTADORES = 20;
/** Si el anfitrión pierde la conexión, se le espera este tiempo antes de terminar la transmisión. */
export const SEGUNDOS_GRACIA_ANFITRION = 30;
/** Comentarios recientes que recibe quien entra. */
export const COMENTARIOS_AL_ENTRAR = 30;
/** Pausa mínima entre comentarios de una misma persona. */
export const MS_ENTRE_COMENTARIOS = 400;
export const LIMITES_TRANSMISION = { titulo: 150, comentario: 300, sdp: 100_000 } as const;

export const REACCIONES_EN_VIVO = ['corazon', 'fuego', 'aplauso', 'risa', 'wow'] as const;
export type ReaccionEnVivo = (typeof REACCIONES_EN_VIVO)[number];

// ---------- REST ----------

export const crearTransmisionSchema = z
  .object({
    titulo: textoRequerido('El título', LIMITES_TRANSMISION.titulo),
    /** Transmitir solo para los miembros de un grupo. */
    grupo_id: z.preprocess((v) => (v === '' || v === null ? undefined : v), idSchema.optional()),
  })
  .strip();

export const listarTransmisionesQuery = paginacionQuery.extend({
  grupo_id: idSchema.optional(),
  anfitrion_id: idSchema.optional(),
});

export const comentariosQuery = paginacionQuery.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ---------- Socket.IO ----------

export const transmisionIdSchema = z.object({ transmision_id: idSchema });

const candidatoSchema = z
  .object({
    candidate: z.string().max(2_000),
    sdpMid: z.string().max(100).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(100).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  })
  .strip();

/** Señal WebRTC entre el anfitrión y UN espectador. */
export const senalTransmisionSchema = z
  .object({
    transmision_id: idSchema,
    para: idSchema,
    tipo: z.enum(['oferta', 'respuesta', 'ice']),
    sdp: z.string().max(LIMITES_TRANSMISION.sdp).optional(),
    candidato: candidatoSchema.optional(),
  })
  .refine((d) => (d.tipo === 'ice' ? !!d.candidato : !!d.sdp), { message: 'Falta la sdp o el candidato', path: ['tipo'] });

export const comentarSchema = z.object({
  transmision_id: idSchema,
  texto: textoRequerido('El comentario', LIMITES_TRANSMISION.comentario),
});

export const reaccionSchema = z.object({
  transmision_id: idSchema,
  tipo: z.enum(REACCIONES_EN_VIVO).default('corazon'),
});

export type CrearTransmisionDto = z.infer<typeof crearTransmisionSchema>;
export type ListarTransmisionesQuery = z.infer<typeof listarTransmisionesQuery>;
export type ComentariosQuery = z.infer<typeof comentariosQuery>;
export type SenalTransmisionDto = z.infer<typeof senalTransmisionSchema>;
