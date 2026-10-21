/** Grupos, chat privado y bitácora de seguridad. */
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

/** Fábricas: Sequelize muta cada definición, así que no se pueden compartir objetos entre columnas. */
const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

export type Privacidad = 'publico' | 'privado';

export const TIPOS_GRUPO = ['comunidad', 'escuela', 'trabajo', 'ocio', 'eventos'] as const;
export type TipoGrupo = (typeof TIPOS_GRUPO)[number];

/** [canales] Mensajes temporales de un chat directo o de grupo: los nuevos vencen a las 24 h o a los 7 días. */
export const MENSAJES_TEMPORALES = ['apagado', '24h', '7d'] as const;
export type MensajesTemporales = (typeof MENSAJES_TEMPORALES)[number];

export class Grupo extends Model<InferAttributes<Grupo>, InferCreationAttributes<Grupo>> {
  declare id: CreationOptional<number>;
  declare nombre: string;
  declare descripcion: CreationOptional<string | null>;
  declare imagen_url: CreationOptional<string | null>;
  declare imagen_portada_url: CreationOptional<string | null>;
  declare creador_id: number;
  declare privacidad: CreationOptional<Privacidad>;
  declare req_aprobacion: CreationOptional<boolean>;
  /** Para qué es el grupo: escuela, trabajo, ocio, eventos o comunidad en general. */
  declare tipo: CreationOptional<TipoGrupo>;
  /** [canales] Mensajes temporales del chat del grupo. */
  declare mensajes_temporales: CreationOptional<MensajesTemporales>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare creador?: NonAttribute<Usuario>;
  declare miembros?: NonAttribute<GrupoMiembro[]>;

  static initModel(sequelize: Sequelize): typeof Grupo {
    Grupo.init(
      {
        id: pk(),
        nombre: { type: DataTypes.STRING(100), allowNull: false },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        imagen_url: { type: DataTypes.STRING(500), allowNull: true },
        imagen_portada_url: { type: DataTypes.STRING(500), allowNull: true },
        creador_id: fk(),
        privacidad: { type: DataTypes.ENUM('publico', 'privado'), defaultValue: 'publico' },
        req_aprobacion: { type: DataTypes.BOOLEAN, defaultValue: false },
        tipo: { type: DataTypes.ENUM(...TIPOS_GRUPO), allowNull: false, defaultValue: 'comunidad' },
        mensajes_temporales: { type: DataTypes.ENUM(...MENSAJES_TEMPORALES), allowNull: false, defaultValue: 'apagado' },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      conFechas(sequelize, 'grupos'),
    );
    return Grupo;
  }
}

export type RolGrupo = 'miembro' | 'admin' | 'moderador';
export type EstadoMiembro = 'pendiente' | 'activo' | 'rechazado';

export class GrupoMiembro extends Model<InferAttributes<GrupoMiembro>, InferCreationAttributes<GrupoMiembro>> {
  declare id: CreationOptional<number>;
  declare grupo_id: number;
  declare usuario_id: number;
  declare rol: CreationOptional<RolGrupo>;
  declare estado: CreationOptional<EstadoMiembro>;
  /** Último mensaje del chat del grupo que vio (para contar no leídos). */
  declare ultimo_mensaje_leido_id: CreationOptional<number | null>;
  declare fecha_union: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;
  declare grupo?: NonAttribute<Grupo>;

  static initModel(sequelize: Sequelize): typeof GrupoMiembro {
    GrupoMiembro.init(
      {
        id: pk(),
        grupo_id: fk(),
        usuario_id: fk(),
        rol: { type: DataTypes.ENUM('miembro', 'admin', 'moderador'), defaultValue: 'miembro' },
        estado: { type: DataTypes.ENUM('pendiente', 'activo', 'rechazado'), defaultValue: 'activo' },
        ultimo_mensaje_leido_id: { type: DataTypes.INTEGER, allowNull: true },
        fecha_union: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'grupo_miembros', 'fecha_union'), indexes: [{ unique: true, fields: ['grupo_id', 'usuario_id'] }] },
    );
    return GrupoMiembro;
  }
}

export type EstadoInvitacion = 'pendiente' | 'aceptada' | 'rechazada';

export class GrupoInvitacion extends Model<InferAttributes<GrupoInvitacion>, InferCreationAttributes<GrupoInvitacion>> {
  declare id: CreationOptional<number>;
  declare grupo_id: number;
  declare remitente_id: number;
  declare invitado_id: number;
  declare estado: CreationOptional<EstadoInvitacion>;
  declare fecha_creacion: CreationOptional<Date>;
  declare grupo?: NonAttribute<Grupo>;
  declare remitente?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof GrupoInvitacion {
    GrupoInvitacion.init(
      {
        id: pk(),
        grupo_id: fk(),
        remitente_id: fk(),
        invitado_id: fk(),
        estado: { type: DataTypes.ENUM('pendiente', 'aceptada', 'rechazada'), defaultValue: 'pendiente' },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'grupo_invitaciones'),
    );
    return GrupoInvitacion;
  }
}

export type EstadoChat = 'pending' | 'accepted' | 'rejected';

export class Chat extends Model<InferAttributes<Chat>, InferCreationAttributes<Chat>> {
  declare id: CreationOptional<number>;
  declare usuario1_id: number;
  declare usuario2_id: number;
  /** Quien abrió el chat: el otro es quien acepta la solicitud. Nulo en chats anteriores a esta columna. */
  declare iniciador_id: CreationOptional<number | null>;
  declare estado: CreationOptional<EstadoChat>;
  declare ultima_interaccion: CreationOptional<Date>;
  /** [canales] Mensajes temporales del chat. */
  declare mensajes_temporales: CreationOptional<MensajesTemporales>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario1?: NonAttribute<Usuario>;
  declare usuario2?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof Chat {
    Chat.init(
      {
        id: pk(),
        usuario1_id: fk(),
        usuario2_id: fk(),
        iniciador_id: { type: DataTypes.INTEGER, allowNull: true },
        estado: { type: DataTypes.ENUM('pending', 'accepted', 'rejected'), defaultValue: 'pending' },
        ultima_interaccion: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
        mensajes_temporales: { type: DataTypes.ENUM(...MENSAJES_TEMPORALES), allowNull: false, defaultValue: 'apagado' },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'chats'), indexes: [{ unique: true, fields: ['usuario1_id', 'usuario2_id'] }] },
    );
    return Chat;
  }
}

export class MensajeChat extends Model<InferAttributes<MensajeChat>, InferCreationAttributes<MensajeChat>> {
  declare id: CreationOptional<number>;
  declare chat_id: number;
  declare emisor_id: number;
  declare texto: CreationOptional<string>;
  declare leido: CreationOptional<boolean>;
  declare archivo_url: CreationOptional<string | null>;
  declare tipo_archivo: CreationOptional<string | null>;
  /** Cuándo lo leyó el receptor (palomitas azules). */
  declare leido_en: CreationOptional<Date | null>;
  /** Notas de voz: segundos de audio. */
  declare duracion_seg: CreationOptional<number | null>;
  /** [canales] Mensaje temporal: después de esta fecha no se devuelve y la limpieza lo borra. */
  declare expira_en: CreationOptional<Date | null>;
  /** [canales] Aviso del sistema dentro del chat (p. ej. "activó los mensajes temporales"). */
  declare es_aviso: CreationOptional<boolean>;
  declare fecha_creacion: CreationOptional<Date>;
  declare emisor?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof MensajeChat {
    MensajeChat.init(
      {
        id: pk(),
        chat_id: fk(),
        emisor_id: fk(),
        texto: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
        leido: { type: DataTypes.BOOLEAN, defaultValue: false },
        archivo_url: { type: DataTypes.STRING(500), allowNull: true },
        tipo_archivo: { type: DataTypes.STRING(20), allowNull: true },
        leido_en: { type: DataTypes.DATE, allowNull: true },
        duracion_seg: { type: DataTypes.INTEGER, allowNull: true },
        expira_en: { type: DataTypes.DATE, allowNull: true },
        es_aviso: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'mensajes_chat'),
    );
    return MensajeChat;
  }
}

export class LogSeguridad extends Model<InferAttributes<LogSeguridad>, InferCreationAttributes<LogSeguridad>> {
  declare id: CreationOptional<number>;
  declare usuario_id: CreationOptional<number | null>;
  declare evento: string;
  declare detalles: CreationOptional<string | null>;
  declare ip: CreationOptional<string | null>;
  declare user_agent: CreationOptional<string | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof LogSeguridad {
    LogSeguridad.init(
      {
        id: pk(),
        usuario_id: { type: DataTypes.INTEGER, allowNull: true },
        evento: { type: DataTypes.STRING(100), allowNull: false },
        detalles: { type: DataTypes.TEXT, allowNull: true },
        ip: { type: DataTypes.STRING(45), allowNull: true },
        user_agent: { type: DataTypes.TEXT, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'logs_seguridad'),
    );
    return LogSeguridad;
  }
}
