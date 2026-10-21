import type { Request, Response } from 'express';
import { BaseController } from '../../../core/http/BaseController';
import { validatedQuery } from '../../../core/validation/validate';
import type { CalendarioQuery } from '../../eventos/evento.schemas';
import { enviarArchivo } from '../aula.archivos';
import { calendarioGrupoService, type CalendarioGrupoService } from './calendario.service';

export class CalendarioController extends BaseController {
  constructor(private readonly service: CalendarioGrupoService) {
    super();
  }

  elementos = async (req: Request, res: Response) => {
    const elementos = await this.service.elementos(this.idParam(req, 'grupo_id'), this.usuarioId(req), validatedQuery<CalendarioQuery>(res));
    return this.ok(res, elementos, `${elementos.length} elementos en el rango`);
  };

  suscripcion = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.suscripcion(this.idParam(req, 'grupo_id'), this.usuarioId(req)), 'Enlace de suscripción');
  };

  regenerar = async (req: Request, res: Response) => {
    const enlaces = await this.service.regenerar(this.idParam(req, 'grupo_id'), this.usuarioId(req));
    return this.ok(res, enlaces, 'Enlace nuevo: las suscripciones anteriores dejaron de funcionar');
  };

  /** Sin sesión: lo pide Google Calendar con el token secreto. Se sirve en línea (no como descarga). */
  ics = async (req: Request, res: Response) => {
    const archivo = await this.service.ics(String(req.params.token), this.idParam(req, 'grupo_id'));
    return enviarArchivo(res, archivo, false);
  };
}

export const calendarioController = new CalendarioController(calendarioGrupoService);
