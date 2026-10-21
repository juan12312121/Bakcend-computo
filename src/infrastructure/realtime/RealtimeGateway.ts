import type { Server as HttpServer } from 'http';
import { Server, type Socket } from 'socket.io';
import { origenesPermitidos } from '../../config/cors';
import { tokenService, type TokenService } from '../security/TokenService';

/** Lo que los servicios necesitan para avisar en tiempo real (no dependen de Socket.IO). */
export interface RealtimeGateway {
  aTodos(evento: string, data: unknown): void;
  aSala(sala: string, evento: string, data: unknown): void;
  aUsuario(usuarioId: number, evento: string, data: unknown): void;
}

export const salas = {
  usuario: (id: number) => `user_${id}`,
  chat: (id: number) => `chat_${id}`,
  grupo: (id: number) => `group_${id}`,
  tablero: (id: number) => `board_${id}`,
};

/** Evento que reenvía el servidor cuando alguien escribe en un chat o en el chat de un grupo. */
export const EVENTO_ESCRIBIENDO = 'escribiendo';

export interface AvisoEscribiendo {
  tipo: 'chat' | 'grupo';
  id: number;
  /** true al empezar a escribir, false al parar o enviar. */
  activo: boolean;
}

/**
 * Reglas para entrar a salas privadas. Las aportan los módulos (chat, grupos) al arrancar el servidor,
 * así la infraestructura no depende de la lógica de negocio.
 */
export interface PermisosDeSalas {
  puedeEntrarAChat(chatId: number, usuarioId: number): Promise<boolean>;
  puedeEntrarAGrupo(grupoId: number, usuarioId: number | undefined): Promise<boolean>;
  puedeEntrarATablero(tableroId: number, usuarioId: number): Promise<boolean>;
}

interface DatosSocket {
  usuarioId?: number;
}

/**
 * Lo que recibe un módulo que necesita escuchar eventos propios del cliente (señalización de llamadas,
 * transmisiones, documentos compartidos...). `usuarioId` es undefined si el socket no tiene sesión.
 */
export interface ContextoSocket {
  usuarioId: number | undefined;
  io: Server;
}

/** Manejador que se instala en cada conexión nueva: socket.on('mi_evento', ...). */
export type ManejadorSocket = (socket: Socket, contexto: ContextoSocket) => void;

/**
 * Implementación con Socket.IO.
 * - El cliente se identifica con el JWT en `auth.token` (o `?token=`); sin token queda como anónimo
 *   y solo recibe eventos públicos (nuevas publicaciones, likes).
 * - Con token entra automáticamente a su sala personal; nadie puede entrar a la sala de otro.
 * - `join_chat` / `join_group` / `join_board` se validan con PermisosDeSalas; si no tiene permiso, se responde `sala_denegada`.
 * - `escribiendo` { tipo: 'chat' | 'grupo', id, activo }: se reenvía a los demás de esa sala (solo si ya está en ella)
 *   como `escribiendo` { tipo, id, activo, usuarioId }.
 * Mientras no se adjunta un servidor HTTP, no emite nada (útil en pruebas).
 */
export class SocketGateway implements RealtimeGateway {
  private io: Server | null = null;
  private readonly manejadores: ManejadorSocket[] = [];

  constructor(private readonly tokens: TokenService) {}

  adjuntar(server: HttpServer, permisos: PermisosDeSalas): Server {
    this.io = new Server(server, {
      cors: { origin: [...origenesPermitidos], methods: ['GET', 'POST'], credentials: true },
    });

    this.io.use((socket, next) => {
      const token = this.tokenDe(socket);
      if (!token) return next();
      try {
        (socket.data as DatosSocket).usuarioId = this.tokens.verificar(token).id;
        next();
      } catch {
        next(new Error('Token inválido o expirado'));
      }
    });

    this.io.on('connection', (socket) => {
      const { usuarioId } = socket.data as DatosSocket;
      if (usuarioId) void socket.join(salas.usuario(usuarioId));

      socket.on('join_chat', async (id: unknown) => {
        const chatId = Number(id);
        const permitido = usuarioId !== undefined && chatId > 0 && (await permisos.puedeEntrarAChat(chatId, usuarioId));
        if (permitido) void socket.join(salas.chat(chatId));
        else socket.emit('sala_denegada', { sala: 'chat', id: chatId });
      });
      socket.on('leave_chat', (id: unknown) => void socket.leave(salas.chat(Number(id))));

      socket.on('join_group', async (id: unknown) => {
        const grupoId = Number(id);
        const permitido = grupoId > 0 && (await permisos.puedeEntrarAGrupo(grupoId, usuarioId));
        if (permitido) void socket.join(salas.grupo(grupoId));
        else socket.emit('sala_denegada', { sala: 'grupo', id: grupoId });
      });
      socket.on('leave_group', (id: unknown) => void socket.leave(salas.grupo(Number(id))));

      socket.on('join_board', async (id: unknown) => {
        const tableroId = Number(id);
        const permitido = usuarioId !== undefined && tableroId > 0 && (await permisos.puedeEntrarATablero(tableroId, usuarioId));
        if (permitido) void socket.join(salas.tablero(tableroId));
        else socket.emit('sala_denegada', { sala: 'tablero', id: tableroId });
      });
      socket.on('leave_board', (id: unknown) => void socket.leave(salas.tablero(Number(id))));

      for (const manejador of this.manejadores) manejador(socket, { usuarioId, io: this.io as Server });

      socket.on(EVENTO_ESCRIBIENDO, (aviso: Partial<AvisoEscribiendo> | undefined) => {
        if (usuarioId === undefined || !aviso || (aviso.tipo !== 'chat' && aviso.tipo !== 'grupo')) return;
        const id = Number(aviso.id);
        const sala = aviso.tipo === 'chat' ? salas.chat(id) : salas.grupo(id);
        // Solo quien ya entró a la sala (con permiso) puede avisar que escribe.
        if (!socket.rooms.has(sala)) return;
        socket.to(sala).emit(EVENTO_ESCRIBIENDO, { tipo: aviso.tipo, id, activo: aviso.activo === true, usuarioId });
      });
    });

    return this.io;
  }

  /**
   * Agrega eventos propios de un módulo a cada conexión (se llama antes de `adjuntar`, desde server.ts).
   * El módulo valida permisos dentro de su manejador; la infraestructura no conoce la lógica.
   */
  usar(manejador: ManejadorSocket): this {
    this.manejadores.push(manejador);
    return this;
  }

  /** ¿El usuario tiene al menos un socket conectado? (p. ej. para decidir si mandar push de una llamada). */
  async estaConectado(usuarioId: number): Promise<boolean> {
    if (!this.io) return false;
    return (await this.io.in(salas.usuario(usuarioId)).fetchSockets()).length > 0;
  }

  aTodos(evento: string, data: unknown): void {
    this.io?.emit(evento, data);
  }

  aSala(sala: string, evento: string, data: unknown): void {
    this.io?.to(sala).emit(evento, data);
  }

  aUsuario(usuarioId: number, evento: string, data: unknown): void {
    this.aSala(salas.usuario(usuarioId), evento, data);
  }

  private tokenDe(socket: Socket): string | undefined {
    const desdeAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const desdeQuery = socket.handshake.query.token;
    const token = typeof desdeAuth === 'string' ? desdeAuth : typeof desdeQuery === 'string' ? desdeQuery : undefined;
    return token?.replace(/^Bearer /, '') || undefined;
  }
}

export const realtime = new SocketGateway(tokenService);
