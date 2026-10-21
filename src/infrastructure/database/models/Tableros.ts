/**
 * Tableros de trabajo tipo Trello / Jira: columnas (Kanban), tareas con tipo, prioridad, puntos y responsables,
 * sprints, etiquetas, checklist, comentarios e historial. Un tablero puede ser personal o de un grupo.
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

/** Fábricas: Sequelize muta cada definición, así que no se pueden compartir objetos entre columnas. */
const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

export const ROLES_TABLERO = ['admin', 'miembro', 'observador'] as const;
export type RolTablero = (typeof ROLES_TABLERO)[number];

export const TIPOS_TAREA = ['tarea', 'historia', 'bug', 'epica'] as const;
export type TipoTarea = (typeof TIPOS_TAREA)[number];

export const PRIORIDADES_TAREA = ['baja', 'media', 'alta', 'urgente'] as const;
export type PrioridadTarea = (typeof PRIORIDADES_TAREA)[number];

export const ESTADOS_SPRINT = ['planeado', 'activo', 'cerrado'] as const;
export type EstadoSprint = (typeof ESTADOS_SPRINT)[number];

export class Tablero extends Model<InferAttributes<Tablero>, InferCreationAttributes<Tablero>> {
  declare id: CreationOptional<number>;
  declare nombre: string;
  declare descripcion: CreationOptional<string | null>;
  /** Grupo dueño (sus miembros pueden entrar); null = tablero personal con miembros invitados. */
  declare grupo_id: CreationOptional<number | null>;
  declare creador_id: number;
  /** Prefijo de las tareas, estilo Jira: "TRI" → TRI-1, TRI-2... */
  declare clave: string;
  /** Color de fondo (clase de gradiente del frontend). */
  declare color: CreationOptional<string>;
  /** Cuántas tareas se han creado (para numerarlas sin huecos). */
  declare contador_tareas: CreationOptional<number>;
  declare archivado: CreationOptional<boolean>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare creador?: NonAttribute<Usuario>;
  declare columnas?: NonAttribute<TableroColumna[]>;
  declare miembros?: NonAttribute<TableroMiembro[]>;

  static initModel(sequelize: Sequelize): typeof Tablero {
    Tablero.init(
      {
        id: pk(),
        nombre: { type: DataTypes.STRING(100), allowNull: false },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        grupo_id: { type: DataTypes.INTEGER, allowNull: true },
        creador_id: fk(),
        clave: { type: DataTypes.STRING(10), allowNull: false },
        color: { type: DataTypes.STRING(60), allowNull: false, defaultValue: 'from-orange-400 to-orange-600' },
        contador_tareas: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        archivado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      { ...conFechas(sequelize, 'tableros'), indexes: [{ fields: ['grupo_id'] }] },
    );
    return Tablero;
  }
}

export class TableroMiembro extends Model<InferAttributes<TableroMiembro>, InferCreationAttributes<TableroMiembro>> {
  declare id: CreationOptional<number>;
  declare tablero_id: number;
  declare usuario_id: number;
  declare rol: CreationOptional<RolTablero>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof TableroMiembro {
    TableroMiembro.init(
      {
        id: pk(),
        tablero_id: fk(),
        usuario_id: fk(),
        rol: { type: DataTypes.ENUM(...ROLES_TABLERO), allowNull: false, defaultValue: 'miembro' },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'tablero_miembros'), indexes: [{ unique: true, fields: ['tablero_id', 'usuario_id'] }] },
    );
    return TableroMiembro;
  }
}

export class TableroColumna extends Model<InferAttributes<TableroColumna>, InferCreationAttributes<TableroColumna>> {
  declare id: CreationOptional<number>;
  declare tablero_id: number;
  declare nombre: string;
  declare posicion: number;
  /** Máximo de tareas (WIP); null = sin límite. */
  declare limite_wip: CreationOptional<number | null>;
  /** Las tareas que llegan aquí cuentan como terminadas. */
  declare es_final: CreationOptional<boolean>;
  declare fecha_creacion: CreationOptional<Date>;
  declare tareas?: NonAttribute<Tarea[]>;

  static initModel(sequelize: Sequelize): typeof TableroColumna {
    TableroColumna.init(
      {
        id: pk(),
        tablero_id: fk(),
        nombre: { type: DataTypes.STRING(60), allowNull: false },
        posicion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        limite_wip: { type: DataTypes.INTEGER, allowNull: true },
        es_final: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'tablero_columnas'), indexes: [{ fields: ['tablero_id', 'posicion'] }] },
    );
    return TableroColumna;
  }
}

export class Sprint extends Model<InferAttributes<Sprint>, InferCreationAttributes<Sprint>> {
  declare id: CreationOptional<number>;
  declare tablero_id: number;
  declare nombre: string;
  declare objetivo: CreationOptional<string | null>;
  declare inicio: CreationOptional<Date | null>;
  declare fin: CreationOptional<Date | null>;
  declare estado: CreationOptional<EstadoSprint>;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof Sprint {
    Sprint.init(
      {
        id: pk(),
        tablero_id: fk(),
        nombre: { type: DataTypes.STRING(80), allowNull: false },
        objetivo: { type: DataTypes.TEXT, allowNull: true },
        inicio: { type: DataTypes.DATE, allowNull: true },
        fin: { type: DataTypes.DATE, allowNull: true },
        estado: { type: DataTypes.ENUM(...ESTADOS_SPRINT), allowNull: false, defaultValue: 'planeado' },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'sprints'), indexes: [{ fields: ['tablero_id', 'estado'] }] },
    );
    return Sprint;
  }
}

export class Tarea extends Model<InferAttributes<Tarea>, InferCreationAttributes<Tarea>> {
  declare id: CreationOptional<number>;
  declare tablero_id: number;
  declare columna_id: number;
  /** null = en el backlog (fuera de sprint). */
  declare sprint_id: CreationOptional<number | null>;
  /** Número dentro del tablero (TRI-12 → 12). */
  declare numero: number;
  declare titulo: string;
  declare descripcion: CreationOptional<string | null>;
  declare tipo: CreationOptional<TipoTarea>;
  declare prioridad: CreationOptional<PrioridadTarea>;
  /** Estimación (story points). */
  declare puntos: CreationOptional<number | null>;
  declare fecha_limite: CreationOptional<Date | null>;
  /** Orden dentro de la columna (decimal: se puede insertar entre dos sin renumerar). */
  declare posicion: number;
  declare creador_id: number;
  /** Épica a la que pertenece (otra tarea de tipo 'epica'). */
  declare epica_id: CreationOptional<number | null>;
  declare completada_en: CreationOptional<Date | null>;
  /** Ya se avisó a los responsables que vence pronto. */
  declare recordatorio_enviado: CreationOptional<boolean>;
  declare archivada: CreationOptional<boolean>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare asignados?: NonAttribute<Usuario[]>;
  declare etiquetas?: NonAttribute<EtiquetaTablero[]>;
  declare creador?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof Tarea {
    Tarea.init(
      {
        id: pk(),
        tablero_id: fk(),
        columna_id: fk(),
        sprint_id: { type: DataTypes.INTEGER, allowNull: true },
        numero: { type: DataTypes.INTEGER, allowNull: false },
        titulo: { type: DataTypes.STRING(200), allowNull: false },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        tipo: { type: DataTypes.ENUM(...TIPOS_TAREA), allowNull: false, defaultValue: 'tarea' },
        prioridad: { type: DataTypes.ENUM(...PRIORIDADES_TAREA), allowNull: false, defaultValue: 'media' },
        puntos: { type: DataTypes.INTEGER, allowNull: true },
        fecha_limite: { type: DataTypes.DATE, allowNull: true },
        posicion: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
        creador_id: fk(),
        epica_id: { type: DataTypes.INTEGER, allowNull: true },
        completada_en: { type: DataTypes.DATE, allowNull: true },
        recordatorio_enviado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        archivada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      {
        ...conFechas(sequelize, 'tareas'),
        indexes: [
          { unique: true, fields: ['tablero_id', 'numero'] },
          { fields: ['columna_id', 'posicion'] },
          { fields: ['sprint_id'] },
        ],
      },
    );
    return Tarea;
  }
}

/** Responsables de una tarea (puede haber varios). */
export class TareaAsignado extends Model<InferAttributes<TareaAsignado>, InferCreationAttributes<TareaAsignado>> {
  declare id: CreationOptional<number>;
  declare tarea_id: number;
  declare usuario_id: number;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof TareaAsignado {
    TareaAsignado.init(
      { id: pk(), tarea_id: fk(), usuario_id: fk(), fecha_creacion: DataTypes.DATE },
      { ...conFechaCreacion(sequelize, 'tarea_asignados'), indexes: [{ unique: true, fields: ['tarea_id', 'usuario_id'] }] },
    );
    return TareaAsignado;
  }
}

/** Etiquetas de color de un tablero ("Frontend", "Urgente", "Examen"...). */
export class EtiquetaTablero extends Model<InferAttributes<EtiquetaTablero>, InferCreationAttributes<EtiquetaTablero>> {
  declare id: CreationOptional<number>;
  declare tablero_id: number;
  declare nombre: string;
  declare color: string;

  static initModel(sequelize: Sequelize): typeof EtiquetaTablero {
    EtiquetaTablero.init(
      {
        id: pk(),
        tablero_id: fk(),
        nombre: { type: DataTypes.STRING(40), allowNull: false },
        color: { type: DataTypes.STRING(30), allowNull: false, defaultValue: 'bg-gray-500' },
      },
      { sequelize, tableName: 'etiquetas_tablero', timestamps: false, indexes: [{ unique: true, fields: ['tablero_id', 'nombre'] }] },
    );
    return EtiquetaTablero;
  }
}

export class TareaEtiqueta extends Model<InferAttributes<TareaEtiqueta>, InferCreationAttributes<TareaEtiqueta>> {
  declare id: CreationOptional<number>;
  declare tarea_id: number;
  declare etiqueta_id: number;

  static initModel(sequelize: Sequelize): typeof TareaEtiqueta {
    TareaEtiqueta.init(
      { id: pk(), tarea_id: fk(), etiqueta_id: fk() },
      { sequelize, tableName: 'tarea_etiquetas', timestamps: false, indexes: [{ unique: true, fields: ['tarea_id', 'etiqueta_id'] }] },
    );
    return TareaEtiqueta;
  }
}

export class TareaComentario extends Model<InferAttributes<TareaComentario>, InferCreationAttributes<TareaComentario>> {
  declare id: CreationOptional<number>;
  declare tarea_id: number;
  declare usuario_id: number;
  declare texto: string;
  declare fecha_creacion: CreationOptional<Date>;
  declare autor?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof TareaComentario {
    TareaComentario.init(
      { id: pk(), tarea_id: fk(), usuario_id: fk(), texto: { type: DataTypes.TEXT, allowNull: false }, fecha_creacion: DataTypes.DATE },
      { ...conFechaCreacion(sequelize, 'tarea_comentarios'), indexes: [{ fields: ['tarea_id'] }] },
    );
    return TareaComentario;
  }
}

/** Subtareas sencillas (checklist) dentro de una tarea. */
export class TareaChecklist extends Model<InferAttributes<TareaChecklist>, InferCreationAttributes<TareaChecklist>> {
  declare id: CreationOptional<number>;
  declare tarea_id: number;
  declare texto: string;
  declare hecho: CreationOptional<boolean>;
  declare posicion: CreationOptional<number>;

  static initModel(sequelize: Sequelize): typeof TareaChecklist {
    TareaChecklist.init(
      {
        id: pk(),
        tarea_id: fk(),
        texto: { type: DataTypes.STRING(300), allowNull: false },
        hecho: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        posicion: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      },
      { sequelize, tableName: 'tarea_checklist', timestamps: false, indexes: [{ fields: ['tarea_id'] }] },
    );
    return TareaChecklist;
  }
}

/** Historial: quién hizo qué en cada tarea ("movió TRI-3 a Hecho"). */
export class TareaActividad extends Model<InferAttributes<TareaActividad>, InferCreationAttributes<TareaActividad>> {
  declare id: CreationOptional<number>;
  declare tablero_id: number;
  declare tarea_id: CreationOptional<number | null>;
  declare usuario_id: number;
  /** Código corto: 'creo', 'movio', 'asigno', 'comento', 'edito', 'cerro_sprint'... */
  declare accion: string;
  /** Texto legible del cambio. */
  declare detalle: CreationOptional<string | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof TareaActividad {
    TareaActividad.init(
      {
        id: pk(),
        tablero_id: fk(),
        tarea_id: { type: DataTypes.INTEGER, allowNull: true },
        usuario_id: fk(),
        accion: { type: DataTypes.STRING(30), allowNull: false },
        detalle: { type: DataTypes.TEXT, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'tarea_actividad'), indexes: [{ fields: ['tablero_id', 'fecha_creacion'] }, { fields: ['tarea_id'] }] },
    );
    return TareaActividad;
  }
}
