/**
 * Eventos (reuniones, clases, fiestas, juntas de trabajo, torneos...): con fecha, lugar o enlace,
 * asistentes ("voy" / "me interesa") e invitaciones. Pueden ser de un grupo o abiertos.
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
import { conFechaCreacion, conFechas } from './modelOptions';
import type { Usuario } from './Usuario';

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

export const MODALIDADES_EVENTO = ['presencial', 'en_linea', 'hibrido'] as const;
export type ModalidadEvento = (typeof MODALIDADES_EVENTO)[number];

export const CATEGORIAS_EVENTO = ['social', 'trabajo', 'escuela', 'deporte', 'cultura', 'tecnologia', 'otro'] as const;
export type CategoriaEvento = (typeof CATEGORIAS_EVENTO)[number];

/** publico: cualquiera · seguidores: quien sigue al creador · grupo: miembros del grupo · privado: solo invitados. */
export const VISIBILIDADES_EVENTO = ['publico', 'seguidores', 'grupo', 'privado'] as const;
export type VisibilidadEvento = (typeof VISIBILIDADES_EVENTO)[number];

export const ESTADOS_ASISTENCIA = ['voy', 'interesado', 'no_voy', 'invitado'] as const;
export type EstadoAsistencia = (typeof ESTADOS_ASISTENCIA)[number];

export class Evento extends Model<InferAttributes<Evento>, InferCreationAttributes<Evento>> {
  declare id: CreationOptional<number>;
  declare creador_id: number;
  declare grupo_id: CreationOptional<number | null>;
  declare titulo: string;
  declare descripcion: CreationOptional<string | null>;
  declare modalidad: CreationOptional<ModalidadEvento>;
  declare categoria: CreationOptional<CategoriaEvento>;
  declare visibilidad: CreationOptional<VisibilidadEvento>;
  declare lugar: CreationOptional<string | null>;
  /** Enlace de la videollamada (en línea / híbrido). */
  declare enlace: CreationOptional<string | null>;
  declare inicio: Date;
  declare fin: CreationOptional<Date | null>;
  declare portada_url: CreationOptional<string | null>;
  declare portada_s3: CreationOptional<string | null>;
  /** Máximo de asistentes con "voy"; null = sin límite. */
  declare cupo: CreationOptional<number | null>;
  declare total_asistentes: CreationOptional<number>;
  declare total_interesados: CreationOptional<number>;
  declare cancelado: CreationOptional<boolean>;
  /** Ya se mandó el recordatorio de "empieza pronto". */
  declare recordatorio_enviado: CreationOptional<boolean>;
  /** [boletos] Con true, "voy" exige tener un boleto válido (módulo boletos). */
  declare requiere_boleto: CreationOptional<boolean>;
  /** [boletos] Moneda de los boletos (ISO 4217, p. ej. MXN). */
  declare moneda: CreationOptional<string>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare creador?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof Evento {
    Evento.init(
      {
        id: pk(),
        creador_id: fk(),
        grupo_id: { type: DataTypes.INTEGER, allowNull: true },
        titulo: { type: DataTypes.STRING(150), allowNull: false },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        modalidad: { type: DataTypes.ENUM(...MODALIDADES_EVENTO), allowNull: false, defaultValue: 'presencial' },
        categoria: { type: DataTypes.ENUM(...CATEGORIAS_EVENTO), allowNull: false, defaultValue: 'social' },
        visibilidad: { type: DataTypes.ENUM(...VISIBILIDADES_EVENTO), allowNull: false, defaultValue: 'publico' },
        lugar: { type: DataTypes.STRING(200), allowNull: true },
        enlace: { type: DataTypes.STRING(500), allowNull: true },
        inicio: { type: DataTypes.DATE, allowNull: false },
        fin: { type: DataTypes.DATE, allowNull: true },
        portada_url: { type: DataTypes.STRING(500), allowNull: true },
        portada_s3: { type: DataTypes.STRING(300), allowNull: true },
        cupo: { type: DataTypes.INTEGER, allowNull: true },
        total_asistentes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        total_interesados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        cancelado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        recordatorio_enviado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        requiere_boleto: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        moneda: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'MXN' },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      { ...conFechas(sequelize, 'eventos'), indexes: [{ fields: ['inicio'] }, { fields: ['grupo_id'] }, { fields: ['creador_id'] }] },
    );
    return Evento;
  }
}

export class EventoAsistente extends Model<InferAttributes<EventoAsistente>, InferCreationAttributes<EventoAsistente>> {
  declare id: CreationOptional<number>;
  declare evento_id: number;
  declare usuario_id: number;
  declare estado: CreationOptional<EstadoAsistencia>;
  /** Quién lo invitó (si llegó por invitación). */
  declare invitado_por: CreationOptional<number | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;
  declare evento?: NonAttribute<Evento>;

  static initModel(sequelize: Sequelize): typeof EventoAsistente {
    EventoAsistente.init(
      {
        id: pk(),
        evento_id: fk(),
        usuario_id: fk(),
        estado: { type: DataTypes.ENUM(...ESTADOS_ASISTENCIA), allowNull: false, defaultValue: 'voy' },
        invitado_por: { type: DataTypes.INTEGER, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'evento_asistentes'), indexes: [{ unique: true, fields: ['evento_id', 'usuario_id'] }] },
    );
    return EventoAsistente;
  }
}
