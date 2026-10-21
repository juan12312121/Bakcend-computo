import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, NotFoundError } from '../../core/errors';
import { sequelize, type Publicacion, type Seccion } from '../../infrastructure/database/models';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { seccionRepository, type SeccionRepository } from './seccion.repository';
import type { ActualizarSeccionDto, CrearSeccionDto, PostSeccionDto } from './seccion.schemas';

export interface SeccionConPublicaciones {
  seccion: Seccion;
  publicaciones: Publicacion[];
}

export class SeccionService extends BaseService<Seccion, SeccionRepository> {
  constructor(
    repository: SeccionRepository,
    private readonly publicacionesRepo: PublicacionRepository,
    private readonly storage: FileStorage,
  ) {
    super(repository);
  }

  // ---------- Lectura ----------

  deUsuario(usuarioId: number): Promise<Seccion[]> {
    return this.repository.deUsuario(usuarioId);
  }

  /** Vista pública: la sección debe ser de ese usuario y solo se listan publicaciones visibles para quien mira. */
  async verPublica(duenoId: number, seccionId: number, usuarioId?: number): Promise<SeccionConPublicaciones> {
    const seccion = await this.repository.findOne({ id: seccionId, usuario_id: duenoId });
    if (!seccion) throw new NotFoundError('Sección');
    const visibles = await this.publicacionesRepo.filtroVisibles(usuarioId);
    return { seccion, publicaciones: await this.repository.publicaciones(seccion, visibles) };
  }

  /** Vista del dueño: todas sus publicaciones de la sección. */
  async verPropia(id: number, usuarioId: number): Promise<SeccionConPublicaciones> {
    const seccion = await this.propia(id, usuarioId);
    return { seccion, publicaciones: await this.repository.publicaciones(seccion) };
  }

  async seccionesDePublicacion(publicacionId: number, usuarioId: number): Promise<Seccion[]> {
    const publicacion = await this.publicacionesRepo.findByIdOrFail(publicacionId);
    this.asegurarDueno(publicacion.usuario_id, usuarioId, 'Solo puedes consultar las secciones de tus publicaciones');
    return this.repository.dePublicacion(publicacionId, usuarioId);
  }

  // ---------- Escritura ----------

  crear(usuarioId: number, datos: CrearSeccionDto, portada?: ArchivoSubido): Promise<Seccion> {
    return this.liberarSiFalla(portada, async () => {
      if (await this.repository.existeNombre(usuarioId, datos.nombre)) {
        throw new ConflictError('Ya existe una sección con ese nombre');
      }
      return this.repository.create({
        usuario_id: usuarioId,
        nombre: datos.nombre,
        ...(datos.icono ? { icono: datos.icono } : {}),
        ...(datos.color ? { color: datos.color } : {}),
        imagen_portada: portada?.url ?? null,
      });
    });
  }

  /** Solo el dueño; si llega portada nueva se borra la anterior de Cloudinary. */
  actualizar(id: number, usuarioId: number, datos: ActualizarSeccionDto, portada?: ArchivoSubido): Promise<Seccion> {
    return this.liberarSiFalla(portada, async () => {
      const seccion = await this.propia(id, usuarioId);

      const cambios: Partial<Seccion> = Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined));
      if (portada) cambios.imagen_portada = portada.url;
      if (!Object.keys(cambios).length) throw new BadRequestError('No hay datos para actualizar');

      if (datos.nombre && (await this.repository.existeNombre(usuarioId, datos.nombre, id))) {
        throw new ConflictError('Ya existe una sección con ese nombre');
      }

      const anterior = portada ? seccion.imagen_portada : null;
      const actualizada = await this.repository.update(seccion, cambios);
      await this.storage.eliminar(anterior);
      return actualizada;
    });
  }

  async eliminar(id: number, usuarioId: number): Promise<void> {
    const seccion = await this.propia(id, usuarioId);
    await sequelize.transaction((t) => this.repository.eliminarConRelaciones(seccion, t));
    await this.storage.eliminar(seccion.imagen_portada);
  }

  /** La publicación debe ser del dueño de la sección; total_posts se recalcula en la misma transacción. */
  async agregarPublicacion(usuarioId: number, { seccion_id, publicacion_id }: PostSeccionDto): Promise<Seccion> {
    const seccion = await this.propia(seccion_id, usuarioId);
    const publicacion = await this.publicacionesRepo.findByIdOrFail(publicacion_id);
    this.asegurarDueno(publicacion.usuario_id, usuarioId, 'Solo puedes agregar tus propias publicaciones');

    if (await this.repository.tienePublicacion(seccion.id, publicacion_id)) {
      throw new ConflictError('La publicación ya está en esta sección');
    }

    await sequelize.transaction(async (t) => {
      await this.repository.agregarPublicacion(seccion.id, publicacion_id, t);
      await this.repository.recontarPosts(seccion.id, t);
    });
    return this.repository.findByIdOrFail(seccion.id);
  }

  async quitarPublicacion(usuarioId: number, { seccion_id, publicacion_id }: PostSeccionDto): Promise<Seccion> {
    const seccion = await this.propia(seccion_id, usuarioId);

    await sequelize.transaction(async (t) => {
      const borradas = await this.repository.quitarPublicacion(seccion.id, publicacion_id, t);
      if (!borradas) throw new NotFoundError('Publicación', 'La publicación no está en esta sección');
      await this.repository.recontarPosts(seccion.id, t);
    });
    return this.repository.findByIdOrFail(seccion.id);
  }

  // ---------- Auxiliares ----------

  /** Sección existente (404) y del usuario (403). */
  private async propia(id: number, usuarioId: number): Promise<Seccion> {
    const seccion = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(seccion.usuario_id, usuarioId, 'Esta sección no te pertenece');
    return seccion;
  }

  /** Si la operación falla, la portada recién subida no se queda huérfana en Cloudinary. */
  private async liberarSiFalla<T>(portada: ArchivoSubido | undefined, accion: () => Promise<T>): Promise<T> {
    try {
      return await accion();
    } catch (error) {
      if (portada) await this.storage.eliminar(portada.id);
      throw error;
    }
  }
}

export const seccionService = new SeccionService(seccionRepository, publicacionRepository, fileStorage);
