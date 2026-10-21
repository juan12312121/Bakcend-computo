/**
 * Más formas de interactuar con publicaciones: like en comentarios, guardados, encuestas y hashtags.
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

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

export class ComentarioLike extends Model<InferAttributes<ComentarioLike>, InferCreationAttributes<ComentarioLike>> {
  declare id: CreationOptional<number>;
  declare comentario_id: number;
  declare usuario_id: number;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof ComentarioLike {
    ComentarioLike.init(
      { id: pk(), comentario_id: fk(), usuario_id: fk(), fecha_creacion: DataTypes.DATE },
      { ...conFechaCreacion(sequelize, 'comentario_likes'), indexes: [{ unique: true, fields: ['comentario_id', 'usuario_id'] }] },
    );
    return ComentarioLike;
  }
}

/** Publicaciones que el usuario guardó para ver después. */
export class PublicacionGuardada extends Model<InferAttributes<PublicacionGuardada>, InferCreationAttributes<PublicacionGuardada>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare publicacion_id: number;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof PublicacionGuardada {
    PublicacionGuardada.init(
      { id: pk(), usuario_id: fk(), publicacion_id: fk(), fecha_creacion: DataTypes.DATE },
      { ...conFechaCreacion(sequelize, 'publicaciones_guardadas'), indexes: [{ unique: true, fields: ['usuario_id', 'publicacion_id'] }] },
    );
    return PublicacionGuardada;
  }
}

/** Encuesta adjunta a una publicación (una por publicación). */
export class Encuesta extends Model<InferAttributes<Encuesta>, InferCreationAttributes<Encuesta>> {
  declare id: CreationOptional<number>;
  declare publicacion_id: number;
  /** Se puede elegir más de una opción. */
  declare multiple: CreationOptional<boolean>;
  /** Después de esta fecha ya no se vota; null = abierta siempre. */
  declare cierra_en: CreationOptional<Date | null>;
  declare total_votos: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;
  declare opciones?: NonAttribute<EncuestaOpcion[]>;

  static initModel(sequelize: Sequelize): typeof Encuesta {
    Encuesta.init(
      {
        id: pk(),
        publicacion_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
        multiple: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        cierra_en: { type: DataTypes.DATE, allowNull: true },
        total_votos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'encuestas'),
    );
    return Encuesta;
  }
}

export class EncuestaOpcion extends Model<InferAttributes<EncuestaOpcion>, InferCreationAttributes<EncuestaOpcion>> {
  declare id: CreationOptional<number>;
  declare encuesta_id: number;
  declare texto: string;
  declare posicion: CreationOptional<number>;
  declare total_votos: CreationOptional<number>;

  static initModel(sequelize: Sequelize): typeof EncuestaOpcion {
    EncuestaOpcion.init(
      {
        id: pk(),
        encuesta_id: fk(),
        texto: { type: DataTypes.STRING(120), allowNull: false },
        posicion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        total_votos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      },
      { sequelize, tableName: 'encuesta_opciones', timestamps: false, indexes: [{ fields: ['encuesta_id'] }] },
    );
    return EncuestaOpcion;
  }
}

export class EncuestaVoto extends Model<InferAttributes<EncuestaVoto>, InferCreationAttributes<EncuestaVoto>> {
  declare id: CreationOptional<number>;
  declare encuesta_id: number;
  declare opcion_id: number;
  declare usuario_id: number;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof EncuestaVoto {
    EncuestaVoto.init(
      { id: pk(), encuesta_id: fk(), opcion_id: fk(), usuario_id: fk(), fecha_creacion: DataTypes.DATE },
      {
        ...conFechaCreacion(sequelize, 'encuesta_votos'),
        indexes: [{ unique: true, fields: ['opcion_id', 'usuario_id'] }, { fields: ['encuesta_id', 'usuario_id'] }],
      },
    );
    return EncuestaVoto;
  }
}

/** #tema: se guarda en minúsculas y sin el '#'. */
export class Hashtag extends Model<InferAttributes<Hashtag>, InferCreationAttributes<Hashtag>> {
  declare id: CreationOptional<number>;
  declare nombre: string;
  declare total_publicaciones: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof Hashtag {
    Hashtag.init(
      {
        id: pk(),
        nombre: { type: DataTypes.STRING(80), allowNull: false, unique: true },
        total_publicaciones: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'hashtags'),
    );
    return Hashtag;
  }
}

export class PublicacionHashtag extends Model<InferAttributes<PublicacionHashtag>, InferCreationAttributes<PublicacionHashtag>> {
  declare id: CreationOptional<number>;
  declare publicacion_id: number;
  declare hashtag_id: number;

  static initModel(sequelize: Sequelize): typeof PublicacionHashtag {
    PublicacionHashtag.init(
      { id: pk(), publicacion_id: fk(), hashtag_id: fk() },
      { sequelize, tableName: 'publicacion_hashtags', timestamps: false, indexes: [{ unique: true, fields: ['publicacion_id', 'hashtag_id'] }, { fields: ['hashtag_id'] }] },
    );
    return PublicacionHashtag;
  }
}
