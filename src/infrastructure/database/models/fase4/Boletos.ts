/**
 * Fase 4 — boletos con QR y pagos de eventos (agente "boletos").
 * Tipos de boleto por evento, órdenes de compra (pago con Stripe / Mercado Pago / demo / gratis),
 * boletos con código firmado y el staff que puede escanearlos en la puerta.
 * Importa los modelos existentes desde su archivo, nunca desde '../index'.
 */
import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from 'sequelize';
import { Evento } from '../Eventos';
import { conFechaCreacion, conFechas } from '../modelOptions';
import { Usuario } from '../Usuario';

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

/** valido: se puede usar · usado: ya entró · cancelado: anulado sin cobro · reembolsado: se devolvió el dinero. */
export const ESTADOS_BOLETO = ['valido', 'usado', 'cancelado', 'reembolsado'] as const;
export type EstadoBoleto = (typeof ESTADOS_BOLETO)[number];

export const ESTADOS_ORDEN = ['pendiente', 'pagada', 'fallida', 'reembolsada'] as const;
export type EstadoOrden = (typeof ESTADOS_ORDEN)[number];

/** gratis: boletos sin costo (no pasa por pasarela) · demo: simulación solo fuera de producción. */
export const PROVEEDORES_PAGO = ['gratis', 'demo', 'stripe', 'mercadopago'] as const;
export type NombreProveedorPago = (typeof PROVEEDORES_PAGO)[number];

/** Tipo de boleto de un evento (General, VIP, Estudiante...). Precio en centavos: 0 = gratis. */
export class TipoBoleto extends Model<InferAttributes<TipoBoleto>, InferCreationAttributes<TipoBoleto>> {
  declare id: CreationOptional<number>;
  declare evento_id: number;
  declare nombre: string;
  declare descripcion: CreationOptional<string | null>;
  declare precio_centavos: CreationOptional<number>;
  /** null = sin límite. */
  declare cupo: CreationOptional<number | null>;
  /** Lugares ocupados: boletos emitidos + órdenes pendientes de pago (reservados). */
  declare vendidos: CreationOptional<number>;
  declare venta_desde: CreationOptional<Date | null>;
  declare venta_hasta: CreationOptional<Date | null>;
  /** Máximo de boletos de este tipo que puede tener una persona. */
  declare max_por_persona: CreationOptional<number>;
  declare activo: CreationOptional<boolean>;
  declare orden: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare evento?: NonAttribute<Evento>;

  static initModel(sequelize: Sequelize): typeof TipoBoleto {
    TipoBoleto.init(
      {
        id: pk(),
        evento_id: fk(),
        nombre: { type: DataTypes.STRING(80), allowNull: false },
        descripcion: { type: DataTypes.STRING(300), allowNull: true },
        precio_centavos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        cupo: { type: DataTypes.INTEGER, allowNull: true },
        vendidos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        venta_desde: { type: DataTypes.DATE, allowNull: true },
        venta_hasta: { type: DataTypes.DATE, allowNull: true },
        max_por_persona: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 10 },
        activo: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      { ...conFechas(sequelize, 'boleto_tipos'), indexes: [{ fields: ['evento_id'] }] },
    );
    return TipoBoleto;
  }
}

/** Orden de compra: reserva el cupo al crearse y emite los boletos solo cuando se confirma el pago. */
export class OrdenBoleto extends Model<InferAttributes<OrdenBoleto>, InferCreationAttributes<OrdenBoleto>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare evento_id: number;
  declare tipo_boleto_id: number;
  declare cantidad: number;
  declare precio_unitario_centavos: number;
  declare total_centavos: number;
  declare moneda: string;
  declare proveedor: NombreProveedorPago;
  declare estado: CreationOptional<EstadoOrden>;
  /** Id de la sesión de Stripe o de la preferencia de Mercado Pago. */
  declare referencia_externa: CreationOptional<string | null>;
  /** Id del cobro (payment_intent de Stripe / payment de Mercado Pago), para reembolsar. */
  declare pago_externo_id: CreationOptional<string | null>;
  declare url_pago: CreationOptional<string | null>;
  declare motivo_fallo: CreationOptional<string | null>;
  /** Una orden pendiente libera su cupo al vencer. */
  declare expira_en: CreationOptional<Date | null>;
  declare pagada_en: CreationOptional<Date | null>;
  declare reembolsada_en: CreationOptional<Date | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare tipo?: NonAttribute<TipoBoleto>;
  declare evento?: NonAttribute<Evento>;
  declare comprador?: NonAttribute<Usuario>;
  declare boletos?: NonAttribute<Boleto[]>;

  static initModel(sequelize: Sequelize): typeof OrdenBoleto {
    OrdenBoleto.init(
      {
        id: pk(),
        usuario_id: fk(),
        evento_id: fk(),
        tipo_boleto_id: fk(),
        cantidad: { type: DataTypes.INTEGER, allowNull: false },
        precio_unitario_centavos: { type: DataTypes.INTEGER, allowNull: false },
        total_centavos: { type: DataTypes.INTEGER, allowNull: false },
        moneda: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'MXN' },
        proveedor: { type: DataTypes.ENUM(...PROVEEDORES_PAGO), allowNull: false },
        estado: { type: DataTypes.ENUM(...ESTADOS_ORDEN), allowNull: false, defaultValue: 'pendiente' },
        referencia_externa: { type: DataTypes.STRING(255), allowNull: true },
        pago_externo_id: { type: DataTypes.STRING(255), allowNull: true },
        url_pago: { type: DataTypes.STRING(1000), allowNull: true },
        motivo_fallo: { type: DataTypes.STRING(255), allowNull: true },
        expira_en: { type: DataTypes.DATE, allowNull: true },
        pagada_en: { type: DataTypes.DATE, allowNull: true },
        reembolsada_en: { type: DataTypes.DATE, allowNull: true },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      {
        ...conFechas(sequelize, 'boleto_ordenes'),
        indexes: [{ fields: ['usuario_id'] }, { fields: ['evento_id', 'estado'] }, { fields: ['estado', 'expira_en'] }],
      },
    );
    return OrdenBoleto;
  }
}

/** Boleto individual con su código firmado (lo que va en el QR). */
export class Boleto extends Model<InferAttributes<Boleto>, InferCreationAttributes<Boleto>> {
  declare id: CreationOptional<number>;
  /** Código único firmado con HMAC (TF1.<evento>.<aleatorio>.<firma>). */
  declare codigo: string;
  declare evento_id: number;
  declare tipo_boleto_id: number;
  declare orden_id: number;
  /** Dueño actual (cambia al transferir). */
  declare usuario_id: number;
  declare estado: CreationOptional<EstadoBoleto>;
  declare usado_en: CreationOptional<Date | null>;
  /** Quién lo escaneó en la puerta. */
  declare usado_por: CreationOptional<number | null>;
  /** Dueño anterior si llegó por transferencia. */
  declare transferido_de: CreationOptional<number | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare dueno?: NonAttribute<Usuario>;
  declare escaneador?: NonAttribute<Usuario | null>;
  declare tipo?: NonAttribute<TipoBoleto>;
  declare evento?: NonAttribute<Evento>;
  declare orden?: NonAttribute<OrdenBoleto>;

  static initModel(sequelize: Sequelize): typeof Boleto {
    Boleto.init(
      {
        id: pk(),
        codigo: { type: DataTypes.STRING(120), allowNull: false, unique: true },
        evento_id: fk(),
        tipo_boleto_id: fk(),
        orden_id: fk(),
        usuario_id: fk(),
        estado: { type: DataTypes.ENUM(...ESTADOS_BOLETO), allowNull: false, defaultValue: 'valido' },
        usado_en: { type: DataTypes.DATE, allowNull: true },
        usado_por: { type: DataTypes.INTEGER, allowNull: true },
        transferido_de: { type: DataTypes.INTEGER, allowNull: true },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      {
        ...conFechas(sequelize, 'boletos'),
        indexes: [{ fields: ['evento_id', 'estado'] }, { fields: ['usuario_id'] }, { fields: ['orden_id'] }],
      },
    );
    return Boleto;
  }
}

/** Personas que el organizador autoriza para escanear boletos en la puerta. */
export class EventoStaff extends Model<InferAttributes<EventoStaff>, InferCreationAttributes<EventoStaff>> {
  declare id: CreationOptional<number>;
  declare evento_id: number;
  declare usuario_id: number;
  declare agregado_por: number;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof EventoStaff {
    EventoStaff.init(
      {
        id: pk(),
        evento_id: fk(),
        usuario_id: fk(),
        agregado_por: fk(),
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'evento_staff'), indexes: [{ unique: true, fields: ['evento_id', 'usuario_id'] }] },
    );
    return EventoStaff;
  }
}

export function registrarModelosBoletos(sequelize: Sequelize): void {
  [TipoBoleto, OrdenBoleto, Boleto, EventoStaff].forEach((modelo) => modelo.initModel(sequelize));
  const cascada = { onDelete: 'CASCADE' as const };

  Evento.hasMany(TipoBoleto, { foreignKey: 'evento_id', as: 'tipos_boleto', ...cascada });
  TipoBoleto.belongsTo(Evento, { foreignKey: 'evento_id', as: 'evento' });

  Evento.hasMany(OrdenBoleto, { foreignKey: 'evento_id', as: 'ordenes_boleto', ...cascada });
  OrdenBoleto.belongsTo(Evento, { foreignKey: 'evento_id', as: 'evento' });
  OrdenBoleto.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'comprador', ...cascada });
  TipoBoleto.hasMany(OrdenBoleto, { foreignKey: 'tipo_boleto_id', as: 'ordenes', ...cascada });
  OrdenBoleto.belongsTo(TipoBoleto, { foreignKey: 'tipo_boleto_id', as: 'tipo' });

  OrdenBoleto.hasMany(Boleto, { foreignKey: 'orden_id', as: 'boletos', ...cascada });
  Boleto.belongsTo(OrdenBoleto, { foreignKey: 'orden_id', as: 'orden' });
  Evento.hasMany(Boleto, { foreignKey: 'evento_id', as: 'boletos', ...cascada });
  Boleto.belongsTo(Evento, { foreignKey: 'evento_id', as: 'evento' });
  TipoBoleto.hasMany(Boleto, { foreignKey: 'tipo_boleto_id', as: 'boletos', ...cascada });
  Boleto.belongsTo(TipoBoleto, { foreignKey: 'tipo_boleto_id', as: 'tipo' });
  Boleto.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'dueno', ...cascada });
  Boleto.belongsTo(Usuario, { foreignKey: 'usado_por', as: 'escaneador', constraints: false });

  Evento.hasMany(EventoStaff, { foreignKey: 'evento_id', as: 'staff', ...cascada });
  EventoStaff.belongsTo(Evento, { foreignKey: 'evento_id', as: 'evento' });
  EventoStaff.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
}
