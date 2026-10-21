import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { validatedQuery } from '../../core/validation/validate';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import type { TemporalesDto } from '../chat/mensajes-temporales';
import type { ReaccionDto } from '../chat/reacciones';
import type { MensajesGrupoQuery } from './chat-grupo.schemas';
import { chatGrupoService, type ChatGrupoService } from './chat-grupo.service';

export class ChatGrupoController extends BaseController {
  constructor(private readonly service: ChatGrupoService) {
    super();
  }

  noLeidos = async (req: Request, res: Response) => {
    const grupos = await this.service.noLeidos(this.usuarioId(req));
    return this.ok(res, grupos, `${grupos.length} chats de grupo`);
  };

  mensajes = async (req: Request, res: Response) => {
    const page = await this.service.mensajes(this.idParam(req, 'grupoId'), this.usuarioId(req), validatedQuery<MensajesGrupoQuery>(res));
    return this.paginated(res, page, 'Mensajes del grupo');
  };

  enviar = async (req: Request, res: Response) => {
    const mensaje = await this.service.enviar(this.idParam(req, 'grupoId'), this.usuarioId(req), req.body, archivoDe(req));
    return this.created(res, mensaje, 'Mensaje enviado');
  };

  leer = async (req: Request, res: Response) => {
    const lectura = await this.service.leer(this.idParam(req, 'grupoId'), this.usuarioId(req));
    return this.ok(res, lectura, 'Chat del grupo al día');
  };

  eliminar = async (req: Request, res: Response) => {
    const eliminado = await this.service.eliminar(this.idParam(req, 'grupoId'), this.idParam(req, 'mensajeId'), this.usuarioId(req));
    return this.ok(res, eliminado, 'Mensaje eliminado para todos');
  };

  ajustes = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.ajustes(this.idParam(req, 'grupoId'), this.usuarioId(req)), 'Ajustes del chat del grupo');
  };

  temporales = async (req: Request, res: Response) => {
    const opcion = (req.body as TemporalesDto).mensajes_temporales;
    const resultado = await this.service.cambiarTemporales(this.idParam(req, 'grupoId'), this.usuarioId(req), opcion);
    return this.ok(res, resultado, opcion === 'apagado' ? 'Mensajes temporales desactivados' : 'Mensajes temporales activados');
  };

  reaccionar = async (req: Request, res: Response) => {
    const { emoji } = req.body as ReaccionDto;
    const resultado = await this.service.reaccionar(this.idParam(req, 'grupoId'), this.idParam(req, 'mensajeId'), this.usuarioId(req), emoji);
    return this.ok(res, resultado, 'Reacción guardada');
  };

  quitarReaccion = async (req: Request, res: Response) => {
    const resultado = await this.service.quitarReaccion(this.idParam(req, 'grupoId'), this.idParam(req, 'mensajeId'), this.usuarioId(req));
    return this.ok(res, resultado, 'Reacción quitada');
  };
}

export const chatGrupoController = new ChatGrupoController(chatGrupoService);
