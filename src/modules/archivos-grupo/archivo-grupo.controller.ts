import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { validatedQuery } from '../../core/validation/validate';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import type { BuscarArchivosQuery, ContenidoQuery } from './archivo-grupo.schemas';
import { archivoGrupoService, type ArchivoGrupoService } from './archivo-grupo.service';
import { carpetaGrupoService, type CarpetaGrupoService } from './carpeta-grupo.service';

export class ArchivoGrupoController extends BaseController {
  constructor(
    private readonly archivos: ArchivoGrupoService,
    private readonly carpetas: CarpetaGrupoService,
  ) {
    super();
  }

  // ---------- Del grupo ----------

  contenido = async (req: Request, res: Response) => {
    const { carpeta_id } = validatedQuery<ContenidoQuery>(res);
    return this.ok(res, await this.carpetas.contenido(this.idParam(req, 'grupoId'), this.usuarioId(req), carpeta_id), 'Contenido de la carpeta');
  };

  arbol = async (req: Request, res: Response) => {
    const carpetas = await this.carpetas.arbol(this.idParam(req, 'grupoId'), this.usuarioId(req));
    return this.ok(res, carpetas, `${carpetas.length} carpetas`);
  };

  buscar = async (req: Request, res: Response) => {
    const page = await this.archivos.buscar(this.idParam(req, 'grupoId'), this.usuarioId(req), validatedQuery<BuscarArchivosQuery>(res));
    return this.paginated(res, page, 'Archivos encontrados');
  };

  uso = async (req: Request, res: Response) => {
    return this.ok(res, await this.archivos.uso(this.idParam(req, 'grupoId'), this.usuarioId(req)), 'Espacio usado por el grupo');
  };

  crearCarpeta = async (req: Request, res: Response) => {
    const carpeta = await this.carpetas.crear(this.idParam(req, 'grupoId'), this.usuarioId(req), req.body);
    return this.created(res, carpeta, 'Carpeta creada');
  };

  subir = async (req: Request, res: Response) => {
    const archivo = await this.archivos.subir(this.idParam(req, 'grupoId'), this.usuarioId(req), req.body, archivoDe(req));
    return this.created(res, archivo, 'Archivo subido');
  };

  // ---------- Carpetas ----------

  actualizarCarpeta = async (req: Request, res: Response) => {
    return this.ok(res, await this.carpetas.actualizar(this.idParam(req), this.usuarioId(req), req.body), 'Carpeta actualizada');
  };

  eliminarCarpeta = async (req: Request, res: Response) => {
    const borrado = await this.carpetas.eliminar(this.idParam(req), this.usuarioId(req));
    return this.ok(res, borrado, 'Carpeta eliminada con su contenido');
  };

  // ---------- Archivos ----------

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.archivos.detalle(this.idParam(req), this.usuarioId(req)));
  };

  actualizar = async (req: Request, res: Response) => {
    return this.ok(res, await this.archivos.actualizar(this.idParam(req), this.usuarioId(req), req.body), 'Archivo actualizado');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.archivos.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Archivo eliminado');
  };
}

export const archivoGrupoController = new ArchivoGrupoController(archivoGrupoService, carpetaGrupoService);
