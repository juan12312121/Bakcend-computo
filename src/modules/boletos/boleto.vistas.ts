import type { InferAttributes } from 'sequelize';
import type {
  Boleto,
  EstadoBoleto,
  EstadoOrden,
  Evento,
  NombreProveedorPago,
  OrdenBoleto,
  TipoBoleto,
  Usuario,
} from '../../infrastructure/database/models';
import type { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';
import type { ATRIBUTOS_EVENTO_BOLETO, ATRIBUTOS_TIPO_BOLETO } from './boleto.repository';

/** Cómo viajan al cliente los tipos, boletos y órdenes (montos en centavos y también en unidades). */

export type UsuarioPublico = Pick<InferAttributes<Usuario>, (typeof ATRIBUTOS_USUARIO_PUBLICO)[number]>;
export type EventoDeBoleto = Pick<InferAttributes<Evento>, (typeof ATRIBUTOS_EVENTO_BOLETO)[number]>;
export type TipoDeBoleto = Pick<InferAttributes<TipoBoleto>, (typeof ATRIBUTOS_TIPO_BOLETO)[number]>;

export const aUnidades = (centavos: number) => Math.round(centavos) / 100;

export interface TipoBoletoVista {
  id: number;
  evento_id: number;
  nombre: string;
  descripcion: string | null;
  /** En unidades de la moneda (150.5 = $150.50). 0 = gratis. */
  precio: number;
  precio_centavos: number;
  moneda: string;
  gratis: boolean;
  /** null = sin límite. */
  cupo: number | null;
  /** Emitidos + apartados en órdenes pendientes. */
  vendidos: number;
  /** null = sin límite. */
  quedan: number | null;
  venta_desde: Date | null;
  venta_hasta: Date | null;
  max_por_persona: number;
  activo: boolean;
  orden: number;
  /** Se puede comprar/obtener ahora mismo. */
  disponible: boolean;
  /** Por qué no está disponible (agotado, la venta no empieza...). */
  motivo: string | null;
}

export interface ContextoVenta {
  moneda: string;
  cancelado: boolean;
  terminado: boolean;
  ahora: Date;
}

export function vistaTipo(tipo: TipoBoleto, contexto: ContextoVenta): TipoBoletoVista {
  const quedan = tipo.cupo === null ? null : Math.max(0, tipo.cupo - tipo.vendidos);
  const ahora = contexto.ahora.getTime();
  let motivo: string | null = null;
  if (!tipo.activo) motivo = 'No disponible';
  else if (contexto.cancelado) motivo = 'El evento fue cancelado';
  else if (contexto.terminado) motivo = 'El evento ya terminó';
  else if (tipo.venta_desde && new Date(tipo.venta_desde).getTime() > ahora) motivo = 'La venta aún no empieza';
  else if (tipo.venta_hasta && new Date(tipo.venta_hasta).getTime() < ahora) motivo = 'La venta terminó';
  else if (quedan === 0) motivo = 'Agotado';

  return {
    id: tipo.id,
    evento_id: tipo.evento_id,
    nombre: tipo.nombre,
    descripcion: tipo.descripcion,
    precio: aUnidades(tipo.precio_centavos),
    precio_centavos: tipo.precio_centavos,
    moneda: contexto.moneda,
    gratis: tipo.precio_centavos === 0,
    cupo: tipo.cupo,
    vendidos: tipo.vendidos,
    quedan,
    venta_desde: tipo.venta_desde,
    venta_hasta: tipo.venta_hasta,
    max_por_persona: tipo.max_por_persona,
    activo: tipo.activo,
    orden: tipo.orden,
    disponible: motivo === null,
    motivo,
  };
}

export interface BoletoVista {
  id: number;
  /** Lo que va en el QR: solo lo recibe el dueño. */
  codigo: string | null;
  evento_id: number;
  estado: EstadoBoleto;
  usado_en: Date | null;
  fecha_creacion: Date;
  transferido_de: number | null;
  es_mio: boolean;
  tipo: TipoDeBoleto & { precio: number };
  evento: EventoDeBoleto | null;
  dueno: UsuarioPublico | null;
  /** Quién lo escaneó en la puerta. */
  escaneado_por: UsuarioPublico | null;
}

const publico = (u: Usuario | null | undefined): UsuarioPublico | null => (u ? (u.toJSON() as UsuarioPublico) : null);

export function vistaBoleto(boleto: Boleto, usuarioId: number): BoletoVista {
  const tipo = boleto.tipo ? (boleto.tipo.toJSON() as TipoDeBoleto) : { id: boleto.tipo_boleto_id, nombre: '', precio_centavos: 0 };
  const esMio = boleto.usuario_id === usuarioId;
  return {
    id: boleto.id,
    codigo: esMio ? boleto.codigo : null,
    evento_id: boleto.evento_id,
    estado: boleto.estado,
    usado_en: boleto.usado_en,
    fecha_creacion: boleto.fecha_creacion,
    transferido_de: boleto.transferido_de,
    es_mio: esMio,
    tipo: { ...tipo, precio: aUnidades(tipo.precio_centavos) },
    evento: boleto.evento ? (boleto.evento.toJSON() as EventoDeBoleto) : null,
    dueno: publico(boleto.dueno),
    escaneado_por: publico(boleto.escaneador),
  };
}

export interface OrdenVista {
  id: number;
  evento_id: number;
  tipo_boleto_id: number;
  cantidad: number;
  precio_unitario_centavos: number;
  total_centavos: number;
  total: number;
  moneda: string;
  proveedor: NombreProveedorPago;
  estado: EstadoOrden;
  url_pago: string | null;
  motivo_fallo: string | null;
  expira_en: Date | null;
  pagada_en: Date | null;
  reembolsada_en: Date | null;
  fecha_creacion: Date;
  evento: EventoDeBoleto | null;
  tipo: TipoDeBoleto | null;
  /** Boletos emitidos que siguen siendo míos (vacío mientras no se paga). */
  boletos: BoletoVista[];
  /** Pago simulado o con claves de prueba: la app lo marca muy claro. */
  modo_prueba: boolean;
}

export function vistaOrden(orden: OrdenBoleto, boletos: BoletoVista[], modoPrueba: boolean): OrdenVista {
  return {
    id: orden.id,
    evento_id: orden.evento_id,
    tipo_boleto_id: orden.tipo_boleto_id,
    cantidad: orden.cantidad,
    precio_unitario_centavos: orden.precio_unitario_centavos,
    total_centavos: orden.total_centavos,
    total: aUnidades(orden.total_centavos),
    moneda: orden.moneda,
    proveedor: orden.proveedor,
    estado: orden.estado,
    url_pago: orden.estado === 'pendiente' ? orden.url_pago : null,
    motivo_fallo: orden.motivo_fallo,
    expira_en: orden.expira_en,
    pagada_en: orden.pagada_en,
    reembolsada_en: orden.reembolsada_en,
    fecha_creacion: orden.fecha_creacion,
    evento: orden.evento ? (orden.evento.toJSON() as EventoDeBoleto) : null,
    tipo: orden.tipo ? (orden.tipo.toJSON() as TipoDeBoleto) : null,
    boletos,
    modo_prueba: modoPrueba,
  };
}
