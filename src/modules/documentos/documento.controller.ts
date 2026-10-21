import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import { documentoService, type DocumentoService } from './documento.service';

/** Campo multipart del archivo (el mismo que usa la creación de publicaciones). */
export const CAMPO_DOCUMENTO = 'documentos';

export class DocumentoController extends BaseController {
  constructor(private readonly service: DocumentoService) {
    super();
  }

  misDocumentos = async (req: Request, res: Response) => {
    const page = await this.service.misDocumentos(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, page.total ? 'Mis documentos' : 'No tienes documentos');
  };

  deUsuario = async (req: Request, res: Response) => {
    const page = await this.service.deUsuario(
      this.idParam(req, 'usuario_id'),
      validatedQuery<Paginacion>(res),
      this.usuarioIdOpcional(req),
    );
    return this.paginated(res, page, 'Documentos del usuario');
  };

  dePublicacion = async (req: Request, res: Response) => {
    const documentos = await this.service.dePublicacion(this.idParam(req, 'publicacion_id'), this.usuarioId(req));
    return this.ok(res, documentos, `${documentos.length} documento(s) encontrado(s)`);
  };

  todos = async (_req: Request, res: Response) => {
    return this.paginated(res, await this.service.todos(validatedQuery<Paginacion>(res)), 'Lista de documentos');
  };

  obtener = async (req: Request, res: Response) => {
    const documento = await this.service.obtenerVisible(this.idParam(req), this.usuarioIdOpcional(req));
    return this.ok(res, documento, 'Documento encontrado');
  };

  subir = async (req: Request, res: Response) => {
    const documento = await this.service.subir(this.usuarioId(req), req.body, archivoDe(req, CAMPO_DOCUMENTO));
    return this.created(res, documento, 'Documento subido correctamente');
  };

  actualizar = async (req: Request, res: Response) => {
    const documento = await this.service.actualizar(this.idParam(req), this.usuarioId(req), req.body, archivoDe(req, CAMPO_DOCUMENTO));
    return this.ok(res, documento, 'Documento actualizado correctamente');
  };

  vincular = async (req: Request, res: Response) => {
    const documento = await this.service.vincular(this.idParam(req), this.usuarioId(req), req.body.publicacion_id);
    return this.ok(res, documento, 'Documento vinculado a publicación');
  };

  desvincular = async (req: Request, res: Response) => {
    const documento = await this.service.desvincular(this.idParam(req), this.usuarioId(req));
    return this.ok(res, documento, 'Documento desvinculado de publicación');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Documento eliminado correctamente');
  };
}

export const documentoController = new DocumentoController(documentoService);
