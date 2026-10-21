/**
 * Fase 4 — calendario del grupo, tareas con entrega (escuela) y control de horas.
 * Dueño: agente "aula". Define aquí sus modelos (clases con initModel) y registra modelos y asociaciones
 * dentro de registrarModelosAula(), que models/index.ts llama una sola vez después de los modelos base.
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
import { conFechaCreacion, conFechas } from '../modelOptions';
import { Tablero, Tarea } from '../Tableros';
import { Usuario } from '../Usuario';

/** Fábricas: Sequelize muta cada definición, así que no se pueden compartir objetos entre columnas. */
const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

/**
 * Estado guardado de una entrega. "pendiente" no se guarda: es no tener fila (o no haber entregado aún).
 * entregada (a tiempo) · tarde (después de la fecha) · calificada · devuelta (el maestro pide corregir).
 */
export const ESTADOS_ENTREGA = ['entregada', 'tarde', 'calificada', 'devuelta'] as const;
export type EstadoEntrega = (typeof ESTADOS_ENTREGA)[number];

// ---------- Tareas con entrega ----------

/** Tarea con entrega de un grupo (la crea un admin/moderador = "maestro"; la entregan los miembros = "alumnos"). */
export class Asignacion extends Model<InferAttributes<Asignacion>, InferCreationAttributes<Asignacion>> {
  declare id: CreationOptional<number>;
  declare grupo_id: number;
  declare creador_id: number;
  declare titulo: string;
  declare instrucciones: CreationOptional<string | null>;
  /** Archivo de apoyo (Cloudinary). */
  declare archivo_url: CreationOptional<string | null>;
  declare archivo_id: CreationOptional<string | null>;
  declare archivo_nombre: CreationOptional<string | null>;
  declare archivo_tipo: CreationOptional<string | null>;
  declare fecha_entrega: Date;
  declare puntos_maximos: CreationOptional<number>;
  /** ¿Se reciben entregas después de la fecha? (quedan marcadas como tarde). */
  declare acepta_tardias: CreationOptional<boolean>;
  /** Ya se avisó a quienes no han entregado (24 h antes). */
  declare recordatorio_enviado: CreationOptional<boolean>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare creador?: NonAttribute<Usuario>;
  declare grupo?: NonAttribute<Grupo>;

  static initModel(sequelize: Sequelize): typeof Asignacion {
    Asignacion.init(
      {
        id: pk(),
        grupo_id: fk(),
        creador_id: fk(),
        titulo: { type: DataTypes.STRING(200), allowNull: false },
        instrucciones: { type: DataTypes.TEXT, allowNull: true },
        archivo_url: { type: DataTypes.STRING(500), allowNull: true },
        archivo_id: { type: DataTypes.STRING(300), allowNull: true },
        archivo_nombre: { type: DataTypes.STRING(255), allowNull: true },
        archivo_tipo: { type: DataTypes.STRING(120), allowNull: true },
        fecha_entrega: { type: DataTypes.DATE, allowNull: false },
        puntos_maximos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 100 },
        acepta_tardias: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        recordatorio_enviado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      { ...conFechas(sequelize, 'asignaciones'), indexes: [{ fields: ['grupo_id', 'fecha_entrega'] }, { fields: ['fecha_entrega'] }] },
    );
    return Asignacion;
  }
}

/** Entrega de un alumno (una por alumno y asignación; reentregar la actualiza). */
export class Entrega extends Model<InferAttributes<Entrega>, InferCreationAttributes<Entrega>> {
  declare id: CreationOptional<number>;
  declare asignacion_id: number;
  declare alumno_id: number;
  declare estado: CreationOptional<EstadoEntrega>;
  declare comentario: CreationOptional<string | null>;
  declare archivo_url: CreationOptional<string | null>;
  declare archivo_id: CreationOptional<string | null>;
  declare archivo_nombre: CreationOptional<string | null>;
  declare archivo_tipo: CreationOptional<string | null>;
  declare entregada_en: CreationOptional<Date | null>;
  /** La última entrega llegó después de la fecha (se conserva al calificar). */
  declare fue_tarde: CreationOptional<boolean>;
  /** Cuántas veces entregó (1 = primera). */
  declare intentos: CreationOptional<number>;
  declare puntos: CreationOptional<number | null>;
  declare retroalimentacion: CreationOptional<string | null>;
  declare calificada_en: CreationOptional<Date | null>;
  declare calificada_por: CreationOptional<number | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare alumno?: NonAttribute<Usuario>;
  declare asignacion?: NonAttribute<Asignacion>;

  static initModel(sequelize: Sequelize): typeof Entrega {
    Entrega.init(
      {
        id: pk(),
        asignacion_id: fk(),
        alumno_id: fk(),
        estado: { type: DataTypes.ENUM(...ESTADOS_ENTREGA), allowNull: false, defaultValue: 'entregada' },
        comentario: { type: DataTypes.TEXT, allowNull: true },
        archivo_url: { type: DataTypes.STRING(500), allowNull: true },
        archivo_id: { type: DataTypes.STRING(300), allowNull: true },
        archivo_nombre: { type: DataTypes.STRING(255), allowNull: true },
        archivo_tipo: { type: DataTypes.STRING(120), allowNull: true },
        entregada_en: { type: DataTypes.DATE, allowNull: true },
        fue_tarde: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        intentos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
        puntos: { type: DataTypes.DOUBLE, allowNull: true },
        retroalimentacion: { type: DataTypes.TEXT, allowNull: true },
        calificada_en: { type: DataTypes.DATE, allowNull: true },
        calificada_por: { type: DataTypes.INTEGER, allowNull: true },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      { ...conFechas(sequelize, 'entregas'), indexes: [{ unique: true, fields: ['asignacion_id', 'alumno_id'] }, { fields: ['alumno_id'] }] },
    );
    return Entrega;
  }
}

// ---------- Calendario ----------

/** Token secreto por usuario para suscribirse al calendario de sus grupos (Google Calendar, Outlook...). */
export class CalendarioToken extends Model<InferAttributes<CalendarioToken>, InferCreationAttributes<CalendarioToken>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare token: string;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof CalendarioToken {
    CalendarioToken.init(
      {
        id: pk(),
        usuario_id: { type: DataTypes.INTEGER, allowNull: false, unique: true },
        token: { type: DataTypes.STRING(64), allowNull: false, unique: true },
        fecha_creacion: DataTypes.DATE,
      },
      conFechaCreacion(sequelize, 'calendario_tokens'),
    );
    return CalendarioToken;
  }
}

// ---------- Control de horas ----------

/** Tiempo trabajado en una tarea de un tablero: cronómetro (fin null mientras corre) o registro a mano. */
export class RegistroHoras extends Model<InferAttributes<RegistroHoras>, InferCreationAttributes<RegistroHoras>> {
  declare id: CreationOptional<number>;
  declare tarea_id: number;
  /** Copia del tablero de la tarea (para los resúmenes por tablero sin unir tablas). */
  declare tablero_id: number;
  declare usuario_id: number;
  declare inicio: Date;
  /** null = cronómetro corriendo. */
  declare fin: CreationOptional<Date | null>;
  /** Minutos registrados (se calculan al detener; 0 mientras corre). */
  declare minutos: CreationOptional<number>;
  declare nota: CreationOptional<string | null>;
  declare facturable: CreationOptional<boolean>;
  /** = usuario_id mientras el cronómetro corre, null al detenerlo. Índice único: un solo cronómetro activo por persona. */
  declare cronometro_de: CreationOptional<number | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;
  declare tarea?: NonAttribute<Tarea>;

  static initModel(sequelize: Sequelize): typeof RegistroHoras {
    RegistroHoras.init(
      {
        id: pk(),
        tarea_id: fk(),
        tablero_id: fk(),
        usuario_id: fk(),
        inicio: { type: DataTypes.DATE, allowNull: false },
        fin: { type: DataTypes.DATE, allowNull: true },
        minutos: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        nota: { type: DataTypes.STRING(500), allowNull: true },
        facturable: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        cronometro_de: { type: DataTypes.INTEGER, allowNull: true, unique: true },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      {
        ...conFechas(sequelize, 'registros_horas'),
        indexes: [{ fields: ['tarea_id'] }, { fields: ['tablero_id', 'inicio'] }, { fields: ['usuario_id', 'inicio'] }],
      },
    );
    return RegistroHoras;
  }
}

/** Tarifa por hora de un tablero (usuario_id null) o de un miembro en ese tablero (tiene prioridad). En centavos. */
export class TarifaHora extends Model<InferAttributes<TarifaHora>, InferCreationAttributes<TarifaHora>> {
  declare id: CreationOptional<number>;
  declare tablero_id: number;
  declare usuario_id: CreationOptional<number | null>;
  declare tarifa_centavos: number;
  declare moneda: CreationOptional<string>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof TarifaHora {
    TarifaHora.init(
      {
        id: pk(),
        tablero_id: fk(),
        usuario_id: { type: DataTypes.INTEGER, allowNull: true },
        tarifa_centavos: { type: DataTypes.INTEGER, allowNull: false },
        moneda: { type: DataTypes.STRING(3), allowNull: false, defaultValue: 'MXN' },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      { ...conFechas(sequelize, 'tarifas_hora'), indexes: [{ fields: ['tablero_id', 'usuario_id'] }] },
    );
    return TarifaHora;
  }
}

export function registrarModelosAula(sequelize: Sequelize): void {
  [Asignacion, Entrega, CalendarioToken, RegistroHoras, TarifaHora].forEach((modelo) => modelo.initModel(sequelize));
  const cascada = { onDelete: 'CASCADE' as const };

  // Asignaciones y entregas
  Asignacion.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo', ...cascada });
  Grupo.hasMany(Asignacion, { foreignKey: 'grupo_id', as: 'asignaciones' });
  Asignacion.belongsTo(Usuario, { foreignKey: 'creador_id', as: 'creador', ...cascada });
  Asignacion.hasMany(Entrega, { foreignKey: 'asignacion_id', as: 'entregas', ...cascada });
  Entrega.belongsTo(Asignacion, { foreignKey: 'asignacion_id', as: 'asignacion' });
  Entrega.belongsTo(Usuario, { foreignKey: 'alumno_id', as: 'alumno', ...cascada });

  // Calendario
  CalendarioToken.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

  // Horas
  RegistroHoras.belongsTo(Tarea, { foreignKey: 'tarea_id', as: 'tarea', ...cascada });
  Tarea.hasMany(RegistroHoras, { foreignKey: 'tarea_id', as: 'registrosHoras' });
  RegistroHoras.belongsTo(Tablero, { foreignKey: 'tablero_id', as: 'tablero', ...cascada });
  RegistroHoras.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
  TarifaHora.belongsTo(Tablero, { foreignKey: 'tablero_id', as: 'tablero', ...cascada });
  TarifaHora.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
}
