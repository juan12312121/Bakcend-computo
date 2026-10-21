/**
 * Modelos de interacción sobre publicaciones: comentarios, likes, reportes,
 * ocultas, "no me interesa" y compartidos.
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
import { conFechaCreacion } from './modelOptions';
import type { Usuario } from './Usuario';
import type { Publicacion } from './Publicacion';

/** Fábricas: Sequelize muta cada definición, así que no se pueden compartir objetos entre columnas. */
const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

export const TIPOS_REACCION = ['me_gusta', 'me_encanta', 'jaja', 'asombro', 'triste', 'enojo', 'aplauso'] as const;
export type TipoReaccion = (typeof TIPOS_REACCION)[number];

export class Comentario extends Model<InferAttributes<Comentario>, InferCreationAttributes<Comentario>> {
  declare id: CreationOptional<number>;
  declare publicacion_id: number;
  declare usuario_id: number;
  declare texto: string;
  /** Comentario al que responde (null = comentario de primer nivel). */
  declare padre_id: CreationOptional<number | null>;
  declare total_likes: CreationOptional<number>;
  declare total_respuestas: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;
  declare autor?: NonAttribute<Usuario>;
  declare respuestas?: NonAttribute<Comentario[]>;

  static initModel(sequelize: Sequelize): typeof Comentario {
    Comentario.init(
      {
        id: pk(),
        publicacion_id: fk(),
        usuario_id: fk(),
        texto: { type: DataTypes.TEXT, allowNull: false },
        padre_id: { type: DataTypes.INTEGER, allowNull: true },
        total_likes: { type: DataTypes.INTEGER, defaultValue: 0 },
        total_respuestas: { type: DataTypes.INTEGER, defaultValue: 0 },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'comentarios'), indexes: [{ fields: ['publicacion_id', 'padre_id'] }] },
    );
    return Comentario;
  }
}

export class Like extends Model<InferAttributes<Like>, InferCreationAttributes<Like>> {
  declare id: CreationOptional<number>;
  declare publicacion_id: number;
  declare usuario_id: number;
  /** Reacción (un "like" de antes es 'me_gusta'). Una sola reacción por persona y publicación. */
  declare tipo: CreationOptional<TipoReaccion>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof Like {
    Like.init(
      {
        id: pk(),
        publicacion_id: fk(),
        usuario_id: fk(),
        tipo: { type: DataTypes.ENUM(...TIPOS_REACCION), allowNull: false, defaultValue: 'me_gusta' },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'likes'), indexes: [{ unique: true, fields: ['publicacion_id', 'usuario_id'] }] },
    );
    return Like;
  }
}

export const MOTIVOS_REPORTE = [
  'Acoso o bullying',
  'Violencia o daño',
  'Spam o publicidad',
  'Información falsa',
  'Suplantación de identidad',
  'Lenguaje ofensivo',
  'Otro',
] as const;
export type MotivoReporte = (typeof MOTIVOS_REPORTE)[number];

export class Reporte extends Model<InferAttributes<Reporte>, InferCreationAttributes<Reporte>> {
  declare id: CreationOptional<number>;
  declare publicacion_id: number;
  declare usuario_id: number;
  declare motivo: CreationOptional<MotivoReporte>;
  declare descripcion: CreationOptional<string | null>;
  declare fecha_reporte: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;
  declare publicacion?: NonAttribute<Publicacion>;

  static initModel(sequelize: Sequelize): typeof Reporte {
    Reporte.init(
      {
        id: pk(),
        publicacion_id: fk(),
        usuario_id: fk(),
        motivo: { type: DataTypes.ENUM(...MOTIVOS_REPORTE), allowNull: false, defaultValue: 'Otro' },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        fecha_reporte: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'reportes', 'fecha_reporte'), indexes: [{ unique: true, fields: ['publicacion_id', 'usuario_id'] }] },
    );
    return Reporte;
  }
}

export class PublicacionOculta extends Model<InferAttributes<PublicacionOculta>, InferCreationAttributes<PublicacionOculta>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare publicacion_id: number;
  declare fecha_creacion: CreationOptional<Date>;
  declare publicacion?: NonAttribute<Publicacion>;

  static initModel(sequelize: Sequelize): typeof PublicacionOculta {
    PublicacionOculta.init(
      { id: pk(), usuario_id: fk(), publicacion_id: fk(), fecha_creacion: DataTypes.DATE },
      { ...conFechaCreacion(sequelize, 'publicaciones_ocultas'), indexes: [{ unique: true, fields: ['usuario_id', 'publicacion_id'] }] },
    );
    return PublicacionOculta;
  }
}

export class PublicacionNoInteresa extends Model<
  InferAttributes<PublicacionNoInteresa>,
  InferCreationAttributes<PublicacionNoInteresa>
> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare publicacion_id: number;
  declare categoria: CreationOptional<string | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare publicacion?: NonAttribute<Publicacion>;

  static initModel(sequelize: Sequelize): typeof PublicacionNoInteresa {
    PublicacionNoInteresa.init(
      { id: pk(), usuario_id: fk(), publicacion_id: fk(), categoria: { type: DataTypes.STRING(50), allowNull: true }, fecha_creacion: DataTypes.DATE },
      {
        ...conFechaCreacion(sequelize, 'publicaciones_no_interesa'),
        indexes: [{ unique: true, fields: ['usuario_id', 'publicacion_id'] }],
      },
    );
    return PublicacionNoInteresa;
  }
}

export class Compartido extends Model<InferAttributes<Compartido>, InferCreationAttributes<Compartido>> {
  declare id: CreationOptional<number>;
  declare publicacion_id: number;
  declare usuario_id: number;
  declare compartido_con_usuario_id: CreationOptional<number | null>;
  declare plataforma: CreationOptional<string | null>;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof Compartido {
    Compartido.init(
      {
        id: pk(),
        publicacion_id: fk(),
        usuario_id: fk(),
        compartido_con_usuario_id: { type: DataTypes.INTEGER, allowNull: true },
        plataforma: { type: DataTypes.STRING(50), allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'compartidos'),
    );
    return Compartido;
  }
}
