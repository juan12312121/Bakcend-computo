/**
 * Cómo la moderación lee, oculta o borra cada tipo de contenido reportable (patrón estrategia).
 * Cada proveedor reutiliza el servicio dueño del contenido para no saltarse sus reglas
 * (contadores, archivos de Cloudinary, avisos en tiempo real).
 * Otros módulos (p. ej. canales) registran el suyo con `moderacionService.registrarProveedor(...)`.
 */
import { ForbiddenError, NotFoundError } from '../../core/errors';
import type { CopiaContenido, TipoContenidoReportable } from '../../infrastructure/database/models';
import { chatRepository, type ChatRepository } from '../chat/chat.repository';
import { chatService, type ChatService } from '../chat/chat.service';
import { mensajeChatRepository, type MensajeChatRepository } from '../chat/mensaje-chat.repository';
import { chatGrupoService, type ChatGrupoService } from '../chat-grupo/chat-grupo.service';
import { mensajeGrupoRepository, type MensajeGrupoRepository } from '../chat-grupo/mensaje-grupo.repository';
import { miembroChatGrupoRepository, type MiembroChatGrupoRepository } from '../chat-grupo/miembro-chat-grupo.repository';
import { comentarioRepository, type ComentarioRepository } from '../comentarios/comentario.repository';
import { comentarioService, type ComentarioService } from '../comentarios/comentario.service';
import { eventoRepository, type EventoRepository } from '../eventos/evento.repository';
import { eventoService, type EventoService } from '../eventos/evento.service';
import { grupoRepository, type GrupoRepository } from '../grupos/grupo.repository';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { publicacionService, type PublicacionService } from '../publicaciones/publicacion.service';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { copiaPublicacion } from './copias';

/** Acciones sobre el contenido mismo (advertir y suspender son sobre el autor y valen para todos). */
export type AccionSobreContenido = 'ocultar' | 'borrar';

export interface ContenidoParaReportar {
  autor_id: number | null;
  copia: CopiaContenido;
}

export interface ProveedorContenido {
  readonly tipo: TipoContenidoReportable;
  /** Qué se puede hacer con el contenido desde la bandeja. */
  readonly acciones: readonly AccionSobreContenido[];
  /** Comprueba que el usuario puede verlo (404/403 si no) y devuelve autor y copia. */
  paraReportar(id: number, usuarioId: number): Promise<ContenidoParaReportar>;
  existe(id: number): Promise<boolean>;
  ocultar?(id: number, adminId: number): Promise<void>;
  borrar?(id: number, adminId: number): Promise<void>;
}

/** Publicaciones: el reporte se crea con ReporteService (umbral de ocultado); aquí solo moderación. */
export class ProveedorPublicacion implements ProveedorContenido {
  readonly tipo = 'publicacion' as const;
  readonly acciones = ['ocultar', 'borrar'] as const;

  constructor(
    private readonly repositorio: PublicacionRepository,
    private readonly servicio: PublicacionService,
  ) {}

  async paraReportar(id: number, usuarioId: number): Promise<ContenidoParaReportar> {
    const p = await this.repositorio.findVisibleOrFail(id, usuarioId);
    return { autor_id: p.usuario_id, copia: copiaPublicacion(p) };
  }

  existe(id: number): Promise<boolean> {
    return this.repositorio.exists({ id });
  }

  async ocultar(id: number): Promise<void> {
    await this.repositorio.update(id, { oculto: true });
  }

  async borrar(id: number, adminId: number): Promise<void> {
    await this.servicio.eliminar(id, adminId, { comoAdmin: true });
  }
}

export class ProveedorComentario implements ProveedorContenido {
  readonly tipo = 'comentario' as const;
  readonly acciones = ['borrar'] as const;

  constructor(
    private readonly repositorio: ComentarioRepository,
    private readonly servicio: ComentarioService,
  ) {}

  async paraReportar(id: number, usuarioId: number): Promise<ContenidoParaReportar> {
    await this.servicio.obtenerVisible(id, usuarioId);
    const c = await this.repositorio.findByIdOrFail(id, { include: [] });
    return { autor_id: c.usuario_id, copia: { texto: c.texto, contexto: { publicacion_id: c.publicacion_id, padre_id: c.padre_id ?? null } } };
  }

  existe(id: number): Promise<boolean> {
    return this.repositorio.exists({ id });
  }

  /** Se borra con el flujo normal "como su autor" (descuenta contadores y retira avisos). */
  async borrar(id: number): Promise<void> {
    const c = await this.repositorio.findByIdOrFail(id, { include: [] });
    await this.servicio.eliminar(id, c.usuario_id);
  }
}

export class ProveedorMensajeChat implements ProveedorContenido {
  readonly tipo = 'mensaje_chat' as const;
  readonly acciones = ['borrar'] as const;

  constructor(
    private readonly mensajes: MensajeChatRepository,
    private readonly chats: ChatRepository,
    private readonly servicio: ChatService,
  ) {}

  /** Solo quienes participan en el chat pueden reportar sus mensajes. */
  async paraReportar(id: number, usuarioId: number): Promise<ContenidoParaReportar> {
    const m = await this.mensajes.findByIdOrFail(id, { include: [] });
    if (!(await this.chats.esParticipante(m.chat_id, usuarioId))) {
      throw new ForbiddenError('Solo quienes participan en el chat pueden reportar sus mensajes');
    }
    return {
      autor_id: m.emisor_id,
      copia: { texto: m.texto ?? '', archivo_url: m.archivo_url ?? null, tipo_archivo: m.tipo_archivo ?? null, contexto: { chat_id: m.chat_id } },
    };
  }

  existe(id: number): Promise<boolean> {
    return this.mensajes.exists({ id });
  }

  /** "Eliminar para todos" en nombre de su emisor (borra el archivo y avisa por socket). */
  async borrar(id: number): Promise<void> {
    const m = await this.mensajes.findByIdOrFail(id, { include: [] });
    await this.servicio.eliminarMensaje(id, m.emisor_id);
  }
}

export class ProveedorMensajeGrupo implements ProveedorContenido {
  readonly tipo = 'mensaje_grupo' as const;
  readonly acciones = ['borrar'] as const;

  constructor(
    private readonly mensajes: MensajeGrupoRepository,
    private readonly miembros: MiembroChatGrupoRepository,
    private readonly servicio: ChatGrupoService,
  ) {}

  /** Solo los miembros activos del grupo pueden reportar sus mensajes. */
  async paraReportar(id: number, usuarioId: number): Promise<ContenidoParaReportar> {
    const m = await this.mensajes.findByIdOrFail(id, { include: [] });
    if (!(await this.miembros.activa(m.grupo_id, usuarioId))) {
      throw new ForbiddenError('Solo los miembros del grupo pueden reportar sus mensajes');
    }
    return {
      autor_id: m.emisor_id,
      copia: { texto: m.texto ?? '', archivo_url: m.archivo_url ?? null, tipo_archivo: m.tipo_archivo ?? null, contexto: { grupo_id: m.grupo_id } },
    };
  }

  existe(id: number): Promise<boolean> {
    return this.mensajes.exists({ id });
  }

  /** En nombre de un admin del grupo no hace falta: si el emisor ya salió del grupo, se borra directo. */
  async borrar(id: number): Promise<void> {
    const m = await this.mensajes.findByIdOrFail(id, { include: [] });
    try {
      await this.servicio.eliminar(m.grupo_id, id, m.emisor_id);
    } catch (error) {
      if (!(error instanceof ForbiddenError)) throw error;
      await this.mensajes.delete({ id });
    }
  }
}

export class ProveedorUsuario implements ProveedorContenido {
  readonly tipo = 'usuario' as const;
  readonly acciones = [] as const;

  constructor(private readonly usuarios: UsuarioRepository) {}

  async paraReportar(id: number): Promise<ContenidoParaReportar> {
    const u = await this.usuarios.findById(id);
    if (!u || !u.activo) throw new NotFoundError('Usuario');
    return {
      autor_id: u.id,
      copia: {
        texto: u.biografia ?? '',
        titulo: `${u.nombre_completo} (@${u.nombre_usuario})`,
        imagen_url: u.foto_perfil_url ?? null,
        contexto: { nombre_usuario: u.nombre_usuario },
      },
    };
  }

  existe(id: number): Promise<boolean> {
    return this.usuarios.exists({ id, activo: true });
  }
}

export class ProveedorGrupo implements ProveedorContenido {
  readonly tipo = 'grupo' as const;
  readonly acciones = ['borrar'] as const;

  constructor(private readonly grupos: GrupoRepository) {}

  async paraReportar(id: number): Promise<ContenidoParaReportar> {
    const g = await this.grupos.findByIdOrFail(id, { include: [] });
    return {
      autor_id: g.creador_id,
      copia: { texto: g.descripcion ?? '', titulo: g.nombre, imagen_url: g.imagen_url ?? null, contexto: { tipo: g.tipo, privacidad: g.privacidad } },
    };
  }

  existe(id: number): Promise<boolean> {
    return this.grupos.exists({ id });
  }

  /** Borra el grupo; miembros, mensajes y publicaciones se van en cascada. */
  async borrar(id: number): Promise<void> {
    await this.grupos.delete(id);
  }
}

export class ProveedorEvento implements ProveedorContenido {
  readonly tipo = 'evento' as const;
  readonly acciones = ['borrar'] as const;

  constructor(
    private readonly eventos: EventoRepository,
    private readonly servicio: EventoService,
  ) {}

  async paraReportar(id: number, usuarioId: number): Promise<ContenidoParaReportar> {
    await this.servicio.detalle(id, usuarioId);
    const e = await this.eventos.findByIdOrFail(id, { include: [] });
    return {
      autor_id: e.creador_id,
      copia: {
        texto: e.descripcion ?? '',
        titulo: e.titulo,
        imagen_url: e.portada_url ?? null,
        contexto: { inicio: new Date(e.inicio).toISOString(), lugar: e.lugar ?? null, grupo_id: e.grupo_id ?? null },
      },
    };
  }

  existe(id: number): Promise<boolean> {
    return this.eventos.exists({ id });
  }

  /** Borra con el flujo normal en nombre de quien lo organiza (también quita la portada). */
  async borrar(id: number): Promise<void> {
    const e = await this.eventos.findByIdOrFail(id, { include: [] });
    await this.servicio.eliminar(id, e.creador_id);
  }
}

/** Proveedores incluidos. 'publicacion_canal' lo registra el módulo de canales. */
export function proveedoresPorDefecto(): ProveedorContenido[] {
  return [
    new ProveedorPublicacion(publicacionRepository, publicacionService),
    new ProveedorComentario(comentarioRepository, comentarioService),
    new ProveedorMensajeChat(mensajeChatRepository, chatRepository, chatService),
    new ProveedorMensajeGrupo(mensajeGrupoRepository, miembroChatGrupoRepository, chatGrupoService),
    new ProveedorUsuario(usuarioRepository),
    new ProveedorGrupo(grupoRepository),
    new ProveedorEvento(eventoRepository, eventoService),
  ];
}
