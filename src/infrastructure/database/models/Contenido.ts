/** Organización de contenido: secciones del perfil, documentos adjuntos y etiquetas. */
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
import type { Publicacion } from './Publicacion';

/** Fábricas: Sequelize muta cada definición, así que no se pueden compartir objetos entre columnas. */
const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

export class Seccion extends Model<InferAttributes<Seccion>, InferCreationAttributes<Seccion>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare nombre: string;
  declare icono: CreationOptional<string>;
  declare color: CreationOptional<string>;
  declare imagen_portada: CreationOptional<string | null>;
  declare total_posts: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;
  declare publicaciones?: NonAttribute<Publicacion[]>;

  static initModel(sequelize: Sequelize): typeof Seccion {
    Seccion.init(
      {
        id: pk(),
        usuario_id: fk(),
        nombre: { type: DataTypes.STRING(100), allowNull: false },
        icono: { type: DataTypes.STRING(50), defaultValue: 'fa-folder' },
        color: { type: DataTypes.STRING(100), defaultValue: 'from-gray-400 to-gray-600' },
        imagen_portada: { type: DataTypes.STRING(500), allowNull: true },
        total_posts: { type: DataTypes.INTEGER, defaultValue: 0 },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'secciones'),
    );
    return Seccion;
  }
}

export class PublicacionSeccion extends Model<InferAttributes<PublicacionSeccion>, InferCreationAttributes<PublicacionSeccion>> {
  declare id: CreationOptional<number>;
  declare publicacion_id: number;
  declare seccion_id: number;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof PublicacionSeccion {
    PublicacionSeccion.init(
      { id: pk(), publicacion_id: fk(), seccion_id: fk(), fecha_creacion: DataTypes.DATE },
      {
        ...conFechaCreacion(sequelize, 'publicaciones_secciones'),
        indexes: [{ unique: true, fields: ['publicacion_id', 'seccion_id'] }],
      },
    );
    return PublicacionSeccion;
  }
}

export const ICONOS_DOCUMENTO = [
  'fa-file-pdf',
  'fa-file-word',
  'fa-file-excel',
  'fa-file-powerpoint',
  'fa-file-archive',
  'fa-file-csv',
  'fa-file-code',
  'fa-file',
] as const;

export class Documento extends Model<InferAttributes<Documento>, InferCreationAttributes<Documento>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare publicacion_id: CreationOptional<number | null>;
  declare documento_url: CreationOptional<string | null>;
  /** public_id del archivo en Cloudinary. */
  declare documento_s3: string;
  declare nombre_archivo: string;
  declare tamano_archivo: number;
  declare tipo_archivo: string;
  declare icono: CreationOptional<string>;
  declare color: CreationOptional<string>;
  declare descripcion: CreationOptional<string | null>;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof Documento {
    Documento.init(
      {
        id: pk(),
        usuario_id: fk(),
        publicacion_id: { type: DataTypes.INTEGER, allowNull: true },
        documento_url: { type: DataTypes.STRING(500), allowNull: true },
        documento_s3: { type: DataTypes.STRING(300), allowNull: false, defaultValue: '' },
        nombre_archivo: { type: DataTypes.STRING(255), allowNull: false },
        tamano_archivo: { type: DataTypes.BIGINT, allowNull: false },
        tipo_archivo: { type: DataTypes.STRING(100), allowNull: false },
        icono: { type: DataTypes.ENUM(...ICONOS_DOCUMENTO), defaultValue: 'fa-file' },
        color: { type: DataTypes.STRING(30), defaultValue: 'text-gray-500' },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'documentos'),
    );
    return Documento;
  }
}

export class Etiqueta extends Model<InferAttributes<Etiqueta>, InferCreationAttributes<Etiqueta>> {
  declare id: CreationOptional<number>;
  declare nombre: string;
  declare icono: CreationOptional<string>;
  declare color: CreationOptional<string>;
  declare total_posts: CreationOptional<number>;
  declare tendencia: CreationOptional<boolean>;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof Etiqueta {
    Etiqueta.init(
      {
        id: pk(),
        nombre: { type: DataTypes.STRING(50), allowNull: false, unique: true },
        icono: { type: DataTypes.STRING(50), defaultValue: 'fa-tag' },
        color: { type: DataTypes.STRING(50), defaultValue: 'teal' },
        total_posts: { type: DataTypes.INTEGER, defaultValue: 0 },
        tendencia: { type: DataTypes.BOOLEAN, defaultValue: false },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'etiquetas'),
    );
    return Etiqueta;
  }
}
