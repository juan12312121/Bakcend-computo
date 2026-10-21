import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type Chat, type EmojiReaccion, type MensajeChat, type MensajesTemporales, type Usuario } from '../../infrastructure/database/models';
import type { AvisadorPush } from '../../infrastructure/push';
import { realtime, salas, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { dispositivoService } from '../dispositivos/dispositivo.service';
import { privacidadService } from '../privacidad/privacidad.service';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { datosAdjunto, resumenAdjunto } from './adjuntos';
import { chatRepository, type ChatRepository } from './chat.repository';
import type { EnviarMensajeDto } from './chat.schemas';
import { mensajeChatRepository, type MensajeChatRepository } from './mensaje-chat.repository';
import { EVENTO_TEMPORALES, expiraEn, textoAvisoTemporales, vencido, type AvisoTemporales } from './mensajes-temporales';
import {
  conReacciones,
  reaccionMensajeChatRepository,
  sinMia,
  type ConteoReaccion,
  type ReaccionMensajeRepository,
  type ReaccionResumen,
} from './reacciones';
import { asegurarTextoPermitido } from '../moderacion/palabras.service';

/** Chat como lo recibe el frontend: sin usuario1/usuario2, con "el otro" ya resuelto. */
export type ChatVista = Omit<ReturnType<Chat['toJSON']>, 'usuario1' | 'usuario2'> & {
  otro_usuario: object | null;
  ultimo_mensaje: object | null;
  no_leidos: number;
};

/** Mensaje como lo recibe el frontend: con sus reacciones agrupadas por emoji. */
export type MensajeVista = ReturnType<MensajeChat['toJSON']> & { emisor?: Pick<Usuario, 'nombre_completo'> | null; reacciones: ReaccionResumen[] };

/** Evento Socket.IO que escucha el frontend al llegar un mensaje. */
export const EVENTO_MENSAJE = 'new_message';
/** El otro leyó mis mensajes hasta `hasta_id` (palomitas azules). */
export const EVENTO_LEIDOS = 'mensajes_leidos';
/** Un mensaje se eliminó para todos. */
export const EVENTO_ELIMINADO = 'mensaje_eliminado';
/** Alguien puso, cambió o quitó su reacción a un mensaje. */
export const EVENTO_REACCION = 'reaccion_mensaje';

/** Payload de `mensajes_leidos` (también es la respuesta de PUT /chat/:chatId/leer). */
export interface AvisoLeidos {
  chat_id: number;
  lector_id: number;
  /** Último id que quedó leído (null si no había nada sin leer). */
  hasta_id: number | null;
  leido_en: Date;
  marcados: number;
}

/** Payload de `reaccion_mensaje`: `emoji` null = la quitó. */
export interface AvisoReaccionChat {
  chat_id: number;
  mensaje_id: number;
  usuario_id: number;
  emoji: EmojiReaccion | null;
  reacciones: ConteoReaccion[];
}

/** Respuesta de PUT/DELETE /chat/mensajes/:mensajeId/reaccion. */
export interface ResultadoReaccionChat {
  chat_id: number;
  mensaje_id: number;
  reacciones: ReaccionResumen[];
}

/** Respuesta de PUT /chat/:chatId/temporales: el aviso que quedó en la conversación (null si no cambió nada). */
export type ResultadoTemporales = AvisoTemporales & { aviso: MensajeVista | null };

export class ChatService extends BaseService<Chat, ChatRepository> {
  constructor(
    repository: ChatRepository,
    private readonly mensajes: MensajeChatRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly tiempoReal: RealtimeGateway,
    private readonly push: AvisadorPush,
    private readonly storage: FileStorage,
    private readonly reacciones: ReaccionMensajeRepository = reaccionMensajeChatRepository,
  ) {
    super(repository);
  }

  // ---------- Consultas ----------

  async lista(usuarioId: number, paginacion: Paginacion): Promise<Page<ChatVista>> {
    const page = await this.repository.deUsuario(usuarioId, paginacion);
    const ids = page.items.map((c) => c.id);
    const [ultimos, noLeidos] = await Promise.all([this.mensajes.ultimosPorChat(ids), this.mensajes.noLeidosPorChat(ids, usuarioId)]);
    return {
      ...page,
      items: page.items.map((c) => this.vista(c, usuarioId, ultimos.get(c.id) ?? null, noLeidos.get(c.id) ?? 0)),
    };
  }

  /**
   * Mensajes vigentes del chat (solo participantes), cada uno con sus reacciones. Antes de leerlos marca como leídos
   * los que recibí (así la página ya trae `leido` / `leido_en` al día) y avisa al otro con `mensajes_leidos`.
   */
  async mensajesDe(chatId: number, usuarioId: number, paginacion: Paginacion): Promise<Page<MensajeVista>> {
    const chat = await this.participante(chatId, usuarioId);
    await this.marcarYAvisar(chat, usuarioId);
    const page = await this.mensajes.deChat(chatId, paginacion);
    const reacciones = await this.reacciones.resumenDe(
      page.items.map((m) => m.id),
      usuarioId,
    );
    return { ...page, items: conReacciones(page.items, reacciones) };
  }

  /** PUT /chat/:chatId/leer: marca leído lo recibido sin pedir mensajes (el chat está abierto y llegó uno nuevo). */
  async leer(chatId: number, usuarioId: number): Promise<AvisoLeidos> {
    const chat = await this.participante(chatId, usuarioId);
    return this.marcarYAvisar(chat, usuarioId);
  }

  // ---------- Escritura ----------

  /**
   * Devuelve el chat del par (o lo crea). Nace "accepted" si se siguen mutuamente;
   * si no, queda como solicitud "pending" hasta que el receptor la acepte.
   */
  async iniciar(emisorId: number, receptorId: number): Promise<{ chat: ChatVista; creado: boolean }> {
    if (emisorId === receptorId) throw new BadRequestError('No puedes chatear contigo mismo');
    await this.usuarios.findByIdOrFail(receptorId);
    await this.asegurarSinBloqueo(emisorId, receptorId);

    const mutuo = await this.repository.seSiguenMutuamente(emisorId, receptorId);
    let chat = await this.repository.entre(emisorId, receptorId);
    const creado = !chat;

    if (!chat) {
      const nuevo = await this.repository.crearEntre(emisorId, receptorId, mutuo ? 'accepted' : 'pending');
      chat = await this.repository.findByIdOrFail(nuevo.id);
    } else if (chat.estado === 'pending' && mutuo) {
      // Si desde entonces empezaron a seguirse, la solicitud ya no hace falta.
      chat = await this.repository.update(chat, { estado: 'accepted' });
    }

    return { chat: this.vista(chat, emisorId, null, 0), creado };
  }

  /** Con mensajes temporales activos, el mensaje nace con `expira_en`. */
  async enviar(emisorId: number, { chatId, texto, duracion_seg }: EnviarMensajeDto, archivo?: ArchivoSubido): Promise<MensajeVista> {
    texto = await asegurarTextoPermitido(texto, 'mensaje');
    const chat = await this.participante(chatId, emisorId);
    if (chat.estado === 'rejected') throw new ForbiddenError('Este chat fue rechazado');
    await this.asegurarSinBloqueo(emisorId, this.otroId(chat, emisorId));
    const adjunto = datosAdjunto(texto, archivo, duracion_seg);

    const creado = await sequelize.transaction(async (t) => {
      const mensaje = await this.mensajes.create(
        { chat_id: chatId, emisor_id: emisorId, texto, ...adjunto, expira_en: expiraEn(chat.mensajes_temporales) },
        t,
      );
      await this.repository.update(chat, { ultima_interaccion: new Date() }, t);
      return mensaje;
    });

    const mensaje = await this.emitirNuevo(chat, creado.id);
    await this.push.avisar(this.otroId(chat, emisorId), {
      titulo: mensaje.emisor?.nombre_completo ?? 'Nuevo mensaje',
      cuerpo: texto || resumenAdjunto(adjunto.tipo_archivo),
      datos: { tipo: 'mensaje', chat_id: String(chatId) },
    });
    return mensaje;
  }

  /** Elimina un mensaje propio "para todos": se borra (y su archivo) y se avisa con `mensaje_eliminado`. */
  async eliminarMensaje(mensajeId: number, usuarioId: number): Promise<{ chat_id: number; mensaje_id: number }> {
    const mensaje = await this.mensajes.findByIdOrFail(mensajeId);
    this.asegurarDueno(mensaje.emisor_id, usuarioId, 'Solo puedes eliminar tus propios mensajes');
    const chat = await this.repository.findByIdOrFail(mensaje.chat_id);

    await this.mensajes.delete(mensaje.id);
    await this.storage.eliminar(mensaje.archivo_url);

    const aviso = { chat_id: chat.id, mensaje_id: mensaje.id };
    this.tiempoReal.aSala(salas.chat(chat.id), EVENTO_ELIMINADO, aviso);
    this.tiempoReal.aUsuario(this.otroId(chat, usuarioId), EVENTO_ELIMINADO, aviso);
    return aviso;
  }

  /** Solo el receptor de la solicitud (quien no abrió el chat) la acepta. */
  async aceptar(chatId: number, usuarioId: number): Promise<ChatVista> {
    const chat = await this.participante(chatId, usuarioId);
    if (chat.estado !== 'accepted') {
      // Chats viejos no tienen iniciador_id: se toma a quien escribió primero.
      const iniciador = chat.iniciador_id ?? (await this.mensajes.primerEmisor(chatId));
      if (iniciador === null) throw new BadRequestError('Todavía no hay una solicitud de mensaje que aceptar');
      if (iniciador === usuarioId) throw new ForbiddenError('Solo quien recibe la solicitud puede aceptarla');
      await this.repository.update(chat, { estado: 'accepted' });
    }
    return this.vista(chat, usuarioId, null, 0);
  }

  // ---------- Mensajes temporales ----------

  /**
   * Cualquiera de los dos activa (24 h / 7 días) o apaga los mensajes temporales. Solo afecta a los mensajes nuevos.
   * Deja un aviso en la conversación (llega como `new_message` con `es_aviso`) y emite `mensajes_temporales`.
   * Si la opción ya era esa, no hace nada (aviso null).
   */
  async cambiarTemporales(chatId: number, usuarioId: number, opcion: MensajesTemporales): Promise<ResultadoTemporales> {
    const chat = await this.participante(chatId, usuarioId);
    if (chat.estado === 'rejected') throw new ForbiddenError('Este chat fue rechazado');
    await this.asegurarSinBloqueo(usuarioId, this.otroId(chat, usuarioId));

    const resultado: AvisoTemporales = { tipo: 'chat', id: chatId, mensajes_temporales: opcion, usuario_id: usuarioId };
    if (chat.mensajes_temporales === opcion) return { ...resultado, aviso: null };

    const yo = chat.usuario1_id === usuarioId ? chat.usuario1 : chat.usuario2;
    const creado = await sequelize.transaction(async (t) => {
      await this.repository.update(chat, { mensajes_temporales: opcion, ultima_interaccion: new Date() }, t);
      return this.mensajes.create(
        { chat_id: chatId, emisor_id: usuarioId, texto: textoAvisoTemporales(yo?.nombre_completo ?? 'Alguien', opcion), es_aviso: true },
        t,
      );
    });

    const aviso = await this.emitirNuevo(chat, creado.id);
    this.tiempoReal.aSala(salas.chat(chatId), EVENTO_TEMPORALES, resultado);
    this.tiempoReal.aUsuario(this.otroId(chat, usuarioId), EVENTO_TEMPORALES, resultado);
    return { ...resultado, aviso };
  }

  // ---------- Reacciones ----------

  /** Pone o cambia mi reacción a un mensaje del chat (una por persona). */
  async reaccionar(mensajeId: number, usuarioId: number, emoji: EmojiReaccion): Promise<ResultadoReaccionChat> {
    const { mensaje, chat } = await this.mensajeReaccionable(mensajeId, usuarioId);
    await this.reacciones.poner(mensaje.id, usuarioId, emoji);
    return this.avisarReaccion(chat, mensaje.id, usuarioId, emoji);
  }

  /** Quita mi reacción (si no tenía, devuelve el estado actual igual). */
  async quitarReaccion(mensajeId: number, usuarioId: number): Promise<ResultadoReaccionChat> {
    const { mensaje, chat } = await this.mensajeReaccionable(mensajeId, usuarioId);
    const quitadas = await this.reacciones.quitar(mensaje.id, usuarioId);
    if (!quitadas) return { chat_id: chat.id, mensaje_id: mensaje.id, reacciones: await this.reacciones.de(mensaje.id, usuarioId) };
    return this.avisarReaccion(chat, mensaje.id, usuarioId, null);
  }

  // ---------- Apoyo ----------

  /** Con un bloqueo de por medio (en cualquier sentido) no se puede abrir el chat ni escribir. */
  private async asegurarSinBloqueo(a: number, b: number): Promise<void> {
    if (await privacidadService.hayBloqueo(a, b)) throw new ForbiddenError('No puedes enviar mensajes a esta persona');
  }

  /** 404 si el chat no existe, 403 si el usuario no participa en él. */
  private async participante(chatId: number, usuarioId: number): Promise<Chat> {
    const chat = await this.repository.findByIdOrFail(chatId);
    if (chat.usuario1_id !== usuarioId && chat.usuario2_id !== usuarioId) {
      throw new ForbiddenError('No tienes permiso para ver este chat');
    }
    return chat;
  }

  /** Mensaje vigente, que no sea un aviso, de un chat donde participo y sin bloqueo. */
  private async mensajeReaccionable(mensajeId: number, usuarioId: number): Promise<{ mensaje: MensajeChat; chat: Chat }> {
    const mensaje = await this.mensajes.findByIdOrFail(mensajeId);
    if (vencido(mensaje)) throw new NotFoundError('Mensaje');
    const chat = await this.participante(mensaje.chat_id, usuarioId);
    if (mensaje.es_aviso) throw new BadRequestError('No se puede reaccionar a un aviso del chat');
    await this.asegurarSinBloqueo(usuarioId, this.otroId(chat, usuarioId));
    return { mensaje, chat };
  }

  private async avisarReaccion(chat: Chat, mensajeId: number, usuarioId: number, emoji: EmojiReaccion | null): Promise<ResultadoReaccionChat> {
    const reacciones = await this.reacciones.de(mensajeId, usuarioId);
    const aviso: AvisoReaccionChat = { chat_id: chat.id, mensaje_id: mensajeId, usuario_id: usuarioId, emoji, reacciones: sinMia(reacciones) };
    this.tiempoReal.aSala(salas.chat(chat.id), EVENTO_REACCION, aviso);
    this.tiempoReal.aUsuario(this.otroId(chat, usuarioId), EVENTO_REACCION, aviso);
    return { chat_id: chat.id, mensaje_id: mensajeId, reacciones };
  }

  /** Lee el mensaje recién creado y lo emite a la sala del chat y a la sala personal del otro. */
  private async emitirNuevo(chat: Chat, mensajeId: number): Promise<MensajeVista> {
    const guardado = await this.mensajes.findByIdOrFail(mensajeId);
    const mensaje: MensajeVista = { ...guardado.toJSON(), reacciones: [] };
    this.tiempoReal.aSala(salas.chat(chat.id), EVENTO_MENSAJE, mensaje);
    this.tiempoReal.aUsuario(this.otroId(chat, guardado.emisor_id), EVENTO_MENSAJE, { ...mensaje, is_global_notif: true });
    return mensaje;
  }

  /** Marca lo recibido como leído y, si cambió algo, avisa a la sala del chat y al otro participante. */
  private async marcarYAvisar(chat: Chat, lectorId: number): Promise<AvisoLeidos> {
    const lectura = await this.mensajes.marcarLeidos(chat.id, lectorId);
    const aviso: AvisoLeidos = { chat_id: chat.id, lector_id: lectorId, ...lectura };
    if (lectura.marcados > 0) {
      this.tiempoReal.aSala(salas.chat(chat.id), EVENTO_LEIDOS, aviso);
      this.tiempoReal.aUsuario(this.otroId(chat, lectorId), EVENTO_LEIDOS, aviso);
    }
    return aviso;
  }

  private otroId(chat: Chat, usuarioId: number): number {
    return chat.usuario1_id === usuarioId ? chat.usuario2_id : chat.usuario1_id;
  }

  private vista(chat: Chat, usuarioId: number, ultimo: MensajeChat | null, noLeidos: number): ChatVista {
    const { usuario1, usuario2, ...datos } = chat.toJSON() as ReturnType<Chat['toJSON']> & { usuario1?: object; usuario2?: object };
    return {
      ...datos,
      otro_usuario: (chat.usuario1_id === usuarioId ? usuario2 : usuario1) ?? null,
      ultimo_mensaje: ultimo
        ? {
            id: ultimo.id,
            texto: ultimo.texto,
            emisor_id: ultimo.emisor_id,
            tipo_archivo: ultimo.tipo_archivo,
            duracion_seg: ultimo.duracion_seg,
            leido: ultimo.leido,
            es_aviso: ultimo.es_aviso,
            fecha_creacion: ultimo.fecha_creacion,
          }
        : null,
      no_leidos: noLeidos,
    };
  }
}

export const chatService = new ChatService(
  chatRepository,
  mensajeChatRepository,
  usuarioRepository,
  realtime,
  dispositivoService,
  fileStorage,
);
