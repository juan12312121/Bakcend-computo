import type { Attributes } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ForbiddenError, ValidationError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import {
  CATEGORIAS,
  COLOR_POR_CATEGORIA,
  Publicacion as ModeloPublicacion,
  sequelize,
  type Documento,
  type EstadoPublicacion,
  type Publicacion,
  type Visibilidad,
} from '../../infrastructure/database/models';
import { realtime, salas, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { documentoService, type DocumentoService } from '../documentos/documento.service';
import { estadisticaRepository, type EstadisticaRepository } from '../estadisticas/estadistica.repository';
import { extraerHashtags } from '../hashtags/extraer-hashtags';
import { hashtagRepository, type HashtagRepository } from '../hashtags/hashtag.repository';
import { mencionService, type MencionService } from '../menciones/mencion.service';
import { likeRepository, type LikeRepository } from '../likes/like.repository';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { avisoProgramada, type AvisoPublicacionProgramada } from './aviso-programada';
import { aplicarMusica, combinarEdicion, duracionRecortada, urlReproduccion } from './edicion-video';
import { publicacionExtras, SIN_EXTRAS, type ExtrasDePublicacion, type FuenteExtrasPublicacion } from './publicacion-extras';
import { publicacionRepository, type FiltrosFeed, type PublicacionRepository } from './publicacion.repository';
import {
  DURACION_VIDEO_MAXIMA,
  type ActualizarPublicacionDto,
  type CrearPublicacionDto,
  type EdicionVideoDto,
  type EstadoNoPublicado,
} from './publicacion.schemas';
import { asegurarTextoPermitido } from '../moderacion/palabras.service';

export interface ArchivosPublicacion {
  imagen?: ArchivoSubido;
  video?: ArchivoSubido;
  documentos?: ArchivoSubido[];
}

/** Orden del feed: lo más nuevo, o la puntuación de Reels (popularidad + antigüedad). */
export type OrdenFeed = 'recientes' | 'populares';

/** Cuántas publicaciones recientes se consideran para ordenar Reels y el feed "populares". */
export const VENTANA_REELS = 300;

/** Cuántas programadas se publican como máximo en cada vuelta del temporizador. */
export const LOTE_PROGRAMADAS = 50;

/** Lo mínimo para puntuar un reel. */
export interface DatosPuntuacion {
  total_likes: number;
  total_comentarios: number;
  total_vistas: number;
  fecha_creacion: Date | string;
}

/**
 * Puntuación de Reels: mezcla popularidad (likes, comentarios y vistas) con antigüedad.
 * Lo nuevo empieza arriba y baja con las horas salvo que siga sumando interacción.
 */
export function puntuacionReel(p: DatosPuntuacion, ahora: number = Date.now()): number {
  const horas = Math.max(0, (ahora - new Date(p.fecha_creacion).getTime()) / 3_600_000);
  const interaccion = (p.total_likes ?? 0) * 2 + (p.total_comentarios ?? 0) * 3 + (p.total_vistas ?? 0) * 0.2;
  return (interaccion + 1) / Math.pow(horas + 2, 1.3);
}

const IMAGEN_Y_VIDEO = 'Una publicación lleva imagen o video, no ambos';
const errorDuracion = () =>
  new ValidationError([{ campo: 'video_duracion', mensaje: 'Indica la duración del video en segundos (1-180)' }]);
const errorRecorte = () =>
  new ValidationError([{ campo: 'recorte_fin', mensaje: `El video recortado no puede durar más de ${DURACION_VIDEO_MAXIMA} segundos` }]);

/** Publicación lista para el frontend: con autor, adjuntos y si el usuario actual le dio like. */
export type PublicacionVista = Attributes<Publicacion> &
  ExtrasDePublicacion & {
    autor?: unknown;
    documentos: Attributes<Documento>[];
    usuario_dio_like: boolean;
  };

/** Eventos Socket.IO que escucha el frontend. */
export const EVENTOS_PUBLICACION = {
  nueva: 'new_post',
  actualizada: 'update_post',
  eliminada: 'delete_post',
} as const;

const VISIBILIDADES_INFO: { value: Visibilidad; label: string; description: string }[] = [
  { value: 'publico', label: 'Público', description: 'Todos pueden ver esta publicación' },
  { value: 'seguidores', label: 'Solo seguidores', description: 'Solo tus seguidores pueden verla' },
  { value: 'privado', label: 'Privado', description: 'Solo tú puedes verla' },
];

export class PublicacionService extends BaseService<Publicacion, PublicacionRepository> {
  constructor(
    repository: PublicacionRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly documentos: DocumentoService,
    private readonly likes: LikeRepository,
    private readonly storage: FileStorage,
    private readonly realtime: RealtimeGateway,
    private readonly hashtags: HashtagRepository = hashtagRepository,
    private readonly menciones: MencionService = mencionService,
    private readonly extras: FuenteExtrasPublicacion = publicacionExtras,
    private readonly estadisticas: EstadisticaRepository = estadisticaRepository,
    private readonly aviso: AvisoPublicacionProgramada = avisoProgramada,
  ) {
    super(repository);
  }

  // ---------- Catálogos ----------

  categorias() {
    return CATEGORIAS.map((c) => ({ value: c, label: c, color: COLOR_POR_CATEGORIA[c] }));
  }

  /** Catálogo con el total de publicaciones visibles para el usuario en cada categoría. */
  async categoriasConTotales(usuarioId: number | undefined) {
    const totales = await this.repository.totalesPorCategoria(usuarioId);
    return this.categorias().map((c) => ({ ...c, total: totales.get(c.value) ?? 0 }));
  }

  visibilidades() {
    return VISIBILIDADES_INFO;
  }

  // ---------- Lectura ----------

  /**
   * Feed con filtros. `orden: 'recientes'` (por defecto) pagina en SQL; `'populares'` ordena por `puntuacionReel`
   * sobre una ventana de las `VENTANA_REELS` más recientes (con los mismos filtros).
   */
  feed(usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<PublicacionVista>>;
  feed(usuarioId: number | undefined, paginacion: Paginacion, filtros: FiltrosFeed): Promise<Page<PublicacionVista>>;
  feed(usuarioId: number | undefined, paginacion: Paginacion, filtros: FiltrosFeed, orden: OrdenFeed): Promise<Page<PublicacionVista>>;
  async feed(
    usuarioId: number | undefined,
    paginacion: Paginacion,
    filtros: FiltrosFeed = {},
    orden: OrdenFeed = 'recientes',
  ): Promise<Page<PublicacionVista>> {
    if (orden === 'populares') return this.populares(usuarioId, paginacion, filtros);
    return this.paginaVista(await this.repository.feed(usuarioId, paginacion, filtros), usuarioId);
  }

  /**
   * Reels: publicaciones con video visibles (las del feed), ordenadas por `puntuacionReel` sobre una ventana
   * de las `VENTANA_REELS` más recientes. `total` es el tamaño de esa ventana.
   */
  reels(usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<PublicacionVista>> {
    return this.populares(usuarioId, paginacion, { tipo: 'video' });
  }

  /** Ventana acotada ordenada en memoria por puntuación (empate → la más nueva). */
  private async populares(usuarioId: number | undefined, { limit, offset }: Paginacion, filtros: FiltrosFeed): Promise<Page<PublicacionVista>> {
    const candidatos = await this.repository.ventanaFeed(usuarioId, filtros, VENTANA_REELS);
    const ahora = Date.now();
    const ordenados = candidatos
      .map((p) => ({ p, puntos: puntuacionReel(p, ahora) }))
      .sort((a, b) => b.puntos - a.puntos || b.p.id - a.p.id)
      .map((x) => x.p);
    const pagina = ordenados.slice(offset, offset + limit);
    return { items: pagina.length ? await this.vista(pagina, usuarioId) : [], total: ordenados.length, limit, offset };
  }

  /** Suma una reproducción al video (con o sin sesión) y devuelve el total. También suma a las estadísticas del día. */
  async registrarVista(id: number, usuarioId?: number): Promise<{ publicacion_id: number; total_vistas: number }> {
    const publicacion = await this.repository.findVisibleOrFail(id, usuarioId);
    if (!publicacion.video_url) throw new BadRequestError('La publicación no tiene video');
    const total_vistas = await this.repository.sumarVista(id);
    // Una falla de estadísticas nunca rompe la reproducción
    await this.estadisticas.sumarPublicacion(id, publicacion.usuario_id, 'reproducciones').catch(() => undefined);
    return { publicacion_id: id, total_vistas };
  }

  /** Página de publicaciones entre `ids` visibles para el usuario (la usan hashtags y otros módulos). */
  async paginaEntre(ids: number[], usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<PublicacionVista>> {
    return this.paginaVista(await this.repository.paginarEntre(ids, usuarioId, paginacion), usuarioId);
  }

  async deAutor(autorId: number, usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<PublicacionVista>> {
    return this.paginaVista(await this.repository.deAutor(autorId, usuarioId, paginacion), usuarioId);
  }

  async buscar(termino: string, usuarioId: number | undefined, paginacion: Paginacion): Promise<Page<PublicacionVista>> {
    return this.paginaVista(await this.repository.buscar(termino, usuarioId, paginacion), usuarioId);
  }

  /**
   * Para otros módulos (guardados, hashtags, reels...): de `ids`, solo las que el usuario puede ver,
   * ya enriquecidas con `vista()` y en el mismo orden de `ids`.
   */
  async publicas(ids: number[], usuarioId?: number): Promise<PublicacionVista[]> {
    const visibles = await this.repository.visiblesPorIds(ids, usuarioId);
    const porId = new Map(visibles.map((p) => [p.id, p]));
    const ordenadas = [...new Set(ids)].map((id) => porId.get(id)).filter((p): p is Publicacion => !!p);
    return ordenadas.length ? this.vista(ordenadas, usuarioId) : [];
  }

  /** Detalle respetando la visibilidad (404 si no se puede ver; las programadas y borradores solo las ve su autor). */
  async detalle(id: number, usuarioId?: number): Promise<PublicacionVista> {
    return this.vista(await this.repository.findVisibleOrFail(id, usuarioId), usuarioId);
  }

  // ---------- Escritura ----------

  /**
   * Crea una publicación. Con `programada_para` queda programada (sale sola a esa hora) y con `borrador`
   * queda como borrador: en ambos casos no se procesan hashtags ni menciones, no suma al contador del autor
   * ni se anuncia hasta que se publique. Con video, `edicion` guarda los ajustes del editor.
   */
  async crear(usuarioId: number, datos: CrearPublicacionDto, archivos: ArchivosPublicacion = {}): Promise<PublicacionVista> {
    datos = { ...datos, contenido: await asegurarTextoPermitido(datos.contenido, 'publicacion') };
    if (archivos.imagen && archivos.video) throw new BadRequestError(IMAGEN_Y_VIDEO);
    if (archivos.video && !datos.video_duracion) throw errorDuracion();
    if (datos.edicion && !archivos.video) throw new BadRequestError('Los ajustes de video necesitan un video');
    if (datos.grupo_id && !(await this.repository.esMiembroActivoDeGrupo(datos.grupo_id, usuarioId))) {
      throw new ForbiddenError('Debes ser miembro activo del grupo para publicar en él');
    }
    const estado: EstadoPublicacion = datos.borrador ? 'borrador' : datos.programada_para ? 'programada' : 'publicada';
    const edicion = archivos.video && datos.edicion ? combinarEdicion(null, datos.edicion) : null;
    const recortada = duracionRecortada(edicion);
    if (recortada !== null && recortada > DURACION_VIDEO_MAXIMA) throw errorRecorte();

    // La publicación, sus adjuntos y sus hashtags se guardan juntos o no se guarda nada
    const id = await sequelize.transaction(async (transaction) => {
      const creada = await this.repository.create(
        {
          usuario_id: usuarioId,
          contenido: datos.contenido,
          categoria: datos.categoria,
          color_categoria: COLOR_POR_CATEGORIA[datos.categoria],
          visibilidad: datos.visibilidad,
          grupo_id: datos.grupo_id ?? null,
          imagen_url: archivos.imagen?.url ?? null,
          imagen_s3: archivos.imagen?.id ?? null,
          video_url: archivos.video ? urlReproduccion(archivos.video.url, edicion) : null,
          video_original_url: archivos.video?.url ?? null,
          video_s3: archivos.video?.id ?? null,
          video_duracion: archivos.video ? (recortada ?? datos.video_duracion ?? null) : null,
          edicion,
          estado,
          programada_para: estado === 'programada' ? (datos.programada_para ?? null) : null,
        },
        transaction,
      );
      await this.documentos.registrar(usuarioId, archivos.documentos ?? [], creada.id, transaction);
      if (estado === 'publicada') await this.hashtags.sincronizar(creada.id, extraerHashtags(datos.contenido), transaction);
      return creada.id;
    });

    if (estado !== 'publicada') return this.vista(await this.repository.findByIdOrFail(id), usuarioId);
    await this.usuarios.ajustarContador(usuarioId, 'total_posts', +1);
    const publicacion = await this.vista(await this.repository.findByIdOrFail(id), usuarioId);
    this.emitir(EVENTOS_PUBLICACION.nueva, publicacion.grupo_id, publicacion);
    await this.menciones.notificar(datos.contenido, usuarioId, { publicacion_id: id });
    return publicacion;
  }

  /**
   * Edita texto, categoría, visibilidad y el archivo principal. Una imagen nueva reemplaza a la imagen o al video
   * que hubiera (y viceversa); `quitar_video` lo quita. Los archivos reemplazados se borran del almacenamiento
   * (también la música del editor). En programadas y borradores no se procesan hashtags ni se anuncia nada.
   */
  actualizar(id: number, usuarioId: number, datos: ActualizarPublicacionDto): Promise<PublicacionVista>;
  actualizar(id: number, usuarioId: number, datos: ActualizarPublicacionDto, archivos: ArchivosPublicacion): Promise<PublicacionVista>;
  async actualizar(
    id: number,
    usuarioId: number,
    datos: ActualizarPublicacionDto,
    { imagen, video, documentos = [] }: ArchivosPublicacion = {},
  ): Promise<PublicacionVista> {
    if (documentos.length) throw new BadRequestError('Los documentos se adjuntan al crear la publicación o desde Documentos');
    if (datos.contenido !== undefined) datos = { ...datos, contenido: await asegurarTextoPermitido(datos.contenido, 'publicacion') };
    if (imagen && video) throw new BadRequestError(IMAGEN_Y_VIDEO);
    if (video && !datos.video_duracion) throw errorDuracion();

    const publicacion = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(publicacion.usuario_id, usuarioId, 'No tienes permiso para modificar esta publicación');

    const cambios: Partial<Attributes<Publicacion>> = {};
    const reemplazados: (string | null)[] = [];
    const sinVideo = { video_url: null, video_s3: null, video_duracion: null, video_original_url: null, edicion: null };
    const musica = publicacion.edicion?.musica_s3 ?? null;
    if (datos.contenido !== undefined) cambios.contenido = datos.contenido;
    if (datos.visibilidad) cambios.visibilidad = datos.visibilidad;
    if (datos.categoria) {
      cambios.categoria = datos.categoria;
      cambios.color_categoria = COLOR_POR_CATEGORIA[datos.categoria];
    }
    if (imagen) {
      Object.assign(cambios, { imagen_url: imagen.url, imagen_s3: imagen.id }, publicacion.video_url ? sinVideo : {});
      reemplazados.push(publicacion.imagen_s3, publicacion.video_s3, publicacion.video_url ? musica : null);
    } else if (video) {
      Object.assign(cambios, {
        video_url: video.url,
        video_original_url: video.url,
        edicion: null,
        video_s3: video.id,
        video_duracion: datos.video_duracion,
        imagen_url: null,
        imagen_s3: null,
      });
      reemplazados.push(publicacion.video_s3, publicacion.imagen_s3, musica);
    } else if (datos.quitar_video && publicacion.video_url) {
      Object.assign(cambios, sinVideo);
      reemplazados.push(publicacion.video_s3, musica);
    } else if (datos.video_duracion && publicacion.video_url) {
      cambios.video_duracion = datos.video_duracion;
    }
    if (!Object.keys(cambios).length) throw new BadRequestError('No hay datos para actualizar');

    const textoAnterior = publicacion.contenido;
    const publicada = publicacion.estado === 'publicada';
    const nuevoTexto = publicada && cambios.contenido !== undefined && cambios.contenido !== textoAnterior ? cambios.contenido : null;
    await sequelize.transaction(async (transaction) => {
      await this.repository.update(publicacion, cambios, transaction);
      if (nuevoTexto !== null) await this.hashtags.sincronizar(id, extraerHashtags(nuevoTexto), transaction);
    });
    await Promise.all(reemplazados.filter((r): r is string => !!r).map((r) => this.storage.eliminar(r)));

    const actualizada = await this.vista(await this.repository.findByIdOrFail(id), usuarioId);
    if (publicada) this.emitir(EVENTOS_PUBLICACION.actualizada, actualizada.grupo_id, actualizada);
    if (nuevoTexto !== null) await this.menciones.notificarNuevas(nuevoTexto, textoAnterior, usuarioId, { publicacion_id: id });
    return actualizada;
  }

  /**
   * Borra la publicación con sus adjuntos, la saca de las secciones y libera los archivos.
   * eliminar(id, usuarioId) → solo el autor · eliminar(id, adminId, { comoAdmin: true }) → moderación.
   */
  eliminar(id: number, usuarioId: number): Promise<Publicacion>;
  eliminar(id: number, usuarioId: number, opciones: { comoAdmin: boolean }): Promise<Publicacion>;
  async eliminar(id: number, usuarioId: number, { comoAdmin = false }: { comoAdmin?: boolean } = {}): Promise<Publicacion> {
    const publicacion = await this.repository.findByIdOrFail(id);
    if (!comoAdmin) this.asegurarDueno(publicacion.usuario_id, usuarioId, 'No tienes permiso para eliminar esta publicación');
    const publicada = publicacion.estado === 'publicada';

    const adjuntos = await this.documentos.adjuntosDe([id]);
    await sequelize.transaction(async (transaction) => {
      await this.documentos.borrarDePublicacion(id, transaction);
      await this.repository.quitarDeSecciones(id, transaction);
      await this.hashtags.sincronizar(id, [], transaction);
      await this.repository.delete({ id }, transaction);
      // Las programadas y los borradores nunca sumaron al contador del autor
      if (publicada) await this.usuarios.ajustarContador(publicacion.usuario_id, 'total_posts', -1, transaction);
    });

    await Promise.all([
      this.storage.eliminar(publicacion.imagen_s3),
      publicacion.video_s3 ? this.storage.eliminar(publicacion.video_s3) : Promise.resolve(false),
      publicacion.edicion?.musica_s3 ? this.storage.eliminar(publicacion.edicion.musica_s3) : Promise.resolve(false),
      this.documentos.liberarArchivos(adjuntos),
    ]);
    if (publicada) this.emitir(EVENTOS_PUBLICACION.eliminada, publicacion.grupo_id, { id });
    return publicacion;
  }

  /** Feed de un grupo con la misma vista que el feed general (adjuntos y like). */
  async deGrupo(grupoId: number, paginacion: Paginacion, usuarioId?: number): Promise<Page<PublicacionVista>> {
    return this.paginaVista(await this.repository.deGrupo(grupoId, paginacion), usuarioId);
  }

  // ---------- Programadas y borradores ----------

  /** Mis programadas (la próxima primero) o mis borradores (el último editado primero). */
  async noPublicadas(usuarioId: number, estado: EstadoNoPublicado, paginacion: Paginacion): Promise<Page<PublicacionVista>> {
    return this.paginaVista(await this.repository.noPublicadasDe(usuarioId, estado, paginacion), usuarioId);
  }

  /** Programa (o reprograma) una programada o un borrador. */
  async programar(id: number, usuarioId: number, fecha: Date): Promise<PublicacionVista> {
    const publicacion = await this.noPublicadaPropia(id, usuarioId);
    await this.repository.update(publicacion, { estado: 'programada', programada_para: fecha });
    return this.vista(await this.repository.findByIdOrFail(id), usuarioId);
  }

  /** Cancela la programación: queda como borrador (para editarla, programarla de nuevo o borrarla). */
  async cancelarProgramacion(id: number, usuarioId: number): Promise<PublicacionVista> {
    const publicacion = await this.noPublicadaPropia(id, usuarioId);
    if (publicacion.estado !== 'programada') throw new BadRequestError('La publicación no está programada');
    await this.repository.update(publicacion, { estado: 'borrador', programada_para: null });
    return this.vista(await this.repository.findByIdOrFail(id), usuarioId);
  }

  /** Publica ya una programada o un borrador. */
  async publicarAhora(id: number, usuarioId: number): Promise<PublicacionVista> {
    const publicacion = await this.noPublicadaPropia(id, usuarioId);
    if (!(await this.publicar(publicacion))) throw new ForbiddenError('Ya no eres miembro activo del grupo de esta publicación');
    return this.vista(await this.repository.findByIdOrFail(id), usuarioId);
  }

  /**
   * Publica las programadas cuya hora llegó (lo llama `programarPublicaciones` cada minuto) y avisa a cada autor
   * con una notificación 'publicacion_programada'. Una que falla no detiene a las demás. Devuelve cuántas publicó.
   */
  async publicarProgramadas(ahora: Date = new Date()): Promise<number> {
    let publicadas = 0;
    for (const publicacion of await this.repository.listasParaPublicar(ahora, LOTE_PROGRAMADAS)) {
      try {
        if (!(await this.publicar(publicacion))) continue;
        publicadas++;
        await this.aviso.publicada(publicacion).catch(() => undefined);
      } catch (error) {
        console.warn(`No se pudo publicar la publicación programada ${publicacion.id}:`, (error as Error).message);
      }
    }
    return publicadas;
  }

  // ---------- Editor de video ----------

  /**
   * Guarda los ajustes del editor de video (recorte, silencio, música y texto) y arma la URL de reproducción
   * (`video_url`; el archivo tal como se subió queda en `video_original_url`). La música llega como archivo
   * de audio (`archivo`); `quitar_musica` la quita. La pista reemplazada se borra del almacenamiento.
   */
  editarVideo(id: number, usuarioId: number, datos: EdicionVideoDto): Promise<PublicacionVista>;
  editarVideo(id: number, usuarioId: number, datos: EdicionVideoDto, musica: ArchivoSubido | undefined): Promise<PublicacionVista>;
  async editarVideo(id: number, usuarioId: number, datos: EdicionVideoDto, musica?: ArchivoSubido): Promise<PublicacionVista> {
    if (musica && !musica.mimetype.startsWith('audio/')) throw new BadRequestError('La música debe ser un archivo de audio');
    const publicacion = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(publicacion.usuario_id, usuarioId, 'No tienes permiso para modificar esta publicación');
    if (!publicacion.video_url) throw new BadRequestError('La publicación no tiene video');

    const { edicion, reemplazada } = aplicarMusica(combinarEdicion(publicacion.edicion, datos), publicacion.edicion, musica, datos.quitar_musica);
    const recortada = duracionRecortada(edicion);
    if (recortada !== null && recortada > DURACION_VIDEO_MAXIMA) throw errorRecorte();
    const original = publicacion.video_original_url ?? publicacion.video_url;
    await this.repository.update(publicacion, {
      edicion,
      video_original_url: original,
      video_url: urlReproduccion(original, edicion),
      ...(recortada !== null ? { video_duracion: recortada } : {}),
    });
    if (reemplazada) await this.storage.eliminar(reemplazada);

    const actualizada = await this.vista(await this.repository.findByIdOrFail(id), usuarioId);
    if (publicacion.estado === 'publicada') this.emitir(EVENTOS_PUBLICACION.actualizada, actualizada.grupo_id, actualizada);
    return actualizada;
  }

  // ---------- Apoyo ----------

  /** Programada o borrador del usuario (404 si no existe, 403 si no es suya, 400 si ya está publicada). */
  private async noPublicadaPropia(id: number, usuarioId: number): Promise<Publicacion> {
    const publicacion = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(publicacion.usuario_id, usuarioId, 'No tienes permiso para modificar esta publicación');
    if (publicacion.estado === 'publicada') throw new BadRequestError('La publicación ya está publicada');
    return publicacion;
  }

  /**
   * Pasa a publicada como si se creara en ese momento: la fecha de creación es la hora de publicación, se procesan
   * hashtags y menciones, suma al contador del autor y se anuncia como nueva. Si era de un grupo del que el autor
   * ya no es miembro activo, queda como borrador y devuelve false.
   */
  private async publicar(publicacion: Publicacion): Promise<boolean> {
    const { id, usuario_id: autorId, grupo_id: grupoId } = publicacion;
    if (grupoId && !(await this.repository.esMiembroActivoDeGrupo(grupoId, autorId))) {
      await this.repository.update(publicacion, { estado: 'borrador', programada_para: null });
      return false;
    }
    await sequelize.transaction(async (transaction) => {
      await ModeloPublicacion.update(
        { estado: 'publicada', programada_para: null, fecha_creacion: new Date() },
        { where: { id }, transaction },
      );
      await this.hashtags.sincronizar(id, extraerHashtags(publicacion.contenido), transaction);
      await this.usuarios.ajustarContador(autorId, 'total_posts', +1, transaction);
    });
    const vista = await this.vista(await this.repository.findByIdOrFail(id), autorId);
    this.emitir(EVENTOS_PUBLICACION.nueva, grupoId, vista);
    await this.menciones.notificar(publicacion.contenido, autorId, { publicacion_id: id });
    return true;
  }

  // ---------- Presentación ----------

  /** Agrega adjuntos, `usuario_dio_like` y los extras (reacciones, guardada, encuesta) a una o varias publicaciones. */
  private vista(publicacion: Publicacion, usuarioId?: number): Promise<PublicacionVista>;
  private vista(publicaciones: Publicacion[], usuarioId?: number): Promise<PublicacionVista[]>;
  private async vista(
    entrada: Publicacion | Publicacion[],
    usuarioId?: number,
  ): Promise<PublicacionVista | PublicacionVista[]> {
    const lista = Array.isArray(entrada) ? entrada : [entrada];
    const ids = lista.map((p) => p.id);
    const [adjuntos, conLike, extras] = await Promise.all([
      this.documentos.adjuntosDe(ids),
      usuarioId ? this.likes.publicacionesConLike(usuarioId, ids) : Promise.resolve(new Set<number>()),
      this.extras.para(ids, usuarioId),
    ]);

    const vistas = lista.map((p) => ({
      ...p.toJSON(),
      ...(extras.get(p.id) ?? SIN_EXTRAS),
      documentos: adjuntos.filter((d) => d.publicacion_id === p.id).map((d) => d.toJSON()),
      usuario_dio_like: conLike.has(p.id),
    }));
    return Array.isArray(entrada) ? vistas : vistas[0];
  }

  private async paginaVista(page: Page<Publicacion>, usuarioId?: number): Promise<Page<PublicacionVista>> {
    return { ...page, items: await this.vista(page.items, usuarioId) };
  }

  /** Las publicaciones de grupo solo se anuncian en la sala del grupo. */
  private emitir(evento: string, grupoId: number | null, data: unknown): void {
    if (grupoId) this.realtime.aSala(salas.grupo(grupoId), evento, data);
    else this.realtime.aTodos(evento, data);
  }
}

export const publicacionService = new PublicacionService(
  publicacionRepository,
  usuarioRepository,
  documentoService,
  likeRepository,
  fileStorage,
  realtime,
);

/**
 * Programa la publicación de las programadas (cada minuto por defecto). `unref()` evita que el temporizador
 * mantenga vivo el proceso. Se llama una vez al arrancar el servidor.
 */
export function programarPublicaciones(): NodeJS.Timeout;
export function programarPublicaciones(intervaloMs: number): NodeJS.Timeout;
export function programarPublicaciones(intervaloMs: number = 60_000): NodeJS.Timeout {
  const temporizador = setInterval(() => {
    publicacionService
      .publicarProgramadas()
      .catch((error: Error) => console.warn('No se pudieron publicar las publicaciones programadas:', error.message));
  }, intervaloMs);
  temporizador.unref();
  return temporizador;
}
