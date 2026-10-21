import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { validatedQuery } from '../../core/validation/validate';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import { usuarioService, type UsuarioService } from './usuario.service';
import type { BuscarUsuariosQuery } from './usuario.schemas';

export class UsuarioController extends BaseController {
  constructor(private readonly service: UsuarioService) {
    super();
  }

  miPerfil = async (req: Request, res: Response) => {
    const usuario = await this.service.obtener(this.usuarioId(req));
    return this.ok(res, usuario, 'Perfil obtenido');
  };

  /** Perfil de otra persona: sin datos privados y con `relacion` (el propio, con todo, está en /me). */
  perfil = async (req: Request, res: Response) => {
    const id = this.idParam(req);
    const yo = this.usuarioId(req);
    const perfil = id === yo ? await this.service.obtener(id) : await this.service.perfilPara(id, yo);
    return this.ok(res, perfil, 'Perfil obtenido');
  };

  actualizarPerfil = async (req: Request, res: Response) => {
    const usuario = await this.service.actualizarPerfil(this.usuarioId(req), req.body, {
      foto_perfil: archivoDe(req, 'foto_perfil'),
      foto_portada: archivoDe(req, 'foto_portada'),
    });
    return this.ok(res, usuario, 'Perfil actualizado');
  };

  eliminarCuenta = async (req: Request, res: Response) => {
    await this.service.eliminarCuenta(this.usuarioId(req));
    return this.message(res, 'Cuenta eliminada');
  };

  buscar = async (req: Request, res: Response) => {
    const { q, limit } = validatedQuery<BuscarUsuariosQuery>(res);
    const usuarios = await this.service.buscar(q, limit, this.usuarioId(req));
    return this.ok(res, usuarios, `${usuarios.length} usuarios encontrados`);
  };

  presencia = async (req: Request, res: Response) => {
    const estado = await this.service.marcarPresencia(this.usuarioId(req), req.body.en_linea);
    return this.ok(res, estado, estado.en_linea ? 'En línea' : 'Desconectado');
  };

  heartbeat = async (req: Request, res: Response) => {
    const estado = await this.service.marcarPresencia(this.usuarioId(req), true);
    return this.ok(res, estado, 'Heartbeat recibido');
  };

  enLinea = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.usuariosEnLinea(this.usuarioId(req)), 'Usuarios en línea');
  };

  seguidoresEnLinea = async (req: Request, res: Response) => {
    const seguidores = await this.service.seguidoresEnLinea(this.usuarioId(req));
    return this.ok(res, seguidores, `${seguidores.length} seguidores en línea`);
  };
}

export const usuarioController = new UsuarioController(usuarioService);
