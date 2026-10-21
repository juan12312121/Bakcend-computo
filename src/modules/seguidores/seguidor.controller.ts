import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import type { LadoRelacion } from './seguidor.repository';
import type { SeguirDto } from './seguidor.schemas';
import { seguidorService, type ResultadoSeguimiento, type SeguidorService } from './seguidor.service';

/** Mensaje según cómo quedó la relación. */
const mensajeDe = ({ estado }: ResultadoSeguimiento): string =>
  estado === 'pendiente' ? 'Solicitud de seguimiento enviada' : estado === 'aceptado' ? 'Ahora sigues a este usuario' : 'Dejaste de seguir a este usuario';

export class SeguidorController extends BaseController {
  constructor(private readonly service: SeguidorService) {
    super();
  }

  seguir = async (req: Request, res: Response) => {
    const { seguido_id } = req.body as SeguirDto;
    const resultado = await this.service.seguir(this.usuarioId(req), seguido_id);
    return this.created(res, resultado, mensajeDe(resultado));
  };

  dejarDeSeguir = async (req: Request, res: Response) => {
    const { seguido_id } = req.body as SeguirDto;
    const resultado = await this.service.dejarDeSeguir(this.usuarioId(req), seguido_id);
    return this.ok(res, resultado, 'Dejaste de seguir a este usuario');
  };

  toggle = async (req: Request, res: Response) => {
    const { seguido_id } = req.body as SeguirDto;
    const resultado = await this.service.toggle(this.usuarioId(req), seguido_id);
    return resultado.estado ? this.created(res, resultado, mensajeDe(resultado)) : this.ok(res, resultado, mensajeDe(resultado));
  };

  verificar = async (req: Request, res: Response) => {
    const estado = await this.service.verificar(this.usuarioId(req), this.idParam(req, 'usuario_id'));
    return this.ok(res, estado, 'Verificación completada');
  };

  estadisticas = async (req: Request, res: Response) => {
    const totales = await this.service.estadisticas(this.idParam(req, 'usuario_id'));
    return this.ok(res, totales, 'Estadísticas obtenidas');
  };

  seguidores = (req: Request, res: Response) => this.listar(req, res, 'seguidores');

  seguidos = (req: Request, res: Response) => this.listar(req, res, 'seguidos');

  // ---------- Solicitudes ----------

  solicitudes = async (req: Request, res: Response) => {
    const page = await this.service.solicitudes(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Solicitudes de seguimiento');
  };

  aceptarSolicitud = async (req: Request, res: Response) => {
    const aceptada = await this.service.aceptarSolicitud(this.usuarioId(req), this.idParam(req, 'seguidorId'));
    return this.ok(res, aceptada, 'Solicitud aceptada');
  };

  rechazarSolicitud = async (req: Request, res: Response) => {
    await this.service.rechazarSolicitud(this.usuarioId(req), this.idParam(req, 'seguidorId'));
    return this.message(res, 'Solicitud rechazada');
  };

  private async listar(req: Request, res: Response, lado: LadoRelacion) {
    const page = await this.service.listar(
      this.idParam(req, 'usuario_id'),
      lado,
      validatedQuery<Paginacion>(res),
      this.usuarioId(req),
    );
    return this.paginated(res, page, lado === 'seguidores' ? 'Seguidores obtenidos' : 'Seguidos obtenidos');
  }
}

export const seguidorController = new SeguidorController(seguidorService);
