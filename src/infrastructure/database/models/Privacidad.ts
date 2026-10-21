/**
 * Privacidad y cuenta: usuarios bloqueados, verificación de correo y chat de grupo.
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

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

/** `bloqueador_id` ya no ve a `bloqueado_id` ni este a él (en ningún sentido: feed, perfil, chat, búsqueda). */
export class Bloqueo extends Model<InferAttributes<Bloqueo>, InferCreationAttributes<Bloqueo>> {
  declare id: CreationOptional<number>;
  declare bloqueador_id: number;
  declare bloqueado_id: number;
  declare fecha_creacion: CreationOptional<Date>;
  declare bloqueado?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof Bloqueo {
    Bloqueo.init(
      { id: pk(), bloqueador_id: fk(), bloqueado_id: fk(), fecha_creacion: DataTypes.DATE },
      { ...conFechaCreacion(sequelize, 'bloqueos'), indexes: [{ unique: true, fields: ['bloqueador_id', 'bloqueado_id'] }, { fields: ['bloqueado_id'] }] },
    );
    return Bloqueo;
  }
}

/** Enlace de "verifica tu correo". Igual que en restablecimientos: solo se guarda el hash del token. */
export class VerificacionEmail extends Model<InferAttributes<VerificacionEmail>, InferCreationAttributes<VerificacionEmail>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare token_hash: string;
  declare expira_en: Date;
  declare usado_en: CreationOptional<Date | null>;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof VerificacionEmail {
    VerificacionEmail.init(
      {
        id: pk(),
        usuario_id: fk(),
        token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
        expira_en: { type: DataTypes.DATE, allowNull: false },
        usado_en: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'verificaciones_email'), indexes: [{ fields: ['usuario_id'] }] },
    );
    return VerificacionEmail;
  }
}

/** Mensajes del chat de un grupo (todos los miembros activos lo ven). */
export class MensajeGrupo extends Model<InferAttributes<MensajeGrupo>, InferCreationAttributes<MensajeGrupo>> {
  declare id: CreationOptional<number>;
  declare grupo_id: number;
  declare emisor_id: number;
  declare texto: CreationOptional<string>;
  declare archivo_url: CreationOptional<string | null>;
  /** 'image' | 'document' | 'audio' */
  declare tipo_archivo: CreationOptional<string | null>;
  declare duracion_seg: CreationOptional<number | null>;
  /** [canales] Mensaje temporal: después de esta fecha no se devuelve y la limpieza lo borra. */
  declare expira_en: CreationOptional<Date | null>;
  /** [canales] Aviso del sistema dentro del chat (p. ej. "activó los mensajes temporales"). */
  declare es_aviso: CreationOptional<boolean>;
  declare fecha_creacion: CreationOptional<Date>;
  declare emisor?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof MensajeGrupo {
    MensajeGrupo.init(
      {
        id: pk(),
        grupo_id: fk(),
        emisor_id: fk(),
        texto: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
        archivo_url: { type: DataTypes.STRING(500), allowNull: true },
        tipo_archivo: { type: DataTypes.STRING(20), allowNull: true },
        duracion_seg: { type: DataTypes.INTEGER, allowNull: true },
        expira_en: { type: DataTypes.DATE, allowNull: true },
        es_aviso: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'mensajes_grupo'), indexes: [{ fields: ['grupo_id', 'id'] }] },
    );
    return MensajeGrupo;
  }
}
