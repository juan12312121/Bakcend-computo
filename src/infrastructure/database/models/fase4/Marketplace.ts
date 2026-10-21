/**
 * Fase 4 — compra y venta entre usuarios (estilo Facebook Marketplace).
 * Anuncios de productos (nuevos o usados) y servicios, con fotos, guardados, visitas, interesados,
 * reportes y calificaciones del vendedor. Dueño: agente "marketplace".
 * Los modelos existentes se importan desde su archivo, nunca desde '../index'.
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
import { Grupo } from '../Comunidad';
import { conFechaCreacion, conFechas } from '../modelOptions';
import { Usuario } from '../Usuario';

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

// ---------- Catálogos ----------

export const CATEGORIAS_ANUNCIO = [
  'electronica',
  'hogar',
  'ropa',
  'vehiculos',
  'libros_escuela',
  'deportes',
  'juguetes',
  'servicios',
  'inmuebles',
  'otros',
] as const;
export type CategoriaAnuncio = (typeof CATEGORIAS_ANUNCIO)[number];

export const TIPOS_ANUNCIO = ['producto', 'servicio'] as const;
export type TipoAnuncio = (typeof TIPOS_ANUNCIO)[number];

/** Solo aplica a productos. */
export const CONDICIONES_ANUNCIO = ['nuevo', 'como_nuevo', 'usado', 'para_piezas'] as const;
export type CondicionAnuncio = (typeof CONDICIONES_ANUNCIO)[number];

/** fijo: con precio · a_convenir: sin precio (se negocia) · gratis: se regala (precio 0). */
export const MODOS_PRECIO_ANUNCIO = ['fijo', 'a_convenir', 'gratis'] as const;
export type ModoPrecioAnuncio = (typeof MODOS_PRECIO_ANUNCIO)[number];

export const MONEDAS_ANUNCIO = ['MXN', 'USD', 'EUR', 'COP', 'ARS', 'CLP', 'PEN', 'GTQ'] as const;
export type MonedaAnuncio = (typeof MONEDAS_ANUNCIO)[number];

/** activo: a la venta · reservado: apartado · vendido · pausado: oculto para los demás. */
export const ESTADOS_ANUNCIO = ['activo', 'reservado', 'vendido', 'pausado'] as const;
export type EstadoAnuncio = (typeof ESTADOS_ANUNCIO)[number];

export const MOTIVOS_REPORTE_ANUNCIO = ['estafa', 'prohibido', 'enganoso', 'duplicado', 'ofensivo', 'ya_vendido', 'otro'] as const;
export type MotivoReporteAnuncio = (typeof MOTIVOS_REPORTE_ANUNCIO)[number];

export const ESTADOS_REPORTE_ANUNCIO = ['pendiente', 'revisado', 'descartado'] as const;
export type EstadoReporteAnuncio = (typeof ESTADOS_REPORTE_ANUNCIO)[number];

// ---------- Anuncio ----------

export class Anuncio extends Model<InferAttributes<Anuncio>, InferCreationAttributes<Anuncio>> {
  declare id: CreationOptional<number>;
  declare vendedor_id: number;
  /** Anuncio publicado dentro de un grupo (lo ven sus miembros, o todos si el grupo es público). */
  declare grupo_id: CreationOptional<number | null>;
  declare titulo: string;
  declare descripcion: CreationOptional<string | null>;
  declare tipo: CreationOptional<TipoAnuncio>;
  declare categoria: CreationOptional<CategoriaAnuncio>;
  declare condicion: CreationOptional<CondicionAnuncio | null>;
  declare modo_precio: CreationOptional<ModoPrecioAnuncio>;
  /** null si es "a convenir"; 0 si es gratis. */
  declare precio: CreationOptional<number | null>;
  declare moneda: CreationOptional<MonedaAnuncio>;
  /** Ciudad o zona en texto libre. */
  declare ubicacion: string;
  declare entrega_en_persona: CreationOptional<boolean>;
  declare entrega_envio: CreationOptional<boolean>;
  declare estado: CreationOptional<EstadoAnuncio>;
  declare total_vistas: CreationOptional<number>;
  declare total_guardados: CreationOptional<number>;
  declare total_interesados: CreationOptional<number>;
  /** A quién se lo vendió (uno de los interesados); habilita su calificación. */
  declare comprador_id: CreationOptional<number | null>;
  /** Fecha que ordena "recientes": al crear y al renovar. */
  declare renovado_en: CreationOptional<Date>;
  declare vendido_en: CreationOptional<Date | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare vendedor?: NonAttribute<Usuario>;
  declare grupo?: NonAttribute<Grupo | null>;
  declare fotos?: NonAttribute<AnuncioFoto[]>;

  static initModel(sequelize: Sequelize): typeof Anuncio {
    Anuncio.init(
      {
        id: pk(),
        vendedor_id: fk(),
        grupo_id: { type: DataTypes.INTEGER, allowNull: true },
        titulo: { type: DataTypes.STRING(120), allowNull: false },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        tipo: { type: DataTypes.ENUM(...TIPOS_ANUNCIO), allowNull: false, defaultValue: 'producto' },
        categoria: { type: DataTypes.ENUM(...CATEGORIAS_ANUNCIO), allowNull: false, defaultValue: 'otros' },
        condicion: { type: DataTypes.ENUM(...CONDICIONES_ANUNCIO), allowNull: true },
        modo_precio: { type: DataTypes.ENUM(...MODOS_PRECIO_ANUNCIO), allowNull: false, defaultValue: 'fijo' },
        precio: {
          type: DataTypes.DECIMAL(12, 2),
          allowNull: true,
          // MySQL devuelve DECIMAL como texto: siempre se entrega como número
          get(this: Anuncio) {
            const valor = this.getDataValue('precio') as number | string | null;
            return valor === null || valor === undefined ? null : Number(valor);
          },
        },
        moneda: { type: DataTypes.ENUM(...MONEDAS_ANUNCIO), allowNull: false, defaultValue: 'MXN' },
        ubicacion: { type: DataTypes.STRING(150), allowNull: false },
        entrega_en_persona: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        entrega_envio: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        estado: { type: DataTypes.ENUM(...ESTADOS_ANUNCIO), allowNull: false, defaultValue: 'activo' },
        total_vistas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        total_guardados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        total_interesados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        comprador_id: { type: DataTypes.INTEGER, allowNull: true },
        renovado_en: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        vendido_en: { type: DataTypes.DATE, allowNull: true },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      {
        ...conFechas(sequelize, 'anuncios'),
        indexes: [
          { fields: ['estado', 'renovado_en'] },
          { fields: ['vendedor_id'] },
          { fields: ['categoria'] },
          { fields: ['grupo_id'] },
          { fields: ['precio'] },
        ],
      },
    );
    return Anuncio;
  }
}

export class AnuncioFoto extends Model<InferAttributes<AnuncioFoto>, InferCreationAttributes<AnuncioFoto>> {
  declare id: CreationOptional<number>;
  declare anuncio_id: number;
  declare url: string;
  /** public_id de Cloudinary (para borrarla). */
  declare archivo_id: CreationOptional<string | null>;
  /** 0 = foto principal. */
  declare orden: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof AnuncioFoto {
    AnuncioFoto.init(
      {
        id: pk(),
        anuncio_id: fk(),
        url: { type: DataTypes.STRING(500), allowNull: false },
        archivo_id: { type: DataTypes.STRING(300), allowNull: true },
        orden: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'anuncio_fotos'), indexes: [{ fields: ['anuncio_id', 'orden'] }] },
    );
    return AnuncioFoto;
  }
}

/** Anuncios guardados (favoritos) de cada usuario. */
export class AnuncioGuardado extends Model<InferAttributes<AnuncioGuardado>, InferCreationAttributes<AnuncioGuardado>> {
  declare id: CreationOptional<number>;
  declare anuncio_id: number;
  declare usuario_id: number;
  declare fecha_creacion: CreationOptional<Date>;
  declare anuncio?: NonAttribute<Anuncio>;

  static initModel(sequelize: Sequelize): typeof AnuncioGuardado {
    AnuncioGuardado.init(
      { id: pk(), anuncio_id: fk(), usuario_id: fk(), fecha_creacion: DataTypes.DATE },
      { ...conFechaCreacion(sequelize, 'anuncio_guardados'), indexes: [{ unique: true, fields: ['anuncio_id', 'usuario_id'] }] },
    );
    return AnuncioGuardado;
  }
}

/** Última vez que un usuario abrió un anuncio ("vistos recientemente"; cuenta una vista por persona). */
export class AnuncioVisita extends Model<InferAttributes<AnuncioVisita>, InferCreationAttributes<AnuncioVisita>> {
  declare id: CreationOptional<number>;
  declare anuncio_id: number;
  declare usuario_id: number;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare anuncio?: NonAttribute<Anuncio>;

  static initModel(sequelize: Sequelize): typeof AnuncioVisita {
    AnuncioVisita.init(
      { id: pk(), anuncio_id: fk(), usuario_id: fk(), fecha_creacion: DataTypes.DATE, fecha_actualizacion: DataTypes.DATE },
      {
        ...conFechas(sequelize, 'anuncio_visitas'),
        indexes: [{ unique: true, fields: ['anuncio_id', 'usuario_id'] }, { fields: ['usuario_id', 'fecha_actualizacion'] }],
      },
    );
    return AnuncioVisita;
  }
}

/** Quién preguntó "¿sigue disponible?" y por qué chat (de aquí sale el comprador al marcar vendido). */
export class AnuncioInteresado extends Model<InferAttributes<AnuncioInteresado>, InferCreationAttributes<AnuncioInteresado>> {
  declare id: CreationOptional<number>;
  declare anuncio_id: number;
  declare usuario_id: number;
  declare chat_id: CreationOptional<number | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof AnuncioInteresado {
    AnuncioInteresado.init(
      {
        id: pk(),
        anuncio_id: fk(),
        usuario_id: fk(),
        chat_id: { type: DataTypes.INTEGER, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'anuncio_interesados'), indexes: [{ unique: true, fields: ['anuncio_id', 'usuario_id'] }] },
    );
    return AnuncioInteresado;
  }
}

/** Reporte de un anuncio (el panel general de moderación los lee con marketplaceService.listarReportes). */
export class AnuncioReporte extends Model<InferAttributes<AnuncioReporte>, InferCreationAttributes<AnuncioReporte>> {
  declare id: CreationOptional<number>;
  declare anuncio_id: number;
  declare usuario_id: number;
  declare motivo: MotivoReporteAnuncio;
  declare detalle: CreationOptional<string | null>;
  declare estado: CreationOptional<EstadoReporteAnuncio>;
  declare revisado_por: CreationOptional<number | null>;
  declare revisado_en: CreationOptional<Date | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare anuncio?: NonAttribute<Anuncio>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof AnuncioReporte {
    AnuncioReporte.init(
      {
        id: pk(),
        anuncio_id: fk(),
        usuario_id: fk(),
        motivo: { type: DataTypes.ENUM(...MOTIVOS_REPORTE_ANUNCIO), allowNull: false },
        detalle: { type: DataTypes.STRING(500), allowNull: true },
        estado: { type: DataTypes.ENUM(...ESTADOS_REPORTE_ANUNCIO), allowNull: false, defaultValue: 'pendiente' },
        revisado_por: { type: DataTypes.INTEGER, allowNull: true },
        revisado_en: { type: DataTypes.DATE, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      {
        ...conFechaCreacion(sequelize, 'anuncio_reportes'),
        indexes: [{ unique: true, fields: ['anuncio_id', 'usuario_id'] }, { fields: ['estado'] }],
      },
    );
    return AnuncioReporte;
  }
}

/** Calificación (1-5) que deja quien compró al vendedor; una por anuncio. */
export class CalificacionVendedor extends Model<InferAttributes<CalificacionVendedor>, InferCreationAttributes<CalificacionVendedor>> {
  declare id: CreationOptional<number>;
  declare vendedor_id: number;
  declare comprador_id: number;
  /** Se conserva aunque el anuncio se borre (queda null). */
  declare anuncio_id: CreationOptional<number | null>;
  declare titulo_anuncio: string;
  declare puntuacion: number;
  declare comentario: CreationOptional<string | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare comprador?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof CalificacionVendedor {
    CalificacionVendedor.init(
      {
        id: pk(),
        vendedor_id: fk(),
        comprador_id: fk(),
        anuncio_id: { type: DataTypes.INTEGER, allowNull: true },
        titulo_anuncio: { type: DataTypes.STRING(120), allowNull: false },
        puntuacion: { type: DataTypes.INTEGER, allowNull: false },
        comentario: { type: DataTypes.STRING(500), allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      {
        ...conFechaCreacion(sequelize, 'calificaciones_vendedor'),
        indexes: [{ fields: ['vendedor_id'] }, { unique: true, fields: ['anuncio_id', 'comprador_id'] }],
      },
    );
    return CalificacionVendedor;
  }
}

export function registrarModelosMarketplace(sequelize: Sequelize): void {
  [Anuncio, AnuncioFoto, AnuncioGuardado, AnuncioVisita, AnuncioInteresado, AnuncioReporte, CalificacionVendedor].forEach((m) =>
    m.initModel(sequelize),
  );
  const cascada = { onDelete: 'CASCADE' as const };

  Anuncio.belongsTo(Usuario, { foreignKey: 'vendedor_id', as: 'vendedor', ...cascada });
  Anuncio.belongsTo(Usuario, { foreignKey: 'comprador_id', as: 'comprador', onDelete: 'SET NULL' });
  Anuncio.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo', ...cascada });
  Anuncio.hasMany(AnuncioFoto, { foreignKey: 'anuncio_id', as: 'fotos', ...cascada });
  AnuncioFoto.belongsTo(Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });

  Anuncio.hasMany(AnuncioGuardado, { foreignKey: 'anuncio_id', as: 'guardados', ...cascada });
  AnuncioGuardado.belongsTo(Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
  AnuncioGuardado.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

  Anuncio.hasMany(AnuncioVisita, { foreignKey: 'anuncio_id', as: 'visitas', ...cascada });
  AnuncioVisita.belongsTo(Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
  AnuncioVisita.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

  Anuncio.hasMany(AnuncioInteresado, { foreignKey: 'anuncio_id', as: 'interesados', ...cascada });
  AnuncioInteresado.belongsTo(Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
  AnuncioInteresado.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

  Anuncio.hasMany(AnuncioReporte, { foreignKey: 'anuncio_id', as: 'reportes', ...cascada });
  AnuncioReporte.belongsTo(Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio' });
  AnuncioReporte.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

  CalificacionVendedor.belongsTo(Usuario, { foreignKey: 'vendedor_id', as: 'vendedor', ...cascada });
  CalificacionVendedor.belongsTo(Usuario, { foreignKey: 'comprador_id', as: 'comprador', ...cascada });
  CalificacionVendedor.belongsTo(Anuncio, { foreignKey: 'anuncio_id', as: 'anuncio', onDelete: 'SET NULL' });
}
