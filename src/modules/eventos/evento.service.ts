import type { InferAttributes, Sequelize, Transaction } from 'sequelize';
import { env } from '../../config/env';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, UnauthorizedError, ValidationError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import {
  sequelize,
  type EstadoAsistencia,
  type Evento,
  type Grupo,
  type TipoNotificacion,
  type Usuario,
} from '../../infrastructure/database/models';
import { fileStorage } from '../../infrastructure/storage/CloudinaryStorage';
import type { ArchivoSubido, FileStorage } from '../../infrastructure/storage/FileStorage';
import { grupoMiembroRepository, type GrupoMiembroRepository } from '../grupos/grupo-miembro.repository';
import { grupoRepository, type GrupoRepository } from '../grupos/grupo.repository';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { seguidorRepository, type SeguidorRepository } from '../seguidores/seguidor.repository';
import { ATRIBUTOS_USUARIO_PUBLICO, usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { DURACION_POR_DEFECTO_MS, generarIcs } from './evento.ics';
import {
  eventoAsistenteRepository,
  eventoRepository,
  type AlcanceUsuario,
  type AsistenteDeEvento,
  type ATRIBUTOS_GRUPO_EVENTO,
  type EventoAsistenteRepository,
  type EventoRepository,
} from './evento.repository';
import {
  enElPasado,
  erroresDeCoherencia,
  type ActualizarEventoDto,
  type AsistentesQuery,
  type CalendarioQuery,
  type CrearEventoDto,
  type ListarEventosQuery,
  type RespuestaAsistencia,
} from './evento.schemas';
import { asegurarTextoPermitido } from '../moderacion/palabras.service';

export type UsuarioPublico = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]>;
export type GrupoDeEvento = Pick<InferAttributes<Grupo>, (typeof ATRIBUTOS_GRUPO_EVENTO)[number]>;

/** Evento tal como lo recibe el cliente (sin el public_id de la portada) + mi relación con él. */
export type EventoVista = Omit<InferAttributes<Evento>, 'portada_s3'> & {
  creador: UsuarioPublico;
  grupo: GrupoDeEvento | null;
  /** voy | interesado | no_voy | invitado | null (sin fila o sin sesión). */
  mi_estado: EstadoAsistencia | null;
  /** Creador o admin/moderador del grupo. */
  puedo_editar: boolean;
  /** Tiene cupo y ya se llenó. */
  lleno: boolean;
  /** Ya pasó su fin (o 2 h desde el inicio si no tiene fin). */
  terminado: boolean;
};

export type EventoDetalle = EventoVista & {
  /** Hasta 8 personas con "voy" (para la fila de avatares). */
  asistentes_preview: UsuarioPublico[];
  total_invitados: number;
};

export interface ResultadoAsistencia {
  evento_id: number;
  mi_estado: RespuestaAsistencia;
  total_asistentes: number;
  total_interesados: number;
  lleno: boolean;
}

export interface ResultadoInvitacion {
  /** A quiénes se invitó ahora (y se les notificó). */
  invitados: number[];
  /** Ya estaban en el evento, no existen o eran yo. */
  omitidos: number[];
}

export interface ArchivoIcs {
  nombre: string;
  contenido: string;
}

/** Cuántas personas trae la vista previa del detalle. */
export const ASISTENTES_EN_VISTA_PREVIA = 8;
/** Cada cuánto se buscan eventos que empiezan pronto. */
export const MINUTOS_RECORDATORIOS = 10;
/** Se avisa a quienes van o les interesa cuando falta esto (o menos) para empezar. */
export const ANTICIPACION_RECORDATORIO_MS = 60 * 60 * 1000;

const ESTADOS_QUE_ASISTEN: EstadoAsistencia[] = ['voy', 'interesado'];

/**
 * Lo que el módulo de boletos aporta a los eventos. Se conecta solo al cargar `modules/boletos`
 * (`eventoService.conectarBoletos(...)`); sin él, los eventos funcionan igual que antes.
 */
export interface ExtensionBoletos {
  /** ¿Tiene un boleto válido (o ya usado) para el evento? En eventos con `requiere_boleto`, "voy" lo exige. */
  tieneBoleto(eventoId: number, usuarioId: number): Promise<boolean>;
  /** Después de cancelar: reembolsa pagos, cancela boletos gratis y libera órdenes pendientes. */
  alCancelarEvento(evento: Evento): Promise<void>;
  /** Antes de eliminar: lanza un error si hay pagos sin reembolsar. */
  antesDeEliminarEvento(evento: Evento): Promise<void>;
}

/** Un evento sin fin se considera terminado 2 h después de empezar. */
export function haTerminado(evento: Pick<Evento, 'inicio' | 'fin'>, ahora: number = Date.now()): boolean {
  const fin = evento.fin ? new Date(evento.fin).getTime() : new Date(evento.inicio).getTime() + DURACION_POR_DEFECTO_MS;
  return fin < ahora;
}

/** ['la fecha', 'el lugar', 'el enlace'] → "la fecha, el lugar y el enlace". */
function unirLista(partes: string[]): string {
  return partes.length > 1 ? `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}` : (partes[0] ?? '');
}

const mismaFecha = (a: Date | null | undefined, b: Date | null | undefined) =>
  (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);

export class EventoService extends BaseService<Evento, EventoRepository> {
  constructor(
    repository: EventoRepository,
    private readonly asistentes: EventoAsistenteRepository,
    private readonly grupos: GrupoRepository,
    private readonly miembros: GrupoMiembroRepository,
    private readonly seguidores: SeguidorRepository,
    private readonly usuarios: UsuarioRepository,
    private readonly notificaciones: NotificacionService,
    private readonly storage: FileStorage,
    private readonly db: Sequelize,
    /** Base de la app web, para el enlace del .ics. */
    private readonly urlApp: string,
  ) {
    super(repository);
  }

  private boletos: ExtensionBoletos | null = null;

  /** Lo llama el módulo de boletos al cargarse. */
  conectarBoletos(extension: ExtensionBoletos): void {
    this.boletos = extension;
  }

  // ---------- Consultas ----------

  /** Listado paginado de lo que puedo ver (próximos por defecto) con filtros. */
  async listar(filtros: ListarEventosQuery, usuarioId?: number): Promise<Page<EventoVista>> {
    if (filtros.mios && !usuarioId) throw new UnauthorizedError('Inicia sesión para ver tus eventos');
    const { limit, offset, mios, ...resto } = filtros;

    let ids: number[] | undefined;
    if (usuarioId && mios && mios !== 'creados') ids = await this.asistentes.idsEventosDe(usuarioId, mios);

    const page = await this.repository.buscar(
      {
        ...resto,
        alcance: usuarioId ? await this.alcance(usuarioId) : undefined,
        ahora: new Date(),
        creador_id: mios === 'creados' ? usuarioId : undefined,
        ids,
      },
      { limit, offset },
    );
    return { ...page, items: await this.enriquecer(page.items, usuarioId) };
  }

  /** Todo lo visible que se cruza con el rango (máx. 62 días), sin paginar. */
  async calendario({ desde, hasta }: CalendarioQuery, usuarioId?: number): Promise<EventoVista[]> {
    const eventos = await this.repository.todos({
      alcance: usuarioId ? await this.alcance(usuarioId) : undefined,
      ahora: new Date(),
      rango: { desde, hasta },
    });
    return this.enriquecer(eventos, usuarioId);
  }

  async detalle(id: number, usuarioId?: number): Promise<EventoDetalle> {
    const evento = await this.visibleOrFail(id, usuarioId);
    const [[vista], previa, totalInvitados] = await Promise.all([
      this.enriquecer([evento], usuarioId),
      this.asistentes.vistaPrevia(id, ASISTENTES_EN_VISTA_PREVIA),
      this.asistentes.count({ evento_id: id, estado: 'invitado' }),
    ]);
    return {
      ...vista,
      asistentes_preview: previa.map((u) => u.toJSON() as UsuarioPublico),
      total_invitados: totalInvitados,
    };
  }

  /** Personas del evento con un estado (voy por defecto), paginadas. */
  async asistentesDe(id: number, { estado, limit, offset }: AsistentesQuery, usuarioId?: number): Promise<Page<AsistenteDeEvento>> {
    await this.visibleOrFail(id, usuarioId);
    return this.asistentes.paginarPorEstado(id, estado, { limit, offset });
  }

  /** El .ics del evento (si lo puedo ver). */
  async ics(id: number, usuarioId?: number): Promise<ArchivoIcs> {
    const evento = await this.visibleOrFail(id, usuarioId);
    return {
      nombre: `evento-${evento.id}.ics`,
      contenido: generarIcs({
        id: evento.id,
        titulo: evento.titulo,
        descripcion: evento.descripcion,
        lugar: evento.lugar,
        enlace: evento.enlace,
        inicio: new Date(evento.inicio),
        fin: evento.fin ? new Date(evento.fin) : null,
        cancelado: evento.cancelado,
        url: `${this.urlApp.replace(/\/+$/, '')}/eventos/${evento.id}`,
        organizador: evento.creador?.nombre_completo ?? null,
        actualizado: evento.fecha_actualizacion ? new Date(evento.fecha_actualizacion) : null,
      }),
    };
  }

  // ---------- Escritura ----------

  /** El creador queda con "voy" (cuenta en el cupo). Con grupo: solo miembros activos; visibilidad "grupo" por defecto. */
  async crear(usuarioId: number, datos: CrearEventoDto): Promise<EventoDetalle>;
  async crear(usuarioId: number, datos: CrearEventoDto, portada: ArchivoSubido | undefined): Promise<EventoDetalle>;
  async crear(usuarioId: number, datos: CrearEventoDto, portada?: ArchivoSubido): Promise<EventoDetalle> {
    datos = { ...datos, titulo: await asegurarTextoPermitido(datos.titulo, 'nombre'), descripcion: await asegurarTextoPermitido(datos.descripcion, 'publicacion') };
    if (datos.grupo_id) {
      await this.grupos.findByIdOrFail(datos.grupo_id);
      if (!(await this.miembros.esMiembroActivo(datos.grupo_id, usuarioId))) {
        throw new ForbiddenError('Solo los miembros activos del grupo pueden crear eventos en él');
      }
    }

    const evento = await this.db.transaction(async (t) => {
      const nuevo = await this.repository.create(
        {
          creador_id: usuarioId,
          grupo_id: datos.grupo_id ?? null,
          titulo: datos.titulo,
          descripcion: datos.descripcion ?? null,
          modalidad: datos.modalidad,
          categoria: datos.categoria,
          visibilidad: datos.visibilidad ?? (datos.grupo_id ? 'grupo' : 'publico'),
          lugar: datos.lugar ?? null,
          enlace: datos.enlace ?? null,
          inicio: datos.inicio,
          fin: datos.fin ?? null,
          cupo: datos.cupo ?? null,
          portada_url: portada?.url ?? null,
          portada_s3: portada?.id ?? null,
          total_asistentes: 1,
        },
        t,
      );
      await this.asistentes.create({ evento_id: nuevo.id, usuario_id: usuarioId, estado: 'voy' }, t);
      return nuevo;
    });
    return this.detalle(evento.id, usuarioId);
  }

  /**
   * Creador o admin/moderador del grupo. Si cambia la fecha, el lugar o el enlace, avisa a quienes van o les interesa.
   * Una portada nueva (o `quitar_portada`) borra la anterior de Cloudinary.
   */
  async actualizar(id: number, usuarioId: number, datos: ActualizarEventoDto): Promise<EventoDetalle>;
  async actualizar(id: number, usuarioId: number, datos: ActualizarEventoDto, portada: ArchivoSubido | undefined): Promise<EventoDetalle>;
  async actualizar(id: number, usuarioId: number, datos: ActualizarEventoDto, portada?: ArchivoSubido): Promise<EventoDetalle> {
    datos = { ...datos, titulo: await asegurarTextoPermitido(datos.titulo, 'nombre'), descripcion: await asegurarTextoPermitido(datos.descripcion, 'publicacion') };
    const evento = await this.repository.findByIdOrFail(id);
    await this.asegurarPuedeEditar(evento, usuarioId);
    if (evento.cancelado) throw new BadRequestError('No se puede editar un evento cancelado');

    const { quitar_portada: quitarPortada, ...campos } = datos;
    const cambios: Partial<InferAttributes<Evento>> = Object.fromEntries(Object.entries(campos).filter(([, v]) => v !== undefined));
    if (portada) Object.assign(cambios, { portada_url: portada.url, portada_s3: portada.id });
    else if (quitarPortada && evento.portada_url) Object.assign(cambios, { portada_url: null, portada_s3: null });
    if (!Object.keys(cambios).length) throw new BadRequestError('No hay datos para actualizar');

    const final = { ...(evento.get({ plain: true }) as InferAttributes<Evento>), ...cambios };
    const errores = erroresDeCoherencia(final);
    const cambioInicio = cambios.inicio !== undefined && !mismaFecha(cambios.inicio, evento.inicio);
    if (cambioInicio && enElPasado(final.inicio)) errores.push({ campo: 'inicio', mensaje: 'La fecha de inicio no puede estar en el pasado' });
    if (cambios.cupo != null && cambios.cupo < evento.total_asistentes) {
      errores.push({ campo: 'cupo', mensaje: `El cupo no puede ser menor que los asistentes confirmados (${evento.total_asistentes})` });
    }
    if (errores.length) throw new ValidationError(errores);

    // Qué cambió de lo que afecta a quien ya pensaba ir (antes de actualizar, que muta el registro)
    const avisos: string[] = [];
    if (cambioInicio || (cambios.fin !== undefined && !mismaFecha(cambios.fin, evento.fin))) avisos.push('la fecha');
    if (cambios.lugar !== undefined && cambios.lugar !== evento.lugar) avisos.push('el lugar');
    if (cambios.enlace !== undefined && cambios.enlace !== evento.enlace) avisos.push('el enlace');
    if (cambioInicio) cambios.recordatorio_enviado = false;

    const portadaAnterior = 'portada_url' in cambios ? (evento.portada_s3 ?? evento.portada_url) : null;
    await this.repository.update(evento, cambios);
    if (portadaAnterior) await this.storage.eliminar(portadaAnterior);

    if (avisos.length) {
      await this.avisar(evento, usuarioId, ESTADOS_QUE_ASISTEN, 'evento_actualizado', `cambió ${unirLista(avisos)} del evento «${evento.titulo}»`);
    }
    return this.detalle(id, usuarioId);
  }

  /** Marca el evento como cancelado y avisa a quienes iban, les interesaba o estaban invitados. */
  async cancelar(id: number, usuarioId: number): Promise<EventoDetalle> {
    const evento = await this.repository.findByIdOrFail(id);
    await this.asegurarPuedeEditar(evento, usuarioId);
    if (evento.cancelado) throw new BadRequestError('El evento ya está cancelado');

    await this.repository.update(evento, { cancelado: true });
    await this.avisar(evento, usuarioId, [...ESTADOS_QUE_ASISTEN, 'invitado'], 'evento_cancelado', `canceló el evento «${evento.titulo}»`);
    if (this.boletos) {
      // Un reembolso que falla no deshace la cancelación: queda pendiente y se reintenta desde el panel de boletos
      await this.boletos.alCancelarEvento(evento).catch((error: Error) => console.warn(`No se pudieron reembolsar los boletos del evento ${id}:`, error.message));
    }
    return this.detalle(id, usuarioId);
  }

  /** Borra asistentes y evento en una transacción y después la portada de Cloudinary. */
  async eliminar(id: number, usuarioId: number): Promise<void> {
    const evento = await this.repository.findByIdOrFail(id);
    await this.asegurarPuedeEditar(evento, usuarioId);
    if (this.boletos) await this.boletos.antesDeEliminarEvento(evento);

    await this.db.transaction(async (t) => {
      await this.asistentes.delete({ evento_id: id }, t);
      await this.repository.delete({ id }, t);
    });
    if (evento.portada_s3 || evento.portada_url) await this.storage.eliminar(evento.portada_s3 ?? evento.portada_url);
  }

  // ---------- Asistencia e invitaciones ----------

  /** voy / interesado / no_voy. Mantiene los contadores; con cupo lleno → 409. */
  async marcarAsistencia(id: number, usuarioId: number, estado: RespuestaAsistencia): Promise<ResultadoAsistencia> {
    const evento = await this.visibleOrFail(id, usuarioId);
    this.asegurarAbierto(evento);
    if (estado === 'voy' && evento.requiere_boleto && evento.creador_id !== usuarioId) {
      if (!this.boletos || !(await this.boletos.tieneBoleto(id, usuarioId))) {
        throw new BadRequestError('Este evento requiere boleto: consigue el tuyo para confirmar tu asistencia');
      }
    }

    await this.db.transaction(async (t) => {
      const actual = await this.asistentes.de(id, usuarioId, t);
      const anterior = actual?.estado ?? null;
      if (anterior === estado) return;

      if (estado === 'voy' && evento.cupo !== null) {
        const { total_asistentes } = await this.repository.totales(id, t);
        if (total_asistentes >= evento.cupo) throw new ConflictError('El evento ya está lleno');
      }
      if (actual) await this.asistentes.update(actual, { estado }, t);
      else await this.asistentes.create({ evento_id: id, usuario_id: usuarioId, estado }, t);
      await this.repository.ajustarTotales(id, anterior, estado, t);
    });

    const totales = await this.repository.totales(id);
    return {
      evento_id: id,
      mi_estado: estado,
      ...totales,
      lleno: evento.cupo !== null && totales.total_asistentes >= evento.cupo,
    };
  }

  /**
   * Invita a varias personas (quien ve el evento; si es privado, solo quien lo puede editar).
   * Omite a quien ya está en el evento, a cuentas inexistentes y a uno mismo.
   */
  async invitar(id: number, usuarioId: number, usuarioIds: number[]): Promise<ResultadoInvitacion> {
    const evento = await this.visibleOrFail(id, usuarioId);
    if (evento.visibilidad === 'privado') {
      await this.asegurarPuedeEditar(evento, usuarioId, 'Solo los organizadores pueden invitar a un evento privado');
    }
    this.asegurarAbierto(evento);

    const pedidos = [...new Set(usuarioIds)].filter((u) => u !== usuarioId);
    if (!pedidos.length) throw new BadRequestError('No puedes invitarte a ti mismo');

    const existentes = new Set(
      (await this.usuarios.findAll({ id: pedidos, activo: true }, { attributes: ['id'] })).map((u) => u.id),
    );
    const yaEstan = await this.asistentes.yaRegistrados(id, pedidos);
    const invitados = pedidos.filter((u) => existentes.has(u) && !yaEstan.has(u));

    if (invitados.length) {
      await this.db.transaction(async (t) => {
        for (const invitado of invitados) {
          await this.asistentes.create({ evento_id: id, usuario_id: invitado, estado: 'invitado', invitado_por: usuarioId }, t);
        }
      });
      for (const invitado of invitados) {
        await this.notificaciones.notificar({
          usuario_id: invitado,
          de_usuario_id: usuarioId,
          tipo: 'evento_invitacion',
          mensaje: `te invitó al evento «${evento.titulo}»`,
          entidad_tipo: 'evento',
          entidad_id: id,
        });
      }
    }
    const omitidos = [...new Set(usuarioIds)].filter((u) => !invitados.includes(u));
    return { invitados, omitidos };
  }

  // ---------- Asistencia por boletos (la usa el módulo de boletos dentro de sus transacciones) ----------

  /** Deja a la persona con "voy" (sin revisar el cupo del evento: el cupo de cada tipo de boleto ya se respetó). */
  async registrarAsistenteConBoleto(eventoId: number, usuarioId: number, t: Transaction): Promise<void> {
    const actual = await this.asistentes.de(eventoId, usuarioId, t);
    const anterior = actual?.estado ?? null;
    if (anterior === 'voy') return;
    if (actual) await this.asistentes.update(actual, { estado: 'voy' }, t);
    else await this.asistentes.create({ evento_id: eventoId, usuario_id: usuarioId, estado: 'voy' }, t);
    await this.repository.ajustarTotales(eventoId, anterior, 'voy', t);
  }

  /** Quien se quedó sin boletos (los transfirió) pasa de "voy" a "me interesa". El organizador no cambia. */
  async retirarAsistenteSinBoleto(eventoId: number, usuarioId: number, t: Transaction): Promise<void> {
    const actual = await this.asistentes.de(eventoId, usuarioId, t);
    if (actual?.estado !== 'voy') return;
    const evento = await this.repository.findById(eventoId, { include: [], attributes: ['id', 'creador_id'], transaction: t });
    if (!evento || evento.creador_id === usuarioId) return;
    await this.asistentes.update(actual, { estado: 'interesado' }, t);
    await this.repository.ajustarTotales(eventoId, 'voy', 'interesado', t);
  }

  // ---------- Recordatorios ----------

  /**
   * Una pasada: a los eventos no cancelados que empiezan dentro de la próxima hora y no tienen recordatorio,
   * los marca y avisa a quienes van o les interesa. Devuelve cuántos eventos procesó.
   */
  async enviarRecordatorios(ahora: Date = new Date()): Promise<number> {
    const eventos = await this.repository.porEmpezar(ahora, new Date(ahora.getTime() + ANTICIPACION_RECORDATORIO_MS));
    for (const evento of eventos) {
      await this.repository.update(evento, { recordatorio_enviado: true });
      await this.avisar(evento, evento.creador_id, ESTADOS_QUE_ASISTEN, 'evento_recordatorio', `organiza «${evento.titulo}», que empieza en menos de una hora`);
    }
    return eventos.length;
  }

  // ---------- Permisos ----------

  /** Busca el evento y verifica que lo pueda ver (404 / 403 con el motivo). También lo usa el módulo de boletos. */
  async visibleOrFail(id: number, usuarioId?: number): Promise<Evento> {
    const evento = await this.repository.findByIdOrFail(id);
    if (await this.puedeVer(evento, usuarioId)) return evento;

    const motivo: Record<string, string> = {
      seguidores: `Solo quienes siguen a ${evento.creador?.nombre_completo ?? 'quien lo organiza'} pueden ver este evento`,
      grupo: 'Solo los miembros del grupo pueden ver este evento',
      privado: 'Este evento es privado: solo para invitados',
    };
    if (!usuarioId) throw new UnauthorizedError('Inicia sesión para ver este evento');
    throw new ForbiddenError(motivo[evento.visibilidad] ?? 'No tienes acceso a este evento');
  }

  /** Regla de visibilidad para un evento: la misma que `filtroVisibles` del repositorio. */
  private async puedeVer(evento: Evento, usuarioId?: number): Promise<boolean> {
    if (evento.visibilidad === 'publico') return true;
    if (!usuarioId) return false;
    if (evento.creador_id === usuarioId) return true;
    if (await this.asistentes.exists({ evento_id: evento.id, usuario_id: usuarioId })) return true;
    if (evento.grupo_id && (await this.esModerador(evento.grupo_id, usuarioId))) return true;

    if (evento.visibilidad === 'seguidores') {
      return this.seguidores.exists({ seguidor_id: usuarioId, siguiendo_id: evento.creador_id, estado: 'aceptado' });
    }
    if (evento.visibilidad === 'grupo' && evento.grupo_id) return this.miembros.esMiembroActivo(evento.grupo_id, usuarioId);
    return false;
  }

  /** Creador o admin/moderador del grupo (también lo usa el módulo de boletos). */
  async puedeEditar(evento: Evento, usuarioId: number): Promise<boolean> {
    if (evento.creador_id === usuarioId) return true;
    return evento.grupo_id !== null && (await this.esModerador(evento.grupo_id, usuarioId));
  }

  private async asegurarPuedeEditar(evento: Evento, usuarioId: number, mensaje = 'Solo quien organiza el evento o los administradores del grupo pueden modificarlo'): Promise<void> {
    if (!(await this.puedeEditar(evento, usuarioId))) throw new ForbiddenError(mensaje);
  }

  /** Ni cancelado ni terminado (para asistencia e invitaciones). */
  private asegurarAbierto(evento: Evento): void {
    if (evento.cancelado) throw new BadRequestError('El evento fue cancelado');
    if (haTerminado(evento)) throw new BadRequestError('El evento ya terminó');
  }

  private esModerador(grupoId: number, usuarioId: number): Promise<boolean> {
    return this.miembros.exists({ grupo_id: grupoId, usuario_id: usuarioId, estado: 'activo', rol: ['admin', 'moderador'] });
  }

  private async gruposModerados(usuarioId: number, grupoIds?: number[]): Promise<number[]> {
    if (grupoIds && !grupoIds.length) return [];
    const filas = await this.miembros.findAll(
      { usuario_id: usuarioId, estado: 'activo', rol: ['admin', 'moderador'], ...(grupoIds ? { grupo_id: grupoIds } : {}) },
      { attributes: ['grupo_id'] },
    );
    return filas.map((m) => m.grupo_id);
  }

  /** Lo que alcanza a ver el usuario, para filtrar listados en la base. */
  private async alcance(usuarioId: number): Promise<AlcanceUsuario> {
    const [seguidos, grupos, gruposModerados, conFila] = await Promise.all([
      this.seguidores
        .findAll({ seguidor_id: usuarioId, estado: 'aceptado' }, { attributes: ['siguiendo_id'] })
        .then((filas) => filas.map((f) => f.siguiendo_id)),
      this.miembros.gruposActivosDe(usuarioId),
      this.gruposModerados(usuarioId),
      this.asistentes.idsEventosDe(usuarioId),
    ]);
    return { usuarioId, seguidos, grupos, gruposModerados, conFila };
  }

  // ---------- Apoyo ----------

  /** Notifica a quienes tienen alguno de los estados (nunca a quien provoca el aviso). */
  private async avisar(evento: Evento, deUsuarioId: number, estados: EstadoAsistencia[], tipo: TipoNotificacion, mensaje: string): Promise<void> {
    for (const destinatario of await this.asistentes.usuariosCon(evento.id, estados)) {
      await this.notificaciones.notificar({
        usuario_id: destinatario,
        de_usuario_id: deUsuarioId,
        tipo,
        mensaje,
        entidad_tipo: 'evento',
        entidad_id: evento.id,
      });
    }
  }

  /** Agrega mi estado y si puedo editar (2 consultas para toda la lista). */
  private async enriquecer(eventos: Evento[], usuarioId?: number): Promise<EventoVista[]> {
    if (!eventos.length) return [];
    const grupoIds = [...new Set(eventos.map((e) => e.grupo_id).filter((g): g is number => g !== null))];
    const [estados, moderados] = usuarioId
      ? await Promise.all([
          this.asistentes.estadosDe(usuarioId, eventos.map((e) => e.id)),
          this.gruposModerados(usuarioId, grupoIds).then((ids) => new Set(ids)),
        ])
      : [new Map<number, EstadoAsistencia>(), new Set<number>()];

    const ahora = Date.now();
    return eventos.map((evento) => {
      const puedoEditar = !!usuarioId && (evento.creador_id === usuarioId || (evento.grupo_id !== null && moderados.has(evento.grupo_id)));
      return this.presentar(evento, estados.get(evento.id) ?? null, puedoEditar, ahora);
    });
  }

  private presentar(evento: Evento, miEstado: EstadoAsistencia | null, puedoEditar: boolean, ahora: number): EventoVista {
    const { portada_s3: _archivo, ...datos } = evento.toJSON() as InferAttributes<Evento> & {
      creador: UsuarioPublico;
      grupo?: GrupoDeEvento | null;
    };
    return {
      ...datos,
      grupo: datos.grupo ?? null,
      mi_estado: miEstado,
      puedo_editar: puedoEditar,
      lleno: evento.cupo !== null && evento.total_asistentes >= evento.cupo,
      terminado: haTerminado(evento, ahora),
    };
  }
}

export const eventoService = new EventoService(
  eventoRepository,
  eventoAsistenteRepository,
  grupoRepository,
  grupoMiembroRepository,
  seguidorRepository,
  usuarioRepository,
  notificacionService,
  fileStorage,
  sequelize,
  env.FRONTEND_URL,
);

/** Una pasada de recordatorios (la usa el temporizador y las pruebas). */
export function enviarRecordatoriosEventos(): Promise<number>;
export function enviarRecordatoriosEventos(ahora: Date): Promise<number>;
export function enviarRecordatoriosEventos(ahora: Date = new Date()): Promise<number> {
  return eventoService.enviarRecordatorios(ahora);
}

/**
 * Programa los recordatorios de eventos (cada 10 min por defecto). `unref()` evita que el temporizador
 * mantenga vivo el proceso. Se llama una vez al arrancar el servidor.
 */
export function programarRecordatoriosEventos(): NodeJS.Timeout;
export function programarRecordatoriosEventos(intervaloMs: number): NodeJS.Timeout;
export function programarRecordatoriosEventos(intervaloMs: number = MINUTOS_RECORDATORIOS * 60_000): NodeJS.Timeout {
  const temporizador = setInterval(() => {
    enviarRecordatoriosEventos().catch((error: Error) => console.warn('No se pudieron enviar los recordatorios de eventos:', error.message));
  }, intervaloMs);
  temporizador.unref();
  return temporizador;
}
