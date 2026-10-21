/**
 * Teléfonos (y navegadores) donde el usuario recibe notificaciones push.
 * Un mismo token solo pertenece a un usuario: si otra persona inicia sesión en ese teléfono, el token cambia de dueño.
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
import { conFechas } from './modelOptions';
import type { Usuario } from './Usuario';

export const PLATAFORMAS_DISPOSITIVO = ['android', 'ios', 'web'] as const;
export type PlataformaDispositivo = (typeof PLATAFORMAS_DISPOSITIVO)[number];

export class Dispositivo extends Model<InferAttributes<Dispositivo>, InferCreationAttributes<Dispositivo>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  /** Token de Firebase Cloud Messaging del dispositivo. */
  declare token: string;
  declare plataforma: PlataformaDispositivo;
  declare fecha_creacion: CreationOptional<Date>;
  /** Última vez que la app confirmó el token (al abrir sesión). */
  declare fecha_actualizacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof Dispositivo {
    Dispositivo.init(
      {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        usuario_id: { type: DataTypes.INTEGER, allowNull: false },
        token: { type: DataTypes.STRING(400), allowNull: false, unique: true },
        plataforma: { type: DataTypes.ENUM(...PLATAFORMAS_DISPOSITIVO), allowNull: false, defaultValue: 'android' },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      { ...conFechas(sequelize, 'dispositivos'), indexes: [{ fields: ['usuario_id'] }] },
    );
    return Dispositivo;
  }
}
