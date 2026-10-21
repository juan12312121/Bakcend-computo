import type { Server, Socket } from 'socket.io';
import { BadRequestError, ForbiddenError, NotFoundError, TooManyRequestsError } from '../../core/errors';
import type { ManejadorSocket } from '../../infrastructure/realtime/RealtimeGateway';
import { llamadaService, type LlamadaService, type UsuarioPublico } from '../llamadas/llamada.service';
import { ErrorSocket, escuchar } from '../llamadas/socket.utils';
import { registroTransmisiones, type EnVivo, type RegistroTransmisiones } from './transmision.registro';
import {
  COMENTARIOS_AL_ENTRAR,
  MAXIMO_ESPECTADORES,
  MS_ENTRE_COMENTARIOS,
  SEGUNDOS_GRACIA_ANFITRION,
  comentarSchema,
  reaccionSchema,
  senalTransmisionSchema,
  transmisionIdSchema,
  type CrearTransmisionDto,
  type ReaccionEnVivo,
  type SenalTransmisionDto,
} from './transmision.schemas';
import { transmisionService, type ComentarioEnVivo, type TransmisionService, type TransmisionVista } from './transmision.service';

/**
 * Eventos de Socket.IO de las transmisiones.
 * Cliente → servidor (con acuse): anfitrion, unirse, salir, senal, comentar, reaccion, terminar.
 * Servidor → cliente: espectador / espectador_salio (solo al anfitrión), contador, comentario, reaccion, senal,
 * anfitrion_reconectando, anfitrion_volvio, terminada.
 */
export const EVENTOS_TRANSMISION = {
  anfitrion: 'transmision:anfitrion',
  unirse: 'transmision:unirse',
  salir: 'transmision:salir',
  senal: 'transmision:senal',
  comentar: 'transmision:comentar',
  reaccion: 'transmision:reaccion',
  terminar: 'transmision:terminar',
  espectador: 'transmision:espectador',
  espectadorSalio: 'transmision:espectador_salio',
  contador: 'transmision:contador',
  comentario: 'transmision:comentario',
  terminada: 'transmision:terminada',
  anfitrionReconectando: 'transmision:anfitrion_reconectando',
  anfitrionVolvio: 'transmision:anfitrion_volvio',
} as const;

/** Sala de Socket.IO de una transmisión (anfitrión + espectadores). */
export const salaTransmision = (id: number) => `live_${id}`;

export type MotivoFinTransmision = 'anfitrion' | 'desconexion';

export interface OpcionesTransmisiones {
  maximoEspectadores: number;
  graciaAnfitrionMs: number;
  msEntreComentarios: number;
}

/** Respuesta al anfitrión: a quiénes ya están viendo (debe mandarles la oferta a cada uno). */
export interface EntradaAnfitrion {
  transmision: TransmisionVista;
  espectadores: UsuarioPublico[];
}

/** Respuesta al espectador: la transmisión y los últimos comentarios (el video llega por la oferta del anfitrión). */
export interface EntradaEspectador {
  transmision: TransmisionVista;
  comentarios: ComentarioEnVivo[];
  espectadores: number;
}

/**
 * Señalización de las transmisiones en vivo. Modelo uno-a-muchos en malla: el anfitrión abre una RTCPeerConnection
 * por espectador y le manda su cámara y micrófono (el espectador solo recibe). Sirve para audiencias chicas
 * (~20 personas: el límite es la subida del teléfono del anfitrión); para miles hace falta un servidor de medios
 * (SFU) como LiveKit, mediasoup o Janus, y esta señalización se reemplaza por la suya.
 */
export class SenalizacionTransmisiones {
  private io: Server | null = null;
  private readonly opciones: OpcionesTransmisiones;

  constructor(
    private readonly service: TransmisionService,
    private readonly perfiles: LlamadaService,
    private readonly registro: RegistroTransmisiones,
    opciones: Partial<OpcionesTransmisiones> = {},
    private readonly registrarError: (mensaje: string, error: unknown) => void = console.error,
  ) {
    this.opciones = {
      maximoEspectadores: MAXIMO_ESPECTADORES,
      graciaAnfitrionMs: SEGUNDOS_GRACIA_ANFITRION * 1000,
      msEntreComentarios: MS_ENTRE_COMENTARIOS,
      ...opciones,
    };
  }

  /** Lo registra el coordinador: `realtime.usar(manejadorTransmisiones)`. */
  readonly manejador: ManejadorSocket = (socket, { usuarioId, io }) => {
    this.io = io;
    const E = EVENTOS_TRANSMISION;
    escuchar(socket, E.anfitrion, transmisionIdSchema, usuarioId, (d, yo) => this.comoAnfitrion(socket, yo, d.transmision_id));
    escuchar(socket, E.unirse, transmisionIdSchema, usuarioId, (d, yo) => this.unirse(socket, yo, d.transmision_id));
    escuchar(socket, E.salir, transmisionIdSchema, usuarioId, (d, yo) => this.salir(socket, yo, d.transmision_id));
    escuchar(socket, E.senal, senalTransmisionSchema, usuarioId, (d, yo) => this.senal(socket, yo, d));
    escuchar(socket, E.comentar, comentarSchema, usuarioId, (d, yo) => this.comentar(socket, yo, d.transmision_id, d.texto));
    escuchar(socket, E.reaccion, reaccionSchema, usuarioId, (d, yo) => this.reaccionar(socket, yo, d.transmision_id, d.tipo));
    escuchar(socket, E.terminar, transmisionIdSchema, usuarioId, (d, yo) => this.terminar(d.transmision_id, yo));
    if (usuarioId !== undefined) socket.on('disconnect', () => this.desconectado(socket.id, usuarioId));
  };

  // ---------- REST (las llama el controlador) ----------

  /** Crea la transmisión y espera a que el anfitrión conecte su socket (si no llega, termina sola). */
  async iniciar(anfitrionId: number, datos: CrearTransmisionDto): Promise<TransmisionVista> {
    const vista = await this.service.iniciar(anfitrionId, datos);
    const enVivo = this.registro.obtenerOCrear(vista.id, anfitrionId);
    this.esperarAnfitrion(enVivo);
    return vista;
  }

  /** Solo el anfitrión. Avisa a todos los que la ven y los saca de la sala. */
  async terminar(id: number, usuarioId: number): Promise<{ transmision_id: number }>;
  async terminar(id: number, usuarioId: number, motivo: MotivoFinTransmision): Promise<{ transmision_id: number }>;
  async terminar(id: number, usuarioId: number, motivo: MotivoFinTransmision = 'anfitrion'): Promise<{ transmision_id: number }> {
    const enVivo = this.registro.obtener(id);
    const cerro = await this.service.finalizar(id, usuarioId, enVivo);
    this.registro.cerrar(id);
    if (cerro && this.io) {
      this.io.to(salaTransmision(id)).emit(EVENTOS_TRANSMISION.terminada, { transmision_id: id, motivo });
      this.io.in(salaTransmision(id)).socketsLeave(salaTransmision(id));
    }
    return { transmision_id: id };
  }

  /** Quiénes la están viendo ahora (solo el anfitrión). */
  async espectadoresDe(id: number, usuarioId: number): Promise<UsuarioPublico[]> {
    const transmision = await this.service.obtener(id);
    if (transmision.anfitrion_id !== usuarioId) throw new ForbiddenError('Solo quien transmite ve la lista de espectadores');
    return [...(this.registro.obtener(id)?.espectadores.values() ?? [])].map((e) => e.usuario);
  }

  ajustar(opciones: Partial<OpcionesTransmisiones>): void {
    Object.assign(this.opciones, opciones);
  }

  // ---------- Socket ----------

  /** El anfitrión conecta (o reconecta) el socket con el que manda el video. */
  private async comoAnfitrion(socket: Socket, yo: number, id: number): Promise<EntradaAnfitrion> {
    const transmision = await this.service.detalle(id, yo);
    if (!transmision.soy_anfitrion) throw new ForbiddenError('Solo quien transmite puede hacerlo');
    if (transmision.estado !== 'en_vivo') throw new BadRequestError('La transmisión ya terminó');

    const enVivo = this.registro.obtenerOCrear(id, yo);
    const volvio = enVivo.anfitrionSocket !== null && enVivo.anfitrionSocket !== socket.id;
    enVivo.anfitrionSocket = socket.id;
    if (enVivo.espera) clearTimeout(enVivo.espera);
    enVivo.espera = null;
    await socket.join(salaTransmision(id));
    if (volvio || enVivo.espectadores.size) socket.to(salaTransmision(id)).emit(EVENTOS_TRANSMISION.anfitrionVolvio, { transmision_id: id });
    return { transmision: { ...transmision, espectadores: enVivo.espectadores.size }, espectadores: [...enVivo.espectadores.values()].map((e) => e.usuario) };
  }

  private async unirse(socket: Socket, yo: number, id: number): Promise<EntradaEspectador> {
    const transmision = await this.service.detalle(id, yo);
    if (transmision.soy_anfitrion) throw new BadRequestError('Eres quien transmite: usa transmision:anfitrion');
    if (transmision.estado !== 'en_vivo') throw new BadRequestError('La transmisión ya terminó');

    const enVivo = this.registro.obtenerOCrear(id, transmision.anfitrion_id);
    const yaEstaba = enVivo.espectadores.get(yo);
    if (!yaEstaba && enVivo.espectadores.size >= this.opciones.maximoEspectadores) {
      throw new ErrorSocket(`La transmisión está llena (máximo ${this.opciones.maximoEspectadores} espectadores)`, 'llena');
    }
    const usuario = await this.perfiles.perfilActivo(yo);
    // Si la estaba viendo desde otro dispositivo, ese deja de recibirla.
    if (yaEstaba && yaEstaba.socketId !== socket.id) this.io?.sockets.sockets.get(yaEstaba.socketId)?.leave(salaTransmision(id));

    const total = this.registro.agregar(enVivo, { socketId: socket.id, usuario });
    await socket.join(salaTransmision(id));
    this.contador(enVivo);
    // El anfitrión crea una conexión para este espectador y le manda la oferta.
    if (enVivo.anfitrionSocket) this.io?.to(enVivo.anfitrionSocket).emit(EVENTOS_TRANSMISION.espectador, { transmision_id: id, usuario });
    return {
      transmision: { ...transmision, espectadores: total },
      comentarios: await this.service.recientes(id, COMENTARIOS_AL_ENTRAR),
      espectadores: total,
    };
  }

  private salir(socket: Socket, yo: number, id: number): { transmision_id: number } {
    const enVivo = this.registro.obtener(id);
    void socket.leave(salaTransmision(id));
    if (enVivo && enVivo.espectadores.get(yo)?.socketId === socket.id) this.quitarEspectador(enVivo, yo);
    return { transmision_id: id };
  }

  /** Señal WebRTC solo entre el anfitrión y un espectador actual de ESTA transmisión. */
  private senal(socket: Socket, yo: number, datos: SenalTransmisionDto): { entregada: true } {
    const enVivo = this.registro.obtener(datos.transmision_id);
    if (!enVivo) throw new NotFoundError('Transmisión', 'La transmisión ya terminó');

    let destino: string | null | undefined;
    if (yo === enVivo.anfitrionId) {
      if (enVivo.anfitrionSocket !== socket.id) throw new ForbiddenError('Este dispositivo no es el que transmite');
      destino = enVivo.espectadores.get(datos.para)?.socketId;
    } else {
      if (enVivo.espectadores.get(yo)?.socketId !== socket.id) throw new ForbiddenError('No estás viendo esta transmisión');
      destino = datos.para === enVivo.anfitrionId ? enVivo.anfitrionSocket : null;
    }
    if (!destino) throw new NotFoundError('Participante', 'Esa persona no está en la transmisión');

    this.io?.to(destino).emit(EVENTOS_TRANSMISION.senal, {
      transmision_id: datos.transmision_id,
      de: yo,
      tipo: datos.tipo,
      ...(datos.sdp !== undefined ? { sdp: datos.sdp } : {}),
      ...(datos.candidato ? { candidato: datos.candidato } : {}),
    });
    return { entregada: true };
  }

  /** Solo quien está en la sala (espectador o anfitrión). Se guarda y llega a todos. */
  private async comentar(socket: Socket, yo: number, id: number, texto: string): Promise<ComentarioEnVivo> {
    const enVivo = this.enSala(socket, id);
    const ahora = Date.now();
    if (ahora - (enVivo.ultimoComentario.get(yo) ?? 0) < this.opciones.msEntreComentarios) throw new TooManyRequestsError('Más despacio: espera un momento');
    enVivo.ultimoComentario.set(yo, ahora);
    const comentario = await this.service.comentar(id, yo, texto);
    this.io?.to(salaTransmision(id)).emit(EVENTOS_TRANSMISION.comentario, { transmision_id: id, comentario });
    return comentario;
  }

  /** Corazones y demás: no se guardan uno por uno, solo el total al terminar. */
  private reaccionar(socket: Socket, yo: number, id: number, tipo: ReaccionEnVivo): { transmision_id: number } {
    const enVivo = this.enSala(socket, id);
    enVivo.reacciones += 1;
    this.io?.to(salaTransmision(id)).emit(EVENTOS_TRANSMISION.reaccion, { transmision_id: id, usuario_id: yo, tipo });
    return { transmision_id: id };
  }

  // ---------- Desconexiones ----------

  private desconectado(socketId: string, usuarioId: number): void {
    for (const enVivo of this.registro.todas()) {
      if (enVivo.espectadores.get(usuarioId)?.socketId === socketId) this.quitarEspectador(enVivo, usuarioId);
      if (enVivo.anfitrionId === usuarioId && enVivo.anfitrionSocket === socketId) {
        enVivo.anfitrionSocket = null;
        this.io?.to(salaTransmision(enVivo.id)).emit(EVENTOS_TRANSMISION.anfitrionReconectando, { transmision_id: enVivo.id });
        this.esperarAnfitrion(enVivo);
      }
    }
  }

  /** Si el anfitrión no (re)conecta su socket a tiempo, la transmisión termina sola. */
  private esperarAnfitrion(enVivo: EnVivo): void {
    if (enVivo.espera) clearTimeout(enVivo.espera);
    enVivo.espera = setTimeout(() => {
      enVivo.espera = null;
      if (this.registro.obtener(enVivo.id) !== enVivo || enVivo.anfitrionSocket) return;
      this.terminar(enVivo.id, enVivo.anfitrionId, 'desconexion').catch((error: unknown) =>
        this.registrarError('[transmisiones] No se pudo terminar la transmisión abandonada', error),
      );
    }, this.opciones.graciaAnfitrionMs);
    enVivo.espera.unref?.();
  }

  // ---------- Apoyo ----------

  private quitarEspectador(enVivo: EnVivo, usuarioId: number): void {
    enVivo.espectadores.delete(usuarioId);
    this.contador(enVivo);
    if (enVivo.anfitrionSocket) this.io?.to(enVivo.anfitrionSocket).emit(EVENTOS_TRANSMISION.espectadorSalio, { transmision_id: enVivo.id, usuario_id: usuarioId });
  }

  private contador(enVivo: EnVivo): void {
    this.io?.to(salaTransmision(enVivo.id)).emit(EVENTOS_TRANSMISION.contador, { transmision_id: enVivo.id, espectadores: enVivo.espectadores.size });
  }

  private enSala(socket: Socket, id: number): EnVivo {
    const enVivo = this.registro.obtener(id);
    if (!enVivo || !socket.rooms.has(salaTransmision(id))) throw new ForbiddenError('No estás en esta transmisión');
    return enVivo;
  }
}

export const senalizacionTransmisiones = new SenalizacionTransmisiones(transmisionService, llamadaService, registroTransmisiones);

/** Para server.ts: `realtime.usar(manejadorTransmisiones)` antes de `realtime.adjuntar(...)`. */
export const manejadorTransmisiones: ManejadorSocket = senalizacionTransmisiones.manejador;
