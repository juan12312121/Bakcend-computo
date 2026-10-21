import type { CreationAttributes, Sequelize, Transaction } from 'sequelize';
import { env } from '../../config/env';
import { BaseService } from '../../core/domain/BaseService';
import { AppError, BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../../core/errors';
import { sequelize, type Boleto, type EstadoOrden, type Evento, type NombreProveedorPago, type OrdenBoleto } from '../../infrastructure/database/models';
import { eventoService, haTerminado, type EventoService } from '../eventos/evento.service';
import { notificacionService, type NotificacionService } from '../notificaciones/notificacion.service';
import { pasarelaPagos, type PasarelaPagos } from '../pagos/pasarela';
import { ErrorProveedorPago, type AvisoPago } from '../pagos/proveedor-pago';
import { usuarioRepository, type UsuarioRepository } from '../usuarios/usuario.repository';
import { firmaBoletos, type FirmaBoletos } from './boleto.codigo';
import { permisosBoletos, type PermisosBoletos } from './boleto.permisos';
import {
  ESTADOS_VENDIDOS,
  boletoRepository,
  ordenBoletoRepository,
  tipoBoletoRepository,
  type BoletoRepository,
  type OrdenBoletoRepository,
  type TipoBoletoRepository,
} from './boleto.repository';
import type { ComprarDto } from './boleto.schemas';
import { vistaBoleto, vistaOrden, vistaTipo, type BoletoVista, type OrdenVista } from './boleto.vistas';

/** Tiempo para pagar antes de que la orden libere su cupo. */
export const MINUTOS_PARA_PAGAR = 30;
/** Cada cuánto se liberan las órdenes vencidas. */
export const MINUTOS_LIMPIEZA_ORDENES = 5;

export interface ResultadoCompra {
  orden: OrdenVista;
  /** A dónde mandar al comprador (null si eran gratis: los boletos ya vienen en `boletos`). */
  url_pago: string | null;
  boletos: BoletoVista[];
}

/** Qué pasó con un aviso de pago (webhook o simulación). */
export type ResultadoAviso = 'confirmada' | 'fallida' | 'reembolsada' | 'duplicada' | 'ignorada';

export interface ResumenReembolsos {
  reembolsadas: number;
  canceladas: number;
  liberadas: number;
  errores: number;
}

/** Marca interna: dentro de la transacción ya no alcanzó el cupo. */
class SinCupo extends Error {}

/**
 * Órdenes de compra: reservan el cupo al crearse (sin sobreventa), emiten los boletos SOLO cuando el pago
 * se confirma (webhook idempotente), liberan el cupo si el pago falla o vence y reembolsan al cancelar el evento.
 */
export class OrdenService extends BaseService<OrdenBoleto, OrdenBoletoRepository> {
  constructor(
    repository: OrdenBoletoRepository,
    private readonly tipos: TipoBoletoRepository,
    private readonly boletos: BoletoRepository,
    private readonly eventos: EventoService,
    private readonly permisos: PermisosBoletos,
    private readonly pasarela: PasarelaPagos,
    private readonly firma: FirmaBoletos,
    private readonly notificaciones: NotificacionService,
    private readonly usuarios: UsuarioRepository,
    private readonly db: Sequelize,
    /** Base de la app web (página de resultado de la compra). */
    private readonly urlApp: string,
  ) {
    super(repository);
  }

  // ---------- Comprar / obtener ----------

  /**
   * Gratis: emite los boletos al instante. De pago: aparta el cupo, crea la orden pendiente y devuelve la URL
   * del proveedor; los boletos se emiten cuando llega la confirmación del pago.
   */
  async comprar(usuarioId: number, { tipo_boleto_id: tipoId, cantidad, proveedor }: ComprarDto): Promise<ResultadoCompra> {
    const tipo = await this.tipos.findByIdOrFail(tipoId);
    const evento = await this.eventos.visibleOrFail(tipo.evento_id, usuarioId);
    const ahora = new Date();

    const vista = vistaTipo(tipo, { moneda: evento.moneda, cancelado: evento.cancelado, terminado: haTerminado(evento), ahora });
    if (!vista.disponible) throw new BadRequestError(vista.motivo === 'Agotado' ? 'Ya no quedan boletos de este tipo' : (vista.motivo ?? 'No disponible'));
    if (vista.quedan !== null && cantidad > vista.quedan) {
      throw new ConflictError(vista.quedan === 1 ? 'Solo queda 1 boleto de este tipo' : `Solo quedan ${vista.quedan} boletos de este tipo`);
    }

    const [tengo, apartados] = await Promise.all([this.boletos.cuantosTiene(usuarioId, tipo.id), this.repository.pendientesDe(usuarioId, tipo.id)]);
    const puedo = tipo.max_por_persona - tengo - apartados;
    if (cantidad > puedo) {
      throw new ConflictError(
        puedo <= 0
          ? `Ya tienes el máximo de boletos "${tipo.nombre}" por persona (${tipo.max_por_persona})`
          : `Solo puedes obtener ${puedo} ${puedo === 1 ? 'boleto' : 'boletos'} más de este tipo`,
      );
    }

    const gratis = tipo.precio_centavos === 0;
    const pasarela = gratis ? null : this.pasarela.elegir(proveedor);
    const expira = new Date(ahora.getTime() + MINUTOS_PARA_PAGAR * 60_000);

    const { orden, emitidos } = await this.db.transaction(async (t) => {
      if (!(await this.tipos.reservar(tipo.id, cantidad, t))) throw new ConflictError('Se agotaron los boletos mientras comprabas');
      const nueva = await this.repository.create(
        {
          usuario_id: usuarioId,
          evento_id: evento.id,
          tipo_boleto_id: tipo.id,
          cantidad,
          precio_unitario_centavos: tipo.precio_centavos,
          total_centavos: tipo.precio_centavos * cantidad,
          moneda: evento.moneda,
          proveedor: pasarela?.nombre ?? 'gratis',
          estado: gratis ? 'pagada' : 'pendiente',
          expira_en: gratis ? null : expira,
          pagada_en: gratis ? ahora : null,
        },
        t,
      );
      return { orden: nueva, emitidos: gratis ? await this.emitir(nueva, t) : [] };
    });

    if (gratis) {
      await this.avisarCompra(orden, evento, emitidos);
      return { orden: await this.vista(orden.id, usuarioId), url_pago: null, boletos: emitidos.map((b) => vistaBoleto(b, usuarioId)) };
    }

    try {
      const comprador = await this.usuarios.findById(usuarioId, { attributes: ['email'] });
      const cobro = await pasarela!.crearCobro({
        ordenId: orden.id,
        titulo: `${tipo.nombre} · ${evento.titulo}`.slice(0, 250),
        descripcion: `${cantidad} ${cantidad === 1 ? 'boleto' : 'boletos'} para «${evento.titulo}»`,
        cantidad,
        precioUnitarioCentavos: tipo.precio_centavos,
        moneda: evento.moneda,
        email: comprador?.email ?? null,
        urlRegreso: this.urlResultado(orden.id),
        expiraEn: expira,
      });
      await this.repository.update(orden, { referencia_externa: cobro.referencia, url_pago: cobro.url });
      return { orden: await this.vista(orden.id, usuarioId), url_pago: cobro.url, boletos: [] };
    } catch (error) {
      // El proveedor no respondió: la orden no sirve y el cupo vuelve a quedar libre
      await this.marcarFallida(orden.id, 'No se pudo iniciar el pago');
      if (error instanceof ErrorProveedorPago) {
        console.warn(`[pagos] ${error.message}:`, (error.causa as Error | undefined)?.message ?? error.causa);
        throw new AppError(`${error.message}. Intenta de nuevo en unos minutos.`, 502);
      }
      throw error;
    }
  }

  /** Estado de mi orden (la página de resultado la consulta hasta que deja de estar pendiente). */
  async consultar(id: number, usuarioId: number): Promise<OrdenVista> {
    const orden = await this.repository.findById(id, { attributes: ['id', 'usuario_id', 'estado', 'expira_en'] });
    if (!orden || orden.usuario_id !== usuarioId) throw new NotFoundError('Orden', 'Orden no encontrada');
    if (orden.estado === 'pendiente' && orden.expira_en && new Date(orden.expira_en).getTime() < Date.now()) {
      await this.marcarFallida(id, 'El tiempo para pagar se agotó');
    }
    return this.vista(id, usuarioId);
  }

  // ---------- Avisos de pago (webhooks y simulación) ----------

  /**
   * Idempotente: la orden pasa de "pendiente" a "pagada" con una sola sentencia condicional dentro de la
   * transacción que emite los boletos; un aviso repetido devuelve "duplicada" sin emitir nada.
   * Un pago que llega tarde (orden ya vencida) se acepta si todavía hay cupo; si no, se reembolsa.
   * Si el monto no coincide o el evento se canceló, se reembolsa.
   */
  async confirmarPago(aviso: AvisoPago, proveedor: NombreProveedorPago): Promise<ResultadoAviso> {
    const orden = await this.repository.findById(aviso.ordenId);
    if (!orden || orden.proveedor !== proveedor) return 'ignorada';
    if (orden.estado === 'pagada' || orden.estado === 'reembolsada') return 'duplicada';

    const pagoId = aviso.pagoId ?? orden.pago_externo_id;
    if (pagoId && pagoId !== orden.pago_externo_id) await this.repository.update(orden, { pago_externo_id: pagoId });

    if (aviso.montoCentavos != null && aviso.montoCentavos !== orden.total_centavos) {
      return this.reembolsar(orden, `El monto cobrado (${aviso.montoCentavos}) no coincide con la orden (${orden.total_centavos})`);
    }
    const evento = await this.eventos.obtener(orden.evento_id);
    if (evento.cancelado) return this.reembolsar(orden, 'El evento fue cancelado');

    const desde: EstadoOrden = orden.estado;
    let emitidos: Boleto[] = [];
    try {
      emitidos = await this.db.transaction(async (t) => {
        // Pago tardío: la orden ya había liberado su cupo, hay que volver a apartarlo
        if (desde === 'fallida' && !(await this.tipos.reservar(orden.tipo_boleto_id, orden.cantidad, t))) throw new SinCupo();
        const cambio = await this.repository.pasarAEstado(orden.id, [desde], { estado: 'pagada', pagada_en: new Date(), motivo_fallo: null }, t);
        if (!cambio) return [];
        return this.emitir(orden, t);
      });
    } catch (error) {
      if (error instanceof SinCupo) return this.reembolsar(await this.repository.findByIdOrFail(orden.id), 'El pago llegó cuando ya no había cupo');
      throw error;
    }
    if (!emitidos.length) return 'duplicada';

    await this.avisarCompra(orden, evento, emitidos);
    return 'confirmada';
  }

  /** Pendiente → fallida y libera el cupo apartado (idempotente). */
  async marcarFallida(ordenId: number, motivo: string): Promise<ResultadoAviso> {
    const orden = await this.repository.findById(ordenId);
    if (!orden) return 'ignorada';
    const cambio = await this.db.transaction(async (t) => {
      const ok = await this.repository.pasarAEstado(ordenId, ['pendiente'], { estado: 'fallida', motivo_fallo: motivo.slice(0, 255) }, t);
      if (ok) await this.tipos.liberar(orden.tipo_boleto_id, orden.cantidad, t);
      return ok;
    });
    return cambio ? 'fallida' : 'duplicada';
  }

  /** Libera las órdenes pendientes cuyo plazo venció. Devuelve cuántas liberó. */
  async expirarVencidas(ahora: Date = new Date()): Promise<number> {
    let liberadas = 0;
    for (const orden of await this.repository.vencidas(ahora)) {
      if ((await this.marcarFallida(orden.id, 'El tiempo para pagar se agotó')) === 'fallida') liberadas++;
    }
    return liberadas;
  }

  // ---------- Cancelación del evento ----------

  /**
   * Al cancelar el evento: reembolsa las órdenes pagadas con dinero, cancela los boletos gratis y libera las
   * pendientes. Un reembolso que falla se cuenta en `errores` y se puede reintentar (la orden sigue "pagada").
   */
  async reembolsarEvento(eventoId: number): Promise<ResumenReembolsos> {
    const resumen: ResumenReembolsos = { reembolsadas: 0, canceladas: 0, liberadas: 0, errores: 0 };
    const ordenes = await this.repository.findAll({ evento_id: eventoId, estado: ['pendiente', 'pagada'] }, { order: [['id', 'ASC']] });
    for (const orden of ordenes) {
      if (orden.estado === 'pendiente') {
        if ((await this.marcarFallida(orden.id, 'El evento fue cancelado')) === 'fallida') resumen.liberadas++;
      } else if (orden.total_centavos === 0) {
        await this.db.transaction(async (t) => {
          if (await this.boletos.cambiarEstadoDeOrden(orden.id, 'cancelado', t)) {
            await this.tipos.liberar(orden.tipo_boleto_id, orden.cantidad, t);
            resumen.canceladas++;
          }
        });
      } else {
        try {
          if ((await this.reembolsar(orden, 'El evento fue cancelado')) === 'reembolsada') resumen.reembolsadas++;
        } catch (error) {
          resumen.errores++;
          console.warn(`[pagos] No se pudo reembolsar la orden ${orden.id}:`, (error as Error).message);
        }
      }
    }
    return resumen;
  }

  /** Reintento manual del organizador (p. ej. si un reembolso falló al cancelar). Solo con el evento cancelado. */
  async reembolsarPorOrganizador(eventoId: number, usuarioId: number): Promise<ResumenReembolsos> {
    const evento = await this.permisos.asegurarOrganizador(eventoId, usuarioId);
    if (!evento.cancelado) throw new BadRequestError('Solo se reembolsa al cancelar el evento');
    return this.reembolsarEvento(eventoId);
  }

  // ---------- Apoyo ----------

  /** Devuelve el dinero con el proveedor y marca la orden y sus boletos como reembolsados. */
  private async reembolsar(orden: OrdenBoleto, motivo: string): Promise<ResultadoAviso> {
    const proveedor = this.pasarela.obtener(orden.proveedor);
    if (orden.proveedor !== 'gratis' && orden.proveedor !== 'demo') {
      if (!proveedor) throw new ErrorProveedorPago(`El proveedor "${orden.proveedor}" ya no está configurado: no se puede reembolsar la orden ${orden.id}`);
      if (orden.estado !== 'pendiente' || orden.pago_externo_id) await proveedor.reembolsar(orden);
    }
    const tenia = orden.estado;
    await this.db.transaction(async (t) => {
      const ok = await this.repository.pasarAEstado(orden.id, [tenia], { estado: 'reembolsada', reembolsada_en: new Date(), motivo_fallo: motivo.slice(0, 255) }, t);
      if (!ok) return;
      await this.boletos.cambiarEstadoDeOrden(orden.id, 'reembolsado', t);
      // Pendiente o pagada tenían el cupo apartado; una fallida ya lo había liberado
      if (tenia !== 'fallida') await this.tipos.liberar(orden.tipo_boleto_id, orden.cantidad, t);
    });
    return 'reembolsada';
  }

  /** Crea los boletos de la orden (cada uno con su código firmado) y deja al comprador con "voy". */
  private async emitir(orden: OrdenBoleto, t: Transaction): Promise<Boleto[]> {
    const datos: CreationAttributes<Boleto>[] = Array.from({ length: orden.cantidad }, () => ({
      codigo: this.firma.generar(orden.evento_id),
      evento_id: orden.evento_id,
      tipo_boleto_id: orden.tipo_boleto_id,
      orden_id: orden.id,
      usuario_id: orden.usuario_id,
    }));
    const creados = await this.boletos.crearVarios(datos, t);
    await this.eventos.registrarAsistenteConBoleto(orden.evento_id, orden.usuario_id, t);
    return creados;
  }

  /** 'boleto_comprado' al comprador (de parte del organizador) y al organizador (de parte del comprador). */
  private async avisarCompra(orden: OrdenBoleto, evento: Evento, emitidos: Boleto[]): Promise<void> {
    const n = emitidos.length;
    const primero = emitidos[0]?.id ?? null;
    // La app muestra "<quien> <mensaje>": «Ana te entregó tus 2 boletos para «X»»
    const boletos = n === 1 ? 'tu boleto' : `tus ${n} boletos`;
    await this.notificaciones.notificar({
      usuario_id: orden.usuario_id,
      de_usuario_id: evento.creador_id,
      tipo: 'boleto_comprado',
      mensaje: `te entregó ${boletos} para «${evento.titulo}»`,
      entidad_tipo: 'boleto',
      entidad_id: primero,
    });
    await this.notificaciones.notificar({
      usuario_id: evento.creador_id,
      de_usuario_id: orden.usuario_id,
      tipo: 'boleto_comprado',
      mensaje: `${orden.total_centavos ? 'compró' : 'obtuvo'} ${n} ${n === 1 ? 'boleto' : 'boletos'} para «${evento.titulo}»`,
      entidad_tipo: 'boleto',
      entidad_id: primero,
    });
  }

  private async vista(id: number, usuarioId: number): Promise<OrdenVista> {
    const orden = await this.repository.conDetalle(id);
    if (!orden) throw new NotFoundError('Orden', 'Orden no encontrada');
    const boletos = orden.estado === 'pagada' || orden.estado === 'reembolsada' ? await this.boletos.deOrden(id, usuarioId) : [];
    const proveedor = this.pasarela.obtener(orden.proveedor);
    return vistaOrden(
      orden,
      boletos.map((b) => vistaBoleto(b, usuarioId)),
      orden.proveedor === 'demo' || !!proveedor?.modoPrueba,
    );
  }

  private urlResultado(ordenId: number): string {
    return `${this.urlApp.replace(/\/+$/, '')}/boletos/compra/${ordenId}`;
  }

  /** Para la simulación del ProveedorDemo: la orden debe ser mía y del proveedor demo. */
  async asegurarOrdenDemo(ordenId: number, usuarioId: number): Promise<OrdenBoleto> {
    const orden = await this.repository.findById(ordenId);
    if (!orden || orden.usuario_id !== usuarioId) throw new NotFoundError('Orden', 'Orden no encontrada');
    if (orden.proveedor !== 'demo') throw new ForbiddenError('Esta orden no es de prueba: se paga con el proveedor real');
    return orden;
  }

  /** ¿Tiene un boleto válido o usado del evento? (regla de "voy" en eventos con boleto). */
  tieneBoleto(eventoId: number, usuarioId: number): Promise<boolean> {
    return this.boletos.exists({ evento_id: eventoId, usuario_id: usuarioId, estado: ESTADOS_VENDIDOS });
  }
}

export const ordenService = new OrdenService(
  ordenBoletoRepository,
  tipoBoletoRepository,
  boletoRepository,
  eventoService,
  permisosBoletos,
  pasarelaPagos,
  firmaBoletos,
  notificacionService,
  usuarioRepository,
  sequelize,
  env.FRONTEND_URL,
);

// Conecta los boletos con los eventos: "voy" con boleto, reembolsos al cancelar y bloqueo al borrar con pagos
eventoService.conectarBoletos({
  tieneBoleto: (eventoId, usuarioId) => ordenService.tieneBoleto(eventoId, usuarioId),
  alCancelarEvento: async (evento) => {
    const resumen = await ordenService.reembolsarEvento(evento.id);
    if (resumen.errores) throw new Error(`${resumen.errores} reembolsos quedaron pendientes`);
  },
  antesDeEliminarEvento: async (evento) => {
    if (await ordenBoletoRepository.pagosSinReembolsar(evento.id)) {
      throw new ConflictError('El evento tiene boletos pagados: cancélalo primero para reembolsarlos y después elimínalo');
    }
  },
});

/** Una pasada de limpieza de órdenes vencidas (la usa el temporizador y las pruebas). */
export function expirarOrdenesVencidas(): Promise<number>;
export function expirarOrdenesVencidas(ahora: Date): Promise<number>;
export function expirarOrdenesVencidas(ahora: Date = new Date()): Promise<number> {
  return ordenService.expirarVencidas(ahora);
}

/** Programa la liberación de órdenes vencidas (cada 5 min por defecto). Se llama una vez al arrancar el servidor. */
export function programarExpiracionOrdenes(): NodeJS.Timeout;
export function programarExpiracionOrdenes(intervaloMs: number): NodeJS.Timeout;
export function programarExpiracionOrdenes(intervaloMs: number = MINUTOS_LIMPIEZA_ORDENES * 60_000): NodeJS.Timeout {
  const temporizador = setInterval(() => {
    expirarOrdenesVencidas().catch((error: Error) => console.warn('No se pudieron liberar las órdenes vencidas:', error.message));
  }, intervaloMs);
  temporizador.unref();
  return temporizador;
}
