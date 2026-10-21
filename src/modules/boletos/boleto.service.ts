import type { InferAttributes, Sequelize } from 'sequelize';
import { BaseService } from '../../core/domain/BaseService';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../core/errors';
import type { Page } from '../../core/http/ApiResponse';
import { sequelize, type Boleto, type Evento, type TipoBoleto } from '../../infrastructure/database/models';
import { realtime, type RealtimeGateway } from '../../infrastructure/realtime/RealtimeGateway';
import { eventoRepository, type EventoRepository } from '../eventos/evento.repository';
import { eventoService, haTerminado, type EventoService } from '../eventos/evento.service';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { pasarelaPagos, type PasarelaPagos, type ProveedorDisponible } from '../pagos/pasarela';
import { privacidadService, type PrivacidadService } from '../privacidad/privacidad.service';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { generarCsv, type ArchivoCsv } from './boleto.csv';
import { firmaBoletos, type FirmaBoletos } from './boleto.codigo';
import { permisosBoletos, type PermisosBoletos } from './boleto.permisos';
import {
  ESTADOS_VENDIDOS,
  boletoRepository,
  eventoStaffRepository,
  ordenBoletoRepository,
  tipoBoletoRepository,
  type BoletoRepository,
  type EventoStaffRepository,
  type OrdenBoletoRepository,
  type TipoBoletoRepository,
} from './boleto.repository';
import { LIMITES_BOLETOS, type ActualizarTipoDto, type BoletosEventoQuery, type ConfiguracionDto, type CrearTipoDto, type MisBoletosQuery, type ValidarDto } from './boleto.schemas';
import { vistaBoleto, vistaTipo, type BoletoVista, type TipoBoletoVista, type UsuarioPublico } from './boleto.vistas';

/** Lo que la pantalla del evento necesita para su sección de boletos. */
export interface ResumenBoletosEvento {
  evento_id: number;
  requiere_boleto: boolean;
  moneda: string;
  tipos: TipoBoletoVista[];
  /** Mis boletos vigentes (válidos o usados) de este evento. */
  mis_boletos: number;
  puedo_organizar: boolean;
  puedo_escanear: boolean;
  proveedores: ProveedorDisponible[];
  /** Pagos simulados o con claves de prueba. */
  modo_prueba: boolean;
}

export type MotivoValidacion = 'valido' | 'ya_usado' | 'otro_evento' | 'cancelado' | 'reembolsado' | 'evento_cancelado' | 'falso';

export interface ConteoAcceso {
  vendidos: number;
  escaneados: number;
}

export interface ResultadoValidacion {
  valido: boolean;
  motivo: MotivoValidacion;
  mensaje: string;
  /** Datos del boleto (no viaja si el código es falso o de otro evento). */
  boleto: {
    id: number;
    estado: Boleto['estado'];
    tipo: { id: number; nombre: string };
    dueno: UsuarioPublico | null;
    usado_en: Date | null;
    escaneado_por: UsuarioPublico | null;
  } | null;
  estadisticas: ConteoAcceso;
}

export interface EstadisticaTipo {
  tipo_id: number;
  nombre: string;
  precio_centavos: number;
  cupo: number | null;
  /** Emitidos vigentes (válidos + usados). */
  vendidos: number;
  /** Apartados en órdenes pendientes de pago. */
  apartados: number;
  escaneados: number;
  /** null para el staff (solo el organizador ve el dinero). */
  ingresos_centavos: number | null;
}

export interface EstadisticasBoletos extends ConteoAcceso {
  evento_id: number;
  moneda: string;
  apartados: number;
  ingresos_centavos: number | null;
  ordenes_pagadas: number | null;
  por_tipo: EstadisticaTipo[];
  puedo_organizar: boolean;
}

/** Evento de Socket.IO que reciben organizador y staff con cada escaneo (para el contador en vivo). */
export const EVENTO_ESCANEO = 'boletos_escaneo';

const MENSAJES: Record<MotivoValidacion, string> = {
  valido: 'Acceso válido',
  ya_usado: 'Este boleto ya se usó',
  otro_evento: 'Este boleto es de otro evento',
  cancelado: 'Boleto cancelado',
  reembolsado: 'Boleto reembolsado',
  evento_cancelado: 'El evento fue cancelado',
  falso: 'Código no válido: el boleto no existe o fue alterado',
};

/**
 * Boletos: tipos por evento, configuración, mis boletos, transferencias, staff de la puerta,
 * validación de códigos (un boleto se marca usado una sola vez), estadísticas y CSV del organizador.
 * La compra y los pagos viven en OrdenService.
 */
export class BoletoService extends BaseService<Boleto, BoletoRepository> {
  constructor(
    repository: BoletoRepository,
    private readonly tipos: TipoBoletoRepository,
    private readonly ordenes: OrdenBoletoRepository,
    private readonly staff: EventoStaffRepository,
    private readonly permisos: PermisosBoletos,
    private readonly eventos: EventoService,
    private readonly repoEventos: EventoRepository,
    private readonly firma: FirmaBoletos,
    private readonly pasarela: PasarelaPagos,
    private readonly notificaciones: NotificacionService,
    private readonly usuarios: UsuarioRepository,
    private readonly privacidad: PrivacidadService,
    private readonly tiempoReal: RealtimeGateway,
    private readonly db: Sequelize,
  ) {
    super(repository);
  }

  // ---------- Tipos y configuración ----------

  /** Sección de boletos del evento: tipos a la venta (el organizador ve también los inactivos) y mis permisos. */
  async resumenEvento(eventoId: number, usuarioId?: number): Promise<ResumenBoletosEvento> {
    const evento = await this.eventos.visibleOrFail(eventoId, usuarioId);
    const [organizador, esStaff] = await Promise.all([this.permisos.esOrganizador(evento, usuarioId), this.permisos.esStaff(eventoId, usuarioId)]);
    const [tipos, mios] = await Promise.all([
      this.tipos.deEvento(eventoId, organizador),
      usuarioId ? this.repository.count({ evento_id: eventoId, usuario_id: usuarioId, estado: ESTADOS_VENDIDOS }) : Promise.resolve(0),
    ]);
    return {
      evento_id: eventoId,
      requiere_boleto: evento.requiere_boleto,
      moneda: evento.moneda,
      tipos: this.vistasTipos(tipos, evento),
      mis_boletos: mios,
      puedo_organizar: organizador,
      puedo_escanear: organizador || esStaff,
      proveedores: this.pasarela.disponibles(),
      modo_prueba: this.pasarela.modoPrueba,
    };
  }

  /** requiere_boleto y moneda (la moneda no cambia una vez que hay órdenes). */
  async configurar(eventoId: number, usuarioId: number, datos: ConfiguracionDto): Promise<ResumenBoletosEvento> {
    const evento = await this.permisos.asegurarOrganizador(eventoId, usuarioId);
    if (evento.cancelado) throw new BadRequestError('El evento está cancelado');
    const cambios: Partial<InferAttributes<Evento>> = {};
    if (datos.requiere_boleto !== undefined) cambios.requiere_boleto = datos.requiere_boleto;
    if (datos.moneda !== undefined && datos.moneda !== evento.moneda) {
      if (await this.ordenes.exists({ evento_id: eventoId })) throw new ConflictError('No se puede cambiar la moneda: ya hay órdenes de compra');
      cambios.moneda = datos.moneda;
    }
    if (Object.keys(cambios).length) await this.repoEventos.update(evento, cambios);
    return this.resumenEvento(eventoId, usuarioId);
  }

  async crearTipo(eventoId: number, usuarioId: number, datos: CrearTipoDto): Promise<TipoBoletoVista> {
    const evento = await this.permisos.asegurarOrganizador(eventoId, usuarioId);
    this.asegurarAbierto(evento);
    const orden = await this.tipos.count({ evento_id: eventoId });
    const tipo = await this.tipos.create({
      evento_id: eventoId,
      nombre: datos.nombre,
      descripcion: datos.descripcion || null,
      precio_centavos: datos.precio,
      cupo: datos.cupo ?? null,
      venta_desde: datos.venta_desde ?? null,
      venta_hasta: datos.venta_hasta ?? null,
      max_por_persona: datos.max_por_persona,
      orden,
    });
    return this.vistaDe(tipo, evento);
  }

  /** El cupo no puede quedar por debajo de lo ya vendido/apartado. */
  async actualizarTipo(id: number, usuarioId: number, datos: ActualizarTipoDto): Promise<TipoBoletoVista> {
    const tipo = await this.tipos.findByIdOrFail(id);
    const evento = await this.permisos.asegurarOrganizador(tipo.evento_id, usuarioId);
    if (evento.cancelado) throw new BadRequestError('El evento está cancelado');

    const { precio, ...resto } = datos;
    const cambios: Partial<InferAttributes<TipoBoleto>> = Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== undefined));
    if (precio !== undefined) cambios.precio_centavos = precio;
    if (cambios.descripcion === '') cambios.descripcion = null;
    if (!Object.keys(cambios).length) throw new BadRequestError('No hay datos para actualizar');

    const desde = cambios.venta_desde !== undefined ? cambios.venta_desde : tipo.venta_desde;
    const hasta = cambios.venta_hasta !== undefined ? cambios.venta_hasta : tipo.venta_hasta;
    if (desde && hasta && new Date(hasta).getTime() <= new Date(desde).getTime()) {
      throw new ValidationError([{ campo: 'venta_hasta', mensaje: 'El fin de la venta debe ser después del inicio' }]);
    }
    if (cambios.cupo != null && cambios.cupo < tipo.vendidos) {
      throw new ValidationError([{ campo: 'cupo', mensaje: `El cupo no puede ser menor que los boletos vendidos o apartados (${tipo.vendidos})` }]);
    }
    await this.tipos.update(tipo, cambios);
    return this.vistaDe(tipo, evento);
  }

  /** Sin órdenes se borra; con órdenes solo se desactiva (los boletos emitidos siguen valiendo). */
  async eliminarTipo(id: number, usuarioId: number): Promise<'eliminado' | 'desactivado'> {
    const tipo = await this.tipos.findByIdOrFail(id);
    await this.permisos.asegurarOrganizador(tipo.evento_id, usuarioId);
    if (await this.ordenes.exists({ tipo_boleto_id: id })) {
      await this.tipos.update(tipo, { activo: false });
      return 'desactivado';
    }
    await this.tipos.delete(id);
    return 'eliminado';
  }

  // ---------- Mis boletos ----------

  async mios(usuarioId: number, { cuando, limit, offset }: MisBoletosQuery): Promise<Page<BoletoVista>> {
    const page = await this.repository.mios(usuarioId, cuando, { limit, offset });
    return { ...page, items: page.items.map((b) => vistaBoleto(b, usuarioId)) };
  }

  /** El dueño (con el código) o la gente de la puerta del evento (sin el código). */
  async detalle(id: number, usuarioId: number): Promise<BoletoVista> {
    const boleto = await this.repository.completo(id);
    if (!boleto) throw new NotFoundError('Boleto');
    if (boleto.usuario_id !== usuarioId) {
      const evento = await this.permisos.evento(boleto.evento_id);
      const puede = (await this.permisos.esOrganizador(evento, usuarioId)) || (await this.permisos.esStaff(evento.id, usuarioId));
      if (!puede) throw new NotFoundError('Boleto');
    }
    return vistaBoleto(boleto, usuarioId);
  }

  /**
   * Pasa un boleto válido a otra persona: cambia el código (el QR anterior deja de servir), la otra persona queda
   * con "voy" y yo paso a "me interesa" si me quedé sin boletos del evento.
   */
  async transferir(id: number, usuarioId: number, destinoId: number): Promise<BoletoVista> {
    const boleto = await this.repository.completo(id);
    if (!boleto || boleto.usuario_id !== usuarioId) throw new NotFoundError('Boleto');
    if (destinoId === usuarioId) throw new BadRequestError('El boleto ya es tuyo');
    if (boleto.estado !== 'valido') throw new BadRequestError('Solo se puede transferir un boleto válido sin usar');
    const evento = await this.permisos.evento(boleto.evento_id);
    this.asegurarAbierto(evento);

    const destino = await this.usuarios.findOne({ id: destinoId, activo: true }, { attributes: ['id', 'nombre_completo'] });
    if (!destino) throw new NotFoundError('Usuario');
    if (await this.privacidad.hayBloqueo(usuarioId, destinoId)) throw new ForbiddenError('No puedes transferir boletos a esta persona');
    try {
      await this.eventos.visibleOrFail(evento.id, destinoId);
    } catch {
      throw new BadRequestError(`${destino.nombre_completo} no puede ver este evento`);
    }
    const tipo = await this.tipos.findByIdOrFail(boleto.tipo_boleto_id);
    if ((await this.repository.cuantosTiene(destinoId, tipo.id)) >= tipo.max_por_persona) {
      throw new ConflictError(`${destino.nombre_completo} ya tiene el máximo de boletos de este tipo`);
    }

    await this.db.transaction(async (t) => {
      await this.repository.update(boleto, { usuario_id: destinoId, transferido_de: usuarioId, codigo: this.firma.generar(evento.id) }, t);
      await this.eventos.registrarAsistenteConBoleto(evento.id, destinoId, t);
      const meQuedan = await this.repository.vigentesDe(evento.id, usuarioId, t);
      if (!meQuedan) await this.eventos.retirarAsistenteSinBoleto(evento.id, usuarioId, t);
    });

    await this.notificaciones.notificar({
      usuario_id: destinoId,
      de_usuario_id: usuarioId,
      tipo: 'boleto_comprado',
      mensaje: `te transfirió un boleto para «${evento.titulo}»`,
      entidad_tipo: 'boleto',
      entidad_id: boleto.id,
    });
    return vistaBoleto((await this.repository.completo(id))!, usuarioId);
  }

  // ---------- Puerta ----------

  /**
   * Valida un código en la puerta (organizador o staff). La firma se revisa antes de buscar en la base y el boleto
   * se marca usado con una sentencia condicional: si llegan dos escaneos a la vez, solo uno es válido.
   */
  async validar(usuarioId: number, { codigo, evento_id: eventoId }: ValidarDto): Promise<ResultadoValidacion> {
    const { evento } = await this.permisos.asegurarPuerta(eventoId, usuarioId);
    const leido = this.firma.leer(codigo);
    if (!leido) return this.resultado(eventoId, 'falso', null);
    if (leido.eventoId !== eventoId) return this.resultado(eventoId, 'otro_evento', null);

    const boleto = await this.repository.completo({ codigo: codigo.trim() });
    // Firma válida pero sin boleto: un código anterior a una transferencia
    if (!boleto) return this.resultado(eventoId, 'falso', null);
    if (boleto.evento_id !== eventoId) return this.resultado(eventoId, 'otro_evento', null);
    if (evento.cancelado) return this.resultado(eventoId, 'evento_cancelado', boleto);
    if (boleto.estado === 'cancelado' || boleto.estado === 'reembolsado') return this.resultado(eventoId, boleto.estado, boleto);
    if (boleto.estado === 'usado') return this.resultado(eventoId, 'ya_usado', boleto);

    const ahora = new Date();
    if (!(await this.repository.marcarUsado(boleto.id, usuarioId, ahora))) {
      // Otro escaneo ganó por milisegundos: se informa con los datos ya guardados
      const actual = (await this.repository.completo(boleto.id)) ?? boleto;
      return this.resultado(eventoId, actual.estado === 'usado' ? 'ya_usado' : (actual.estado as MotivoValidacion), actual);
    }

    const usado = (await this.repository.completo(boleto.id)) ?? boleto;
    const resultado = await this.resultado(eventoId, 'valido', usado);
    await this.notificaciones.notificar({
      usuario_id: boleto.usuario_id,
      de_usuario_id: usuarioId,
      tipo: 'boleto_usado',
      mensaje: `registró tu entrada a «${evento.titulo}»`,
      entidad_tipo: 'boleto',
      entidad_id: boleto.id,
    });
    await this.avisarEscaneo(evento, resultado.estadisticas);
    return resultado;
  }

  async estadisticas(eventoId: number, usuarioId: number): Promise<EstadisticasBoletos> {
    const { evento, organizador } = await this.permisos.asegurarPuerta(eventoId, usuarioId);
    const [tipos, conteos, ingresos] = await Promise.all([
      this.tipos.deEvento(eventoId, true),
      this.repository.conteoPorTipo(eventoId),
      organizador ? this.ordenes.ingresosPorTipo(eventoId) : Promise.resolve([]),
    ]);
    const conteoDe = new Map(conteos.map((c) => [c.tipo_boleto_id, c]));
    const ingresoDe = new Map(ingresos.map((i) => [i.tipo_boleto_id, i]));

    const porTipo: EstadisticaTipo[] = tipos.map((tipo) => {
      const conteo = conteoDe.get(tipo.id);
      const vendidos = conteo?.vendidos ?? 0;
      return {
        tipo_id: tipo.id,
        nombre: tipo.nombre,
        precio_centavos: tipo.precio_centavos,
        cupo: tipo.cupo,
        vendidos,
        apartados: Math.max(0, tipo.vendidos - vendidos),
        escaneados: conteo?.escaneados ?? 0,
        ingresos_centavos: organizador ? (ingresoDe.get(tipo.id)?.total_centavos ?? 0) : null,
      };
    });
    const suma = (campo: 'vendidos' | 'escaneados' | 'apartados') => porTipo.reduce((total, t) => total + t[campo], 0);
    return {
      evento_id: eventoId,
      moneda: evento.moneda,
      vendidos: suma('vendidos'),
      escaneados: suma('escaneados'),
      apartados: suma('apartados'),
      ingresos_centavos: organizador ? ingresos.reduce((total, i) => total + i.total_centavos, 0) : null,
      ordenes_pagadas: organizador ? ingresos.reduce((total, i) => total + i.ordenes, 0) : null,
      por_tipo: porTipo,
      puedo_organizar: organizador,
    };
  }

  /** Lista de boletos del evento (organizador o staff) con búsqueda por nombre. */
  async boletosDeEvento(eventoId: number, usuarioId: number, { estado, q, limit, offset }: BoletosEventoQuery): Promise<Page<BoletoVista>> {
    await this.permisos.asegurarPuerta(eventoId, usuarioId);
    const page = await this.repository.deEvento(eventoId, { estado, q }, { limit, offset });
    return { ...page, items: page.items.map((b) => vistaBoleto(b, usuarioId)) };
  }

  /** CSV de asistentes para el organizador (sin los códigos: son las entradas). */
  async csv(eventoId: number, usuarioId: number): Promise<ArchivoCsv> {
    const evento = await this.permisos.asegurarOrganizador(eventoId, usuarioId);
    return generarCsv(evento, await this.repository.todosDeEvento(eventoId));
  }

  // ---------- Staff ----------

  async staffDe(eventoId: number, usuarioId: number): Promise<UsuarioPublico[]> {
    await this.permisos.asegurarOrganizador(eventoId, usuarioId);
    return (await this.staff.deEvento(eventoId)).map((s) => s.usuario!.toJSON() as UsuarioPublico);
  }

  async agregarStaff(eventoId: number, usuarioId: number, staffId: number): Promise<UsuarioPublico[]> {
    const evento = await this.permisos.asegurarOrganizador(eventoId, usuarioId);
    if (staffId === usuarioId || staffId === evento.creador_id) throw new BadRequestError('Quien organiza ya puede escanear boletos');
    if (!(await this.usuarios.exists({ id: staffId, activo: true }))) throw new NotFoundError('Usuario');
    if (await this.privacidad.hayBloqueo(usuarioId, staffId)) throw new ForbiddenError('No puedes agregar a esta persona');
    if (await this.staff.esStaff(eventoId, staffId)) throw new ConflictError('Esa persona ya es parte del staff');
    if ((await this.staff.count({ evento_id: eventoId })) >= LIMITES_BOLETOS.staff) throw new ConflictError(`Máximo ${LIMITES_BOLETOS.staff} personas en el staff`);
    await this.staff.create({ evento_id: eventoId, usuario_id: staffId, agregado_por: usuarioId });
    return this.staffDe(eventoId, usuarioId);
  }

  async quitarStaff(eventoId: number, usuarioId: number, staffId: number): Promise<UsuarioPublico[]> {
    await this.permisos.asegurarOrganizador(eventoId, usuarioId);
    if (!(await this.staff.delete({ evento_id: eventoId, usuario_id: staffId }))) throw new NotFoundError('Staff', 'Esa persona no es parte del staff');
    return this.staffDe(eventoId, usuarioId);
  }

  // ---------- Apoyo ----------

  private asegurarAbierto(evento: Evento): void {
    if (evento.cancelado) throw new BadRequestError('El evento fue cancelado');
    if (haTerminado(evento)) throw new BadRequestError('El evento ya terminó');
  }

  private contexto(evento: Evento) {
    return { moneda: evento.moneda, cancelado: evento.cancelado, terminado: haTerminado(evento), ahora: new Date() };
  }

  private vistasTipos(tipos: TipoBoleto[], evento: Evento): TipoBoletoVista[] {
    const contexto = this.contexto(evento);
    return tipos.map((t) => vistaTipo(t, contexto));
  }

  private async vistaDe(tipo: TipoBoleto, evento: Evento): Promise<TipoBoletoVista> {
    return vistaTipo(await this.tipos.findByIdOrFail(tipo.id), this.contexto(evento));
  }

  private async conteo(eventoId: number): Promise<ConteoAcceso> {
    const conteos = await this.repository.conteoPorTipo(eventoId);
    return {
      vendidos: conteos.reduce((total, c) => total + c.vendidos, 0),
      escaneados: conteos.reduce((total, c) => total + c.escaneados, 0),
    };
  }

  private async resultado(eventoId: number, motivo: MotivoValidacion, boleto: Boleto | null): Promise<ResultadoValidacion> {
    return {
      valido: motivo === 'valido',
      motivo,
      mensaje: MENSAJES[motivo],
      boleto: boleto
        ? {
            id: boleto.id,
            estado: boleto.estado,
            tipo: { id: boleto.tipo_boleto_id, nombre: boleto.tipo?.nombre ?? '' },
            dueno: boleto.dueno ? (boleto.dueno.toJSON() as UsuarioPublico) : null,
            usado_en: boleto.usado_en,
            escaneado_por: boleto.escaneador ? (boleto.escaneador.toJSON() as UsuarioPublico) : null,
          }
        : null,
      estadisticas: await this.conteo(eventoId),
    };
  }

  /** Contador en vivo para el organizador y todo el staff (cada uno en su sala personal). */
  private async avisarEscaneo(evento: Evento, conteo: ConteoAcceso): Promise<void> {
    const destinatarios = new Set([evento.creador_id, ...(await this.staff.idsDe(evento.id))]);
    for (const id of destinatarios) this.tiempoReal.aUsuario(id, EVENTO_ESCANEO, { evento_id: evento.id, ...conteo });
  }
}

export const boletoService = new BoletoService(
  boletoRepository,
  tipoBoletoRepository,
  ordenBoletoRepository,
  eventoStaffRepository,
  permisosBoletos,
  eventoService,
  eventoRepository,
  firmaBoletos,
  pasarelaPagos,
  notificacionService,
  usuarioRepository,
  privacidadService,
  realtime,
  sequelize,
);
