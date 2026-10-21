import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { validatedQuery } from '../../core/validation/validate';
import { fotoService, type FotoService } from './foto.service';
import type { FotosLoteDto, GaleriaQuery } from './foto.schemas';

export class FotoController extends BaseController {
  constructor(private readonly service: FotoService) {
    super();
  }

  deUsuario = async (req: Request, res: Response) => {
    const galeria = await this.service.galeria(
      this.idParam(req, 'usuario_id'),
      this.usuarioIdOpcional(req),
      validatedQuery<GaleriaQuery>(res),
    );
    return this.ok(res, galeria, 'Fotos del usuario obtenidas');
  };

  misFotos = async (req: Request, res: Response) => {
    const id = this.usuarioId(req);
    return this.ok(res, await this.service.galeria(id, id, validatedQuery<GaleriaQuery>(res)), 'Fotos obtenidas');
  };

  fotoPerfil = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.fotoPerfil(this.idParam(req, 'usuario_id')), 'Foto de perfil obtenida');
  };

  fotosPerfilLote = async (req: Request, res: Response) => {
    const { usuarios_ids } = req.body as FotosLoteDto;
    const fotos = await this.service.fotosPerfil(usuarios_ids);
    return this.ok(res, fotos, `${fotos.length} fotos de perfil obtenidas`);
  };
}

export const fotoController = new FotoController(fotoService);
