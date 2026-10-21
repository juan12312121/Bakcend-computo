import type { ModelStatic } from 'sequelize';
import { z } from 'zod';
import { BaseRepository } from '../../core/domain/BaseRepository';
import {
  EMOJIS_REACCION,
  ReaccionMensajeChat,
  ReaccionMensajeGrupo,
  type EmojiReaccion,
  type ReaccionMensaje,
} from '../../infrastructure/database/models';

/** Cómo viaja cada reacción dentro de un mensaje o publicación: agrupada por emoji. */
export interface ReaccionResumen {
  emoji: EmojiReaccion;
  total: number;
  /** Es la reacción de quien consulta. */
  mia: boolean;
}

/** En tiempo real no se manda `mia` (depende de quién recibe): el cliente lo calcula con `usuario_id` y `emoji`. */
export type ConteoReaccion = Omit<ReaccionResumen, 'mia'>;

/** Fila agrupada (objetivo, emoji, total) que sale de un COUNT ... GROUP BY. */
export interface FilaConteo {
  objetivo_id: number;
  emoji: string;
  total: number;
}

/** "❤" sin el selector de variación cuenta como "❤️". */
const normalizarEmoji = (valor: unknown) => (valor === '❤' ? '❤️' : valor);

/** Body de PUT .../reaccion: uno de los emojis de la lista corta. */
export const reaccionSchema = z.object({
  emoji: z.preprocess(
    normalizarEmoji,
    z.enum(EMOJIS_REACCION, { errorMap: () => ({ message: `Reacciona con uno de: ${EMOJIS_REACCION.join(' ')}` }) }),
  ),
});
export type ReaccionDto = z.infer<typeof reaccionSchema>;

/**
 * Arma `reacciones` por objetivo (mensaje o publicación): de más a menos votado y, si empatan, en el orden de la lista.
 * `mias` = objetivo → mi emoji.
 */
export function resumirReacciones(filas: readonly FilaConteo[], mias: ReadonlyMap<number, string>): Map<number, ReaccionResumen[]> {
  const resultado = new Map<number, ReaccionResumen[]>();
  for (const fila of filas) {
    const lista = resultado.get(fila.objetivo_id) ?? [];
    lista.push({ emoji: fila.emoji as EmojiReaccion, total: fila.total, mia: mias.get(fila.objetivo_id) === fila.emoji });
    resultado.set(fila.objetivo_id, lista);
  }
  const orden = (emoji: string) => EMOJIS_REACCION.indexOf(emoji as EmojiReaccion);
  for (const lista of resultado.values()) lista.sort((a, b) => b.total - a.total || orden(a.emoji) - orden(b.emoji));
  return resultado;
}

/** Quita `mia` para los avisos en tiempo real. */
export const sinMia = (reacciones: readonly ReaccionResumen[]): ConteoReaccion[] => reacciones.map(({ emoji, total }) => ({ emoji, total }));

/**
 * Reacciones a mensajes: una por persona y mensaje. El mismo repositorio sirve para el chat directo
 * y el de grupo (tablas distintas con la misma forma).
 */
export class ReaccionMensajeRepository extends BaseRepository<ReaccionMensaje> {
  protected readonly entidad = 'Reacción';

  constructor(modelo: ModelStatic<ReaccionMensaje>) {
    super(modelo);
  }

  /** Pone o cambia mi reacción al mensaje. */
  async poner(mensajeId: number, usuarioId: number, emoji: EmojiReaccion): Promise<void> {
    const actual = await this.findOne({ mensaje_id: mensajeId, usuario_id: usuarioId });
    if (actual) {
      if (actual.emoji !== emoji) await this.update(actual, { emoji });
      return;
    }
    await this.create({ mensaje_id: mensajeId, usuario_id: usuarioId, emoji });
  }

  /** Quita mi reacción (devuelve cuántas borró: 0 si no tenía). */
  quitar(mensajeId: number, usuarioId: number): Promise<number> {
    return this.delete({ mensaje_id: mensajeId, usuario_id: usuarioId });
  }

  /** Reacciones agrupadas de varios mensajes en 2 consultas (conteos + las mías). */
  async resumenDe(mensajeIds: readonly number[], usuarioId: number): Promise<Map<number, ReaccionResumen[]>> {
    if (!mensajeIds.length) return new Map();
    const ids = [...mensajeIds];
    const [conteos, mias] = await Promise.all([
      this.model.count({ where: { mensaje_id: ids }, group: ['mensaje_id', 'emoji'] }),
      this.findAll({ mensaje_id: ids, usuario_id: usuarioId }, { attributes: ['mensaje_id', 'emoji'] }),
    ]);
    const filas = conteos.map((c) => ({ objetivo_id: Number(c.mensaje_id), emoji: String(c.emoji), total: Number(c.count) }));
    return resumirReacciones(filas, new Map(mias.map((m) => [m.mensaje_id, m.emoji])));
  }

  /** Reacciones de un mensaje vistas por `usuarioId`. */
  async de(mensajeId: number, usuarioId: number): Promise<ReaccionResumen[]> {
    return (await this.resumenDe([mensajeId], usuarioId)).get(mensajeId) ?? [];
  }
}

export const reaccionMensajeChatRepository = new ReaccionMensajeRepository(ReaccionMensajeChat);
export const reaccionMensajeGrupoRepository = new ReaccionMensajeRepository(ReaccionMensajeGrupo);

/** Agrega `reacciones` a cada mensaje de una lista (los que no tienen quedan con []). */
export function conReacciones<T extends { id: number; toJSON(): object }>(
  mensajes: readonly T[],
  reacciones: ReadonlyMap<number, ReaccionResumen[]>,
): (ReturnType<T['toJSON']> & { reacciones: ReaccionResumen[] })[] {
  return mensajes.map((m) => ({ ...(m.toJSON() as ReturnType<T['toJSON']>), reacciones: reacciones.get(m.id) ?? [] }));
}
