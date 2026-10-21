/** Historias efímeras (duran 24 h) y quién vio cada una. */
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
import type { EdicionVideo } from './Publicacion';

/** Fábricas: Sequelize muta cada definición, así que no se pueden compartir objetos entre columnas. */
const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

export const TIPOS_HISTORIA = ['imagen', 'video', 'texto'] as const;
export type TipoHistoria = (typeof TIPOS_HISTORIA)[number];

export class Historia extends Model<InferAttributes<Historia>, InferCreationAttributes<Historia>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare tipo: TipoHistoria;
  /** URL pública del archivo (null en las de texto). */
  declare media_url: CreationOptional<string | null>;
  /** public_id en Cloudinary para poder borrarlo (null en las de texto). */
  declare media_s3: CreationOptional<string | null>;
  declare texto: CreationOptional<string | null>;
  /** Gradiente de Tailwind de las historias de texto ("from-orange-500 to-pink-500"). */
  declare fondo: CreationOptional<string | null>;
  declare duracion_seg: CreationOptional<number>;
  declare total_vistas: CreationOptional<number>;
  declare expira_en: Date;
  /** [creadores] Ya pasó de la bandeja de 24 h al archivo (se conserva para las destacadas). */
  declare archivada: CreationOptional<boolean>;
  /** [creadores] Video tal como se subió; `media_url` es la URL de reproducción con los ajustes del editor. */
  declare media_original_url: CreationOptional<string | null>;
  /** [creadores] Ajustes del editor de video (recorte, música, texto). */
  declare edicion: CreationOptional<EdicionVideo | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare autor?: NonAttribute<Usuario>;
  declare vistas?: NonAttribute<HistoriaVista[]>;

  static initModel(sequelize: Sequelize): typeof Historia {
    Historia.init(
      {
        id: pk(),
        usuario_id: fk(),
        tipo: { type: DataTypes.ENUM(...TIPOS_HISTORIA), allowNull: false },
        media_url: { type: DataTypes.STRING(500), allowNull: true },
        media_s3: { type: DataTypes.STRING(255), allowNull: true },
        texto: { type: DataTypes.STRING(500), allowNull: true },
        fondo: { type: DataTypes.STRING(100), allowNull: true },
        duracion_seg: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 5 },
        total_vistas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        expira_en: { type: DataTypes.DATE, allowNull: false },
        archivada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        media_original_url: { type: DataTypes.STRING(500), allowNull: true },
        edicion: { type: DataTypes.JSON, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'historias'), indexes: [{ fields: ['usuario_id', 'expira_en'] }] },
    );
    return Historia;
  }
}

export class HistoriaVista extends Model<InferAttributes<HistoriaVista>, InferCreationAttributes<HistoriaVista>> {
  declare id: CreationOptional<number>;
  declare historia_id: number;
  /** Quien la vio. */
  declare usuario_id: number;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;
  declare historia?: NonAttribute<Historia>;

  static initModel(sequelize: Sequelize): typeof HistoriaVista {
    HistoriaVista.init(
      { id: pk(), historia_id: fk(), usuario_id: fk(), fecha_creacion: DataTypes.DATE },
      { ...conFechaCreacion(sequelize, 'historias_vistas'), indexes: [{ unique: true, fields: ['historia_id', 'usuario_id'] }] },
    );
    return HistoriaVista;
  }
}
