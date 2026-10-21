import type { Server, Socket } from 'socket.io';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { TipoLlamada } from '../../infrastructure/database/models';
import type { AvisadorPush } from '../../infrastructure/push';
import { salas, type ManejadorSocket } from '../../infrastructure/realtime/RealtimeGateway';
import { dispositivoService } from '../dispositivos/dispositivo.service';
import {
  MAXIMO_PARTICIPANTES,
  SEGUNDOS_GRACIA_DESCONEXION,
  SEGUNDOS_SIN_RESPUESTA,
  iniciarLlamadaSchema,
  llamadaIdSchema,
  mediosSchema,
  senalSchema,
  type IniciarLlamadaDto,
  type MediosDto,
  type SenalDto,
} from './llamada.schemas';
import { llamadaService, type GrupoResumen, type LlamadaService, type UsuarioPublico } from './llamada.service';
import { ErrorSocket, OcupadoError, conectado, escuchar } from './socket.utils';

/**
 * Nombres de los eventos de Socket.IO de las llamadas.
 * Cliente → servidor (todos con acuse { ok, data } | { ok: false, error, codigo }): iniciar, sonando, aceptar,
 * rechazar, colgar, senal, medios, retomar, pendientes.
 * Servidor → cliente: entrante, sonando, unido, salio, rechazada, terminada, cancelada, senal, medios,
 * reconectando, reconectado.
 */
export const EVENTOS_LLAMADA = {
  iniciar: 'llamada:iniciar',
  sonando: 'llamada:sonando',
  aceptar: 'llamada:aceptar',
  rechazar: 'llamada:rechazar',
  colgar: 'llamada:colgar',
  senal: 'llamada:senal',
  medios: 'llamada:medios',
  retomar: 'llamada:retomar',
  pendientes: 'llamada:pendientes',
  entrante: 'llamada:entrante',
  unido: 'llamada:unido',
  salio: 'llamada:salio',
  rechazada: 'llamada:rechazada',
  terminada: 'llamada:terminada',
  cancelada: 'llamada:cancelada',
  reconectando: 'llamada:reconectando',
  reconectado: 'llamada:reconectado',
} as const;

/** Por qué terminó (o dejó de sonar) una llamada. */
export type MotivoLlamada = 'colgo' | 'sin_respuesta' | 'rechazada' | 'desconexion' | 'contestada_en_otro_dispositivo';

/** Llamada en curso tal como la recibe el cliente. */
export interface LlamadaEnVivo {
  id: number;
  tipo: TipoLlamada;
  /** sonando: nadie ha contestado todavía · en_curso: ya hay al menos dos personas dentro. */
  estado: 'sonando' | 'en_curso';
  grupo: GrupoResumen | null;
  iniciador: UsuarioPublico;
  /** Quienes están dentro ahora (con conexión WebRTC entre todos). */
  presentes: UsuarioPublico[];
  /** Ids de a quienes todavía les está sonando. */
  sonando: number[];
  /** A quienes se llamó (para mostrar a quién llamo mientras suena). */
  invitados: UsuarioPublico[];
  /** Máximo de personas dentro (malla). */
  maximo: number;
  creada_en: string;
}

/** Respuesta de aceptar / retomar: la llamada y con quiénes hay que negociar (quien entra manda la oferta). */
export interface EntradaLlamada {
  llamada: LlamadaEnVivo;
  presentes: UsuarioPublico[];
}

export interface OpcionesSenalizacion {
  tiempoLimiteMs: number;
  graciaMs: number;
  maximoParticipantes: number;
}

/** Estado en memoria de una llamada que todavía no termina. */
interface LlamadaActiva {
  id: number;
  tipo: TipoLlamada;
  grupo: GrupoResumen | null;
  iniciador: UsuarioPublico;
  /** usuarioId → id del socket con el que está dentro (la señalización va solo a ese socket). */
  presentes: Map<number, string>;
  /** A quienes les sigue sonando. */
  pendientes: Set<number>;
  /** A quienes les sonó (pueden contestar). En un grupo también entra cualquier miembro activo. */
  invitados: Set<number>;
  /** Datos públicos de todos los que aparecen en la llamada. */
  usuarios: Map<number, UsuarioPublico>;
  /** Alguien llegó a contestar. */
  contestada: boolean;
  creada: Date;
  temporizador: NodeJS.Timeout | null;
  /** Desconexiones en espera de `retomar`. */
  gracias: Map<number, NodeJS.Timeout>;
  cerrando: boolean;
}

const ETIQUETA: Record<TipoLlamada, string> = { audio: 'Llamada', video: 'Videollamada' };

/**
 * Señalización WebRTC de las llamadas por Socket.IO. El servidor nunca toca el audio ni el video: solo decide quién
 * puede hablar con quién y reenvía ofertas, respuestas y candidatos ICE ENTRE LOS SOCKETS que están dentro de la llamada.
 * Llamadas de grupo en malla: cada quien abre una RTCPeerConnection con cada uno de los demás (hasta 8 personas);
 * quien entra recibe la lista de presentes y les manda la oferta a todos.
 * El estado vive en memoria de este proceso (con varias instancias haría falta el adaptador de Redis y estado compartido).
 */
export class SenalizacionLlamadas {
  private io: Server | null = null;
  private readonly activas = new Map<number, LlamadaActiva>();
  private readonly opciones: OpcionesSenalizacion;

  constructor(
    private readonly service: LlamadaService,
    private readonly push: AvisadorPush,
    opciones: Partial<OpcionesSenalizacion> = {},
    private readonly registrarError: (mensaje: string, error: unknown) => void = console.error,
  ) {
    this.opciones = {
      tiempoLimiteMs: SEGUNDOS_SIN_RESPUESTA * 1000,
      graciaMs: SEGUNDOS_GRACIA_DESCONEXION * 1000,
      maximoParticipantes: MAXIMO_PARTICIPANTES,
      ...opciones,
    };
  }

  /** Lo registra el coordinador: `realtime.usar(manejadorLlamadas)`. */
  readonly manejador: ManejadorSocket = (socket, { usuarioId, io }) => {
    this.io = io;
    const E = EVENTOS_LLAMADA;
    escuchar(socket, E.iniciar, iniciarLlamadaSchema, usuarioId, (datos, yo) => this.iniciar(socket, yo, datos));
    escuchar(socket, E.sonando, llamadaIdSchema, usuarioId, (datos, yo) => this.sonando(yo, datos.llamada_id));
    escuchar(socket, E.aceptar, llamadaIdSchema, usuarioId, (datos, yo) => this.aceptar(socket, yo, datos.llamada_id));
    escuchar(socket, E.rechazar, llamadaIdSchema, usuarioId, (datos, yo) => this.rechazar(yo, datos.llamada_id));
    escuchar(socket, E.colgar, llamadaIdSchema, usuarioId, (datos, yo) => this.colgar(yo, datos.llamada_id));
    escuchar(socket, E.senal, senalSchema, usuarioId, (datos, yo) => this.senal(socket, yo, datos));
    escuchar(socket, E.medios, mediosSchema, usuarioId, (datos, yo) => this.medios(socket, yo, datos));
    escuchar(socket, E.retomar, llamadaIdSchema, usuarioId, (datos, yo) => this.retomar(socket, yo, datos.llamada_id));
    escuchar(socket, E.pendientes, llamadaIdSchema.partial(), usuarioId, (_datos, yo) => this.sonandoPara(yo).map((a) => this.vista(a)));

    if (usuarioId === undefined) return;
    socket.on('disconnect', () => this.desconectado(socket.id, usuarioId));
    // Abrió la app (p. ej. desde la push): si le está sonando algo, que lo vea de inmediato.
    for (const activa of this.sonandoPara(usuarioId)) socket.emit(E.entrante, { llamada: this.vista(activa) });
  };

  // ---------- Consultas (también para REST) ----------

  /** ¿Está dentro de una llamada o le suena una llamada 1 a 1? */
  ocupado(usuarioId: number): boolean {
    for (const a of this.activas.values()) {
      if (a.presentes.has(usuarioId) || (!a.grupo && a.pendientes.has(usuarioId))) return true;
    }
    return false;
  }

  /** La llamada en curso de un grupo (solo para sus miembros activos), o null. */
  async activaDeGrupo(grupoId: number, usuarioId: number): Promise<LlamadaEnVivo | null> {
    if (!(await this.service.esMiembroActivo(grupoId, usuarioId))) throw new ForbiddenError('Solo los miembros del grupo pueden ver sus llamadas');
    const activa = this.deGrupo(grupoId);
    return activa ? this.vista(activa) : null;
  }

  /** Cambia tiempos o el máximo (las pruebas usan tiempos cortos). Afecta a las llamadas nuevas. */
  ajustar(opciones: Partial<OpcionesSenalizacion>): void {
    Object.assign(this.opciones, opciones);
  }

  /** Para pruebas: suelta todos los temporizadores y olvida las llamadas en memoria. */
  reiniciar(): void {
    for (const a of this.activas.values()) this.soltarTemporizadores(a);
    this.activas.clear();
  }

  // ---------- Acciones ----------

  private async iniciar(socket: Socket, yo: number, datos: IniciarLlamadaDto): Promise<{ llamada: LlamadaEnVivo }> {
    if (this.dentroDe(yo)) throw new BadRequestError('Ya estás en una llamada');
    const iniciador = await this.service.perfilActivo(yo);
    const destino = await this.service.destinoDe(yo, datos);

    if (destino.grupo) {
      const existente = this.deGrupo(destino.grupo.id);
      if (existente) throw new ErrorSocket('Ya hay una llamada en curso en este grupo: únete a ella', 'conflicto', 409, { llamada_id: existente.id });
    } else {
      const otro = destino.destinatarios[0];
      if (this.ocupado(otro.id)) {
        // Queda en su historial como perdida y le llega la notificación.
        const registro = await this.service.registrar(yo, datos.tipo, destino, [otro.id]);
        await this.service.finalizar(registro.id, 'perdida');
        await this.service.avisarPerdida({ id: registro.id, tipo: datos.tipo, iniciadorId: yo, grupo: null }, otro.id, true);
        throw new OcupadoError(`${otro.nombre_completo} está en otra llamada`);
      }
    }
    if (this.dentroDe(yo)) throw new BadRequestError('Ya estás en una llamada');

    const invitados = destino.destinatarios.filter((u) => !this.dentroDe(u.id));
    if (!invitados.length) throw new OcupadoError('Todos están en otra llamada');

    const registro = await this.service.registrar(yo, datos.tipo, destino, invitados.map((u) => u.id));
    const activa: LlamadaActiva = {
      id: registro.id,
      tipo: datos.tipo,
      grupo: destino.grupo,
      iniciador,
      presentes: new Map(),
      pendientes: new Set(invitados.map((u) => u.id)),
      invitados: new Set(invitados.map((u) => u.id)),
      usuarios: new Map([iniciador, ...invitados].map((u) => [u.id, u])),
      contestada: false,
      creada: new Date(),
      temporizador: null,
      gracias: new Map(),
      cerrando: false,
    };
    // Quien llama queda dentro con el socket que hizo la llamada.
    activa.presentes.set(yo, socket.id);
    this.activas.set(activa.id, activa);
    activa.temporizador = setTimeout(() => this.seguro(this.sinRespuesta(activa.id)), this.opciones.tiempoLimiteMs);
    activa.temporizador.unref?.();

    const vista = this.vista(activa);
    // Primero sale el acuse a quien llama; después suena a los demás.
    setImmediate(() => this.seguro(Promise.all(invitados.map((u) => this.timbrar(u.id, activa, vista)))));
    return { llamada: vista };
  }

  /** El teléfono del invitado ya está sonando: se le avisa a quienes están dentro. */
  private sonando(yo: number, llamadaId: number): { llamada_id: number } {
    const activa = this.activas.get(llamadaId);
    if (activa?.pendientes.has(yo)) this.aPresentes(activa, EVENTOS_LLAMADA.sonando, { llamada_id: llamadaId, usuario_id: yo });
    return { llamada_id: llamadaId };
  }

  private async aceptar(socket: Socket, yo: number, llamadaId: number): Promise<EntradaLlamada> {
    const activa = this.activaOrFail(llamadaId);
    const socketActual = activa.presentes.get(yo);
    if (socketActual === socket.id) return this.entrada(activa, yo);
    if (socketActual) throw new BadRequestError('Ya estás en esta llamada desde otro dispositivo');

    if (!activa.invitados.has(yo)) {
      const puede = activa.grupo !== null && (await this.service.puedeUnirseAGrupo(activa.grupo.id, yo, activa.iniciador.id));
      if (!puede) throw new ForbiddenError('No puedes entrar a esta llamada');
    }
    if (this.dentroDe(yo)) throw new BadRequestError('Ya estás en otra llamada');
    if (activa.presentes.size >= this.opciones.maximoParticipantes) {
      throw new ErrorSocket(`La llamada está llena (máximo ${this.opciones.maximoParticipantes} personas)`, 'llena');
    }
    const perfil = activa.usuarios.get(yo) ?? (await this.service.perfilActivo(yo));
    if (this.activas.get(llamadaId) !== activa || activa.cerrando) throw new NotFoundError('Llamada', 'La llamada ya terminó');

    activa.usuarios.set(yo, perfil);
    activa.presentes.set(yo, socket.id);
    activa.pendientes.delete(yo);
    activa.contestada = true;
    if (!activa.grupo) this.pararTimbre(activa);

    await this.service.marcarUnido(llamadaId, yo, activa.presentes.size);
    this.aPresentes(activa, EVENTOS_LLAMADA.unido, { llamada_id: llamadaId, usuario: perfil }, yo);
    // Si la tenía sonando en otro teléfono o pestaña, que deje de sonar allá.
    this.io?.to(salas.usuario(yo)).except(socket.id).emit(EVENTOS_LLAMADA.cancelada, { llamada_id: llamadaId, motivo: 'contestada_en_otro_dispositivo' });
    return this.entrada(activa, yo);
  }

  private async rechazar(yo: number, llamadaId: number): Promise<{ llamada_id: number }> {
    const activa = this.activas.get(llamadaId);
    if (!activa || !activa.pendientes.has(yo)) return { llamada_id: llamadaId };

    activa.pendientes.delete(yo);
    await this.service.marcarParticipante(llamadaId, yo, 'rechazo');
    this.aPresentes(activa, EVENTOS_LLAMADA.rechazada, { llamada_id: llamadaId, usuario_id: yo });
    this.aUsuario(yo, EVENTOS_LLAMADA.cancelada, { llamada_id: llamadaId, motivo: 'rechazada' });

    if (!activa.grupo) await this.terminar(activa, 'rechazada', 'rechazada');
    else if (!activa.pendientes.size && activa.presentes.size <= 1) await this.terminar(activa, activa.contestada ? 'terminada' : 'rechazada', 'rechazada');
    return { llamada_id: llamadaId };
  }

  /** Colgar: si estaba dentro, sale; si le estaba sonando, equivale a rechazar. */
  private async colgar(yo: number, llamadaId: number): Promise<{ llamada_id: number }> {
    const activa = this.activas.get(llamadaId);
    if (!activa) return { llamada_id: llamadaId };
    if (activa.presentes.has(yo)) await this.salir(activa, yo, 'colgo');
    else if (activa.pendientes.has(yo)) await this.rechazar(yo, llamadaId);
    return { llamada_id: llamadaId };
  }

  /** Reenvía una oferta/respuesta SDP o un candidato ICE a UNA persona de la llamada (solo entre presentes). */
  private senal(socket: Socket, yo: number, datos: SenalDto): { entregada: true } {
    const activa = this.dentroConEsteSocket(socket, yo, datos.llamada_id);
    const destino = datos.para !== yo ? activa.presentes.get(datos.para) : undefined;
    if (!destino) throw new NotFoundError('Participante', 'Esa persona no está en la llamada');
    this.io?.to(destino).emit(EVENTOS_LLAMADA.senal, {
      llamada_id: datos.llamada_id,
      de: yo,
      tipo: datos.tipo,
      ...(datos.sdp !== undefined ? { sdp: datos.sdp } : {}),
      ...(datos.candidato ? { candidato: datos.candidato } : {}),
    });
    return { entregada: true };
  }

  private medios(socket: Socket, yo: number, datos: MediosDto): { llamada_id: number } {
    const activa = this.dentroConEsteSocket(socket, yo, datos.llamada_id);
    this.aPresentes(activa, EVENTOS_LLAMADA.medios, { ...datos, usuario_id: yo }, yo);
    return { llamada_id: datos.llamada_id };
  }

  /** Tras reconectar el socket: vuelve a quedar dentro con el socket nuevo (y reinicia ICE desde el cliente). */
  private retomar(socket: Socket, yo: number, llamadaId: number): EntradaLlamada {
    const activa = this.activaOrFail(llamadaId);
    if (!activa.presentes.has(yo)) throw new ForbiddenError('Ya no estás en esta llamada');
    activa.presentes.set(yo, socket.id);
    const espera = activa.gracias.get(yo);
    if (espera) clearTimeout(espera);
    activa.gracias.delete(yo);
    this.aPresentes(activa, EVENTOS_LLAMADA.reconectado, { llamada_id: llamadaId, usuario_id: yo }, yo);
    return this.entrada(activa, yo);
  }

  // ---------- Ciclo de vida ----------

  /** Pasaron 40 s: a quienes no contestaron se les marca perdida (y si nadie contestó, la llamada termina). */
  private async sinRespuesta(llamadaId: number): Promise<void> {
    const activa = this.activas.get(llamadaId);
    if (!activa) return;
    activa.temporizador = null;
    if (!activa.grupo || activa.presentes.size <= 1) {
      await this.terminar(activa, activa.contestada ? 'terminada' : 'perdida', 'sin_respuesta');
      return;
    }
    const perdidos = [...activa.pendientes];
    activa.pendientes.clear();
    for (const usuarioId of perdidos) {
      await this.service.marcarParticipante(llamadaId, usuarioId, 'perdida');
      this.aUsuario(usuarioId, EVENTOS_LLAMADA.cancelada, { llamada_id: llamadaId, motivo: 'sin_respuesta' });
      await this.service.avisarPerdida(this.datosAviso(activa), usuarioId);
    }
  }

  private async salir(activa: LlamadaActiva, yo: number, motivo: MotivoLlamada): Promise<void> {
    activa.presentes.delete(yo);
    const espera = activa.gracias.get(yo);
    if (espera) clearTimeout(espera);
    activa.gracias.delete(yo);
    await this.service.marcarParticipante(activa.id, yo, 'salio');

    const termina = !activa.grupo || activa.presentes.size === 0 || (activa.presentes.size === 1 && activa.pendientes.size === 0);
    if (termina) await this.terminar(activa, activa.contestada ? 'terminada' : 'perdida', motivo);
    else this.aPresentes(activa, EVENTOS_LLAMADA.salio, { llamada_id: activa.id, usuario_id: yo });
  }

  private async terminar(activa: LlamadaActiva, estado: 'terminada' | 'perdida' | 'rechazada', motivo: MotivoLlamada): Promise<void> {
    if (activa.cerrando) return;
    activa.cerrando = true;
    this.soltarTemporizadores(activa);
    this.activas.delete(activa.id);

    const perdidos = [...activa.pendientes];
    activa.pendientes.clear();
    const registro = await this.service.finalizar(activa.id, estado);
    const aviso = { llamada_id: activa.id, estado, motivo, duracion_seg: registro?.duracion_seg ?? 0 };
    for (const socketId of activa.presentes.values()) this.io?.to(socketId).emit(EVENTOS_LLAMADA.terminada, aviso);
    for (const usuarioId of perdidos) {
      this.aUsuario(usuarioId, EVENTOS_LLAMADA.cancelada, { llamada_id: activa.id, motivo });
      await this.service.avisarPerdida(this.datosAviso(activa), usuarioId);
    }
  }

  /** Se cayó un socket que estaba dentro: se le espera `graciaMs` a que haga `retomar`; si no, sale. */
  private desconectado(socketId: string, usuarioId: number): void {
    for (const activa of this.activas.values()) {
      if (activa.presentes.get(usuarioId) !== socketId) continue;
      const salir = () => {
        activa.gracias.delete(usuarioId);
        if (this.activas.get(activa.id) === activa && activa.presentes.get(usuarioId) === socketId) {
          this.seguro(this.salir(activa, usuarioId, 'desconexion'));
        }
      };
      if (this.opciones.graciaMs <= 0) {
        salir();
        continue;
      }
      this.aPresentes(activa, EVENTOS_LLAMADA.reconectando, { llamada_id: activa.id, usuario_id: usuarioId }, usuarioId);
      const previa = activa.gracias.get(usuarioId);
      if (previa) clearTimeout(previa);
      const espera = setTimeout(salir, this.opciones.graciaMs);
      espera.unref?.();
      activa.gracias.set(usuarioId, espera);
    }
  }

  /** Avisa por socket (sala personal: todos sus dispositivos) y, si no tiene ninguno conectado, por push. */
  private async timbrar(usuarioId: number, activa: LlamadaActiva, vista: LlamadaEnVivo): Promise<void> {
    if (!activa.pendientes.has(usuarioId) || activa.cerrando) return;
    this.aUsuario(usuarioId, EVENTOS_LLAMADA.entrante, { llamada: vista });
    if (this.io && (await conectado(this.io, usuarioId))) return;
    const quien = activa.iniciador.nombre_completo;
    await this.push.avisar(usuarioId, {
      titulo: `${ETIQUETA[activa.tipo]} entrante`,
      cuerpo: activa.grupo ? `${quien} llama al grupo «${activa.grupo.nombre}»` : `${quien} te está llamando`,
      datos: { tipo: 'llamada', llamada_id: String(activa.id), llamada_tipo: activa.tipo },
    });
  }

  // ---------- Apoyo ----------

  private dentroDe(usuarioId: number): boolean {
    for (const a of this.activas.values()) if (a.presentes.has(usuarioId)) return true;
    return false;
  }

  private deGrupo(grupoId: number): LlamadaActiva | undefined {
    for (const a of this.activas.values()) if (a.grupo?.id === grupoId) return a;
    return undefined;
  }

  private sonandoPara(usuarioId: number): LlamadaActiva[] {
    return [...this.activas.values()].filter((a) => a.pendientes.has(usuarioId));
  }

  private activaOrFail(llamadaId: number): LlamadaActiva {
    const activa = this.activas.get(llamadaId);
    if (!activa || activa.cerrando) throw new NotFoundError('Llamada', 'La llamada ya terminó');
    return activa;
  }

  /** Solo el socket con el que la persona está dentro puede mandar señales (nadie espía ni inyecta). */
  private dentroConEsteSocket(socket: Socket, yo: number, llamadaId: number): LlamadaActiva {
    const activa = this.activas.get(llamadaId);
    if (!activa || activa.presentes.get(yo) !== socket.id) throw new ForbiddenError('No estás en esta llamada');
    return activa;
  }

  private entrada(activa: LlamadaActiva, yo: number): EntradaLlamada {
    const llamada = this.vista(activa);
    return { llamada, presentes: llamada.presentes.filter((u) => u.id !== yo) };
  }

  private vista(activa: LlamadaActiva): LlamadaEnVivo {
    return {
      id: activa.id,
      tipo: activa.tipo,
      estado: activa.contestada ? 'en_curso' : 'sonando',
      grupo: activa.grupo,
      iniciador: activa.iniciador,
      presentes: [...activa.presentes.keys()].map((id) => activa.usuarios.get(id)).filter((u): u is UsuarioPublico => !!u),
      sonando: [...activa.pendientes],
      invitados: [...activa.invitados].map((id) => activa.usuarios.get(id)).filter((u): u is UsuarioPublico => !!u),
      maximo: this.opciones.maximoParticipantes,
      creada_en: activa.creada.toISOString(),
    };
  }

  private datosAviso(activa: LlamadaActiva) {
    return { id: activa.id, tipo: activa.tipo, iniciadorId: activa.iniciador.id, grupo: activa.grupo };
  }

  private aPresentes(activa: LlamadaActiva, evento: string, data: unknown, excepto?: number): void {
    for (const [usuarioId, socketId] of activa.presentes) {
      if (usuarioId !== excepto && socketId) this.io?.to(socketId).emit(evento, data);
    }
  }

  private aUsuario(usuarioId: number, evento: string, data: unknown): void {
    this.io?.to(salas.usuario(usuarioId)).emit(evento, data);
  }

  private pararTimbre(activa: LlamadaActiva): void {
    if (activa.temporizador) clearTimeout(activa.temporizador);
    activa.temporizador = null;
  }

  private soltarTemporizadores(activa: LlamadaActiva): void {
    this.pararTimbre(activa);
    for (const t of activa.gracias.values()) clearTimeout(t);
    activa.gracias.clear();
  }

  /** Los temporizadores no tienen a quién devolver el error: se registra y sigue. */
  private seguro(tarea: Promise<unknown>): void {
    tarea.catch((error: unknown) => this.registrarError('[llamadas] Falló una tarea en segundo plano', error));
  }
}

export const senalizacionLlamadas = new SenalizacionLlamadas(llamadaService, dispositivoService);

/** Para server.ts: `realtime.usar(manejadorLlamadas)` antes de `realtime.adjuntar(...)`. */
export const manejadorLlamadas: ManejadorSocket = senalizacionLlamadas.manejador;
