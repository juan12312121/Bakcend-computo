/** Relaciones entre usuarios: seguidores y notificaciones. */
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
import type { Publicacion } from './Publicacion';

/** Fábricas: Sequelize muta cada definición, así que no se pueden compartir objetos entre columnas. */
const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

export const ESTADOS_SEGUIMIENTO = ['aceptado', 'pendiente'] as const;
export type EstadoSeguimiento = (typeof ESTADOS_SEGUIMIENTO)[number];

export class Seguidor extends Model<InferAttributes<Seguidor>, InferCreationAttributes<Seguidor>> {
  declare id: CreationOptional<number>;
  /** Quien sigue. */
  declare seguidor_id: number;
  /** A quien sigue. */
  declare siguiendo_id: number;
  /** 'pendiente' cuando la cuenta seguida es privada y aún no aprueba. */
  declare estado: CreationOptional<EstadoSeguimiento>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuarioSeguidor?: NonAttribute<Usuario>;
  declare usuarioSeguido?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof Seguidor {
    Seguidor.init(
      {
        id: pk(),
        seguidor_id: fk(),
        siguiendo_id: fk(),
        estado: { type: DataTypes.ENUM(...ESTADOS_SEGUIMIENTO), allowNull: false, defaultValue: 'aceptado' },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'seguidores'), indexes: [{ unique: true, fields: ['seguidor_id', 'siguiendo_id'] }] },
    );
    return Seguidor;
  }
}

export const TIPOS_NOTIFICACION = [
  'like',
  'comment',
  'follow',
  'share',
  'invitacion_grupo',
  // Fase 3
  'reaccion',
  'respuesta_comentario',
  'like_comentario',
  'mencion',
  'solicitud_seguimiento',
  'seguimiento_aceptado',
  'tarea_asignada',
  'tarea_comentario',
  'tarea_movida',
  'tarea_vence',
  'evento_invitacion',
  'evento_recordatorio',
  'evento_actualizado',
  'evento_cancelado',
  // Fase 4
  'llamada_perdida',
  'transmision_en_vivo',
  'canal_publicacion',
  'documento_compartido',
  'archivo_subido',
  'asignacion_nueva',
  'entrega_recibida',
  'entrega_calificada',
  'boleto_comprado',
  'boleto_usado',
  'anuncio_interes',
  'anuncio_vendido',
  'publicacion_programada',
  'reporte_resuelto',
] as const;

/** A qué apunta una notificación que no es de una publicación (tarea, evento, grupo...). */
export const ENTIDADES_NOTIFICACION = [
  'publicacion',
  'comentario',
  'tablero',
  'tarea',
  'evento',
  'grupo',
  'usuario',
  'transmision',
  'canal',
  'documento',
  'archivo',
  'asignacion',
  'boleto',
  'anuncio',
] as const;
export type EntidadNotificacion = (typeof ENTIDADES_NOTIFICACION)[number];
export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];

export class Notificacion extends Model<InferAttributes<Notificacion>, InferCreationAttributes<Notificacion>> {
  declare id: CreationOptional<number>;
  /** Destinatario. */
  declare usuario_id: number;
  /** Quien la provocó. */
  declare de_usuario_id: CreationOptional<number | null>;
  declare tipo: TipoNotificacion;
  declare publicacion_id: CreationOptional<number | null>;
  declare mensaje: CreationOptional<string | null>;
  declare entidad_tipo: CreationOptional<EntidadNotificacion | null>;
  declare entidad_id: CreationOptional<number | null>;
  declare leida: CreationOptional<boolean>;
  declare fecha_creacion: CreationOptional<Date>;
  declare emisor?: NonAttribute<Usuario>;
  declare publicacion?: NonAttribute<Publicacion>;

  static initModel(sequelize: Sequelize): typeof Notificacion {
    Notificacion.init(
      {
        id: pk(),
        usuario_id: fk(),
        de_usuario_id: { type: DataTypes.INTEGER, allowNull: true },
        tipo: { type: DataTypes.ENUM(...TIPOS_NOTIFICACION), allowNull: false },
        publicacion_id: { type: DataTypes.INTEGER, allowNull: true },
        mensaje: { type: DataTypes.TEXT, allowNull: true },
        entidad_tipo: { type: DataTypes.ENUM(...ENTIDADES_NOTIFICACION), allowNull: true },
        entidad_id: { type: DataTypes.INTEGER, allowNull: true },
        leida: { type: DataTypes.BOOLEAN, defaultValue: false },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'notificaciones'),
    );
    return Notificacion;
  }
}
