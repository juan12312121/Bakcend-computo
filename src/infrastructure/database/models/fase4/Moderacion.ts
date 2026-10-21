/**
 * Fase 4 — moderación: reportes de cualquier contenido (bandeja común), acciones y notas de los admins,
 * palabras prohibidas y suspensiones con fecha de fin.
 * Dueño: agente "moderacion". registrarModelosModeracion() la llama models/index.ts una sola vez.
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
import { Usuario } from '../Usuario';
import { MOTIVOS_REPORTE, type MotivoReporte } from '../Interacciones';

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

/** Todo lo que se puede reportar. Las publicaciones también quedan en `reportes` (umbral de ocultado). */
export const TIPOS_CONTENIDO_REPORTABLE = [
  'publicacion',
  'comentario',
  'mensaje_chat',
  'mensaje_grupo',
  'usuario',
  'grupo',
  'evento',
  'publicacion_canal',
] as const;
export type TipoContenidoReportable = (typeof TIPOS_CONTENIDO_REPORTABLE)[number];

export const ESTADOS_REPORTE = ['pendiente', 'resuelto', 'descartado'] as const;
export type EstadoReporte = (typeof ESTADOS_REPORTE)[number];

/** Lo que puede hacer un admin con un contenido reportado (y lo que queda en el historial). */
export const ACCIONES_MODERACION = ['descartar', 'ocultar', 'borrar', 'advertir', 'suspender', 'levantar_suspension'] as const;
export type AccionModeracionTipo = (typeof ACCIONES_MODERACION)[number];

/** Dónde se revisa un texto contra las palabras prohibidas. */
export const CONTEXTOS_TEXTO = ['publicacion', 'comentario', 'mensaje', 'nombre'] as const;
export type ContextoTexto = (typeof CONTEXTOS_TEXTO)[number];

export const COINCIDENCIAS_PALABRA = ['exacta', 'contiene'] as const;
export type CoincidenciaPalabra = (typeof COINCIDENCIAS_PALABRA)[number];

export const ACCIONES_PALABRA = ['censurar', 'bloquear'] as const;
export type AccionPalabra = (typeof ACCIONES_PALABRA)[number];

/** Copia del contenido al momento de reportar (por si después lo borran). */
export interface CopiaContenido {
  /** Texto principal (contenido, mensaje, biografía, descripción...). */
  texto: string;
  /** Título o nombre (grupo, evento, usuario). */
  titulo?: string | null;
  imagen_url?: string | null;
  archivo_url?: string | null;
  tipo_archivo?: string | null;
  /** Datos para ubicar el contenido (publicacion_id de un comentario, chat_id, grupo_id...). */
  contexto?: Record<string, number | string | null>;
}

/** JSON guardado como TEXT (funciona igual en MySQL y en SQLite de las pruebas). */
const columnaJson = (campo: string) => ({
  type: DataTypes.TEXT,
  allowNull: true,
  get(this: Model): unknown {
    const valor = this.getDataValue(campo) as unknown;
    if (typeof valor !== 'string') return valor ?? null;
    try {
      return JSON.parse(valor);
    } catch {
      return null;
    }
  },
  set(this: Model, valor: unknown): void {
    this.setDataValue(campo, valor === null || valor === undefined ? null : JSON.stringify(valor));
  },
});

export class ReporteContenido extends Model<InferAttributes<ReporteContenido>, InferCreationAttributes<ReporteContenido>> {
  declare id: CreationOptional<number>;
  declare tipo: TipoContenidoReportable;
  declare contenido_id: number;
  /** Quien reporta. */
  declare usuario_id: number;
  /** Autor del contenido (o el propio usuario reportado). */
  declare autor_id: CreationOptional<number | null>;
  declare motivo: MotivoReporte;
  declare descripcion: CreationOptional<string | null>;
  declare copia: CreationOptional<CopiaContenido | null>;
  declare estado: CreationOptional<EstadoReporte>;
  declare resuelto_por: CreationOptional<number | null>;
  declare fecha_resolucion: CreationOptional<Date | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare reportante?: NonAttribute<Usuario>;
  declare autor?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof ReporteContenido {
    ReporteContenido.init(
      {
        id: pk(),
        tipo: { type: DataTypes.ENUM(...TIPOS_CONTENIDO_REPORTABLE), allowNull: false },
        contenido_id: fk(),
        usuario_id: fk(),
        autor_id: { type: DataTypes.INTEGER, allowNull: true },
        motivo: { type: DataTypes.ENUM(...MOTIVOS_REPORTE), allowNull: false, defaultValue: 'Otro' },
        descripcion: { type: DataTypes.TEXT, allowNull: true },
        copia: columnaJson('copia'),
        estado: { type: DataTypes.ENUM(...ESTADOS_REPORTE), allowNull: false, defaultValue: 'pendiente' },
        resuelto_por: { type: DataTypes.INTEGER, allowNull: true },
        fecha_resolucion: { type: DataTypes.DATE, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      {
        ...conFechaCreacion(sequelize, 'reportes_contenido'),
        indexes: [
          { unique: true, fields: ['tipo', 'contenido_id', 'usuario_id'] },
          { fields: ['estado', 'tipo'] },
          { fields: ['autor_id'] },
        ],
      },
    );
    return ReporteContenido;
  }
}

/** Historial: quién hizo qué sobre qué contenido y cuándo. */
export class AccionModeracion extends Model<InferAttributes<AccionModeracion>, InferCreationAttributes<AccionModeracion>> {
  declare id: CreationOptional<number>;
  declare admin_id: CreationOptional<number | null>;
  declare accion: AccionModeracionTipo;
  declare tipo: CreationOptional<TipoContenidoReportable | null>;
  declare contenido_id: CreationOptional<number | null>;
  /** A quién afectó (autor advertido, usuario suspendido...). */
  declare autor_id: CreationOptional<number | null>;
  /** Texto libre: advertencia enviada, días de suspensión, motivo... */
  declare detalle: CreationOptional<string | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare admin?: NonAttribute<Usuario>;
  declare autor?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof AccionModeracion {
    AccionModeracion.init(
      {
        id: pk(),
        admin_id: { type: DataTypes.INTEGER, allowNull: true },
        accion: { type: DataTypes.ENUM(...ACCIONES_MODERACION), allowNull: false },
        tipo: { type: DataTypes.ENUM(...TIPOS_CONTENIDO_REPORTABLE), allowNull: true },
        contenido_id: { type: DataTypes.INTEGER, allowNull: true },
        autor_id: { type: DataTypes.INTEGER, allowNull: true },
        detalle: { type: DataTypes.TEXT, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'acciones_moderacion'), indexes: [{ fields: ['tipo', 'contenido_id'] }, { fields: ['autor_id'] }] },
    );
    return AccionModeracion;
  }
}

/** Notas internas de los admins sobre un contenido reportado (no las ve nadie más). */
export class NotaModeracion extends Model<InferAttributes<NotaModeracion>, InferCreationAttributes<NotaModeracion>> {
  declare id: CreationOptional<number>;
  declare admin_id: number;
  declare tipo: TipoContenidoReportable;
  declare contenido_id: number;
  declare texto: string;
  declare fecha_creacion: CreationOptional<Date>;
  declare admin?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof NotaModeracion {
    NotaModeracion.init(
      {
        id: pk(),
        admin_id: fk(),
        tipo: { type: DataTypes.ENUM(...TIPOS_CONTENIDO_REPORTABLE), allowNull: false },
        contenido_id: fk(),
        texto: { type: DataTypes.TEXT, allowNull: false },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'notas_moderacion'), indexes: [{ fields: ['tipo', 'contenido_id'] }] },
    );
    return NotaModeracion;
  }
}

export class PalabraProhibida extends Model<InferAttributes<PalabraProhibida>, InferCreationAttributes<PalabraProhibida>> {
  declare id: CreationOptional<number>;
  /** Palabra o frase (se compara sin mayúsculas ni acentos). */
  declare palabra: string;
  declare coincidencia: CreationOptional<CoincidenciaPalabra>;
  declare accion: CreationOptional<AccionPalabra>;
  /** Dónde aplica; se guarda como texto separado por comas. */
  declare aplica_a: CreationOptional<ContextoTexto[]>;
  declare activa: CreationOptional<boolean>;
  declare creado_por: CreationOptional<number | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof PalabraProhibida {
    PalabraProhibida.init(
      {
        id: pk(),
        palabra: { type: DataTypes.STRING(100), allowNull: false, unique: true },
        coincidencia: { type: DataTypes.ENUM(...COINCIDENCIAS_PALABRA), allowNull: false, defaultValue: 'exacta' },
        accion: { type: DataTypes.ENUM(...ACCIONES_PALABRA), allowNull: false, defaultValue: 'censurar' },
        aplica_a: {
          type: DataTypes.STRING(100),
          allowNull: false,
          defaultValue: CONTEXTOS_TEXTO.join(','),
          get(this: PalabraProhibida): ContextoTexto[] {
            const valor = this.getDataValue('aplica_a') as unknown;
            if (Array.isArray(valor)) return valor as ContextoTexto[];
            return String(valor ?? '')
              .split(',')
              .filter((c): c is ContextoTexto => (CONTEXTOS_TEXTO as readonly string[]).includes(c));
          },
          set(this: PalabraProhibida, valor: ContextoTexto[] | string): void {
            this.setDataValue('aplica_a', (Array.isArray(valor) ? valor.join(',') : valor) as unknown as ContextoTexto[]);
          },
        },
        activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        creado_por: { type: DataTypes.INTEGER, allowNull: true },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      conFechas(sequelize, 'palabras_prohibidas'),
    );
    return PalabraProhibida;
  }
}

/**
 * Historial de suspensiones. `usuarios.suspendido` sigue siendo lo que mira AuthGuard;
 * aquí queda hasta cuándo (null = permanente) y la tarea programada la levanta al vencer.
 */
export class Suspension extends Model<InferAttributes<Suspension>, InferCreationAttributes<Suspension>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  /** null = automática (por reportes). */
  declare admin_id: CreationOptional<number | null>;
  declare motivo: CreationOptional<string | null>;
  /** null = permanente. */
  declare hasta: CreationOptional<Date | null>;
  declare activa: CreationOptional<boolean>;
  declare levantada_en: CreationOptional<Date | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;
  declare admin?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof Suspension {
    Suspension.init(
      {
        id: pk(),
        usuario_id: fk(),
        admin_id: { type: DataTypes.INTEGER, allowNull: true },
        motivo: { type: DataTypes.TEXT, allowNull: true },
        hasta: { type: DataTypes.DATE, allowNull: true },
        activa: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: true },
        levantada_en: { type: DataTypes.DATE, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'suspensiones'), indexes: [{ fields: ['usuario_id', 'activa'] }, { fields: ['activa', 'hasta'] }] },
    );
    return Suspension;
  }
}

export function registrarModelosModeracion(sequelize: Sequelize): void {
  [ReporteContenido, AccionModeracion, NotaModeracion, PalabraProhibida, Suspension].forEach((modelo) => modelo.initModel(sequelize));

  const cascada = { onDelete: 'CASCADE' as const };
  const libre = { constraints: false };

  ReporteContenido.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'reportante', ...cascada });
  ReporteContenido.belongsTo(Usuario, { foreignKey: 'autor_id', as: 'autor', ...libre });

  AccionModeracion.belongsTo(Usuario, { foreignKey: 'admin_id', as: 'admin', ...libre });
  AccionModeracion.belongsTo(Usuario, { foreignKey: 'autor_id', as: 'autor', ...libre });

  NotaModeracion.belongsTo(Usuario, { foreignKey: 'admin_id', as: 'admin', ...cascada });

  Suspension.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
  Suspension.belongsTo(Usuario, { foreignKey: 'admin_id', as: 'admin', ...libre });
}
