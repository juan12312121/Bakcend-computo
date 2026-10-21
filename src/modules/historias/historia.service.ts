import type { InferAttributes, Sequelize } from 'sequelize';
import { env } from '../../config/env';
import { BaseService } from '../../core/domain/BaseService';
import { AppError, BadRequestError, ForbiddenError, ValidationError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import { HttpStatus } from '../../core/http/HttpStatus';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type Historia, type TipoHistoria, type Usuario } from '../../infrastructure/database/models';
import { realtime, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { destacadaRepository, type DestacadaRepository } from '../destacados/destacada.repository';
import { estadisticaRepository, type EstadisticaRepository } from '../estadisticas/estadistica.repository';
import { aplicarMusica, combinarEdicion, duracionRecortada, urlReproduccion } from '../publicaciones/edicion-video';
import { seguidorRepository, type SeguidorRepository } from '../seguidores/seguidor.repository';
import { ATRIBUTOS_USUARIO_PUBLICO, usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import {
  HORAS_VIGENCIA,
  historiaRepository,
  historiaVistaRepository,
  type HistoriaRepository,
  type HistoriaVistaRepository,
  type VistaDeHistoria,
} from './historia.repository';
import {
  DURACION_MAXIMA,
  DURACION_POR_DEFECTO,
  FONDO_POR_DEFECTO,
  FONDOS_HISTORIA,
  type CrearHistoriaDto,
  type EdicionHistoriaDto,
  type FondoHistoria,
} from './historia.schemas';

export type UsuarioPublico = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]>;

/** Historia tal como la ve el cliente (sin el public_id del archivo). */
export type HistoriaDto = Omit<InferAttributes<Historia>, 'media_s3'> & {
  /** Si el usuario autenticado ya la vio (las propias cuentan como vistas). */
  vista_por_mi: boolean;
};

/** Historia del archivo personal: si sigue en la bandeja de 24 h y en qué destacadas está. */
export type HistoriaArchivoDto = HistoriaDto & {
  vigente: boolean;
  destacada_ids: number[];
};

/** Historias vigentes de una cuenta, como las muestra la bandeja. */
export interface GrupoHistorias {
  usuario: UsuarioPublico;
  es_mio: boolean;
  /** De la más antigua a la más reciente. */
  historias: HistoriaDto[];
  todas_vistas: boolean;
  /** Fecha de la historia más reciente (null si no tiene vigentes). */
  ultima: Date | null;
}

export interface ResultadoVista {
  historia_id: number;
  /** true solo la primera vez que el usuario la ve. */
  registrada: boolean;
  /** Las propias nunca suman vistas. */
  propia: boolean;
}

/** Eventos Socket.IO del módulo. */
export const EVENTOS_HISTORIAS = { nueva: 'nueva_historia' } as const;

/** Cada cuánto pasan al archivo las historias vencidas. */
export const MINUTOS_LIMPIEZA = 30;

const MS_POR_HORA = 60 * 60 * 1000;

const errorRecorte = () =>
  new ValidationError([{ campo: 'recorte_fin', mensaje: `El video recortado no puede durar más de ${DURACION_MAXIMA} segundos` }]);

/** Historia sin el public_id del archivo (lo que ve el cliente). */
export function presentarHistoria(historia: Historia, vistaPorMi: boolean): HistoriaDto {
  const { media_s3: _archivo, autor: _autor, ...datos } = historia.toJSON() as InferAttributes<Historia> & { autor?: unknown };
  return { ...datos, vista_por_mi: vistaPorMi };
}

export class HistoriaService extends BaseService<Historia, HistoriaRepository> {
  constructor(
    repository: HistoriaRepository,
    private readonly vistas: HistoriaVistaRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly seguidores: SeguidorRepository,
    private readonly storage: FileStorage,
    private readonly tiempoReal: RealtimeGateway,
    private readonly db: Sequelize,
    private readonly destacadas: DestacadaRepository = destacadaRepository,
    private readonly estadisticas: EstadisticaRepository = estadisticaRepository,
  ) {
    super(repository);
  }

  fondos(): readonly FondoHistoria[] {
    return FONDOS_HISTORIA;
  }

  // ---------- Publicar ----------

  async crear(usuarioId: number, datos: CrearHistoriaDto): Promise<HistoriaDto>;
  async crear(usuarioId: number, datos: CrearHistoriaDto, archivo: ArchivoSubido | undefined): Promise<HistoriaDto>;
  async crear(usuarioId: number, datos: CrearHistoriaDto, archivo?: ArchivoSubido): Promise<HistoriaDto> {
    this.validarArchivo(datos.tipo, archivo);
    const esTexto = datos.tipo === 'texto';
    // Video con ajustes del editor: se reproduce con transformaciones de Cloudinary
    const edicion = datos.tipo === 'video' && datos.edicion ? combinarEdicion(null, datos.edicion) : null;
    const recortada = duracionRecortada(edicion);
    if (recortada !== null && recortada > DURACION_MAXIMA) throw errorRecorte();

    const historia = await this.repository.create({
      usuario_id: usuarioId,
      tipo: datos.tipo,
      media_url: archivo ? urlReproduccion(archivo.url, edicion) : null,
      media_original_url: archivo?.url ?? null,
      media_s3: archivo?.id ?? null,
      texto: datos.texto ?? null,
      fondo: esTexto ? (datos.fondo ?? FONDO_POR_DEFECTO) : null,
      duracion_seg: recortada ?? datos.duracion_seg ?? DURACION_POR_DEFECTO,
      edicion,
      expira_en: new Date(Date.now() + HORAS_VIGENCIA * MS_POR_HORA),
    });

    // Aviso en tiempo real a cada seguidor para que refresque su bandeja
    for (const seguidorId of await this.repository.idsSeguidores(usuarioId)) {
      this.tiempoReal.aUsuario(seguidorId, EVENTOS_HISTORIAS.nueva, { usuario_id: usuarioId });
    }
    return presentarHistoria(historia, true);
  }

  /**
   * Ajustes del editor para una historia de video propia (recorte, silencio, música y texto).
   * La música llega como audio en `archivo`; la pista reemplazada se borra.
   */
  editarVideo(historiaId: number, usuarioId: number, datos: EdicionHistoriaDto): Promise<HistoriaDto>;
  editarVideo(historiaId: number, usuarioId: number, datos: EdicionHistoriaDto, musica: ArchivoSubido | undefined): Promise<HistoriaDto>;
  async editarVideo(historiaId: number, usuarioId: number, datos: EdicionHistoriaDto, musica?: ArchivoSubido): Promise<HistoriaDto> {
    if (musica && !musica.mimetype.startsWith('audio/')) throw new BadRequestError('La música debe ser un archivo de audio');
    const historia = await this.repository.findByIdOrFail(historiaId);
    this.asegurarDueno(historia.usuario_id, usuarioId, 'Solo el autor puede editar esta historia');
    if (historia.tipo !== 'video' || !historia.media_url) throw new BadRequestError('La historia no es de video');

    const { edicion, reemplazada } = aplicarMusica(combinarEdicion(historia.edicion, datos), historia.edicion, musica, datos.quitar_musica);
    const recortada = duracionRecortada(edicion);
    if (recortada !== null && recortada > DURACION_MAXIMA) throw errorRecorte();
    const original = historia.media_original_url ?? historia.media_url;
    await this.repository.update(historia, {
      edicion,
      media_original_url: original,
      media_url: urlReproduccion(original, edicion),
      ...(recortada !== null ? { duracion_seg: recortada } : {}),
    });
    if (reemplazada) await this.storage.eliminar(reemplazada);
    return presentarHistoria(await this.repository.findByIdOrFail(historiaId), true);
  }

  // ---------- Consultar ----------

  /**
   * Bandeja: historias vigentes propias y de las cuentas que sigo, agrupadas por usuario.
   * Orden: las mías primero, luego los grupos con algo sin ver, luego los ya vistos
   * (cada bloque de la publicación más reciente a la más antigua).
   */
  async bandeja(usuarioId: number): Promise<GrupoHistorias[]> {
    const seguidos = await this.repository.idsSeguidos(usuarioId);
    const historias = await this.repository.vigentesDe([usuarioId, ...seguidos]);
    const vistas = await this.vistas.vistasPor(
      usuarioId,
      historias.filter((h) => h.usuario_id !== usuarioId).map((h) => h.id),
    );

    const porAutor = new Map<number, Historia[]>();
    for (const historia of historias) {
      porAutor.set(historia.usuario_id, [...(porAutor.get(historia.usuario_id) ?? []), historia]);
    }

    const grupos = [...porAutor.values()].map((lista) =>
      this.armarGrupo(lista[0].autor!.toJSON() as UsuarioPublico, lista, usuarioId, vistas),
    );
    return grupos.sort(
      (a, b) =>
        Number(b.es_mio) - Number(a.es_mio) ||
        Number(a.todas_vistas) - Number(b.todas_vistas) ||
        (b.ultima?.getTime() ?? 0) - (a.ultima?.getTime() ?? 0),
    );
  }

  /** Historias vigentes de una cuenta: solo las ve su dueño o quien la sigue (403 si no). */
  async deUsuario(autorId: number, observadorId: number): Promise<GrupoHistorias> {
    const autor = await this.usuarios.findByIdOrFail(autorId, { attributes: [...ATRIBUTOS_USUARIO_PUBLICO] });
    await this.asegurarPuedeVer(autorId, observadorId);

    const historias = await this.repository.vigentesDe(autorId);
    const vistas = autorId === observadorId ? new Set<number>() : await this.vistas.vistasPor(observadorId, historias.map((h) => h.id));
    return this.armarGrupo(autor.toJSON() as UsuarioPublico, historias, observadorId, vistas);
  }

  /** Archivo personal: todas mis historias (vigentes y pasadas), la más reciente primero, con sus destacadas. */
  async archivo(usuarioId: number, paginacion: Paginacion): Promise<Page<HistoriaArchivoDto>> {
    const page = await this.repository.archivoDe(usuarioId, paginacion);
    const enDestacadas = await this.destacadas.destacadasDe(page.items.map((h) => h.id));
    const ahora = Date.now();
    return {
      ...page,
      items: page.items.map((h) => ({
        ...presentarHistoria(h, true),
        vigente: !h.archivada && h.expira_en.getTime() > ahora,
        destacada_ids: enDestacadas.get(h.id) ?? [],
      })),
    };
  }

  // ---------- Vistas ----------

  /** Marca la historia como vista. Idempotente; las propias no cuentan. La primera vista suma a las estadísticas. */
  async marcarVista(historiaId: number, usuarioId: number): Promise<ResultadoVista> {
    const historia = await this.repository.findVigenteOrFail(historiaId);
    if (historia.usuario_id === usuarioId) return { historia_id: historiaId, registrada: false, propia: true };
    await this.asegurarPuedeVer(historia.usuario_id, usuarioId);

    const registrada = await this.db.transaction(async (t) => {
      const creada = await this.vistas.registrar(historiaId, usuarioId, t);
      if (creada) await this.repository.sumarVista(historiaId, t);
      return creada;
    });
    if (registrada) await this.estadisticas.sumarPerfil(historia.usuario_id, 'reproducciones_historias').catch(() => undefined);
    return { historia_id: historiaId, registrada, propia: false };
  }

  /** Quién vio la historia (solo su autor). */
  async quienesVieron(historiaId: number, usuarioId: number, paginacion: Paginacion): Promise<Page<VistaDeHistoria>> {
    const historia = await this.repository.findVigenteOrFail(historiaId);
    this.asegurarDueno(historia.usuario_id, usuarioId, 'Solo el autor puede ver quién vio su historia');
    return this.vistas.paginarDe(historiaId, paginacion);
  }

  // ---------- Borrado ----------

  /**
   * Solo el autor (vigente o del archivo): borra vistas, la saca de sus destacadas y borra la historia
   * en una transacción; después, el archivo y la música de Cloudinary.
   */
  async eliminar(historiaId: number, usuarioId: number): Promise<void> {
    const historia = await this.repository.findByIdOrFail(historiaId);
    this.asegurarDueno(historia.usuario_id, usuarioId, 'Solo el autor puede eliminar esta historia');

    await this.db.transaction(async (t) => {
      await this.vistas.eliminarDe([historia.id], t);
      await this.destacadas.quitarHistoriaDeTodas(historia.id, t);
      await this.repository.eliminarVarias([historia.id], t);
    });
    if (historia.media_s3) await this.storage.eliminar(historia.media_s3);
    if (historia.edicion?.musica_s3) await this.storage.eliminar(historia.edicion.musica_s3);
  }

  /**
   * Las vencidas salen de la bandeja y pasan al archivo (ya no se borran: así se pueden agregar a destacadas
   * y las que están en una destacada se siguen viendo con su archivo). Devuelve cuántas archivó.
   */
  async limpiarVencidas(): Promise<number> {
    const vencidas = await this.repository.vencidas();
    return this.repository.archivar(vencidas.map((h) => h.id));
  }

  // ---------- Apoyo ----------

  /** Coherencia tipo ↔ archivo: texto sin archivo, imagen con image/*, video con video/*. */
  private validarArchivo(tipo: TipoHistoria, archivo?: ArchivoSubido): void {
    if (tipo === 'texto') {
      if (archivo) throw new BadRequestError('Las historias de texto no llevan archivo');
      return;
    }
    if (!archivo) throw new BadRequestError(`La historia de tipo ${tipo} requiere un archivo en el campo media`);

    const familia = tipo === 'imagen' ? 'image/' : 'video/';
    if (!archivo.mimetype.startsWith(familia)) {
      throw new BadRequestError(tipo === 'imagen' ? 'El archivo no es una imagen' : 'El archivo no es un video');
    }
    // El límite de subida es el de video; las imágenes conservan el límite general
    if (tipo === 'imagen' && archivo.tamano > env.MAX_FILE_SIZE) {
      throw new AppError('La imagen excede el tamaño permitido', HttpStatus.PAYLOAD_TOO_LARGE);
    }
  }

  /** Regla de visibilidad: el dueño o quien lo sigue. */
  private async asegurarPuedeVer(autorId: number, observadorId: number): Promise<void> {
    if (autorId === observadorId) return;
    if ((await this.seguidores.relacion(observadorId, autorId))?.estado !== 'aceptado') {
      throw new ForbiddenError('Solo los seguidores de esta cuenta pueden ver sus historias');
    }
  }

  private armarGrupo(usuario: UsuarioPublico, historias: Historia[], observadorId: number, vistas: Set<number>): GrupoHistorias {
    const es_mio = usuario.id === observadorId;
    const dtos = historias.map((h) => presentarHistoria(h, es_mio || vistas.has(h.id)));
    return {
      usuario,
      es_mio,
      historias: dtos,
      todas_vistas: dtos.every((h) => h.vista_por_mi),
      ultima: historias.length ? historias[historias.length - 1].fecha_creacion : null,
    };
  }
}

export const historiaService = new HistoriaService(
  historiaRepository,
  historiaVistaRepository,
  usuarioRepository,
  seguidorRepository,
  fileStorage,
  realtime,
  sequelize,
);

/**
 * Programa el paso al archivo de las historias vencidas (cada 30 min por defecto). `unref()` evita que el
 * temporizador mantenga vivo el proceso. Se llama una vez al arrancar el servidor.
 */
export function programarLimpieza(): NodeJS.Timeout;
export function programarLimpieza(intervaloMs: number): NodeJS.Timeout;
export function programarLimpieza(intervaloMs: number = MINUTOS_LIMPIEZA * 60_000): NodeJS.Timeout {
  const temporizador = setInterval(() => {
    historiaService
      .limpiarVencidas()
      .catch((error: Error) => console.warn('No se pudieron archivar las historias vencidas:', error.message));
  }, intervaloMs);
  temporizador.unref();
  return temporizador;
}
