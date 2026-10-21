/**
 * Fase 4 — videollamadas 1 a 1 y en grupo, y transmisiones en vivo.
 * Dueño: agente "llamadas". El audio y el video viajan por WebRTC entre los teléfonos (malla); aquí solo se guarda
 * el registro: quién llamó, a quién o a qué grupo, cómo terminó y cuánto duró; y las transmisiones con sus comentarios.
 * Importa los modelos existentes desde su archivo (p. ej. '../Usuario'), nunca desde '../index'.
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
import { conFechaCreacion } from '../modelOptions';
import { Usuario } from '../Usuario';

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });
const cascada = { onDelete: 'CASCADE' as const };

// ---------- Llamadas ----------

export const TIPOS_LLAMADA = ['audio', 'video'] as const;
export type TipoLlamada = (typeof TIPOS_LLAMADA)[number];

/** sonando → en_curso → terminada · sonando → perdida (nadie contestó / colgó antes) · sonando → rechazada. */
export const ESTADOS_LLAMADA = ['sonando', 'en_curso', 'terminada', 'perdida', 'rechazada'] as const;
export type EstadoLlamada = (typeof ESTADOS_LLAMADA)[number];

/** Cómo le fue a cada persona en la llamada. */
export const ESTADOS_PARTICIPANTE = ['invitado', 'unido', 'salio', 'rechazo', 'perdida'] as const;
export type EstadoParticipante = (typeof ESTADOS_PARTICIPANTE)[number];

export class Llamada extends Model<InferAttributes<Llamada>, InferCreationAttributes<Llamada>> {
  declare id: CreationOptional<number>;
  /** Quien llamó. */
  declare iniciador_id: number;
  /** Llamada 1 a 1: a quién. */
  declare destinatario_id: CreationOptional<number | null>;
  /** Llamada de grupo: a qué grupo. */
  declare grupo_id: CreationOptional<number | null>;
  declare tipo: CreationOptional<TipoLlamada>;
  declare estado: CreationOptional<EstadoLlamada>;
  /** Cuando contestó la primera persona (null si nunca se contestó). */
  declare inicio: CreationOptional<Date | null>;
  declare fin: CreationOptional<Date | null>;
  /** Segundos entre `inicio` y `fin`. */
  declare duracion_seg: CreationOptional<number>;
  /** Cuántas personas llegaron a estar dentro (contando a quien llamó). */
  declare max_participantes: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;
  declare iniciador?: NonAttribute<Usuario>;
  declare destinatario?: NonAttribute<Usuario | null>;
  declare grupo?: NonAttribute<Grupo | null>;
  declare participantes?: NonAttribute<LlamadaParticipante[]>;

  static initModel(sequelize: Sequelize): typeof Llamada {
    Llamada.init(
      {
        id: pk(),
        iniciador_id: fk(),
        destinatario_id: { type: DataTypes.INTEGER, allowNull: true },
        grupo_id: { type: DataTypes.INTEGER, allowNull: true },
        tipo: { type: DataTypes.ENUM(...TIPOS_LLAMADA), allowNull: false, defaultValue: 'audio' },
        estado: { type: DataTypes.ENUM(...ESTADOS_LLAMADA), allowNull: false, defaultValue: 'sonando' },
        inicio: { type: DataTypes.DATE, allowNull: true },
        fin: { type: DataTypes.DATE, allowNull: true },
        duracion_seg: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        max_participantes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        fecha_creacion: DataTypes.DATE,
      },
      {
        ...conFechaCreacion(sequelize, 'llamadas'),
        indexes: [{ fields: ['iniciador_id'] }, { fields: ['destinatario_id'] }, { fields: ['grupo_id'] }, { fields: ['estado'] }],
      },
    );
    return Llamada;
  }
}

/** Una fila por persona en la llamada (quien llamó incluido): sirve para el historial de cada quien. */
export class LlamadaParticipante extends Model<InferAttributes<LlamadaParticipante>, InferCreationAttributes<LlamadaParticipante>> {
  declare id: CreationOptional<number>;
  declare llamada_id: number;
  declare usuario_id: number;
  declare estado: CreationOptional<EstadoParticipante>;
  declare unido_en: CreationOptional<Date | null>;
  declare salio_en: CreationOptional<Date | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;
  declare llamada?: NonAttribute<Llamada>;

  static initModel(sequelize: Sequelize): typeof LlamadaParticipante {
    LlamadaParticipante.init(
      {
        id: pk(),
        llamada_id: fk(),
        usuario_id: fk(),
        estado: { type: DataTypes.ENUM(...ESTADOS_PARTICIPANTE), allowNull: false, defaultValue: 'invitado' },
        unido_en: { type: DataTypes.DATE, allowNull: true },
        salio_en: { type: DataTypes.DATE, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      {
        ...conFechaCreacion(sequelize, 'llamada_participantes'),
        indexes: [{ unique: true, fields: ['llamada_id', 'usuario_id'] }, { fields: ['usuario_id'] }],
      },
    );
    return LlamadaParticipante;
  }
}

// ---------- Transmisiones en vivo ----------

export const ESTADOS_TRANSMISION = ['en_vivo', 'terminada'] as const;
export type EstadoTransmision = (typeof ESTADOS_TRANSMISION)[number];

export class Transmision extends Model<InferAttributes<Transmision>, InferCreationAttributes<Transmision>> {
  declare id: CreationOptional<number>;
  declare anfitrion_id: number;
  declare titulo: string;
  /** Transmisión para los miembros de un grupo (null = para mis seguidores / pública). */
  declare grupo_id: CreationOptional<number | null>;
  declare estado: CreationOptional<EstadoTransmision>;
  declare inicio: Date;
  declare fin: CreationOptional<Date | null>;
  /** Pico de espectadores conectados al mismo tiempo. */
  declare max_espectadores: CreationOptional<number>;
  /** Personas distintas que entraron a verla. */
  declare total_espectadores: CreationOptional<number>;
  declare total_comentarios: CreationOptional<number>;
  declare total_reacciones: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;
  declare anfitrion?: NonAttribute<Usuario>;
  declare grupo?: NonAttribute<Grupo | null>;

  static initModel(sequelize: Sequelize): typeof Transmision {
    Transmision.init(
      {
        id: pk(),
        anfitrion_id: fk(),
        titulo: { type: DataTypes.STRING(150), allowNull: false },
        grupo_id: { type: DataTypes.INTEGER, allowNull: true },
        estado: { type: DataTypes.ENUM(...ESTADOS_TRANSMISION), allowNull: false, defaultValue: 'en_vivo' },
        inicio: { type: DataTypes.DATE, allowNull: false },
        fin: { type: DataTypes.DATE, allowNull: true },
        max_espectadores: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        total_espectadores: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        total_comentarios: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        total_reacciones: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        fecha_creacion: DataTypes.DATE,
      },
      {
        ...conFechaCreacion(sequelize, 'transmisiones'),
        indexes: [{ fields: ['anfitrion_id'] }, { fields: ['grupo_id'] }, { fields: ['estado'] }],
      },
    );
    return Transmision;
  }
}

/** Comentarios que se escriben durante la transmisión (se guardan para verlos al entrar tarde). */
export class TransmisionComentario extends Model<InferAttributes<TransmisionComentario>, InferCreationAttributes<TransmisionComentario>> {
  declare id: CreationOptional<number>;
  declare transmision_id: number;
  declare usuario_id: number;
  declare texto: string;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof TransmisionComentario {
    TransmisionComentario.init(
      {
        id: pk(),
        transmision_id: fk(),
        usuario_id: fk(),
        texto: { type: DataTypes.STRING(300), allowNull: false },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'transmision_comentarios'), indexes: [{ fields: ['transmision_id', 'id'] }] },
    );
    return TransmisionComentario;
  }
}

export function registrarModelosLlamadas(sequelize: Sequelize): void {
  [Llamada, LlamadaParticipante, Transmision, TransmisionComentario].forEach((modelo) => modelo.initModel(sequelize));

  // Llamadas
  Llamada.belongsTo(Usuario, { foreignKey: 'iniciador_id', as: 'iniciador', ...cascada });
  Llamada.belongsTo(Usuario, { foreignKey: 'destinatario_id', as: 'destinatario', ...cascada });
  Llamada.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo', ...cascada });
  Llamada.hasMany(LlamadaParticipante, { foreignKey: 'llamada_id', as: 'participantes', ...cascada });
  LlamadaParticipante.belongsTo(Llamada, { foreignKey: 'llamada_id', as: 'llamada' });
  LlamadaParticipante.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

  // Transmisiones
  Transmision.belongsTo(Usuario, { foreignKey: 'anfitrion_id', as: 'anfitrion', ...cascada });
  Transmision.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo', ...cascada });
  Transmision.hasMany(TransmisionComentario, { foreignKey: 'transmision_id', as: 'comentarios', ...cascada });
  TransmisionComentario.belongsTo(Transmision, { foreignKey: 'transmision_id', as: 'transmision' });
  TransmisionComentario.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
}
