import { env } from '../../../config/env';
import { NotFoundError } from '../../../core/errors';
import { eventoAsistenteRepository, eventoRepository, type EventoAsistenteRepository, type EventoRepository } from '../../eventos/evento.repository';
import type { CalendarioQuery } from '../../eventos/evento.schemas';
import { seguidorRepository, type SeguidorRepository } from '../../seguidores/seguidor.repository';
import { accesoAula, type AccesoAula, type RolAula } from '../aula.acceso';
import { nombreArchivo, type ArchivoTexto } from '../aula.csv';
import { asignacionRepository, entregaRepository, type AsignacionRepository, type EntregaRepository } from '../asignaciones/asignacion.repository';
import { estadoDeAlumno } from '../asignaciones/libreta';
import { deAsignacion, deEvento, deTarea, ordenarElementos, type ElementoCalendario } from './calendario.elementos';
import { generarCalendarioIcs } from './calendario.ics';
import {
  calendarioTokenRepository,
  tareaCalendarioRepository,
  type CalendarioTokenRepository,
  type TareaCalendarioRepository,
} from './calendario.repository';

const MS_DIA = 24 * 60 * 60 * 1000;
/** Lo que trae la suscripción: desde hace 60 días hasta dentro de 180. */
export const DIAS_ICS_ATRAS = 60;
export const DIAS_ICS_ADELANTE = 180;

/** Enlaces para suscribirse al calendario del grupo. */
export interface SuscripcionCalendario {
  /** URL https del .ics (Outlook, Apple, cualquier lector). */
  url: string;
  /** La misma con webcal:// (abre la app de calendario del teléfono). */
  webcal: string;
  /** Abre Google Calendar con la suscripción lista para aceptar. */
  google: string;
}

export class CalendarioGrupoService {
  constructor(
    private readonly acceso: AccesoAula,
    private readonly eventos: EventoRepository,
    private readonly asistentes: EventoAsistenteRepository,
    private readonly seguidores: SeguidorRepository,
    private readonly tareas: TareaCalendarioRepository,
    private readonly asignaciones: AsignacionRepository,
    private readonly entregas: EntregaRepository,
    private readonly tokens: CalendarioTokenRepository,
    /** Base pública de la API (para la URL de suscripción). */
    private readonly urlApi: string,
    /** Base de la app web (para los enlaces dentro del .ics). */
    private readonly urlApp: string,
  ) {}

  /** Todo lo del grupo que se cruza con [desde, hasta) (máx. 62 días), en un solo formato y ordenado. */
  async elementos(grupoId: number, usuarioId: number, { desde, hasta }: CalendarioQuery): Promise<ElementoCalendario[]> {
    const { rol } = await this.acceso.exigirMiembro(grupoId, usuarioId);
    return this.reunir(grupoId, usuarioId, rol, desde, hasta);
  }

  /** URL secreta del usuario para el calendario de este grupo (crea el token la primera vez). */
  async suscripcion(grupoId: number, usuarioId: number): Promise<SuscripcionCalendario> {
    await this.acceso.exigirMiembro(grupoId, usuarioId);
    const { token } = await this.tokens.deUsuario(usuarioId);
    return this.enlaces(token, grupoId);
  }

  /** Token nuevo: las suscripciones anteriores (de todos sus grupos) dejan de funcionar. */
  async regenerar(grupoId: number, usuarioId: number): Promise<SuscripcionCalendario> {
    await this.acceso.exigirMiembro(grupoId, usuarioId);
    const { token } = await this.tokens.regenerar(usuarioId);
    return this.enlaces(token, grupoId);
  }

  /** El .ics de la suscripción. 404 si el token no existe o su dueño ya no es miembro activo (no se distingue). */
  async ics(token: string, grupoId: number, ahora: Date = new Date()): Promise<ArchivoTexto> {
    const registro = await this.tokens.porToken(token);
    const rol = registro ? await this.acceso.rolDe(grupoId, registro.usuario_id) : null;
    if (!registro || !rol) throw new NotFoundError('Calendario');
    const { grupo } = await this.acceso.exigirMiembro(grupoId, registro.usuario_id);
    const desde = new Date(ahora.getTime() - DIAS_ICS_ATRAS * MS_DIA);
    const hasta = new Date(ahora.getTime() + DIAS_ICS_ADELANTE * MS_DIA);
    const elementos = await this.reunir(grupoId, registro.usuario_id, rol, desde, hasta);
    return {
      nombre: `${nombreArchivo(grupo.nombre)}.ics`,
      tipo: 'text/calendar; charset=utf-8',
      contenido: generarCalendarioIcs({ nombre: `TrinoFlow · ${grupo.nombre}`, elementos, urlApp: this.urlApp }, ahora),
    };
  }

  // ---------- Apoyo ----------

  private async reunir(grupoId: number, usuarioId: number, rol: RolAula, desde: Date, hasta: Date): Promise<ElementoCalendario[]> {
    const [eventos, tareas, asignaciones] = await Promise.all([
      this.eventosVisibles(grupoId, usuarioId, rol, desde, hasta),
      this.tareas.delGrupoEnRango(grupoId, desde, hasta),
      this.asignaciones.enRango(grupoId, desde, hasta),
    ]);
    const mias = rol === 'alumno' ? await this.entregas.delAlumnoEn(usuarioId, asignaciones.map((a) => a.id)) : null;
    return ordenarElementos([
      ...eventos.map(deEvento),
      ...tareas.map(deTarea),
      ...asignaciones.map((a) => deAsignacion(a, mias ? estadoDeAlumno(mias.get(a.id)) : null)),
    ]);
  }

  /** Eventos del grupo con la misma regla de visibilidad que el módulo de eventos (los maestros ven todos). */
  private async eventosVisibles(grupoId: number, usuarioId: number, rol: RolAula, desde: Date, hasta: Date) {
    const [seguidos, conFila] = await Promise.all([
      this.seguidores.findAll({ seguidor_id: usuarioId, estado: 'aceptado' }, { attributes: ['siguiendo_id'] }).then((f) => f.map((s) => s.siguiendo_id)),
      this.asistentes.idsEventosDe(usuarioId),
    ]);
    return this.eventos.todos({
      alcance: { usuarioId, seguidos, grupos: [grupoId], gruposModerados: rol === 'maestro' ? [grupoId] : [], conFila },
      ahora: new Date(),
      grupo_id: grupoId,
      rango: { desde, hasta },
    });
  }

  private enlaces(token: string, grupoId: number): SuscripcionCalendario {
    const url = `${this.urlApi.replace(/\/+$/, '')}/api/aula/ics/${token}/grupos/${grupoId}.ics`;
    const webcal = url.replace(/^https?:\/\//i, 'webcal://');
    return { url, webcal, google: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}` };
  }
}

export const calendarioGrupoService = new CalendarioGrupoService(
  accesoAula,
  eventoRepository,
  eventoAsistenteRepository,
  seguidorRepository,
  tareaCalendarioRepository,
  asignacionRepository,
  entregaRepository,
  calendarioTokenRepository,
  env.API_URL,
  env.FRONTEND_URL,
);
