import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import {
  sequelize,
  type EmojiReaccion,
  type Grupo,
  type GrupoMiembro,
  type MensajeGrupo,
  type MensajesTemporales,
  type Usuario,
} from '../../infrastructure/database/models';
import type { AvisadorPush } from '../../infrastructure/push';
import { realtime, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { datosAdjunto, resumenAdjunto } from '../chat/adjuntos';
import { EVENTO_TEMPORALES, expiraEn, textoAvisoTemporales, vencido, type AvisoTemporales } from '../chat/mensajes-temporales';
import {
  conReacciones,
  reaccionMensajeGrupoRepository,
  sinMia,
  type ConteoReaccion,
  type ReaccionMensajeRepository,
  type ReaccionResumen,
} from '../chat/reacciones';
import { dispositivoService } from '../dispositivos/dispositivo.service';
import { grupoRepository, type GrupoRepository } from '../grupos/grupo.repository';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import type { EnviarMensajeGrupoDto, MensajesGrupoQuery } from './chat-grupo.schemas';
import { mensajeGrupoRepository, type MensajeGrupoRepository } from './mensaje-grupo.repository';
import { miembroChatGrupoRepository, type ATRIBUTOS_GRUPO_CHAT, type MiembroChatGrupoRepository } from './miembro-chat-grupo.repository';
import { asegurarTextoPermitido } from '../moderacion/palabras.service';

/** Mensaje nuevo en el chat de un grupo (llega a la sala personal de cada miembro activo, emisor incluido). */
export const EVENTO_MENSAJE_GRUPO = 'mensaje_grupo';
/** Un mensaje del grupo se eliminó para todos: { grupo_id, mensaje_id }. */
export const EVENTO_MENSAJE_GRUPO_ELIMINADO = 'mensaje_grupo_eliminado';
/** Alguien puso, cambió o quitó su reacción a un mensaje del grupo. */
export const EVENTO_REACCION_GRUPO = 'reaccion_mensaje_grupo';

/** Mensaje como lo recibe el frontend: con sus reacciones agrupadas por emoji. */
export type MensajeGrupoVista = ReturnType<MensajeGrupo['toJSON']> & {
  emisor?: Pick<Usuario, 'nombre_completo'> | null;
  reacciones: ReaccionResumen[];
};

/** Respuesta de PUT /:grupoId/leer. */
export interface LecturaGrupo {
  grupo_id: number;
  /** Lo que tenía leído antes de esta llamada (para el separador "Mensajes nuevos"). */
  anterior_leido_id: number | null;
  ultimo_mensaje_leido_id: number | null;
}

/** Fila de GET /no-leidos: un grupo mío con su chat resumido. */
export interface ResumenChatGrupo {
  grupo: Pick<Grupo, (typeof ATRIBUTOS_GRUPO_CHAT)[number]> | null;
  grupo_id: number;
  no_leidos: number;
  ultimo_mensaje_leido_id: number | null;
  ultimo_mensaje: object | null;
}

/** GET /:grupoId/ajustes: opciones del chat del grupo y si puedo cambiarlas. */
export interface AjustesChatGrupo {
  grupo_id: number;
  mensajes_temporales: MensajesTemporales;
  /** Admin o moderador del grupo. */
  puede_cambiar: boolean;
}

/** Payload de `reaccion_mensaje_grupo`: `emoji` null = la quitó. */
export interface AvisoReaccionGrupo {
  grupo_id: number;
  mensaje_id: number;
  usuario_id: number;
  emoji: EmojiReaccion | null;
  reacciones: ConteoReaccion[];
}

/** Respuesta de PUT/DELETE /:grupoId/mensajes/:mensajeId/reaccion. */
export interface ResultadoReaccionGrupo {
  grupo_id: number;
  mensaje_id: number;
  reacciones: ReaccionResumen[];
}

/** Respuesta de PUT /:grupoId/temporales. */
export type ResultadoTemporalesGrupo = AvisoTemporales & { aviso: MensajeGrupoVista | null };

const esModerador = (membresia: GrupoMiembro) => membresia.rol === 'admin' || membresia.rol === 'moderador';

export class ChatGrupoService extends BaseService<MensajeGrupo, MensajeGrupoRepository> {
  constructor(
    repository: MensajeGrupoRepository,
    private readonly miembros: MiembroChatGrupoRepository,
    private readonly grupos: GrupoRepository,
    private readonly tiempoReal: RealtimeGateway,
    private readonly push: AvisadorPush,
    private readonly storage: FileStorage,
    private readonly reacciones: ReaccionMensajeRepository = reaccionMensajeGrupoRepository,
    private readonly usuarios: UsuarioRepository = usuarioRepository,
  ) {
    super(repository);
  }

  // ---------- Consultas ----------

  /** Página de mensajes vigentes (los más nuevos primero), con reacciones. Solo miembros activos. */
  async mensajes(grupoId: number, usuarioId: number, { antes_de, limit }: MensajesGrupoQuery): Promise<Page<MensajeGrupoVista>> {
    await this.miembroActivo(grupoId, usuarioId);
    const page = antes_de ? await this.repository.pagina(grupoId, limit, antes_de) : await this.repository.pagina(grupoId, limit);
    const reacciones = await this.reacciones.resumenDe(
      page.items.map((m) => m.id),
      usuarioId,
    );
    return { ...page, items: conReacciones(page.items, reacciones) };
  }

  /** Mis grupos (miembro activo) con no leídos y último mensaje; el de actividad más reciente primero. */
  async noLeidos(usuarioId: number): Promise<ResumenChatGrupo[]> {
    const membresias = await this.miembros.activasDe(usuarioId);
    const ids = membresias.map((m) => m.grupo_id);
    const [ultimos, conteos] = await Promise.all([
      this.repository.ultimosPorGrupo(ids),
      this.repository.noLeidosPorGrupo(
        membresias.map((m) => ({ grupo_id: m.grupo_id, ultimo_leido_id: m.ultimo_mensaje_leido_id, desde: m.fecha_union })),
        usuarioId,
      ),
    ]);

    const resumenes = membresias.map((m): ResumenChatGrupo => {
      const ultimo = ultimos.get(m.grupo_id);
      return {
        grupo: m.grupo ? (m.grupo.toJSON() as ResumenChatGrupo['grupo']) : null,
        grupo_id: m.grupo_id,
        no_leidos: conteos.get(m.grupo_id) ?? 0,
        ultimo_mensaje_leido_id: m.ultimo_mensaje_leido_id,
        ultimo_mensaje: ultimo ? this.resumen(ultimo) : null,
      };
    });
    const idUltimo = (r: ResumenChatGrupo) => ultimos.get(r.grupo_id)?.id ?? 0;
    return resumenes.sort((a, b) => idUltimo(b) - idUltimo(a));
  }

  /** Opciones del chat del grupo (para el menú del chat). */
  async ajustes(grupoId: number, usuarioId: number): Promise<AjustesChatGrupo> {
    const { grupo, membresia } = await this.miembroActivo(grupoId, usuarioId);
    return { grupo_id: grupoId, mensajes_temporales: grupo.mensajes_temporales, puede_cambiar: esModerador(membresia) };
  }

  // ---------- Escritura ----------

  /** Envía texto y/o archivo (imagen, documento o nota de voz) y avisa a los demás miembros activos. */
  async enviar(grupoId: number, emisorId: number, { texto, duracion_seg }: EnviarMensajeGrupoDto, archivo?: ArchivoSubido): Promise<MensajeGrupoVista> {
    texto = await asegurarTextoPermitido(texto, 'mensaje');
    const { grupo, membresia } = await this.miembroActivo(grupoId, emisorId);
    const adjunto = datosAdjunto(texto, archivo, duracion_seg);

    const creado = await sequelize.transaction(async (t) => {
      const mensaje = await this.repository.create(
        { grupo_id: grupoId, emisor_id: emisorId, texto, ...adjunto, expira_en: expiraEn(grupo.mensajes_temporales) },
        t,
      );
      // Lo propio cuenta como leído
      await this.miembros.update(membresia, { ultimo_mensaje_leido_id: mensaje.id }, t);
      return mensaje;
    });

    const { mensaje, destinatarios } = await this.emitirNuevo(grupoId, creado.id);
    const aviso = {
      titulo: `${grupo.nombre} · ${mensaje.emisor?.nombre_completo ?? 'Alguien'}`,
      cuerpo: texto || resumenAdjunto(adjunto.tipo_archivo),
      datos: { tipo: 'mensaje_grupo', grupo_id: String(grupoId) },
    };
    await Promise.all(destinatarios.filter((id) => id !== emisorId).map((id) => this.push.avisar(id, aviso)));
    return mensaje;
  }

  /** Marca leído todo el chat del grupo hasta el último mensaje. */
  async leer(grupoId: number, usuarioId: number): Promise<LecturaGrupo> {
    const { membresia } = await this.miembroActivo(grupoId, usuarioId);
    const anterior = membresia.ultimo_mensaje_leido_id;
    const ultimo = await this.repository.ultimoId(grupoId);
    if (ultimo !== null && ultimo > (anterior ?? 0)) await this.miembros.update(membresia, { ultimo_mensaje_leido_id: ultimo });
    return { grupo_id: grupoId, anterior_leido_id: anterior, ultimo_mensaje_leido_id: membresia.ultimo_mensaje_leido_id };
  }

  /** Elimina un mensaje "para todos": su autor o un admin/moderador del grupo. */
  async eliminar(grupoId: number, mensajeId: number, usuarioId: number): Promise<{ grupo_id: number; mensaje_id: number }> {
    const { membresia } = await this.miembroActivo(grupoId, usuarioId);
    const mensaje = await this.repository.findOne({ id: mensajeId, grupo_id: grupoId });
    if (!mensaje) throw new NotFoundError('Mensaje');
    if (mensaje.emisor_id !== usuarioId && !esModerador(membresia)) throw new ForbiddenError('Solo puedes eliminar tus propios mensajes');

    await this.repository.delete({ id: mensaje.id });
    await this.storage.eliminar(mensaje.archivo_url);

    const aviso = { grupo_id: grupoId, mensaje_id: mensaje.id };
    for (const id of await this.miembros.idsActivos(grupoId)) this.tiempoReal.aUsuario(id, EVENTO_MENSAJE_GRUPO_ELIMINADO, aviso);
    return aviso;
  }

  // ---------- Mensajes temporales ----------

  /**
   * Un admin o moderador activa (24 h / 7 días) o apaga los mensajes temporales del chat del grupo.
   * Deja un aviso en la conversación (llega como `mensaje_grupo` con `es_aviso`) y emite `mensajes_temporales`
   * a cada miembro activo. Si la opción ya era esa, no hace nada (aviso null).
   */
  async cambiarTemporales(grupoId: number, usuarioId: number, opcion: MensajesTemporales): Promise<ResultadoTemporalesGrupo> {
    const { grupo, membresia } = await this.miembroActivo(grupoId, usuarioId);
    if (!esModerador(membresia)) throw new ForbiddenError('Solo los administradores del grupo cambian los mensajes temporales');

    const resultado: AvisoTemporales = { tipo: 'grupo', id: grupoId, mensajes_temporales: opcion, usuario_id: usuarioId };
    if (grupo.mensajes_temporales === opcion) return { ...resultado, aviso: null };

    const yo = await this.usuarios.findByIdOrFail(usuarioId);
    const creado = await sequelize.transaction(async (t) => {
      await this.grupos.update(grupo, { mensajes_temporales: opcion }, t);
      const mensaje = await this.repository.create(
        { grupo_id: grupoId, emisor_id: usuarioId, texto: textoAvisoTemporales(yo.nombre_completo, opcion), es_aviso: true },
        t,
      );
      await this.miembros.update(membresia, { ultimo_mensaje_leido_id: mensaje.id }, t);
      return mensaje;
    });

    const { mensaje, destinatarios } = await this.emitirNuevo(grupoId, creado.id);
    for (const id of destinatarios) this.tiempoReal.aUsuario(id, EVENTO_TEMPORALES, resultado);
    return { ...resultado, aviso: mensaje };
  }

  // ---------- Reacciones ----------

  /** Pone o cambia mi reacción a un mensaje del grupo (una por persona). */
  async reaccionar(grupoId: number, mensajeId: number, usuarioId: number, emoji: EmojiReaccion): Promise<ResultadoReaccionGrupo> {
    const mensaje = await this.mensajeReaccionable(grupoId, mensajeId, usuarioId);
    await this.reacciones.poner(mensaje.id, usuarioId, emoji);
    return this.avisarReaccion(grupoId, mensaje.id, usuarioId, emoji);
  }

  /** Quita mi reacción (si no tenía, devuelve el estado actual igual). */
  async quitarReaccion(grupoId: number, mensajeId: number, usuarioId: number): Promise<ResultadoReaccionGrupo> {
    const mensaje = await this.mensajeReaccionable(grupoId, mensajeId, usuarioId);
    const quitadas = await this.reacciones.quitar(mensaje.id, usuarioId);
    if (!quitadas) return { grupo_id: grupoId, mensaje_id: mensaje.id, reacciones: await this.reacciones.de(mensaje.id, usuarioId) };
    return this.avisarReaccion(grupoId, mensaje.id, usuarioId, null);
  }

  // ---------- Apoyo ----------

  /** 404 si el grupo no existe; 403 si el usuario no es miembro activo. */
  private async miembroActivo(grupoId: number, usuarioId: number): Promise<{ grupo: Grupo; membresia: GrupoMiembro }> {
    const grupo = await this.grupos.findByIdOrFail(grupoId);
    const membresia = await this.miembros.activa(grupoId, usuarioId);
    if (!membresia) throw new ForbiddenError('Solo los miembros del grupo pueden usar su chat');
    return { grupo, membresia };
  }

  /** Mensaje vigente del grupo que no sea un aviso; solo para miembros activos. */
  private async mensajeReaccionable(grupoId: number, mensajeId: number, usuarioId: number): Promise<MensajeGrupo> {
    await this.miembroActivo(grupoId, usuarioId);
    const mensaje = await this.repository.findOne({ id: mensajeId, grupo_id: grupoId });
    if (!mensaje || vencido(mensaje)) throw new NotFoundError('Mensaje');
    if (mensaje.es_aviso) throw new BadRequestError('No se puede reaccionar a un aviso del chat');
    return mensaje;
  }

  private async avisarReaccion(grupoId: number, mensajeId: number, usuarioId: number, emoji: EmojiReaccion | null): Promise<ResultadoReaccionGrupo> {
    const reacciones = await this.reacciones.de(mensajeId, usuarioId);
    const aviso: AvisoReaccionGrupo = { grupo_id: grupoId, mensaje_id: mensajeId, usuario_id: usuarioId, emoji, reacciones: sinMia(reacciones) };
    for (const id of await this.miembros.idsActivos(grupoId)) this.tiempoReal.aUsuario(id, EVENTO_REACCION_GRUPO, aviso);
    return { grupo_id: grupoId, mensaje_id: mensajeId, reacciones };
  }

  /** Lee el mensaje recién creado y lo emite a la sala personal de cada miembro activo (emisor incluido). */
  private async emitirNuevo(grupoId: number, mensajeId: number): Promise<{ mensaje: MensajeGrupoVista; destinatarios: number[] }> {
    const guardado = await this.repository.findByIdOrFail(mensajeId);
    const mensaje: MensajeGrupoVista = { ...guardado.toJSON(), reacciones: [] };
    const destinatarios = await this.miembros.idsActivos(grupoId);
    for (const id of destinatarios) this.tiempoReal.aUsuario(id, EVENTO_MENSAJE_GRUPO, mensaje);
    return { mensaje, destinatarios };
  }

  private resumen(mensaje: MensajeGrupo): object {
    const { id, texto, emisor_id, tipo_archivo, duracion_seg, es_aviso, fecha_creacion, emisor } = mensaje;
    return { id, texto, emisor_id, tipo_archivo, duracion_seg, es_aviso, fecha_creacion, emisor: emisor ?? null };
  }
}

export const chatGrupoService = new ChatGrupoService(
  mensajeGrupoRepository,
  miembroChatGrupoRepository,
  grupoRepository,
  realtime,
  dispositivoService,
  fileStorage,
);
