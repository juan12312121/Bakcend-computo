import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import type { ExportarQuery, ListarDocumentosQuery } from './documento-colaborativo.schemas';
import { documentoColaborativoService, type DocumentoColaborativoService } from './documento-colaborativo.service';

export class DocumentoColaborativoController extends BaseController {
  constructor(private readonly service: DocumentoColaborativoService) {
    super();
  }

  // ---------- Listas ----------

  delGrupo = async (req: Request, res: Response) => {
    const page = await this.service.delGrupo(this.idParam(req, 'grupoId'), this.usuarioId(req), validatedQuery<ListarDocumentosQuery>(res));
    return this.paginated(res, page, 'Documentos del grupo');
  };

  mios = async (req: Request, res: Response) => {
    const page = await this.service.mios(this.usuarioId(req), validatedQuery<ListarDocumentosQuery>(res));
    return this.paginated(res, page, 'Mis documentos');
  };

  compartidos = async (req: Request, res: Response) => {
    const page = await this.service.compartidosConmigo(this.usuarioId(req), validatedQuery<ListarDocumentosQuery>(res));
    return this.paginated(res, page, 'Documentos compartidos conmigo');
  };

  // ---------- Documento ----------

  crear = async (req: Request, res: Response) => {
    const documento = await this.service.crear(this.usuarioId(req), req.body);
    return this.created(res, documento, 'Documento creado');
  };

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detalle(this.idParam(req), this.usuarioId(req)));
  };

  renombrar = async (req: Request, res: Response) => {
    const documento = await this.service.renombrar(this.idParam(req), this.usuarioId(req), req.body.titulo);
    return this.ok(res, documento, 'Documento renombrado');
  };

  aPapelera = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.aPapelera(this.idParam(req), this.usuarioId(req)), 'Documento enviado a la papelera');
  };

  restaurar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.restaurar(this.idParam(req), this.usuarioId(req)), 'Documento restaurado');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Documento eliminado');
  };

  // ---------- Compartir ----------

  permisos = async (req: Request, res: Response) => {
    const permisos = await this.service.permisosDe(this.idParam(req), this.usuarioId(req));
    return this.ok(res, permisos, `${permisos.length} personas con acceso`);
  };

  compartir = async (req: Request, res: Response) => {
    const permiso = await this.service.compartir(this.idParam(req), this.usuarioId(req), req.body);
    return this.ok(res, permiso, 'Documento compartido');
  };

  quitarPermiso = async (req: Request, res: Response) => {
    await this.service.quitarPermiso(this.idParam(req), this.usuarioId(req), this.idParam(req, 'usuarioId'));
    return this.message(res, 'Acceso quitado');
  };

  // ---------- Versiones ----------

  versiones = async (req: Request, res: Response) => {
    const page = await this.service.versionesDe(this.idParam(req), this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Versiones del documento');
  };

  version = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.version(this.idParam(req), this.idParam(req, 'versionId'), this.usuarioId(req)));
  };

  crearVersion = async (req: Request, res: Response) => {
    const version = await this.service.crearVersion(this.idParam(req), this.usuarioId(req), req.body);
    return this.created(res, version, 'Versión guardada');
  };

  restaurarVersion = async (req: Request, res: Response) => {
    const documento = await this.service.restaurarVersion(this.idParam(req), this.idParam(req, 'versionId'), this.usuarioId(req));
    return this.ok(res, documento, 'Versión restaurada');
  };

  // ---------- Exportar ----------

  exportar = async (req: Request, res: Response) => {
    const { formato } = validatedQuery<ExportarQuery>(res);
    return this.ok(res, await this.service.exportar(this.idParam(req), this.usuarioId(req), formato), 'Documento exportado');
  };
}

export const documentoColaborativoController = new DocumentoColaborativoController(documentoColaborativoService);
