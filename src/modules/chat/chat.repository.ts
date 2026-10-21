import { Op } from 'sequelize';
import { BaseRepository } from '../../core/domain/BaseRepository';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { Chat, Seguidor, Usuario, type EstadoChat } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

export class ChatRepository extends BaseRepository<Chat> {
  protected readonly entidad = 'Chat';

  constructor() {
    super(Chat);
  }

  /** Un chat siempre se lee con los datos públicos de sus dos participantes. */
  protected override opcionesPorDefecto() {
    return {
      include: [
        { model: Usuario, as: 'usuario1', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
        { model: Usuario, as: 'usuario2', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
      ],
    };
  }

  /** Para Socket.IO: solo los dos participantes pueden escuchar la sala del chat. */
  esParticipante(chatId: number, usuarioId: number): Promise<boolean> {
    return this.exists({ id: chatId, [Op.or]: [{ usuario1_id: usuarioId }, { usuario2_id: usuarioId }] });
  }

  /** El índice único es (usuario1_id, usuario2_id): el id menor siempre va primero. */
  static ordenar(a: number, b: number): [number, number] {
    return a < b ? [a, b] : [b, a];
  }

  entre(a: number, b: number): Promise<Chat | null> {
    const [usuario1_id, usuario2_id] = ChatRepository.ordenar(a, b);
    return this.findOne({ usuario1_id, usuario2_id });
  }

  /** Crea el chat del par; `iniciadorId` es quien lo abre. */
  crearEntre(iniciadorId: number, otroId: number, estado: EstadoChat): Promise<Chat> {
    const [usuario1_id, usuario2_id] = ChatRepository.ordenar(iniciadorId, otroId);
    return this.create({ usuario1_id, usuario2_id, iniciador_id: iniciadorId, estado });
  }

  /** Chats del usuario, el de actividad más reciente primero. */
  deUsuario(usuarioId: number, paginacion: Paginacion): Promise<Page<Chat>> {
    return this.paginate({ [Op.or]: [{ usuario1_id: usuarioId }, { usuario2_id: usuarioId }] }, paginacion, {
      order: [['ultima_interaccion', 'DESC'], ['id', 'DESC']],
    });
  }

  async seSiguenMutuamente(a: number, b: number): Promise<boolean> {
    const relaciones = await Seguidor.count({
      where: { estado: 'aceptado', [Op.or]: [{ seguidor_id: a, siguiendo_id: b }, { seguidor_id: b, siguiendo_id: a }] },
    });
    return relaciones === 2;
  }
}

export const chatRepository = new ChatRepository();
