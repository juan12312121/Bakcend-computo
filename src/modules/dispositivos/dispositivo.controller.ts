import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { RegistrarDispositivoDto } from './dispositivo.schemas';
import { dispositivoService, type DispositivoService } from './dispositivo.service';

export class DispositivoController extends BaseController {
  constructor(private readonly service: DispositivoService) {
    super();
  }

  registrar = async (req: Request, res: Response) => {
    const dispositivo = await this.service.registrar(this.usuarioId(req), req.body as RegistrarDispositivoDto);
    return this.ok(res, { id: dispositivo.id, plataforma: dispositivo.plataforma }, 'Dispositivo registrado para notificaciones');
  };

  quitar = async (req: Request, res: Response) => {
    await this.service.quitar(this.usuarioId(req), String(req.params.token));
    return this.message(res, 'Dispositivo quitado');
  };
}

export const dispositivoController = new DispositivoController(dispositivoService);
