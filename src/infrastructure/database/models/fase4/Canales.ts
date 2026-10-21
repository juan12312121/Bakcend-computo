/**
 * Fase 4 — canales tipo Telegram, mensajes temporales y reacciones a mensajes.
 * Dueño: agente "canales". Los modelos se registran (initModel + asociaciones) en registrarModelosCanales(),
 * que models/index.ts llama una sola vez después de los modelos base.
 *
 * - Canal: difusión de uno a muchos. Solo sus administradores publican; los suscriptores leen, reaccionan y cuentan vistas.
 * - CanalMiembro: una fila por persona en el canal (propietario, admin o suscriptor), con silencio y última leída.
 * - CanalPublicacion / CanalReaccion / CanalVista: lo publicado, una reacción por persona y una vista por persona.
 * - ReaccionMensajeChat / ReaccionMensajeGrupo: una reacción con emoji por persona y mensaje (chat directo y de grupo).
 * Las columnas de mensajes temporales viven en Chat, MensajeChat, Grupo (Comunidad.ts) y MensajeGrupo (Privacidad.ts).
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
import { conFechaCreacion, conFechas } from '../modelOptions';
import { MensajeChat } from '../Comunidad';
import { MensajeGrupo } from '../Privacidad';
import { Usuario } from '../Usuario';

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

/** Lista corta de emojis para reaccionar a mensajes y publicaciones de canal. */
export const EMOJIS_REACCION = ['❤️', '😂', '😮', '😢', '🙏', '👍', '👎', '🔥'] as const;
export type EmojiReaccion = (typeof EMOJIS_REACCION)[number];

/** publico: aparece en "descubrir" y cualquiera se suscribe · privado: solo con el enlace de invitación. */
export const PRIVACIDADES_CANAL = ['publico', 'privado'] as const;
export type PrivacidadCanal = (typeof PRIVACIDADES_CANAL)[number];

/** propietario: quien lo creó (gestiona administradores) · admin: publica · suscriptor: lee. */
export const ROLES_CANAL = ['propietario', 'admin', 'suscriptor'] as const;
export type RolCanal = (typeof ROLES_CANAL)[number];

export class Canal extends Model<InferAttributes<Canal>, InferCreationAttributes<Canal>> {
  declare id: CreationOptional<number>;
  declare creador_id: number;
  declare nombre: string;
  declare descripcion: CreationOptional<string | null>;
  declare foto_url: CreationOptional<string | null>;
  declare privacidad: CreationOptional<PrivacidadCanal>;
  /** Código del enlace de invitación (/canales/invitacion/:codigo). Se puede regenerar. */
  declare codigo_invitacion: string;
  declare total_suscriptores: CreationOptional<number>;
  declare total_publicaciones: CreationOptional<number>;
  declare ultima_publicacion_en: CreationOptional<Date | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare creador?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof Canal {
    Canal.init(
      {
        id: pk(),
        creador_id: fk(),
        nombre: { type: DataTypes.STRING(100), allowNull: false },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        foto_url: { type: DataTypes.STRING(500), allowNull: true },
        privacidad: { type: DataTypes.ENUM(...PRIVACIDADES_CANAL), allowNull: false, defaultValue: 'publico' },
        codigo_invitacion: { type: DataTypes.STRING(40), allowNull: false, unique: true },
        total_suscriptores: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        total_publicaciones: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ultima_publicacion_en: { type: DataTypes.DATE, allowNull: true },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      { ...conFechas(sequelize, 'canales'), indexes: [{ fields: ['privacidad', 'total_suscriptores'] }, { fields: ['creador_id'] }] },
    );
    return Canal;
  }
}

export class CanalMiembro extends Model<InferAttributes<CanalMiembro>, InferCreationAttributes<CanalMiembro>> {
  declare id: CreationOptional<number>;
  declare canal_id: number;
  declare usuario_id: number;
  declare rol: CreationOptional<RolCanal>;
  /** Silenciado: no recibe notificaciones ni push de las publicaciones nuevas. */
  declare silenciado: CreationOptional<boolean>;
  /** Última publicación que vio (para contar no leídas en "mis canales"). */
  declare ultima_leida_id: CreationOptional<number | null>;
  declare fecha_union: CreationOptional<Date>;
  declare canal?: NonAttribute<Canal>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof CanalMiembro {
    CanalMiembro.init(
      {
        id: pk(),
        canal_id: fk(),
        usuario_id: fk(),
        rol: { type: DataTypes.ENUM(...ROLES_CANAL), allowNull: false, defaultValue: 'suscriptor' },
        silenciado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        ultima_leida_id: { type: DataTypes.INTEGER, allowNull: true },
        fecha_union: DataTypes.DATE,
      },
      {
        ...conFechaCreacion(sequelize, 'canal_miembros', 'fecha_union'),
        indexes: [{ unique: true, fields: ['canal_id', 'usuario_id'] }, { fields: ['usuario_id'] }],
      },
    );
    return CanalMiembro;
  }
}

export class CanalPublicacion extends Model<InferAttributes<CanalPublicacion>, InferCreationAttributes<CanalPublicacion>> {
  declare id: CreationOptional<number>;
  declare canal_id: number;
  declare autor_id: number;
  declare texto: CreationOptional<string>;
  declare archivo_url: CreationOptional<string | null>;
  /** 'image' | 'document' */
  declare tipo_archivo: CreationOptional<string | null>;
  /** Nombre original del documento (para mostrarlo y descargarlo). */
  declare nombre_archivo: CreationOptional<string | null>;
  declare total_vistas: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;
  declare autor?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof CanalPublicacion {
    CanalPublicacion.init(
      {
        id: pk(),
        canal_id: fk(),
        autor_id: fk(),
        texto: { type: DataTypes.TEXT, allowNull: false, defaultValue: '' },
        archivo_url: { type: DataTypes.STRING(500), allowNull: true },
        tipo_archivo: { type: DataTypes.STRING(20), allowNull: true },
        nombre_archivo: { type: DataTypes.STRING(255), allowNull: true },
        total_vistas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'canal_publicaciones'), indexes: [{ fields: ['canal_id', 'id'] }] },
    );
    return CanalPublicacion;
  }
}

export class CanalReaccion extends Model<InferAttributes<CanalReaccion>, InferCreationAttributes<CanalReaccion>> {
  declare id: CreationOptional<number>;
  declare publicacion_id: number;
  declare usuario_id: number;
  declare emoji: EmojiReaccion;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof CanalReaccion {
    CanalReaccion.init(
      {
        id: pk(),
        publicacion_id: fk(),
        usuario_id: fk(),
        emoji: { type: DataTypes.STRING(16), allowNull: false },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'canal_reacciones'), indexes: [{ unique: true, fields: ['publicacion_id', 'usuario_id'] }] },
    );
    return CanalReaccion;
  }
}

/** Una vista por persona y publicación (el contador `total_vistas` solo sube la primera vez). */
export class CanalVista extends Model<InferAttributes<CanalVista>, InferCreationAttributes<CanalVista>> {
  declare id: CreationOptional<number>;
  declare publicacion_id: number;
  declare usuario_id: number;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof CanalVista {
    CanalVista.init(
      { id: pk(), publicacion_id: fk(), usuario_id: fk(), fecha_creacion: DataTypes.DATE },
      { ...conFechaCreacion(sequelize, 'canal_vistas'), indexes: [{ unique: true, fields: ['publicacion_id', 'usuario_id'] }] },
    );
    return CanalVista;
  }
}

/**
 * Reacción a un mensaje (misma forma para chat directo y de grupo). No se inicializa:
 * sus dos tablas son las subclases, así un solo repositorio sirve para ambas.
 */
export class ReaccionMensaje extends Model<InferAttributes<ReaccionMensaje>, InferCreationAttributes<ReaccionMensaje>> {
  declare id: CreationOptional<number>;
  declare mensaje_id: number;
  declare usuario_id: number;
  declare emoji: EmojiReaccion;
  declare fecha_creacion: CreationOptional<Date>;
}

const atributosReaccion = () => ({
  id: pk(),
  mensaje_id: fk(),
  usuario_id: fk(),
  emoji: { type: DataTypes.STRING(16), allowNull: false },
  fecha_creacion: DataTypes.DATE,
});

export class ReaccionMensajeChat extends ReaccionMensaje {
  static initModel(sequelize: Sequelize): typeof ReaccionMensajeChat {
    ReaccionMensajeChat.init(atributosReaccion(), {
      ...conFechaCreacion(sequelize, 'reacciones_mensajes_chat'),
      indexes: [{ unique: true, fields: ['mensaje_id', 'usuario_id'] }],
    });
    return ReaccionMensajeChat;
  }
}

export class ReaccionMensajeGrupo extends ReaccionMensaje {
  static initModel(sequelize: Sequelize): typeof ReaccionMensajeGrupo {
    ReaccionMensajeGrupo.init(atributosReaccion(), {
      ...conFechaCreacion(sequelize, 'reacciones_mensajes_grupo'),
      indexes: [{ unique: true, fields: ['mensaje_id', 'usuario_id'] }],
    });
    return ReaccionMensajeGrupo;
  }
}

export function registrarModelosCanales(sequelize: Sequelize): void {
  [Canal, CanalMiembro, CanalPublicacion, CanalReaccion, CanalVista, ReaccionMensajeChat, ReaccionMensajeGrupo].forEach((m) =>
    m.initModel(sequelize),
  );
  const cascada = { onDelete: 'CASCADE' as const };

  Canal.belongsTo(Usuario, { foreignKey: 'creador_id', as: 'creador', ...cascada });
  Canal.hasMany(CanalMiembro, { foreignKey: 'canal_id', as: 'miembros', ...cascada });
  CanalMiembro.belongsTo(Canal, { foreignKey: 'canal_id', as: 'canal', ...cascada });
  CanalMiembro.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

  Canal.hasMany(CanalPublicacion, { foreignKey: 'canal_id', as: 'publicaciones', ...cascada });
  CanalPublicacion.belongsTo(Canal, { foreignKey: 'canal_id', as: 'canal', ...cascada });
  CanalPublicacion.belongsTo(Usuario, { foreignKey: 'autor_id', as: 'autor', ...cascada });

  CanalPublicacion.hasMany(CanalReaccion, { foreignKey: 'publicacion_id', as: 'reacciones', ...cascada });
  CanalReaccion.belongsTo(CanalPublicacion, { foreignKey: 'publicacion_id', as: 'publicacion', ...cascada });
  CanalReaccion.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

  CanalPublicacion.hasMany(CanalVista, { foreignKey: 'publicacion_id', as: 'vistas', ...cascada });
  CanalVista.belongsTo(CanalPublicacion, { foreignKey: 'publicacion_id', as: 'publicacion', ...cascada });
  CanalVista.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

  // Al borrar el mensaje (a mano, por vencido o con su grupo/chat) se van sus reacciones
  ReaccionMensajeChat.belongsTo(MensajeChat, { foreignKey: 'mensaje_id', as: 'mensaje', ...cascada });
  ReaccionMensajeChat.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
  ReaccionMensajeGrupo.belongsTo(MensajeGrupo, { foreignKey: 'mensaje_id', as: 'mensaje', ...cascada });
  ReaccionMensajeGrupo.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
}
