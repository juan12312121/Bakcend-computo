import { Op, fn, col, type Attributes, type WhereOptions } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { MensajeChat, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import { vigentes } from './mensajes-temporales';

/** Resultado de marcar un chat como leído. */
export interface LecturaChat {
  marcados: number;
  hasta_id: number | null;
  leido_en: Date;
}

/** Lo mínimo de un mensaje vencido para borrarlo con su archivo. */
export type MensajeVencido = Pick<MensajeChat, 'id' | 'archivo_url'>;

type WhereMensaje = WhereOptions<Attributes<MensajeChat>>;

export class MensajeChatRepository extends BaseRepository<MensajeChat> {
  protected readonly entidad = 'Mensaje';

  constructor() {
    super(MensajeChat);
  }

  /** Cada mensaje viaja con los datos públicos de quien lo envió. */
  protected override opcionesPorDefecto() {
    return {
      include: [{ model: Usuario, as: 'emisor', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }],
    };
  }

  /**
   * Página de mensajes vigentes contando desde el más reciente (offset 0 = lo último que se habló),
   * devuelta en orden cronológico para pintarla tal cual.
   */
  async deChat(chatId: number, paginacion: Paginacion): Promise<Page<MensajeChat>> {
    const where: WhereMensaje = { chat_id: chatId, [Op.and]: [vigentes<Attributes<MensajeChat>>()] };
    const page = await this.paginate(where, paginacion, { order: [['fecha_creacion', 'DESC'], ['id', 'DESC']] });
    return { ...page, items: page.items.reverse() };
  }

  /**
   * Marca como leídos (con la hora de lectura) los mensajes que el lector recibió en ese chat.
   * Devuelve cuántos cambió y hasta qué id quedó leído (null si no había nada sin leer).
   */
  async marcarLeidos(chatId: number, lectorId: number): Promise<LecturaChat> {
    const recibidos = { chat_id: chatId, emisor_id: { [Op.ne]: lectorId }, leido: false };
    const hastaId = (await MensajeChat.max('id', { where: recibidos })) as number | null;
    const leido_en = new Date();
    if (!hastaId) return { marcados: 0, hasta_id: null, leido_en };

    const [marcados] = await MensajeChat.update({ leido: true, leido_en }, { where: { ...recibidos, id: { [Op.lte]: hastaId } } });
    return { marcados, hasta_id: Number(hastaId), leido_en };
  }

  /** Último mensaje vigente de cada chat (2 consultas, sin importar cuántos chats sean). */
  async ultimosPorChat(chatIds: number[]): Promise<Map<number, MensajeChat>> {
    if (!chatIds.length) return new Map();
    const maximos = (await MensajeChat.findAll({
      attributes: ['chat_id', [fn('MAX', col('id')), 'ultimo_id']],
      where: { chat_id: chatIds, [Op.and]: [vigentes<Attributes<MensajeChat>>()] },
      group: ['chat_id'],
      raw: true,
    })) as unknown as { chat_id: number; ultimo_id: number }[];
    if (!maximos.length) return new Map();

    const mensajes = await MensajeChat.findAll({ where: { id: maximos.map((m) => Number(m.ultimo_id)) } });
    return new Map(mensajes.map((m) => [m.chat_id, m]));
  }

  /** Mensajes vigentes sin leer que recibió el usuario, por chat. */
  async noLeidosPorChat(chatIds: number[], lectorId: number): Promise<Map<number, number>> {
    if (!chatIds.length) return new Map();
    const filas = await MensajeChat.count({
      where: { chat_id: chatIds, emisor_id: { [Op.ne]: lectorId }, leido: false, [Op.and]: [vigentes<Attributes<MensajeChat>>()] },
      group: ['chat_id'],
    });
    return new Map(filas.map((f) => [Number(f.chat_id), Number(f.count)]));
  }

  /** Quien escribió primero en el chat: es quien inició la solicitud de mensaje (los avisos no cuentan). */
  async primerEmisor(chatId: number): Promise<number | null> {
    const primero = await MensajeChat.findOne({
      where: { chat_id: chatId, es_aviso: false },
      attributes: ['emisor_id'],
      order: [['fecha_creacion', 'ASC'], ['id', 'ASC']],
    });
    return primero?.emisor_id ?? null;
  }

  /** Hasta `limite` mensajes ya vencidos (para la limpieza programada). */
  vencidos(ahora: Date, limite: number): Promise<MensajeVencido[]> {
    return MensajeChat.findAll({
      where: { expira_en: { [Op.lte]: ahora } },
      attributes: ['id', 'archivo_url'],
      order: [['id', 'ASC']],
      limit: limite,
    });
  }
}

export const mensajeChatRepository = new MensajeChatRepository();
