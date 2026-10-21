import { BaseService } from '../../core/domain/BaseService';
import { AppError, BadRequestError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import { HttpStatus } from '../../core/http/HttpStatus';
import { TIPOS_ARCHIVO_GRUPO, type ArchivoGrupo, type TipoArchivoGrupo } from '../../infrastructure/database/models';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { notificacionService } from '../notificaciones/notificacion.service';
import { accesoArchivosGrupo, type AccesoArchivosGrupo } from './archivo-grupo.acceso';
import { rutaDe, nombreLegible, tipoDeArchivo, type Miga } from './archivo-grupo.arbol';
import { AgrupadorAvisos, mensajeAviso } from './archivo-grupo.avisos';
import {
  archivoGrupoRepository,
  carpetaGrupoRepository,
  type ArchivoGrupoRepository,
  type CarpetaGrupoRepository,
} from './archivo-grupo.repository';
import type { ActualizarArchivoDto, BuscarArchivosQuery, SubirArchivoDto } from './archivo-grupo.schemas';

/** Espacio por grupo (`ARCHIVOS_GRUPO_LIMITE_MB`, por defecto 2 GB). */
const LIMITE_MB = Number(process.env.ARCHIVOS_GRUPO_LIMITE_MB) > 0 ? Number(process.env.ARCHIVOS_GRUPO_LIMITE_MB) : 2048;
export const LIMITE_BYTES_GRUPO = LIMITE_MB * 1024 * 1024;

/** Archivo abierto por su id (`/archivos/:id`): con su ruta y si puedo cambiarlo. */
export type ArchivoVista = Record<string, unknown> & { id: number; ruta: Miga[]; puede_modificar: boolean };

export interface UsoGrupo {
  total_bytes: number;
  total_archivos: number;
  limite_bytes: number;
  por_tipo: Record<TipoArchivoGrupo, { bytes: number; archivos: number }>;
}

/** Archivos subidos a la carpeta compartida de un grupo. */
export class ArchivoGrupoService extends BaseService<ArchivoGrupo, ArchivoGrupoRepository> {
  constructor(
    repository: ArchivoGrupoRepository,
    private readonly carpetas: CarpetaGrupoRepository,
    private readonly acceso: AccesoArchivosGrupo,
    private readonly storage: FileStorage,
    private readonly avisos: AgrupadorAvisos,
  ) {
    super(repository);
  }

  /** Sube un archivo (imagen, documento o audio) a la raíz o a una carpeta y avisa a los demás miembros (agrupado). */
  async subir(grupoId: number, usuarioId: number, { carpeta_id, nombre }: SubirArchivoDto, archivo?: ArchivoSubido): Promise<ArchivoGrupo> {
    if (!archivo) throw new BadRequestError('Elige un archivo para subir');
    const { grupo } = await this.acceso.exigirMiembro(grupoId, usuarioId);
    const carpetaId = carpeta_id ?? null;
    if (carpetaId !== null) await this.carpetaDelGrupo(carpetaId, grupoId);
    if ((await this.repository.bytesDelGrupo(grupoId)) + archivo.tamano > LIMITE_BYTES_GRUPO) {
      throw new AppError(`El grupo llegó a su límite de ${LIMITE_MB} MB; borra archivos para subir más`, HttpStatus.PAYLOAD_TOO_LARGE);
    }

    const creado = await this.repository.create({
      grupo_id: grupoId,
      carpeta_id: carpetaId,
      usuario_id: usuarioId,
      nombre: nombre ?? nombreLegible(archivo.nombreOriginal),
      url: archivo.url,
      storage_id: archivo.id,
      mimetype: archivo.mimetype,
      tipo: tipoDeArchivo(archivo.mimetype),
      tamano: archivo.tamano,
    });
    this.acceso.avisar(grupoId, carpetaId, 'archivo_subido', usuarioId);

    const destinatarios = (await this.acceso.idsMiembros(grupoId)).filter((id) => id !== usuarioId);
    await Promise.all(
      destinatarios.map((destinatarioId) =>
        this.avisos.registrar({
          destinatarioId,
          deUsuarioId: usuarioId,
          grupoId,
          grupoNombre: grupo.nombre,
          archivoId: creado.id,
          nombreArchivo: creado.nombre,
        }),
      ),
    );
    return this.repository.findByIdOrFail(creado.id);
  }

  async detalle(id: number, usuarioId: number): Promise<ArchivoVista> {
    const archivo = await this.repository.completo(id);
    if (!archivo) throw new NotFoundError('Archivo', 'Archivo no encontrado');
    const miembro = await this.acceso.exigirMiembro(archivo.grupo_id, usuarioId);
    const ruta = archivo.carpeta_id !== null ? rutaDe(archivo.carpeta_id, await this.carpetas.delGrupo(archivo.grupo_id)) : [];
    return { ...archivo.toJSON(), ruta, puede_modificar: this.acceso.puedeModificar(archivo.usuario_id, usuarioId, miembro) };
  }

  /** Renombrar y/o mover (`carpeta_id` null = a la raíz). Quien lo subió o un admin/moderador. */
  async actualizar(id: number, usuarioId: number, { nombre, carpeta_id }: ActualizarArchivoDto): Promise<ArchivoVista> {
    const archivo = await this.repository.findByIdOrFail(id);
    const miembro = await this.acceso.exigirMiembro(archivo.grupo_id, usuarioId);
    this.acceso.exigirAutorOModerador(archivo.usuario_id, usuarioId, miembro, 'Solo quien subió el archivo o un admin/moderador puede cambiarlo');
    const destino = carpeta_id === undefined ? archivo.carpeta_id : carpeta_id;
    if (destino !== null) await this.carpetaDelGrupo(destino, archivo.grupo_id);

    const origen = archivo.carpeta_id;
    await this.repository.update(archivo, { nombre: nombre ?? archivo.nombre, carpeta_id: destino });
    this.acceso.avisar(archivo.grupo_id, origen, 'archivo_actualizado', usuarioId);
    if (destino !== origen) this.acceso.avisar(archivo.grupo_id, destino, 'archivo_actualizado', usuarioId);
    return this.detalle(id, usuarioId);
  }

  /** Quien lo subió o un admin/moderador; también se borra de Cloudinary. */
  async eliminar(id: number, usuarioId: number): Promise<void> {
    const archivo = await this.repository.findByIdOrFail(id);
    const miembro = await this.acceso.exigirMiembro(archivo.grupo_id, usuarioId);
    this.acceso.exigirAutorOModerador(archivo.usuario_id, usuarioId, miembro, 'Solo quien subió el archivo o un admin/moderador puede borrarlo');
    await this.repository.delete({ id });
    await this.storage.eliminar(archivo.url);
    this.acceso.avisar(archivo.grupo_id, archivo.carpeta_id, 'archivo_eliminado', usuarioId);
  }

  /** Busca por nombre en todas las carpetas del grupo. */
  async buscar(grupoId: number, usuarioId: number, { q, tipo, limit, offset }: BuscarArchivosQuery): Promise<Page<ArchivoGrupo>> {
    await this.acceso.exigirMiembro(grupoId, usuarioId);
    return this.repository.buscar(grupoId, { q, tipo }, { limit, offset });
  }

  async uso(grupoId: number, usuarioId: number): Promise<UsoGrupo> {
    await this.acceso.exigirMiembro(grupoId, usuarioId);
    const filas = await this.repository.usoPorTipo(grupoId);
    const por_tipo = Object.fromEntries(TIPOS_ARCHIVO_GRUPO.map((t) => [t, { bytes: 0, archivos: 0 }])) as UsoGrupo['por_tipo'];
    for (const fila of filas) por_tipo[fila.tipo] = { bytes: fila.bytes, archivos: fila.archivos };
    return {
      total_bytes: filas.reduce((suma, f) => suma + f.bytes, 0),
      total_archivos: filas.reduce((suma, f) => suma + f.archivos, 0),
      limite_bytes: LIMITE_BYTES_GRUPO,
      por_tipo,
    };
  }

  private async carpetaDelGrupo(carpetaId: number, grupoId: number): Promise<void> {
    if (!(await this.carpetas.exists({ id: carpetaId, grupo_id: grupoId }))) throw new NotFoundError('Carpeta', 'La carpeta no existe');
  }
}

/** Un aviso 'archivo_subido' por persona y grupo cada 10 minutos (los demás se agrupan). */
export const avisosArchivos = new AgrupadorAvisos(async (aviso) => {
  await notificacionService.notificar({
    usuario_id: aviso.destinatarioId,
    de_usuario_id: aviso.deUsuarioId,
    tipo: 'archivo_subido',
    mensaje: mensajeAviso(aviso),
    entidad_tipo: 'archivo',
    entidad_id: aviso.archivoId,
  });
});

export const archivoGrupoService = new ArchivoGrupoService(archivoGrupoRepository, carpetaGrupoRepository, accesoArchivosGrupo, fileStorage, avisosArchivos);

