import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import type { EdicionHistoriaDto } from './historia.schemas';
import { historiaService, type HistoriaService } from './historia.service';

export class HistoriaController extends BaseController {
  constructor(private readonly service: HistoriaService) {
    super();
  }

  fondos = async (_req: Request, res: Response) => {
    return this.ok(res, this.service.fondos(), 'Fondos disponibles para historias de texto');
  };

  crear = async (req: Request, res: Response) => {
    const historia = await this.service.crear(this.usuarioId(req), req.body, archivoDe(req));
    return this.created(res, historia, 'Historia publicada');
  };

  bandeja = async (req: Request, res: Response) => {
    const grupos = await this.service.bandeja(this.usuarioId(req));
    return this.ok(res, grupos, grupos.length ? `${grupos.length} cuentas con historias` : 'No hay historias por ahora');
  };

  deUsuario = async (req: Request, res: Response) => {
    const grupo = await this.service.deUsuario(this.idParam(req, 'usuarioId'), this.usuarioId(req));
    return this.ok(res, grupo, grupo.historias.length ? 'Historias del usuario' : 'El usuario no tiene historias vigentes');
  };

  marcarVista = async (req: Request, res: Response) => {
    const resultado = await this.service.marcarVista(this.idParam(req), this.usuarioId(req));
    const mensaje = resultado.propia
      ? 'Las historias propias no suman vistas'
      : resultado.registrada
        ? 'Vista registrada'
        : 'Ya habías visto esta historia';
    return this.ok(res, resultado, mensaje);
  };

  vistas = async (req: Request, res: Response) => {
    const page = await this.service.quienesVieron(this.idParam(req), this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Vistas de la historia');
  };

  /** [creadores] Mis historias (vigentes y pasadas) para elegir destacadas. */
  archivo = async (req: Request, res: Response) => {
    const page = await this.service.archivo(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, page.total ? 'Archivo de historias' : 'Aún no tienes historias');
  };

  /** [creadores] Ajustes del editor de video (música en `archivo`). */
  editarVideo = async (req: Request, res: Response) => {
    const historia = await this.service.editarVideo(this.idParam(req), this.usuarioId(req), req.body as EdicionHistoriaDto, archivoDe(req));
    return this.ok(res, historia, 'Ajustes del video guardados');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Historia eliminada');
  };
}

export const historiaController = new HistoriaController(historiaService);
