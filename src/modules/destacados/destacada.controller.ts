import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import { destacadaService, type DestacadaService } from './destacada.service';
import type { AgregarHistoriaDto, OrdenDestacadasDto } from './destacada.schemas';

export class DestacadaController extends BaseController {
  constructor(private readonly service: DestacadaService) {
    super();
  }

  mias = async (req: Request, res: Response) => {
    const usuarioId = this.usuarioId(req);
    const lista = await this.service.deUsuario(usuarioId, usuarioId);
    return this.ok(res, lista, lista.length ? 'Mis destacadas' : 'Aún no tienes destacadas');
  };

  deUsuario = async (req: Request, res: Response) => {
    const lista = await this.service.deUsuario(this.idParam(req, 'usuarioId'), this.usuarioIdOpcional(req));
    return this.ok(res, lista, lista.length ? 'Destacadas del perfil' : 'Este perfil no tiene destacadas');
  };

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detalle(this.idParam(req), this.usuarioIdOpcional(req)), 'Destacada');
  };

  crear = async (req: Request, res: Response) => {
    const destacada = await this.service.crear(this.usuarioId(req), req.body, archivoDe(req));
    return this.created(res, destacada, 'Destacada creada');
  };

  actualizar = async (req: Request, res: Response) => {
    const destacada = await this.service.actualizar(this.idParam(req), this.usuarioId(req), req.body, archivoDe(req));
    return this.ok(res, destacada, 'Destacada actualizada');
  };

  agregarHistoria = async (req: Request, res: Response) => {
    const { historia_id } = req.body as AgregarHistoriaDto;
    return this.ok(res, await this.service.agregarHistoria(this.idParam(req), this.usuarioId(req), historia_id), 'Historia agregada a la destacada');
  };

  quitarHistoria = async (req: Request, res: Response) => {
    const destacada = await this.service.quitarHistoria(this.idParam(req), this.usuarioId(req), this.idParam(req, 'historiaId'));
    return this.ok(res, destacada, 'Historia quitada de la destacada');
  };

  reordenar = async (req: Request, res: Response) => {
    const { ids } = req.body as OrdenDestacadasDto;
    return this.ok(res, await this.service.reordenar(this.usuarioId(req), ids), 'Orden guardado');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Destacada eliminada');
  };
}

export const destacadaController = new DestacadaController(destacadaService);
