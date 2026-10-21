import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { validatedQuery } from '../../core/validation/validate';
import { estadisticaService, type EstadisticaService } from './estadistica.service';
import type { DetalleQuery, ImpresionesDto, ResumenQuery } from './estadistica.schemas';

export class EstadisticaController extends BaseController {
  constructor(private readonly service: EstadisticaService) {
    super();
  }

  impresiones = async (req: Request, res: Response) => {
    const { publicacion_ids } = req.body as ImpresionesDto;
    return this.ok(res, await this.service.registrarImpresiones(this.usuarioId(req), publicacion_ids), 'Impresiones registradas');
  };

  visitaPerfil = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.registrarVisitaPerfil(this.usuarioId(req), this.idParam(req, 'usuarioId')), 'Visita registrada');
  };

  clic = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.registrarClic(this.usuarioId(req), this.idParam(req, 'publicacionId')), 'Clic registrado');
  };

  resumen = async (req: Request, res: Response) => {
    const { dias, zona } = validatedQuery<ResumenQuery>(res);
    return this.ok(res, await this.service.resumen(this.usuarioId(req), dias, zona), `Estadísticas de los últimos ${dias} días`);
  };

  detallePublicacion = async (req: Request, res: Response) => {
    const { zona } = validatedQuery<DetalleQuery>(res);
    const detalle = await this.service.detallePublicacion(this.usuarioId(req), this.idParam(req, 'publicacionId'), zona);
    return this.ok(res, detalle, 'Estadísticas de la publicación');
  };
}

export const estadisticaController = new EstadisticaController(estadisticaService);
