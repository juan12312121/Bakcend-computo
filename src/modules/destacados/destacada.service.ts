import type { Attributes, Sequelize } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ForbiddenError, NotFoundError } from '../../core/errors';
import { sequelize, type Historia, type HistoriaDestacada } from '../../infrastructure/database/models';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { historiaRepository, type HistoriaRepository } from '../historias/historia.repository';
import { presentarHistoria, type HistoriaDto } from '../historias/historia.service';
import { privacidadService, type PrivacidadService } from '../privacidad/privacidad.service';
import { miniaturaVideo } from '../publicaciones/edicion-video';
import { ATRIBUTOS_USUARIO_PUBLICO, usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { destacadaRepository, type DestacadaRepository } from './destacada.repository';
import {
  MAX_DESTACADAS,
  MAX_HISTORIAS_DESTACADA,
  type ActualizarDestacadaDto,
  type CrearDestacadaDto,
} from './destacada.schemas';

/** Cómo pintar el círculo: una imagen o (si la portada es una historia de texto) su gradiente y texto. */
export type PortadaDestacada =
  | { tipo: 'imagen'; url: string }
  | { tipo: 'texto'; fondo: string | null; texto: string | null }
  | { tipo: 'ninguna' };

/** Destacada para el perfil (círculo). */
export interface DestacadaDto {
  id: number;
  usuario_id: number;
  titulo: string;
  orden: number;
  portada: PortadaDestacada;
  /** Si la portada es una imagen subida (no una historia). */
  portada_subida: boolean;
  portada_historia_id: number | null;
  total_historias: number;
  /** Ids de sus historias en orden de reproducción. */
  historia_ids: number[];
  fecha_creacion: Date;
  fecha_actualizacion: Date;
}

/** Destacada abierta en el visor: con su dueño (datos públicos) y sus historias completas. */
export interface DestacadaConHistorias extends DestacadaDto {
  usuario: object | null;
  historias: HistoriaDto[];
}

type ColumnasPortada = Pick<Attributes<Historia>, 'tipo' | 'media_url' | 'media_original_url' | 'texto' | 'fondo'>;

/** Portada a partir de una historia: imagen tal cual, primer cuadro del video, o el gradiente si es de texto. */
export function portadaDeHistoria(historia: ColumnasPortada | null | undefined): PortadaDestacada {
  if (!historia) return { tipo: 'ninguna' };
  if (historia.tipo === 'texto') return { tipo: 'texto', fondo: historia.fondo, texto: historia.texto };
  if (historia.tipo === 'imagen' && historia.media_url) return { tipo: 'imagen', url: historia.media_url };
  const miniatura = miniaturaVideo(historia.media_original_url ?? historia.media_url);
  return miniatura ? { tipo: 'imagen', url: miniatura } : { tipo: 'ninguna' };
}

/**
 * Historias destacadas del perfil: colecciones de historias propias que no vencen.
 * Las ve quien puede ver las publicaciones del dueño (cuenta pública sin bloqueo, o seguidor aceptado).
 */
export class DestacadaService extends BaseService<HistoriaDestacada, DestacadaRepository> {
  constructor(
    repository: DestacadaRepository,
    private readonly historias: HistoriaRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly privacidad: PrivacidadService,
    private readonly storage: FileStorage,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  // ---------- Consultar ----------

  /** Destacadas de un perfil (las vacías solo las ve su dueño). 404 si la cuenta no existe, 403 si no se puede ver. */
  async deUsuario(usuarioId: number, observadorId?: number): Promise<DestacadaDto[]> {
    await this.asegurarPuedeVer(usuarioId, observadorId);
    const lista = (await this.repository.deUsuario(usuarioId)).map((d) => this.presentar(d));
    return usuarioId === observadorId ? lista : lista.filter((d) => d.total_historias > 0);
  }

  /** Una destacada con sus historias, para el visor. */
  async detalle(id: number, observadorId?: number): Promise<DestacadaConHistorias> {
    const destacada = await this.repository.findByIdOrFail(id);
    await this.asegurarPuedeVer(destacada.usuario_id, observadorId);
    return this.conHistorias(destacada);
  }

  // ---------- Escribir ----------

  async crear(usuarioId: number, datos: CrearDestacadaDto): Promise<DestacadaConHistorias>;
  async crear(usuarioId: number, datos: CrearDestacadaDto, portada: ArchivoSubido | undefined): Promise<DestacadaConHistorias>;
  async crear(usuarioId: number, datos: CrearDestacadaDto, portada?: ArchivoSubido): Promise<DestacadaConHistorias> {
    this.validarPortada(portada);
    if ((await this.repository.count({ usuario_id: usuarioId })) >= MAX_DESTACADAS) {
      throw new BadRequestError(`Puedes tener máximo ${MAX_DESTACADAS} destacadas`);
    }
    await this.asegurarPropias(usuarioId, datos.historia_ids);
    const portadaHistoria = this.portadaEntre(datos.portada_historia_id, datos.historia_ids);

    const orden = await this.repository.siguienteOrden(usuarioId);
    const id = await this.db.transaction(async (t) => {
      const creada = await this.repository.create(
        {
          usuario_id: usuarioId,
          titulo: datos.titulo,
          orden,
          portada_url: portada?.url ?? null,
          portada_s3: portada?.id ?? null,
          portada_historia_id: portadaHistoria,
        },
        t,
      );
      await this.repository.reemplazarItems(creada.id, datos.historia_ids, t);
      return creada.id;
    });
    return this.conHistorias(await this.repository.findByIdOrFail(id));
  }

  /** Cambia título, contenido (y su orden) y portada. Una portada subida reemplaza (y borra) la anterior. */
  async actualizar(id: number, usuarioId: number, datos: ActualizarDestacadaDto): Promise<DestacadaConHistorias>;
  async actualizar(id: number, usuarioId: number, datos: ActualizarDestacadaDto, portada: ArchivoSubido | undefined): Promise<DestacadaConHistorias>;
  async actualizar(id: number, usuarioId: number, datos: ActualizarDestacadaDto, portada?: ArchivoSubido): Promise<DestacadaConHistorias> {
    this.validarPortada(portada);
    const destacada = await this.propia(id, usuarioId);
    if (datos.historia_ids) await this.asegurarPropias(usuarioId, datos.historia_ids);

    const historiaIds = datos.historia_ids ?? (destacada.items ?? []).map((i) => i.historia_id);
    const cambios: Partial<Attributes<HistoriaDestacada>> = {};
    if (datos.titulo !== undefined) cambios.titulo = datos.titulo;
    if (datos.portada_historia_id !== undefined) cambios.portada_historia_id = this.portadaEntre(datos.portada_historia_id ?? undefined, historiaIds);
    else if (destacada.portada_historia_id && !historiaIds.includes(destacada.portada_historia_id)) cambios.portada_historia_id = null;

    let borrar: string | null = null;
    if (portada) {
      Object.assign(cambios, { portada_url: portada.url, portada_s3: portada.id });
      borrar = destacada.portada_s3;
    } else if (datos.quitar_portada && destacada.portada_url) {
      Object.assign(cambios, { portada_url: null, portada_s3: null });
      borrar = destacada.portada_s3;
    }
    if (!Object.keys(cambios).length && !datos.historia_ids) throw new BadRequestError('No hay datos para actualizar');

    await this.db.transaction(async (t) => {
      if (Object.keys(cambios).length) await this.repository.update(destacada, cambios, t);
      if (datos.historia_ids) await this.repository.reemplazarItems(id, datos.historia_ids, t);
    });
    if (borrar) await this.storage.eliminar(borrar);
    return this.conHistorias(await this.repository.findByIdOrFail(id));
  }

  /** Agrega una historia propia al final (desde el archivo o desde el visor). */
  async agregarHistoria(id: number, usuarioId: number, historiaId: number): Promise<DestacadaDto> {
    await this.propia(id, usuarioId);
    await this.asegurarPropias(usuarioId, [historiaId]);
    if ((await this.repository.contarItems(id)) >= MAX_HISTORIAS_DESTACADA) {
      throw new BadRequestError(`Una destacada admite máximo ${MAX_HISTORIAS_DESTACADA} historias`);
    }
    await this.repository.agregarItem(id, historiaId);
    return this.presentar(await this.repository.findByIdOrFail(id));
  }

  /** Quita una historia (la historia sigue en el archivo). Si era la portada, vuelve a la primera. */
  async quitarHistoria(id: number, usuarioId: number, historiaId: number): Promise<DestacadaDto> {
    const destacada = await this.propia(id, usuarioId);
    if (!(await this.repository.quitarItem(id, historiaId))) throw new NotFoundError('Historia', 'La historia no está en esta destacada');
    if (destacada.portada_historia_id === historiaId) await this.repository.update(destacada, { portada_historia_id: null });
    return this.presentar(await this.repository.findByIdOrFail(id));
  }

  /** Orden de las destacadas en el perfil (todas deben ser del usuario). */
  async reordenar(usuarioId: number, ids: number[]): Promise<DestacadaDto[]> {
    const mias = new Set((await this.repository.deUsuario(usuarioId)).map((d) => d.id));
    if (ids.some((id) => !mias.has(id))) throw new BadRequestError('Solo puedes ordenar tus propias destacadas');
    await this.db.transaction((t) => this.repository.reordenar(usuarioId, ids, t));
    return this.deUsuario(usuarioId, usuarioId);
  }

  /** Borra la destacada (las historias siguen en el archivo) y su portada subida. */
  async eliminar(id: number, usuarioId: number): Promise<void> {
    const destacada = await this.propia(id, usuarioId);
    await this.repository.delete({ id });
    if (destacada.portada_s3) await this.storage.eliminar(destacada.portada_s3);
  }

  // ---------- Apoyo ----------

  private async propia(id: number, usuarioId: number): Promise<HistoriaDestacada> {
    const destacada = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(destacada.usuario_id, usuarioId, 'Solo el dueño puede modificar esta destacada');
    return destacada;
  }

  /** Todas las historias deben existir y ser del usuario (vigentes o del archivo). */
  private async asegurarPropias(usuarioId: number, historiaIds: number[]): Promise<void> {
    const propias = await this.historias.propiasEntre(usuarioId, historiaIds);
    if (propias.length !== new Set(historiaIds).size) throw new BadRequestError('Solo puedes destacar tus propias historias');
  }

  /** La portada elegida debe estar entre las historias de la destacada (si no se elige, null = la primera). */
  private portadaEntre(portadaId: number | undefined, historiaIds: number[]): number | null {
    if (portadaId === undefined) return null;
    if (!historiaIds.includes(portadaId)) throw new BadRequestError('La portada debe ser una de las historias de la destacada');
    return portadaId;
  }

  private validarPortada(portada?: ArchivoSubido): void {
    if (portada && !portada.mimetype.startsWith('image/')) throw new BadRequestError('La portada debe ser una imagen');
  }

  /** Mismo criterio que las publicaciones: dueño, cuenta pública sin bloqueo o seguidor aceptado. */
  private async asegurarPuedeVer(usuarioId: number, observadorId?: number): Promise<void> {
    const usuario = await this.usuarios.findById(usuarioId, { attributes: ['id', 'activo'] });
    if (!usuario || !usuario.activo) throw new NotFoundError('Usuario');
    if (!(await this.privacidad.puedeVerPublicacionesDe(usuarioId, observadorId))) {
      throw new ForbiddenError('No puedes ver las destacadas de esta cuenta');
    }
  }

  private presentar(destacada: HistoriaDestacada): DestacadaDto {
    const items = destacada.items ?? [];
    const primera = items[0]?.historia ?? null;
    const portada: PortadaDestacada = destacada.portada_url
      ? { tipo: 'imagen', url: destacada.portada_url }
      : portadaDeHistoria(destacada.portadaHistoria ?? primera);
    return {
      id: destacada.id,
      usuario_id: destacada.usuario_id,
      titulo: destacada.titulo,
      orden: destacada.orden,
      portada,
      portada_subida: !!destacada.portada_url,
      portada_historia_id: destacada.portada_historia_id,
      total_historias: items.length,
      historia_ids: items.map((i) => i.historia_id),
      fecha_creacion: destacada.fecha_creacion,
      fecha_actualizacion: destacada.fecha_actualizacion,
    };
  }

  private async conHistorias(destacada: HistoriaDestacada): Promise<DestacadaConHistorias> {
    const [historias, usuario] = await Promise.all([
      this.repository.historiasDe(destacada.id),
      this.usuarios.findById(destacada.usuario_id, { attributes: [...ATRIBUTOS_USUARIO_PUBLICO] }),
    ]);
    return { ...this.presentar(destacada), usuario: usuario?.toJSON() ?? null, historias: historias.map((h) => presentarHistoria(h, true)) };
  }
}

export const destacadaService = new DestacadaService(
  destacadaRepository,
  historiaRepository,
  usuarioRepository,
  privacidadService,
  fileStorage,
  sequelize,
);
