import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import type { ListarGruposQuery } from './grupo.schemas';
import { grupoService, type FotosGrupo, type GrupoService } from './grupo.service';

export class GrupoController extends BaseController {
  constructor(private readonly service: GrupoService) {
    super();
  }

  listar = async (req: Request, res: Response) => {
    const { tipo, q, ...paginacion } = validatedQuery<ListarGruposQuery>(res);
    const page = await this.service.listar(paginacion, this.usuarioIdOpcional(req), tipo, q);
    return this.paginated(res, page, 'Grupos obtenidos');
  };

  misGrupos = async (req: Request, res: Response) => {
    const grupos = await this.service.misGrupos(this.usuarioId(req));
    return this.ok(res, grupos, `${grupos.length} grupos`);
  };

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detalle(this.idParam(req), this.usuarioIdOpcional(req)), 'Grupo obtenido');
  };

  crear = async (req: Request, res: Response) => {
    const grupo = await this.service.crear(this.usuarioId(req), req.body, this.fotos(req));
    return this.created(res, grupo, 'Grupo creado exitosamente');
  };

  actualizar = async (req: Request, res: Response) => {
    const grupo = await this.service.actualizar(this.idParam(req), this.usuarioId(req), req.body, this.fotos(req));
    return this.ok(res, grupo, 'Grupo actualizado correctamente');
  };

  unirse = async (req: Request, res: Response) => {
    const resultado = await this.service.unirse(this.idParam(req), this.usuarioId(req));
    return this.ok(res, resultado, resultado.estado === 'activo' ? 'Te has unido al grupo' : 'Solicitud enviada');
  };

  salir = async (req: Request, res: Response) => {
    await this.service.salir(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Has salido del grupo');
  };

  publicaciones = async (req: Request, res: Response) => {
    const page = await this.service.publicacionesDe(this.idParam(req), validatedQuery<Paginacion>(res), this.usuarioIdOpcional(req));
    return this.paginated(res, page, 'Publicaciones del grupo');
  };

  invitar = async (req: Request, res: Response) => {
    const invitacion = await this.service.invitar(this.idParam(req), this.usuarioId(req), req.body.usuario_id);
    return this.created(res, invitacion, 'Invitación enviada correctamente');
  };

  invitaciones = async (req: Request, res: Response) => {
    const invitaciones = await this.service.invitacionesPendientes(this.usuarioId(req));
    return this.ok(res, invitaciones, `${invitaciones.length} invitaciones pendientes`);
  };

  responderInvitacion = async (req: Request, res: Response) => {
    const resultado = await this.service.responderInvitacion(this.idParam(req, 'invitacion_id'), this.usuarioId(req), req.body);
    return this.ok(res, resultado, `Invitación ${resultado.estado} correctamente`);
  };

  private fotos(req: Request): FotosGrupo {
    return { foto_perfil: archivoDe(req, 'foto_perfil'), foto_portada: archivoDe(req, 'foto_portada') };
  }
}

export const grupoController = new GrupoController(grupoService);
