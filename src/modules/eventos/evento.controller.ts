import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { validatedQuery } from '../../core/validation/validate';
import { archivoDe } from '../../infrastructure/storage/FileStorage';
import type { AsistentesQuery, CalendarioQuery, ListarEventosQuery } from './evento.schemas';
import { eventoService, type EventoService } from './evento.service';

const MENSAJES_ASISTENCIA = {
  voy: '¡Vas a asistir!',
  interesado: 'Marcado como "me interesa"',
  no_voy: 'Marcado como "no voy"',
} as const;

export class EventoController extends BaseController {
  constructor(private readonly service: EventoService) {
    super();
  }

  listar = async (req: Request, res: Response) => {
    const page = await this.service.listar(validatedQuery<ListarEventosQuery>(res), this.usuarioIdOpcional(req));
    return this.paginated(res, page, 'Eventos obtenidos');
  };

  calendario = async (req: Request, res: Response) => {
    const eventos = await this.service.calendario(validatedQuery<CalendarioQuery>(res), this.usuarioIdOpcional(req));
    return this.ok(res, eventos, `${eventos.length} eventos en el rango`);
  };

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detalle(this.idParam(req), this.usuarioIdOpcional(req)), 'Evento obtenido');
  };

  crear = async (req: Request, res: Response) => {
    const evento = await this.service.crear(this.usuarioId(req), req.body, archivoDe(req));
    return this.created(res, evento, 'Evento creado');
  };

  actualizar = async (req: Request, res: Response) => {
    const evento = await this.service.actualizar(this.idParam(req), this.usuarioId(req), req.body, archivoDe(req));
    return this.ok(res, evento, 'Evento actualizado');
  };

  cancelar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.cancelar(this.idParam(req), this.usuarioId(req)), 'Evento cancelado');
  };

  eliminar = async (req: Request, res: Response) => {
    await this.service.eliminar(this.idParam(req), this.usuarioId(req));
    return this.message(res, 'Evento eliminado');
  };

  asistencia = async (req: Request, res: Response) => {
    const resultado = await this.service.marcarAsistencia(this.idParam(req), this.usuarioId(req), req.body.estado);
    return this.ok(res, resultado, MENSAJES_ASISTENCIA[resultado.mi_estado]);
  };

  invitar = async (req: Request, res: Response) => {
    const resultado = await this.service.invitar(this.idParam(req), this.usuarioId(req), req.body.usuario_ids);
    const n = resultado.invitados.length;
    return this.ok(res, resultado, n ? `${n} ${n === 1 ? 'invitación enviada' : 'invitaciones enviadas'}` : 'No había nadie nuevo a quien invitar');
  };

  asistentes = async (req: Request, res: Response) => {
    const page = await this.service.asistentesDe(this.idParam(req), validatedQuery<AsistentesQuery>(res), this.usuarioIdOpcional(req));
    return this.paginated(res, page, 'Asistentes del evento');
  };

  /** Única respuesta fuera del contrato JSON: el archivo iCalendar. */
  ics = async (req: Request, res: Response) => {
    const archivo = await this.service.ics(this.idParam(req), this.usuarioIdOpcional(req));
    res.attachment(archivo.nombre);
    res.set('Content-Type', 'text/calendar; charset=utf-8');
    return res.send(archivo.contenido);
  };
}

export const eventoController = new EventoController(eventoService);
