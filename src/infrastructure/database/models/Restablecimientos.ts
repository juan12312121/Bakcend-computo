/**
 * Solicitudes para restablecer la contraseña ("olvidé mi contraseña").
 * Solo se guarda el hash SHA-256 del token: quien lea la tabla no puede usar los enlaces.
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

/** Fábricas: Sequelize muta cada definición, así que no se pueden compartir objetos entre columnas. */
const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

export class RestablecimientoContrasena extends Model<
  InferAttributes<RestablecimientoContrasena>,
  InferCreationAttributes<RestablecimientoContrasena>
> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  /** sha256 (hex) del token que viaja en el enlace; el token en claro nunca se guarda. */
  declare token_hash: string;
  declare expira_en: Date;
  declare usado_en: CreationOptional<Date | null>;
  declare ip: CreationOptional<string | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof RestablecimientoContrasena {
    RestablecimientoContrasena.init(
      {
        id: pk(),
        usuario_id: fk(),
        token_hash: { type: DataTypes.STRING(64), allowNull: false, unique: true },
        expira_en: { type: DataTypes.DATE, allowNull: false },
        usado_en: { type: DataTypes.DATE, allowNull: true, defaultValue: null },
        ip: { type: DataTypes.STRING(45), allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      {
        ...conFechaCreacion(sequelize, 'restablecimientos_contrasena'),
        indexes: [{ fields: ['usuario_id', 'fecha_creacion'] }],
      },
    );
    return RestablecimientoContrasena;
  }
}
