import { Op, type WhereOptions } from 'sequelize';
import { z } from 'zod';
import { MENSAJES_TEMPORALES, type MensajesTemporales } from '../../infrastructure/database/models';

/** Cuánto vive un mensaje nuevo según la opción del chat. */
export const DURACION_TEMPORAL_MS: Record<Exclude<MensajesTemporales, 'apagado'>, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const ETIQUETAS: Record<Exclude<MensajesTemporales, 'apagado'>, string> = { '24h': '24 horas', '7d': '7 días' };

/** Evento Socket.IO cuando alguien cambia la opción (chat directo o de grupo). */
export const EVENTO_TEMPORALES = 'mensajes_temporales';

/** Payload de `mensajes_temporales`. */
export interface AvisoTemporales {
  tipo: 'chat' | 'grupo';
  /** chat_id o grupo_id. */
  id: number;
  mensajes_temporales: MensajesTemporales;
  /** Quién lo cambió. */
  usuario_id: number;
}

/** Body de PUT .../temporales. */
export const temporalesSchema = z.object({
  mensajes_temporales: z.enum(MENSAJES_TEMPORALES, {
    errorMap: () => ({ message: `Elige una opción: ${MENSAJES_TEMPORALES.join(', ')}` }),
  }),
});
export type TemporalesDto = z.infer<typeof temporalesSchema>;

/** Fecha de vencimiento de un mensaje nuevo (null si están apagados). */
export function expiraEn(opcion: MensajesTemporales | null | undefined): Date | null;
export function expiraEn(opcion: MensajesTemporales | null | undefined, desde: Date): Date | null;
export function expiraEn(opcion: MensajesTemporales | null | undefined, desde: Date = new Date()): Date | null {
  if (!opcion || opcion === 'apagado') return null;
  return new Date(desde.getTime() + DURACION_TEMPORAL_MS[opcion]);
}

/** Condición "no vencido": sin fecha de vencimiento o con una futura. Nunca se devuelven mensajes vencidos. */
export function vigentes<T>(ahora: Date = new Date()): WhereOptions<T> {
  return { [Op.or]: [{ expira_en: null }, { expira_en: { [Op.gt]: ahora } }] } as unknown as WhereOptions<T>;
}

/** ¿Ya venció? */
export function vencido(mensaje: { expira_en?: Date | null }, ahora: Date = new Date()): boolean {
  return !!mensaje.expira_en && new Date(mensaje.expira_en).getTime() <= ahora.getTime();
}

/** Texto del aviso que queda en la conversación: "Ana activó los mensajes temporales (24 horas)". */
export function textoAvisoTemporales(nombre: string, opcion: MensajesTemporales): string {
  if (opcion === 'apagado') return `${nombre} desactivó los mensajes temporales.`;
  return `${nombre} activó los mensajes temporales: los mensajes nuevos desaparecerán a las ${ETIQUETAS[opcion]}.`;
}
