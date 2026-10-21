import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import { sequelize, type ArchivoGrupo, type CarpetaGrupo } from '../../infrastructure/database/models';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { FileStorage } from '../../infrastructure/storage/FileStorage';
import { accesoArchivosGrupo, type AccesoArchivosGrupo } from './archivo-grupo.acceso';
import { creariaCiclo, descendientes, nombreOcupado, rutaDe, type Miga } from './archivo-grupo.arbol';
import {
  archivoGrupoRepository,
  carpetaGrupoRepository,
  type ArchivoGrupoRepository,
  type CarpetaGrupoRepository,
} from './archivo-grupo.repository';
import type { ActualizarCarpetaDto, CrearCarpetaDto } from './archivo-grupo.schemas';

/** Subcarpeta en el explorador, con cuántas cosas tiene adentro (archivos + carpetas). */
export type CarpetaConConteo = Record<string, unknown> & { id: number; total_elementos: number };

/** Lo que muestra el explorador al abrir una carpeta (o la raíz). */
export interface ContenidoCarpeta {
  grupo: { id: number; nombre: string };
  /** null = raíz. */
  carpeta: CarpetaGrupo | null;
  /** Migas de pan desde la raíz (sin incluirla). */
  ruta: Miga[];
  carpetas: CarpetaConConteo[];
  archivos: ArchivoGrupo[];
  /** Soy admin/moderador: puedo mover, renombrar y borrar lo de los demás. */
  puede_moderar: boolean;
}

export interface ResultadoBorrado {
  carpetas: number;
  archivos: number;
}

/** Carpetas anidadas de la carpeta compartida de un grupo. */
export class CarpetaGrupoService extends BaseService<CarpetaGrupo, CarpetaGrupoRepository> {
  constructor(
    repository: CarpetaGrupoRepository,
    private readonly archivos: ArchivoGrupoRepository,
    private readonly acceso: AccesoArchivosGrupo,
    private readonly storage: FileStorage,
  ) {
    super(repository);
  }

  /** Abre una carpeta (o la raíz sin `carpetaId`). */
  async contenido(grupoId: number, usuarioId: number, carpetaId?: number): Promise<ContenidoCarpeta> {
    const miembro = await this.acceso.exigirMiembro(grupoId, usuarioId);
    const todas = await this.repository.delGrupo(grupoId);
    const actual = carpetaId !== undefined ? todas.find((c) => c.id === carpetaId) : null;
    if (actual === undefined) throw new NotFoundError('Carpeta', 'Carpeta no encontrada');
    const dentroDe = actual?.id ?? null;

    const [archivos, conteo] = await Promise.all([this.archivos.enCarpeta(grupoId, dentroDe), this.archivos.conteoPorCarpeta(grupoId)]);
    const carpetas = todas
      .filter((c) => c.padre_id === dentroDe)
      .map((c) => ({ ...c.toJSON(), total_elementos: (conteo.get(c.id) ?? 0) + todas.filter((h) => h.padre_id === c.id).length }));

    return {
      grupo: { id: miembro.grupo.id, nombre: miembro.grupo.nombre },
      carpeta: actual,
      ruta: rutaDe(dentroDe, todas),
      carpetas,
      archivos,
      puede_moderar: miembro.moderador,
    };
  }

  /** Todas las carpetas del grupo (planas) para elegir a dónde mover algo. */
  async arbol(grupoId: number, usuarioId: number): Promise<CarpetaGrupo[]> {
    await this.acceso.exigirMiembro(grupoId, usuarioId);
    return this.repository.delGrupo(grupoId);
  }

  async crear(grupoId: number, usuarioId: number, { nombre, padre_id }: CrearCarpetaDto): Promise<CarpetaGrupo> {
    await this.acceso.exigirMiembro(grupoId, usuarioId);
    const todas = await this.repository.delGrupo(grupoId);
    const padre = padre_id ?? null;
    if (padre !== null && !todas.some((c) => c.id === padre)) throw new NotFoundError('Carpeta', 'La carpeta destino no existe');
    if (nombreOcupado(nombre, padre, todas)) throw new ConflictError(`Ya hay una carpeta llamada «${nombre}» ahí`);

    const carpeta = await this.repository.create({ grupo_id: grupoId, padre_id: padre, nombre, creador_id: usuarioId });
    this.acceso.avisar(grupoId, padre, 'carpeta_creada', usuarioId);
    return carpeta;
  }

  /** Renombrar y/o mover (`padre_id` null = a la raíz). Su creador o un admin/moderador. */
  async actualizar(id: number, usuarioId: number, { nombre, padre_id }: ActualizarCarpetaDto): Promise<CarpetaGrupo> {
    const carpeta = await this.repository.findByIdOrFail(id);
    const miembro = await this.acceso.exigirMiembro(carpeta.grupo_id, usuarioId);
    this.acceso.exigirAutorOModerador(carpeta.creador_id, usuarioId, miembro, 'Solo quien creó la carpeta o un admin/moderador puede cambiarla');

    const todas = await this.repository.delGrupo(carpeta.grupo_id);
    const destino = padre_id === undefined ? carpeta.padre_id : padre_id;
    if (destino !== null && !todas.some((c) => c.id === destino)) throw new NotFoundError('Carpeta', 'La carpeta destino no existe');
    if (creariaCiclo(id, destino, todas)) throw new BadRequestError('No puedes mover una carpeta dentro de sí misma');
    const nuevoNombre = nombre ?? carpeta.nombre;
    if (nombreOcupado(nuevoNombre, destino, todas, id)) throw new ConflictError(`Ya hay una carpeta llamada «${nuevoNombre}» ahí`);

    const origen = carpeta.padre_id;
    await this.repository.update(carpeta, { nombre: nuevoNombre, padre_id: destino });
    this.acceso.avisar(carpeta.grupo_id, origen, 'carpeta_actualizada', usuarioId);
    if (destino !== origen) this.acceso.avisar(carpeta.grupo_id, destino, 'carpeta_actualizada', usuarioId);
    return carpeta;
  }

  /**
   * Borra la carpeta con todo su contenido (subcarpetas y archivos, también de Cloudinary).
   * Su creador solo si todo lo de adentro es suyo; si hay cosas de otros, un admin/moderador.
   */
  async eliminar(id: number, usuarioId: number): Promise<ResultadoBorrado> {
    const carpeta = await this.repository.findByIdOrFail(id);
    const miembro = await this.acceso.exigirMiembro(carpeta.grupo_id, usuarioId);
    const todas = await this.repository.delGrupo(carpeta.grupo_id);
    const ids = descendientes(id, todas);
    const archivos = await this.archivos.findAll({ carpeta_id: ids });

    const todoEsMio =
      carpeta.creador_id === usuarioId &&
      todas.every((c) => !ids.includes(c.id) || c.creador_id === usuarioId) &&
      archivos.every((a) => a.usuario_id === usuarioId);
    if (!miembro.moderador && !todoEsMio) {
      throw new ForbiddenError(
        carpeta.creador_id === usuarioId
          ? 'La carpeta tiene cosas de otros miembros; solo un admin/moderador puede borrarla'
          : 'Solo quien creó la carpeta o un admin/moderador puede borrarla',
      );
    }

    await sequelize.transaction(async (t) => {
      await this.archivos.delete({ carpeta_id: ids }, t);
      await this.repository.delete({ id: ids }, t);
    });
    await Promise.all(archivos.map((a) => this.storage.eliminar(a.url)));
    this.acceso.avisar(carpeta.grupo_id, carpeta.padre_id, 'carpeta_eliminada', usuarioId);
    return { carpetas: ids.length, archivos: archivos.length };
  }
}

export const carpetaGrupoService = new CarpetaGrupoService(carpetaGrupoRepository, archivoGrupoRepository, accesoArchivosGrupo, fileStorage);
