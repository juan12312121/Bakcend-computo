import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import type { Paginacion } from '../../core/validation/common.schemas';
import { validatedQuery } from '../../core/validation/validate';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import { chatService, type ChatService } from './chat.service';
import type { TemporalesDto } from './mensajes-temporales';
import type { ReaccionDto } from './reacciones';

export class ChatController extends BaseController {
  constructor(private readonly service: ChatService) {
    super();
  }

  lista = async (req: Request, res: Response) => {
    const page = await this.service.lista(this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Chats obtenidos');
  };

  mensajes = async (req: Request, res: Response) => {
    const page = await this.service.mensajesDe(this.idParam(req, 'chatId'), this.usuarioId(req), validatedQuery<Paginacion>(res));
    return this.paginated(res, page, 'Mensajes obtenidos');
  };

  iniciar = async (req: Request, res: Response) => {
    const { chat, creado } = await this.service.iniciar(this.usuarioId(req), req.body.receptorId);
    return creado ? this.created(res, chat, 'Chat iniciado') : this.ok(res, chat, 'Chat existente');
  };

  enviar = async (req: Request, res: Response) => {
    const mensaje = await this.service.enviar(this.usuarioId(req), req.body, archivoDe(req));
    return this.created(res, mensaje, 'Mensaje enviado');
  };

  leer = async (req: Request, res: Response) => {
    const lectura = await this.service.leer(this.idParam(req, 'chatId'), this.usuarioId(req));
    return this.ok(res, lectura, lectura.marcados ? 'Mensajes marcados como leídos' : 'No había mensajes sin leer');
  };

  eliminarMensaje = async (req: Request, res: Response) => {
    const eliminado = await this.service.eliminarMensaje(this.idParam(req, 'mensajeId'), this.usuarioId(req));
    return this.ok(res, eliminado, 'Mensaje eliminado para todos');
  };

  aceptar = async (req: Request, res: Response) => {
    const chat = await this.service.aceptar(this.idParam(req, 'chatId'), this.usuarioId(req));
    return this.ok(res, chat, 'Solicitud aceptada');
  };

  temporales = async (req: Request, res: Response) => {
    const opcion = (req.body as TemporalesDto).mensajes_temporales;
    const resultado = await this.service.cambiarTemporales(this.idParam(req, 'chatId'), this.usuarioId(req), opcion);
    return this.ok(res, resultado, opcion === 'apagado' ? 'Mensajes temporales desactivados' : 'Mensajes temporales activados');
  };

  reaccionar = async (req: Request, res: Response) => {
    const { emoji } = req.body as ReaccionDto;
    return this.ok(res, await this.service.reaccionar(this.idParam(req, 'mensajeId'), this.usuarioId(req), emoji), 'Reacción guardada');
  };

  quitarReaccion = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.quitarReaccion(this.idParam(req, 'mensajeId'), this.usuarioId(req)), 'Reacción quitada');
  };
}

export const chatController = new ChatController(chatService);
