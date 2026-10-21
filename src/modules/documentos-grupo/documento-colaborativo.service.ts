import * as Y from 'yjs';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import type { Paginacion } from '../../core/validation/common.schemas';
import { sequelize, type DocumentoColaborativo, type DocumentoPermiso, type DocumentoVersion } from '../../infrastructure/database/models';
import { realtime, salas, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { miembroChatGrupoRepository, type MiembroChatGrupoRepository } from '../chat-grupo/miembro-chat-grupo.repository';
import { grupoRepository, type GrupoRepository } from '../grupos/grupo.repository';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { privacidadService, type PrivacidadService } from '../privacidad/privacidad.service';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { sesionesDocumentos } from './documento-almacen';
import { accesoDocumentos, type AccesoDocumento, type AccesoDocumentos } from './documento-colaborativo.acceso';
import {
  documentoColaborativoRepository,
  documentoPermisoRepository,
  documentoVersionRepository,
  type DocumentoColaborativoRepository,
  type DocumentoPermisoRepository,
  type DocumentoVersionRepository,
} from './documento-colaborativo.repository';
import type { CompartirDocumentoDto, CrearDocumentoDto, CrearVersionDto, FormatoExportar, ListarDocumentosQuery } from './documento-colaborativo.schemas';
import { EVENTOS_DOCUMENTO, type SesionesDocumentos } from './documento-sesiones';
import { contenidoHtml, docDesde, documentoHtml, reemplazarContenido, resumenDe, textoPlano } from './documento-yjs';

/** Aviso a la sala del grupo cuando cambia su lista de documentos: { grupo_id, documento_id, accion, por_usuario_id }. */
export const EVENTO_DOCUMENTOS_GRUPO = 'documentos_grupo_actualizado';

export type AccionDocumentoGrupo = 'creado' | 'actualizado' | 'papelera' | 'restaurado' | 'eliminado';

/** Detalle de un documento: sus columnas (sin el contenido) + mi acceso + quién lo tiene abierto ahora. */
export type DocumentoVista = Record<string, unknown> & { id: number; mi_acceso: AccesoDocumento; editando_ahora: number[] };

/** Versión con su contenido para la vista previa. */
export type VersionVista = Record<string, unknown> & { id: number; html: string };

export interface Exportacion {
  nombre_archivo: string;
  tipo_mime: string;
  contenido: string;
}

/**
 * Documentos colaborativos: de un grupo (sus miembros activos) o personales compartidos con permiso de ver/editar.
 * El contenido se edita en vivo por Socket.IO (ver `documento-sesiones.ts`); aquí viven las reglas y lo que va por REST.
 */
export class DocumentoColaborativoService extends BaseService<DocumentoColaborativo, DocumentoColaborativoRepository> {
  constructor(
    repository: DocumentoColaborativoRepository,
    private readonly permisos: DocumentoPermisoRepository,
    private readonly versiones: DocumentoVersionRepository,
    private readonly acceso: AccesoDocumentos,
    private readonly sesiones: SesionesDocumentos,
    private readonly grupos: GrupoRepository,
    private readonly miembros: MiembroChatGrupoRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly privacidad: PrivacidadService,
    private readonly notificaciones: NotificacionService,
    private readonly tiempoReal: RealtimeGateway,
  ) {
    super(repository);
  }

  // ---------- Listas ----------

  /** Documentos de un grupo (solo miembros activos). */
  async delGrupo(grupoId: number, usuarioId: number, { q, papelera, limit, offset }: ListarDocumentosQuery): Promise<Page<DocumentoColaborativo>> {
    await this.exigirMiembro(grupoId, usuarioId);
    return this.repository.buscar({ grupo_id: grupoId, en_papelera: papelera }, { limit, offset }, q);
  }

  /** Mis documentos personales. */
  mios(usuarioId: number, { q, papelera, limit, offset }: ListarDocumentosQuery): Promise<Page<DocumentoColaborativo>> {
    return this.repository.buscar({ grupo_id: null, propietario_id: usuarioId, en_papelera: papelera }, { limit, offset }, q);
  }

  /** Personales que otros compartieron conmigo. */
  compartidosConmigo(usuarioId: number, { q, limit, offset }: ListarDocumentosQuery): Promise<Page<DocumentoColaborativo>> {
    return this.repository.compartidosCon(usuarioId, { limit, offset }, q);
  }

  // ---------- Documento ----------

  async crear(usuarioId: number, { titulo, grupo_id }: CrearDocumentoDto): Promise<DocumentoVista> {
    if (grupo_id) await this.exigirMiembro(grupo_id, usuarioId);
    const creado = await this.repository.create({ titulo, grupo_id: grupo_id ?? null, propietario_id: usuarioId });
    if (grupo_id) this.avisarGrupo(grupo_id, 'creado', creado.id, usuarioId);
    return this.detalle(creado.id, usuarioId);
  }

  async detalle(id: number, usuarioId: number): Promise<DocumentoVista> {
    const documento = await this.repository.findByIdOrFail(id);
    const acceso = await this.acceso.exigir(documento, usuarioId, 'ver');
    return this.vista(documento, acceso);
  }

  async renombrar(id: number, usuarioId: number, titulo: string): Promise<DocumentoVista> {
    const documento = await this.repository.findByIdOrFail(id);
    await this.acceso.exigir(documento, usuarioId, 'editar');
    this.fueraDePapelera(documento);
    await this.repository.update(documento, { titulo });
    this.sesiones.avisar(id, EVENTOS_DOCUMENTO.titulo, { titulo });
    if (documento.grupo_id) this.avisarGrupo(documento.grupo_id, 'actualizado', id, usuarioId);
    return this.detalle(id, usuarioId);
  }

  /** A la papelera: se cierra para quien lo tenga abierto (guardando lo pendiente). */
  async aPapelera(id: number, usuarioId: number): Promise<DocumentoVista> {
    const documento = await this.repository.findByIdOrFail(id);
    await this.acceso.exigir(documento, usuarioId, 'administrar');
    if (!documento.en_papelera) {
      await this.sesiones.cerrarDocumento(id, 'papelera', true);
      await this.repository.update(documento, { en_papelera: true, fecha_papelera: new Date() });
      if (documento.grupo_id) this.avisarGrupo(documento.grupo_id, 'papelera', id, usuarioId);
    }
    return this.detalle(id, usuarioId);
  }

  async restaurar(id: number, usuarioId: number): Promise<DocumentoVista> {
    const documento = await this.repository.findByIdOrFail(id);
    await this.acceso.exigir(documento, usuarioId, 'administrar');
    if (documento.en_papelera) {
      await this.repository.update(documento, { en_papelera: false, fecha_papelera: null });
      if (documento.grupo_id) this.avisarGrupo(documento.grupo_id, 'restaurado', id, usuarioId);
    }
    return this.detalle(id, usuarioId);
  }

  /** Borra para siempre (con sus permisos y versiones). */
  async eliminar(id: number, usuarioId: number): Promise<void> {
    const documento = await this.repository.findByIdOrFail(id);
    await this.acceso.exigir(documento, usuarioId, 'administrar');
    await this.sesiones.cerrarDocumento(id, 'eliminado', false);
    await sequelize.transaction(async (t) => {
      await this.permisos.delete({ documento_id: id }, t);
      await this.versiones.delete({ documento_id: id }, t);
      await this.repository.delete({ id }, t);
    });
    if (documento.grupo_id) this.avisarGrupo(documento.grupo_id, 'eliminado', id, usuarioId);
  }

  // ---------- Compartir (solo personales) ----------

  async permisosDe(id: number, usuarioId: number): Promise<DocumentoPermiso[]> {
    const documento = await this.repository.findByIdOrFail(id);
    await this.acceso.exigir(documento, usuarioId, 'compartir');
    return this.permisos.delDocumento(id);
  }

  /** Da o cambia el permiso de alguien; avisa con 'documento_compartido' la primera vez. */
  async compartir(id: number, duenoId: number, { usuario_id, permiso }: CompartirDocumentoDto): Promise<DocumentoPermiso> {
    const documento = await this.repository.findByIdOrFail(id);
    if (documento.grupo_id) throw new BadRequestError('Los documentos de un grupo ya los ven todos sus miembros; no se comparten aparte');
    await this.acceso.exigir(documento, duenoId, 'compartir');
    if (usuario_id === duenoId) throw new BadRequestError('Ya eres el dueño del documento');
    await this.usuarios.findByIdOrFail(usuario_id);
    if (await this.privacidad.hayBloqueo(duenoId, usuario_id)) throw new ForbiddenError('No puedes compartir documentos con este usuario');

    const existente = await this.permisos.de(id, usuario_id);
    if (existente) {
      if (existente.permiso !== permiso) {
        await this.permisos.update(existente, { permiso });
        this.sesiones.actualizarAcceso(id, usuario_id, permiso === 'editar');
      }
    } else {
      await this.permisos.create({ documento_id: id, usuario_id, permiso });
      await this.notificaciones.notificar({
        usuario_id,
        de_usuario_id: duenoId,
        tipo: 'documento_compartido',
        mensaje: `te compartió el documento «${documento.titulo}»${permiso === 'editar' ? ' para editarlo' : ''}`,
        entidad_tipo: 'documento',
        entidad_id: id,
      });
    }
    return (await this.permisos.findOne({ documento_id: id, usuario_id })) as DocumentoPermiso;
  }

  /** El dueño quita a alguien, o alguien deja un documento que le compartieron. */
  async quitarPermiso(id: number, solicitanteId: number, usuarioId: number): Promise<void> {
    const documento = await this.repository.findByIdOrFail(id);
    if (solicitanteId !== usuarioId) await this.acceso.exigir(documento, solicitanteId, 'compartir');
    const borrados = await this.permisos.delete({ documento_id: id, usuario_id: usuarioId });
    if (!borrados) throw new NotFoundError('Permiso', 'Ese usuario no tiene acceso al documento');
    this.sesiones.actualizarAcceso(id, usuarioId, null);
    await this.notificaciones.retirar({
      usuario_id: usuarioId,
      de_usuario_id: documento.propietario_id,
      tipo: 'documento_compartido',
      entidad_tipo: 'documento',
      entidad_id: id,
    });
  }

  // ---------- Versiones ----------

  async versionesDe(id: number, usuarioId: number, paginacion: Paginacion): Promise<Page<DocumentoVersion>> {
    const documento = await this.repository.findByIdOrFail(id);
    await this.acceso.exigir(documento, usuarioId, 'ver');
    return this.versiones.delDocumento(id, paginacion);
  }

  /** Una versión con su texto y su HTML (vista previa). */
  async version(id: number, versionId: number, usuarioId: number): Promise<VersionVista> {
    const documento = await this.repository.findByIdOrFail(id);
    await this.acceso.exigir(documento, usuarioId, 'ver');
    const version = await this.versiones.conEstado(id, versionId);
    if (!version) throw new NotFoundError('Versión', 'Versión no encontrada');
    const { estado_yjs, ...datos } = version.toJSON();
    return { ...datos, html: contenidoHtml(docDesde(estado_yjs)) };
  }

  /** Instantánea manual del contenido actual (incluye lo que se está editando en este momento). */
  async crearVersion(id: number, usuarioId: number, { nombre }: CrearVersionDto): Promise<DocumentoVersion> {
    const documento = await this.repository.findByIdOrFail(id);
    await this.acceso.exigir(documento, usuarioId, 'editar');
    this.fueraDePapelera(documento);
    const estado = await this.estadoActual(id);
    const creada = await this.versiones.create({
      documento_id: id,
      autor_id: usuarioId,
      tipo: 'manual',
      nombre: nombre ?? null,
      estado_yjs: Buffer.from(estado),
      texto_plano: textoPlano(docDesde(estado)),
    });
    return this.versiones.findByIdOrFail(creada.id);
  }

  /**
   * Vuelve el contenido a una versión. Antes guarda el contenido actual como versión ("Antes de restaurar"),
   * así nada se pierde. Si alguien lo está editando, el cambio le llega en vivo.
   */
  async restaurarVersion(id: number, versionId: number, usuarioId: number): Promise<DocumentoVista> {
    const documento = await this.repository.findByIdOrFail(id);
    await this.acceso.exigir(documento, usuarioId, 'editar');
    this.fueraDePapelera(documento);
    const version = await this.versiones.conEstado(id, versionId);
    if (!version) throw new NotFoundError('Versión', 'Versión no encontrada');

    const actual = await this.estadoActual(id);
    await this.versiones.create({
      documento_id: id,
      autor_id: usuarioId,
      tipo: 'automatica',
      nombre: 'Antes de restaurar',
      estado_yjs: Buffer.from(actual),
      texto_plano: textoPlano(docDesde(actual)),
    });

    const origen = docDesde(version.estado_yjs);
    if (!(await this.sesiones.restaurarEnVivo(id, origen, usuarioId))) {
      const doc = docDesde(actual);
      reemplazarContenido(doc, origen, null);
      const texto = textoPlano(doc);
      await this.repository.guardarEstado(id, { estado: Y.encodeStateAsUpdate(doc), texto, resumen: resumenDe(texto), editorId: usuarioId, fecha: new Date() });
    }
    return this.detalle(id, usuarioId);
  }

  // ---------- Exportar ----------

  async exportar(id: number, usuarioId: number, formato: FormatoExportar): Promise<Exportacion> {
    const documento = await this.repository.findByIdOrFail(id);
    await this.acceso.exigir(documento, usuarioId, 'ver');
    const doc = docDesde(await this.estadoActual(id));
    const base = nombreArchivo(documento.titulo);
    return formato === 'texto'
      ? { nombre_archivo: `${base}.txt`, tipo_mime: 'text/plain;charset=utf-8', contenido: textoPlano(doc) }
      : { nombre_archivo: `${base}.html`, tipo_mime: 'text/html;charset=utf-8', contenido: documentoHtml(doc, documento.titulo) };
  }

  // ---------- Edición en vivo ----------

  /** Lo usa el manejador de Socket.IO al entrar: 404/403 como en REST y 409 si está en la papelera. */
  async accesoEnVivo(id: number, usuarioId: number): Promise<{ puede_editar: boolean }> {
    const documento = await this.repository.findByIdOrFail(id);
    const acceso = await this.acceso.exigir(documento, usuarioId, 'ver');
    this.fueraDePapelera(documento);
    return { puede_editar: acceso.editar };
  }

  // ---------- Apoyo ----------

  private vista(documento: DocumentoColaborativo, acceso: AccesoDocumento): DocumentoVista {
    return { ...documento.toJSON(), mi_acceso: acceso, editando_ahora: this.sesiones.conectados(documento.id) };
  }

  /** Lo más reciente: el que está en memoria si alguien lo edita (guardado ya), si no el de la base. */
  private async estadoActual(id: number): Promise<Uint8Array> {
    await this.sesiones.guardarAhora(id);
    const enVivo = this.sesiones.estadoEnVivo(id);
    if (enVivo) return enVivo;
    const guardado = (await this.repository.conContenido(id))?.estado_yjs;
    return guardado ? new Uint8Array(guardado) : Y.encodeStateAsUpdate(new Y.Doc());
  }

  private fueraDePapelera(documento: DocumentoColaborativo): void {
    if (documento.en_papelera) throw new ConflictError('El documento está en la papelera; restáuralo para editarlo');
  }

  private async exigirMiembro(grupoId: number, usuarioId: number): Promise<void> {
    await this.grupos.findByIdOrFail(grupoId);
    if (!(await this.miembros.activa(grupoId, usuarioId))) throw new ForbiddenError('Solo los miembros del grupo pueden usar sus documentos');
  }

  private avisarGrupo(grupoId: number, accion: AccionDocumentoGrupo, documentoId: number, usuarioId: number): void {
    this.tiempoReal.aSala(salas.grupo(grupoId), EVENTO_DOCUMENTOS_GRUPO, { grupo_id: grupoId, documento_id: documentoId, accion, por_usuario_id: usuarioId });
  }
}

/** Título → nombre de archivo seguro ("Plan 2026: borrador" → "Plan 2026 borrador"). */
export function nombreArchivo(titulo: string): string {
  const limpio = titulo
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return limpio || 'documento';
}

export const documentoColaborativoService = new DocumentoColaborativoService(
  documentoColaborativoRepository,
  documentoPermisoRepository,
  documentoVersionRepository,
  accesoDocumentos,
  sesionesDocumentos,
  grupoRepository,
  miembroChatGrupoRepository,
  usuarioRepository,
  privacidadService,
  notificacionService,
  realtime,
);
