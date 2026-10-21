import type { Transaction } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import type { Documento, ICONOS_DOCUMENTO } from '../../infrastructure/database/models';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { publicacionRepository, type PublicacionRepository } from '../publicaciones/publicacion.repository';
import { documentoRepository, type DocumentoRepository } from './documento.repository';
import type { ActualizarDocumentoDto, SubirDocumentoDto } from './documento.schemas';

type IconoDocumento = (typeof ICONOS_DOCUMENTO)[number];

/** Ícono (Font Awesome) y color (Tailwind) con que el frontend pinta cada tipo de archivo. */
const ICONO_POR_TIPO: Record<string, { icono: IconoDocumento; color: string }> = {
  'application/pdf': { icono: 'fa-file-pdf', color: 'text-red-500' },
  'application/msword': { icono: 'fa-file-word', color: 'text-blue-500' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { icono: 'fa-file-word', color: 'text-blue-500' },
  'application/vnd.ms-excel': { icono: 'fa-file-excel', color: 'text-green-500' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { icono: 'fa-file-excel', color: 'text-green-500' },
  'application/vnd.ms-powerpoint': { icono: 'fa-file-powerpoint', color: 'text-orange-500' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { icono: 'fa-file-powerpoint', color: 'text-orange-500' },
  'application/zip': { icono: 'fa-file-archive', color: 'text-purple-500' },
  'application/x-rar-compressed': { icono: 'fa-file-archive', color: 'text-purple-500' },
  'text/csv': { icono: 'fa-file-csv', color: 'text-yellow-500' },
  'text/plain': { icono: 'fa-file-code', color: 'text-indigo-500' },
};

export function iconoYColor(mimetype: string): { icono: IconoDocumento; color: string } {
  return ICONO_POR_TIPO[mimetype] ?? { icono: 'fa-file', color: 'text-gray-500' };
}

export class DocumentoService extends BaseService<Documento, DocumentoRepository> {
  constructor(
    repository: DocumentoRepository,
    private readonly publicaciones: PublicacionRepository,
    private readonly storage: FileStorage,
  ) {
    super(repository);
  }

  // ---------- Lectura ----------

  misDocumentos(usuarioId: number, paginacion: Paginacion): Promise<Page<Documento>> {
    return this.repository.deUsuario(usuarioId, paginacion);
  }

  /** Documentos de otra persona: los sueltos y los de publicaciones que el visitante puede ver. */
  async deUsuario(duenoId: number, paginacion: Paginacion, visitanteId?: number): Promise<Page<Documento>> {
    if (duenoId === visitanteId) return this.repository.deUsuario(duenoId, paginacion);
    const visibles = await this.publicaciones.idsVisiblesDe(duenoId, visitanteId);
    return this.repository.deUsuario(duenoId, paginacion, visibles);
  }

  async dePublicacion(publicacionId: number, usuarioId?: number): Promise<Documento[]> {
    await this.publicaciones.findVisibleOrFail(publicacionId, usuarioId);
    return this.repository.dePublicacion(publicacionId);
  }

  /** Un documento adjunto a una publicación solo se ve si la publicación es visible. */
  async obtenerVisible(id: number, usuarioId?: number): Promise<Documento> {
    const documento = await this.repository.findByIdOrFail(id);
    if (documento.publicacion_id && documento.usuario_id !== usuarioId) {
      const publicacion = await this.publicaciones.findById(documento.publicacion_id);
      if (!publicacion || !(await this.publicaciones.puedeVer(publicacion, usuarioId))) throw new NotFoundError('Documento');
    }
    return documento;
  }

  todos(paginacion: Paginacion): Promise<Page<Documento>> {
    return this.repository.paginate({}, paginacion);
  }

  /** Adjuntos de varias publicaciones (sin revisar visibilidad: quien llama ya filtró las publicaciones). */
  adjuntosDe(publicacionIds: number[]): Promise<Documento[]> {
    return this.repository.dePublicaciones(publicacionIds);
  }

  // ---------- Escritura ----------

  /**
   * Registra archivos ya subidos. La usa también el módulo de publicaciones
   * para guardar los adjuntos dentro de su transacción.
   */
  registrar(usuarioId: number, archivos: ArchivoSubido[], publicacionId: number | null): Promise<Documento[]>;
  registrar(usuarioId: number, archivos: ArchivoSubido[], publicacionId: number | null, transaction: Transaction): Promise<Documento[]>;
  async registrar(
    usuarioId: number,
    archivos: ArchivoSubido[],
    publicacionId: number | null,
    transaction?: Transaction,
  ): Promise<Documento[]> {
    const creados: Documento[] = [];
    for (const archivo of archivos) {
      const datos = { ...this.datosDeArchivo(archivo), usuario_id: usuarioId, publicacion_id: publicacionId };
      creados.push(await (transaction ? this.repository.create(datos, transaction) : this.repository.create(datos)));
    }
    return creados;
  }

  async subir(usuarioId: number, datos: SubirDocumentoDto, archivo: ArchivoSubido | undefined): Promise<Documento> {
    if (!archivo) throw new BadRequestError('No se seleccionó archivo');
    if (datos.publicacion_id) await this.asegurarPublicacionPropia(datos.publicacion_id, usuarioId);

    const creado = await this.repository.create({
      ...this.datosDeArchivo(archivo),
      ...(datos.nombre_archivo_custom ? { nombre_archivo: datos.nombre_archivo_custom } : {}),
      descripcion: datos.descripcion ?? null,
      usuario_id: usuarioId,
      publicacion_id: datos.publicacion_id ?? null,
    });
    return this.repository.findByIdOrFail(creado.id);
  }

  async actualizar(id: number, usuarioId: number, datos: ActualizarDocumentoDto, archivo?: ArchivoSubido): Promise<Documento> {
    const documento = await this.propio(id, usuarioId);
    const { nombre_archivo_custom, ...resto } = datos;
    const cambios: Partial<Documento> = Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== undefined));

    if (nombre_archivo_custom) cambios.nombre_archivo = nombre_archivo_custom;
    if (cambios.publicacion_id) await this.asegurarPublicacionPropia(cambios.publicacion_id, usuarioId);
    if (archivo) {
      Object.assign(cambios, this.datosDeArchivo(archivo));
      if (nombre_archivo_custom) cambios.nombre_archivo = nombre_archivo_custom;
    }
    if (!Object.keys(cambios).length) throw new BadRequestError('No hay datos para actualizar');

    const anterior = archivo ? documento.documento_s3 : null;
    await this.repository.update(documento, cambios);
    if (anterior) await this.storage.eliminar(anterior);
    return this.repository.findByIdOrFail(id);
  }

  async vincular(id: number, usuarioId: number, publicacionId: number): Promise<Documento> {
    const documento = await this.propio(id, usuarioId);
    await this.asegurarPublicacionPropia(publicacionId, usuarioId);
    await this.repository.update(documento, { publicacion_id: publicacionId });
    return this.repository.findByIdOrFail(id);
  }

  async desvincular(id: number, usuarioId: number): Promise<Documento> {
    const documento = await this.propio(id, usuarioId);
    await this.repository.update(documento, { publicacion_id: null });
    return this.repository.findByIdOrFail(id);
  }

  async eliminar(id: number, usuarioId: number): Promise<void> {
    const documento = await this.propio(id, usuarioId);
    await this.repository.delete(documento.id);
    await this.storage.eliminar(documento.documento_s3);
  }

  /** Borra los registros de los adjuntos de una publicación dentro de la transacción de quien la elimina. */
  async borrarDePublicacion(publicacionId: number, transaction: Transaction): Promise<void> {
    await this.repository.delete({ publicacion_id: publicacionId }, transaction);
  }

  /** Libera del almacenamiento los archivos de documentos ya borrados. */
  async liberarArchivos(documentos: Documento[]): Promise<void> {
    await Promise.all(documentos.map((d) => this.storage.eliminar(d.documento_s3)));
  }

  // ---------- Reglas ----------

  /** El documento existe y es del usuario (403 si es de otro). */
  private async propio(id: number, usuarioId: number): Promise<Documento> {
    const documento = await this.repository.findByIdOrFail(id);
    this.asegurarDueno(documento.usuario_id, usuarioId, 'No tienes permiso para modificar este documento');
    return documento;
  }

  /** Solo se adjuntan documentos a publicaciones propias. */
  private async asegurarPublicacionPropia(publicacionId: number, usuarioId: number): Promise<void> {
    const publicacion = await this.publicaciones.findByIdOrFail(publicacionId);
    this.asegurarDueno(publicacion.usuario_id, usuarioId, 'Solo puedes adjuntar documentos a tus publicaciones');
  }

  private datosDeArchivo(archivo: ArchivoSubido) {
    return {
      documento_url: archivo.url,
      documento_s3: archivo.id,
      nombre_archivo: archivo.nombreOriginal,
      tamano_archivo: archivo.tamano,
      tipo_archivo: archivo.mimetype,
      ...iconoYColor(archivo.mimetype),
    };
  }
}

export const documentoService = new DocumentoService(documentoRepository, publicacionRepository, fileStorage);
