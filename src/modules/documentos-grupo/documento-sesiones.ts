import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type { Socket } from 'socket.io';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import type { EstadoGuardado } from './documento-colaborativo.repository';
import { reemplazarContenido, resumenDe, textoPlano } from './documento-yjs';

/**
 * Eventos de Socket.IO de la edición en vivo (cliente ⇄ servidor).
 * Los mensajes `mensaje` / `actualizacion` son binarios (Uint8Array): protocolo de `y-protocols/sync` y de awareness.
 */
export const EVENTOS_DOCUMENTO = {
  /** cliente → { documento_id } con acuse { ok, puede_editar } | { ok: false, mensaje } */
  entrar: 'doc:entrar',
  /** cliente → { documento_id } */
  salir: 'doc:salir',
  /** ambos sentidos → { documento_id, mensaje } (paso 1, paso 2 o actualización) */
  sync: 'doc:sync',
  /** ambos sentidos → { documento_id, actualizacion } (quién está y dónde está su cursor) */
  awareness: 'doc:awareness',
  /** servidor → { documento_id, fecha, ultimo_editor_id } cuando el contenido quedó guardado en la base */
  guardado: 'doc:guardado',
  /** servidor → { documento_id, titulo } al renombrar */
  titulo: 'doc:titulo',
  /** servidor → { documento_id, puede_editar } cuando cambia mi permiso */
  acceso: 'doc:acceso',
  /** servidor → { documento_id, motivo: 'papelera' | 'eliminado' | 'sin_acceso' }: hay que salir del editor */
  cerrado: 'doc:cerrado',
} as const;

export type MotivoCierre = 'papelera' | 'eliminado' | 'sin_acceso';

/** Dónde se guarda el contenido (la base en producción; un almacén falso en pruebas). */
export interface AlmacenDocumentos {
  cargar(documentoId: number): Promise<Uint8Array | null>;
  guardar(documentoId: number, datos: EstadoGuardado): Promise<void>;
  versionAutomatica(documentoId: number, estado: Uint8Array, texto: string, autorId: number | null): Promise<void>;
}

export interface OpcionesSesiones {
  /** Cada cuánto se guarda como máximo mientras hay cambios. */
  guardarCadaMs: number;
  /** Minutos de edición entre instantáneas automáticas. */
  minutosVersion: number;
}

/** Un socket que tiene abierto el documento. */
export class Participante {
  /** clientIDs de awareness que controla este socket (se borran al salir). */
  readonly clientes = new Set<number>();

  constructor(
    readonly socket: Socket,
    readonly usuarioId: number,
    public puedeEditar: boolean,
  ) {}
}

/** Cambio hecho por el servidor en nombre de un usuario (restaurar una versión). */
export class OrigenServidor {
  constructor(readonly usuarioId: number) {}
}

/** Un documento abierto en memoria mientras alguien lo edita. */
class SesionDocumento {
  readonly doc = new Y.Doc();
  readonly awareness: awarenessProtocol.Awareness;
  readonly participantes = new Map<string, Participante>();
  sucio = false;
  cambiosDesdeVersion = false;
  ultimoEditor: number | null = null;
  ultimaVersion: number;
  temporizador: ReturnType<typeof setTimeout> | null = null;
  guardando: Promise<void> = Promise.resolve();

  constructor(
    readonly id: number,
    estado: Uint8Array | null,
  ) {
    if (estado?.length) Y.applyUpdate(this.doc, estado);
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    // El servidor no tiene cursor propio
    this.awareness.setLocalState(null);
    this.ultimaVersion = Date.now();
  }

  /** Envía a todos los participantes menos a `excepto`. */
  emitir(evento: string, data: object, excepto?: unknown): void {
    for (const participante of this.participantes.values()) if (participante !== excepto) participante.socket.emit(evento, data);
  }
}

interface CambiosAwareness {
  added: number[];
  updated: number[];
  removed: number[];
}

function mensajeSync(escribir: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoder = encoding.createEncoder();
  escribir(encoder);
  return encoding.toUint8Array(encoder);
}

/**
 * Documentos abiertos en vivo: aplica los mensajes de Yjs de cada cliente, reenvía las actualizaciones a los demás,
 * lleva el awareness y guarda en diferido (como máximo cada `guardarCadaMs` con cambios, y al salir el último).
 * Mientras se edita deja una instantánea automática cada `minutosVersion` y otra al cerrar si hubo cambios.
 */
export class SesionesDocumentos {
  private readonly sesiones = new Map<number, SesionDocumento>();
  private readonly abriendo = new Map<number, Promise<SesionDocumento>>();
  private readonly cerrando = new Map<number, Promise<void>>();

  constructor(
    private readonly almacen: AlmacenDocumentos,
    private readonly opciones: OpcionesSesiones,
  ) {}

  // ---------- Participantes ----------

  /** Mete al socket en el documento y le manda el paso 1 del servidor y quién está. */
  async unir(documentoId: number, socket: Socket, usuarioId: number, puedeEditar: boolean): Promise<void> {
    let sesion = await this.abrir(documentoId);
    // Si se cerró mientras se cargaba (salió el último), se abre de nuevo
    while (this.sesiones.get(documentoId) !== sesion) sesion = await this.abrir(documentoId);

    sesion.participantes.set(socket.id, new Participante(socket, usuarioId, puedeEditar));
    socket.emit(EVENTOS_DOCUMENTO.sync, {
      documento_id: documentoId,
      mensaje: mensajeSync((encoder) => syncProtocol.writeSyncStep1(encoder, sesion.doc)),
    });
    const clientes = Array.from(sesion.awareness.getStates().keys());
    if (clientes.length) {
      socket.emit(EVENTOS_DOCUMENTO.awareness, {
        documento_id: documentoId,
        actualizacion: awarenessProtocol.encodeAwarenessUpdate(sesion.awareness, clientes),
      });
    }
  }

  /** Mensaje de sincronización de un cliente. Quien solo puede leer únicamente pide el estado (paso 1). */
  recibirSync(documentoId: number, socketId: string, mensaje: Uint8Array): void {
    const sesion = this.sesiones.get(documentoId);
    const participante = sesion?.participantes.get(socketId);
    if (!sesion || !participante) return;
    try {
      const decoder = decoding.createDecoder(mensaje);
      const tipo = decoding.peekVarUint(decoder);
      if (!participante.puedeEditar && tipo !== syncProtocol.messageYjsSyncStep1) return;
      const encoder = encoding.createEncoder();
      syncProtocol.readSyncMessage(decoder, encoder, sesion.doc, participante);
      if (encoding.length(encoder) > 0) {
        participante.socket.emit(EVENTOS_DOCUMENTO.sync, { documento_id: documentoId, mensaje: encoding.toUint8Array(encoder) });
      }
    } catch {
      // Mensaje mal formado: se ignora
    }
  }

  recibirAwareness(documentoId: number, socketId: string, actualizacion: Uint8Array): void {
    const sesion = this.sesiones.get(documentoId);
    const participante = sesion?.participantes.get(socketId);
    if (!sesion || !participante) return;
    try {
      awarenessProtocol.applyAwarenessUpdate(sesion.awareness, actualizacion, participante);
    } catch {
      // Mensaje mal formado: se ignora
    }
  }

  /** El socket deja el documento; si era el último, se guarda y se libera la memoria. */
  salir(documentoId: number, socketId: string): void {
    const sesion = this.sesiones.get(documentoId);
    const participante = sesion?.participantes.get(socketId);
    if (!sesion || !participante) return;
    sesion.participantes.delete(socketId);
    if (participante.clientes.size) awarenessProtocol.removeAwarenessStates(sesion.awareness, Array.from(participante.clientes), null);
    if (!sesion.participantes.size) void this.cerrar(sesion, true);
  }

  /** El socket se desconectó: sale de todos sus documentos. */
  desconectar(socketId: string): void {
    for (const id of Array.from(this.sesiones.keys())) this.salir(id, socketId);
  }

  // ---------- Lo que usa el servicio REST ----------

  /** ¿Alguien lo tiene abierto? */
  abierto(documentoId: number): boolean {
    return this.sesiones.has(documentoId);
  }

  /** Estado más reciente si está abierto (puede ir por delante de la base); null si no. */
  estadoEnVivo(documentoId: number): Uint8Array | null {
    const sesion = this.sesiones.get(documentoId);
    return sesion ? Y.encodeStateAsUpdate(sesion.doc) : null;
  }

  /** Usuarios conectados al documento (sin repetir). */
  conectados(documentoId: number): number[] {
    const sesion = this.sesiones.get(documentoId);
    return sesion ? Array.from(new Set(Array.from(sesion.participantes.values(), (p) => p.usuarioId))) : [];
  }

  /**
   * Si está abierto, reemplaza el contenido en vivo (llega a todos como una edición normal) y lo guarda ya.
   * Devuelve false si no está abierto (el servicio lo hace sobre la base).
   */
  async restaurarEnVivo(documentoId: number, origen: Y.Doc, usuarioId: number): Promise<boolean> {
    const sesion = this.sesiones.get(documentoId);
    if (!sesion) return false;
    reemplazarContenido(sesion.doc, origen, new OrigenServidor(usuarioId));
    await this.guardar(sesion);
    return true;
  }

  /** Guarda ya lo pendiente (p. ej. antes de crear una versión manual). */
  async guardarAhora(documentoId: number): Promise<void> {
    const sesion = this.sesiones.get(documentoId);
    if (sesion) await this.guardar(sesion);
  }

  /** Aviso a todos los que lo tienen abierto (p. ej. nuevo título). */
  avisar(documentoId: number, evento: string, data: object): void {
    this.sesiones.get(documentoId)?.emitir(evento, { ...data, documento_id: documentoId });
  }

  /** Cambió el permiso de un usuario: null lo saca del documento; boolean ajusta si puede editar. */
  actualizarAcceso(documentoId: number, usuarioId: number, puedeEditar: boolean | null): void {
    const sesion = this.sesiones.get(documentoId);
    if (!sesion) return;
    for (const [socketId, participante] of Array.from(sesion.participantes)) {
      if (participante.usuarioId !== usuarioId) continue;
      if (puedeEditar === null) {
        participante.socket.emit(EVENTOS_DOCUMENTO.cerrado, { documento_id: documentoId, motivo: 'sin_acceso' satisfies MotivoCierre });
        this.salir(documentoId, socketId);
      } else {
        participante.puedeEditar = puedeEditar;
        participante.socket.emit(EVENTOS_DOCUMENTO.acceso, { documento_id: documentoId, puede_editar: puedeEditar });
      }
    }
  }

  /** Saca a todos (papelera o borrado). Con `guardar` false se descarta lo pendiente. */
  async cerrarDocumento(documentoId: number, motivo: MotivoCierre, guardar: boolean): Promise<void> {
    const sesion = this.sesiones.get(documentoId);
    if (!sesion) return this.cerrando.get(documentoId);
    sesion.emitir(EVENTOS_DOCUMENTO.cerrado, { documento_id: documentoId, motivo });
    sesion.participantes.clear();
    await this.cerrar(sesion, guardar);
  }

  /** Guarda y cierra todo (apagado del servidor y pruebas). */
  async cerrarTodas(): Promise<void> {
    await Promise.all(Array.from(this.sesiones.values(), (sesion) => this.cerrar(sesion, true)));
    await Promise.all(Array.from(this.cerrando.values()));
  }

  // ---------- Apoyo ----------

  private async abrir(documentoId: number): Promise<SesionDocumento> {
    for (;;) {
      const existente = this.sesiones.get(documentoId);
      if (existente) return existente;
      const cierre = this.cerrando.get(documentoId);
      if (cierre) {
        // Primero termina de guardarse la sesión anterior, así no se carga un estado viejo
        await cierre;
        continue;
      }
      let carga = this.abriendo.get(documentoId);
      if (!carga) {
        carga = this.cargar(documentoId).finally(() => this.abriendo.delete(documentoId));
        this.abriendo.set(documentoId, carga);
      }
      return carga;
    }
  }

  private async cargar(documentoId: number): Promise<SesionDocumento> {
    const sesion = new SesionDocumento(documentoId, await this.almacen.cargar(documentoId));
    sesion.doc.on('update', (update: Uint8Array, origin: unknown) => this.alActualizar(sesion, update, origin));
    sesion.awareness.on('update', (cambios: CambiosAwareness, origin: unknown) => this.alCambiarAwareness(sesion, cambios, origin));
    this.sesiones.set(documentoId, sesion);
    return sesion;
  }

  private alActualizar(sesion: SesionDocumento, update: Uint8Array, origin: unknown): void {
    if (origin instanceof Participante || origin instanceof OrigenServidor) sesion.ultimoEditor = origin.usuarioId;
    sesion.sucio = true;
    sesion.cambiosDesdeVersion = true;
    const mensaje = mensajeSync((encoder) => syncProtocol.writeUpdate(encoder, update));
    sesion.emitir(EVENTOS_DOCUMENTO.sync, { documento_id: sesion.id, mensaje }, origin);
    this.programarGuardado(sesion);
  }

  private alCambiarAwareness(sesion: SesionDocumento, { added, updated, removed }: CambiosAwareness, origin: unknown): void {
    if (origin instanceof Participante) {
      added.forEach((id) => origin.clientes.add(id));
      removed.forEach((id) => origin.clientes.delete(id));
    }
    const cambiados = [...added, ...updated, ...removed];
    if (!cambiados.length) return;
    const actualizacion = awarenessProtocol.encodeAwarenessUpdate(sesion.awareness, cambiados);
    sesion.emitir(EVENTOS_DOCUMENTO.awareness, { documento_id: sesion.id, actualizacion }, origin);
  }

  private programarGuardado(sesion: SesionDocumento): void {
    if (sesion.temporizador) return;
    sesion.temporizador = setTimeout(() => {
      sesion.temporizador = null;
      void this.guardar(sesion);
    }, this.opciones.guardarCadaMs);
    sesion.temporizador.unref?.();
  }

  /** Guardados en fila (nunca dos a la vez del mismo documento). */
  private guardar(sesion: SesionDocumento): Promise<void> {
    sesion.guardando = sesion.guardando.then(async () => {
      if (!sesion.sucio) return;
      sesion.sucio = false;
      const estado = Y.encodeStateAsUpdate(sesion.doc);
      const texto = textoPlano(sesion.doc);
      const fecha = new Date();
      try {
        await this.almacen.guardar(sesion.id, { estado, texto, resumen: resumenDe(texto), editorId: sesion.ultimoEditor, fecha });
      } catch (error) {
        sesion.sucio = true;
        console.warn(`No se pudo guardar el documento ${sesion.id}:`, (error as Error).message);
        return;
      }
      sesion.emitir(EVENTOS_DOCUMENTO.guardado, { documento_id: sesion.id, fecha, ultimo_editor_id: sesion.ultimoEditor });
      const minutos = (Date.now() - sesion.ultimaVersion) / 60_000;
      if (sesion.cambiosDesdeVersion && minutos >= this.opciones.minutosVersion) await this.versionar(sesion, estado, texto);
    });
    return sesion.guardando;
  }

  private async versionar(sesion: SesionDocumento, estado: Uint8Array, texto: string): Promise<void> {
    sesion.cambiosDesdeVersion = false;
    sesion.ultimaVersion = Date.now();
    try {
      await this.almacen.versionAutomatica(sesion.id, estado, texto, sesion.ultimoEditor);
    } catch (error) {
      console.warn(`No se pudo crear la versión automática del documento ${sesion.id}:`, (error as Error).message);
    }
  }

  private cerrar(sesion: SesionDocumento, guardar: boolean): Promise<void> {
    if (this.sesiones.get(sesion.id) !== sesion) return this.cerrando.get(sesion.id) ?? Promise.resolve();
    this.sesiones.delete(sesion.id);
    if (sesion.temporizador) clearTimeout(sesion.temporizador);
    sesion.temporizador = null;

    const cierre = (async () => {
      if (guardar) {
        await this.guardar(sesion);
        // Cada sesión de edición con cambios deja su instantánea
        if (sesion.cambiosDesdeVersion) await this.versionar(sesion, Y.encodeStateAsUpdate(sesion.doc), textoPlano(sesion.doc));
      } else {
        await sesion.guardando;
      }
      sesion.awareness.destroy();
      sesion.doc.destroy();
    })().finally(() => this.cerrando.delete(sesion.id));
    this.cerrando.set(sesion.id, cierre);
    return cierre;
  }
}
