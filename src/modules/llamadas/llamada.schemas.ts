import { z } from 'zod';
import { idSchema, paginacionQuery, paramsDe } from '../../core/validation/common.schemas';
import { TIPOS_LLAMADA } from '../../infrastructure/database/models';

/** Una llamada en malla (cada quien conectado con cada quien) aguanta bien hasta 8 personas. */
export const MAXIMO_PARTICIPANTES = 8;
/** Sin respuesta en este tiempo, la llamada se da por perdida. */
export const SEGUNDOS_SIN_RESPUESTA = 40;
/** Si el socket de alguien en llamada se cae, se le espera este tiempo a que vuelva (`llamada:retomar`). */
export const SEGUNDOS_GRACIA_DESCONEXION = 15;
/** Una SDP de video con varios códecs ronda los 5-10 KB; esto deja margen sin aceptar basura enorme. */
export const MAXIMO_SDP = 100_000;

// ---------- REST ----------

export const FILTROS_HISTORIAL = ['todas', 'perdidas'] as const;

export const historialQuery = paginacionQuery.extend({
  filtro: z.enum(FILTROS_HISTORIAL, { errorMap: () => ({ message: `filtro debe ser uno de: ${FILTROS_HISTORIAL.join(', ')}` }) }).default('todas'),
});

export const grupoIdParams = paramsDe('grupoId');

// ---------- Socket.IO ----------

const tipoLlamada = z.enum(TIPOS_LLAMADA, { errorMap: () => ({ message: 'tipo debe ser audio o video' }) });

/** 'llamada:iniciar': a un usuario o a un grupo (exactamente uno). */
export const iniciarLlamadaSchema = z
  .object({
    tipo: tipoLlamada.default('audio'),
    usuario_id: idSchema.optional(),
    grupo_id: idSchema.optional(),
  })
  .refine((d) => (d.usuario_id === undefined) !== (d.grupo_id === undefined), {
    message: 'Indica a quién llamar: usuario_id o grupo_id (solo uno)',
    path: ['usuario_id'],
  });

export const llamadaIdSchema = z.object({ llamada_id: idSchema });

export const TIPOS_SENAL = ['oferta', 'respuesta', 'ice'] as const;
export type TipoSenal = (typeof TIPOS_SENAL)[number];

/** Candidato ICE tal como lo da RTCIceCandidate.toJSON(). */
const candidatoSchema = z
  .object({
    candidate: z.string().max(2_000),
    sdpMid: z.string().max(100).nullable().optional(),
    sdpMLineIndex: z.number().int().min(0).max(100).nullable().optional(),
    usernameFragment: z.string().max(256).nullable().optional(),
  })
  .strip();

/** 'llamada:senal': oferta/respuesta SDP o candidato ICE para UNA persona de la llamada. */
export const senalSchema = z
  .object({
    llamada_id: idSchema,
    para: idSchema,
    tipo: z.enum(TIPOS_SENAL),
    sdp: z.string().max(MAXIMO_SDP).optional(),
    candidato: candidatoSchema.optional(),
  })
  .refine((d) => (d.tipo === 'ice' ? !!d.candidato : !!d.sdp), { message: 'Falta la sdp o el candidato', path: ['tipo'] });

/** 'llamada:medios': aviso de micrófono / cámara / pantalla para que los demás muestren el ícono. */
export const mediosSchema = z.object({
  llamada_id: idSchema,
  microfono: z.boolean(),
  camara: z.boolean(),
  pantalla: z.boolean().default(false),
});

export type HistorialQuery = z.infer<typeof historialQuery>;
export type IniciarLlamadaDto = z.infer<typeof iniciarLlamadaSchema>;
export type SenalDto = z.infer<typeof senalSchema>;
export type MediosDto = z.infer<typeof mediosSchema>;
