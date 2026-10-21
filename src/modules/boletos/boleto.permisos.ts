import { ForbiddenError } from '../../core/errors';
import type { Evento } from '../../infrastructure/database/models';
import { eventoRepository, type EventoRepository } from '../eventos/evento.repository';
import { eventoService, type EventoService } from '../eventos/evento.service';
import { eventoStaffRepository, type EventoStaffRepository } from './boleto.repository';

export interface AccesoPuerta {
  evento: Evento;
  /** Organizador (creador o admin/moderador del grupo); si no, es staff. */
  organizador: boolean;
}

/**
 * Quién puede hacer qué con los boletos de un evento:
 * organizador = quien puede editar el evento · puerta = organizador o staff autorizado.
 */
export class PermisosBoletos {
  constructor(
    private readonly eventos: EventoService,
    private readonly repoEventos: EventoRepository,
    private readonly staff: EventoStaffRepository,
  ) {}

  evento(id: number): Promise<Evento> {
    return this.repoEventos.findByIdOrFail(id);
  }

  async esOrganizador(evento: Evento, usuarioId?: number): Promise<boolean> {
    return !!usuarioId && (await this.eventos.puedeEditar(evento, usuarioId));
  }

  async esStaff(eventoId: number, usuarioId?: number): Promise<boolean> {
    return !!usuarioId && (await this.staff.esStaff(eventoId, usuarioId));
  }

  async asegurarOrganizador(eventoId: number, usuarioId: number): Promise<Evento> {
    const evento = await this.evento(eventoId);
    if (!(await this.esOrganizador(evento, usuarioId))) {
      throw new ForbiddenError('Solo quien organiza el evento puede administrar sus boletos');
    }
    return evento;
  }

  async asegurarPuerta(eventoId: number, usuarioId: number): Promise<AccesoPuerta> {
    const evento = await this.evento(eventoId);
    if (await this.esOrganizador(evento, usuarioId)) return { evento, organizador: true };
    if (await this.esStaff(eventoId, usuarioId)) return { evento, organizador: false };
    throw new ForbiddenError('Solo el organizador y el staff autorizado pueden validar boletos de este evento');
  }
}

export const permisosBoletos = new PermisosBoletos(eventoService, eventoRepository, eventoStaffRepository);
