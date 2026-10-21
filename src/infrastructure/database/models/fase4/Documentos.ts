/**
 * Fase 4 — documentos colaborativos (Yjs) y archivos del grupo (carpeta compartida).
 * Dueño: agente "documentos". Los adjuntos de publicaciones siguen en `Contenido.ts` (`Documento`); aquí nada los toca.
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
import { Usuario } from '../Usuario';

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });

// ---------- Documentos colaborativos ----------

/** ver: solo lectura · editar: puede escribir y renombrar. */
export const PERMISOS_DOCUMENTO = ['ver', 'editar'] as const;
export type PermisoDocumento = (typeof PERMISOS_DOCUMENTO)[number];

export const TIPOS_VERSION_DOCUMENTO = ['manual', 'automatica'] as const;
export type TipoVersionDocumento = (typeof TIPOS_VERSION_DOCUMENTO)[number];

/**
 * Documento de texto que se edita entre varios en tiempo real.
 * De un grupo (`grupo_id`; lo editan sus miembros activos) o personal (`grupo_id` null; su dueño lo comparte).
 * El contenido es el estado de Yjs (`estado_yjs`); `texto_plano` es una copia para buscar y para la vista previa.
 */
/**
 * MySQL no admite valor por defecto en MEDIUMTEXT (y Sequelize sí lo escribe en el DDL para ese tipo):
 * el texto vacío se pone aquí, antes de validar, en lugar de `defaultValue`.
 */
function textoPlanoVacio(registro: { texto_plano?: string | null }): void {
  registro.texto_plano ??= '';
}

export class DocumentoColaborativo extends Model<InferAttributes<DocumentoColaborativo>, InferCreationAttributes<DocumentoColaborativo>> {
  declare id: CreationOptional<number>;
  declare titulo: string;
  declare grupo_id: CreationOptional<number | null>;
  declare propietario_id: number;
  /** Y.encodeStateAsUpdate(doc); null mientras nadie lo ha editado. */
  declare estado_yjs: CreationOptional<Buffer | null>;
  declare texto_plano: CreationOptional<string>;
  /** Primeros caracteres del texto (para listas sin cargar todo el contenido). */
  declare resumen: CreationOptional<string>;
  declare en_papelera: CreationOptional<boolean>;
  declare fecha_papelera: CreationOptional<Date | null>;
  declare ultimo_editor_id: CreationOptional<number | null>;
  declare fecha_edicion: CreationOptional<Date | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare propietario?: NonAttribute<Usuario>;
  declare ultimo_editor?: NonAttribute<Usuario | null>;
  declare grupo?: NonAttribute<Grupo | null>;
  declare permisos?: NonAttribute<DocumentoPermiso[]>;

  static initModel(sequelize: Sequelize): typeof DocumentoColaborativo {
    DocumentoColaborativo.init(
      {
        id: pk(),
        titulo: { type: DataTypes.STRING(200), allowNull: false },
        grupo_id: { type: DataTypes.INTEGER, allowNull: true },
        propietario_id: fk(),
        estado_yjs: { type: DataTypes.BLOB('long'), allowNull: true },
        texto_plano: { type: DataTypes.TEXT('medium'), allowNull: false },
        resumen: { type: DataTypes.STRING(300), allowNull: false, defaultValue: '' },
        en_papelera: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        fecha_papelera: { type: DataTypes.DATE, allowNull: true },
        ultimo_editor_id: { type: DataTypes.INTEGER, allowNull: true },
        fecha_edicion: { type: DataTypes.DATE, allowNull: true },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      {
        ...conFechas(sequelize, 'documentos_colaborativos'), hooks: { beforeValidate: textoPlanoVacio },
        indexes: [{ fields: ['grupo_id', 'en_papelera'] }, { fields: ['propietario_id', 'en_papelera'] }],
      },
    );
    return DocumentoColaborativo;
  }
}

/** Con quién se compartió un documento personal y con qué permiso. */
export class DocumentoPermiso extends Model<InferAttributes<DocumentoPermiso>, InferCreationAttributes<DocumentoPermiso>> {
  declare id: CreationOptional<number>;
  declare documento_id: number;
  declare usuario_id: number;
  declare permiso: CreationOptional<PermisoDocumento>;
  declare fecha_creacion: CreationOptional<Date>;
  declare usuario?: NonAttribute<Usuario>;
  declare documento?: NonAttribute<DocumentoColaborativo>;

  static initModel(sequelize: Sequelize): typeof DocumentoPermiso {
    DocumentoPermiso.init(
      {
        id: pk(),
        documento_id: fk(),
        usuario_id: fk(),
        permiso: { type: DataTypes.ENUM(...PERMISOS_DOCUMENTO), allowNull: false, defaultValue: 'ver' },
        fecha_creacion: DataTypes.DATE,
      },
      {
        ...conFechaCreacion(sequelize, 'documento_permisos'),
        indexes: [{ unique: true, fields: ['documento_id', 'usuario_id'] }, { fields: ['usuario_id'] }],
      },
    );
    return DocumentoPermiso;
  }
}

/** Instantánea del documento (manual o automática mientras se edita) que se puede restaurar. */
export class DocumentoVersion extends Model<InferAttributes<DocumentoVersion>, InferCreationAttributes<DocumentoVersion>> {
  declare id: CreationOptional<number>;
  declare documento_id: number;
  /** Quién la guardó (manual) o quién editaba (automática). */
  declare autor_id: CreationOptional<number | null>;
  declare tipo: CreationOptional<TipoVersionDocumento>;
  declare nombre: CreationOptional<string | null>;
  declare estado_yjs: Buffer;
  declare texto_plano: CreationOptional<string>;
  declare fecha_creacion: CreationOptional<Date>;
  declare autor?: NonAttribute<Usuario | null>;

  static initModel(sequelize: Sequelize): typeof DocumentoVersion {
    DocumentoVersion.init(
      {
        id: pk(),
        documento_id: fk(),
        autor_id: { type: DataTypes.INTEGER, allowNull: true },
        tipo: { type: DataTypes.ENUM(...TIPOS_VERSION_DOCUMENTO), allowNull: false, defaultValue: 'manual' },
        nombre: { type: DataTypes.STRING(120), allowNull: true },
        estado_yjs: { type: DataTypes.BLOB('long'), allowNull: false },
        texto_plano: { type: DataTypes.TEXT('medium'), allowNull: false },
        fecha_creacion: DataTypes.DATE,
      },
      { ...conFechaCreacion(sequelize, 'documento_versiones'), hooks: { beforeValidate: textoPlanoVacio }, indexes: [{ fields: ['documento_id', 'fecha_creacion'] }] },
    );
    return DocumentoVersion;
  }
}

// ---------- Archivos del grupo ----------

export const TIPOS_ARCHIVO_GRUPO = ['imagen', 'documento', 'audio', 'video', 'otro'] as const;
export type TipoArchivoGrupo = (typeof TIPOS_ARCHIVO_GRUPO)[number];

/** Carpeta de la carpeta compartida de un grupo; `padre_id` null = está en la raíz. */
export class CarpetaGrupo extends Model<InferAttributes<CarpetaGrupo>, InferCreationAttributes<CarpetaGrupo>> {
  declare id: CreationOptional<number>;
  declare grupo_id: number;
  declare padre_id: CreationOptional<number | null>;
  declare nombre: string;
  declare creador_id: number;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare creador?: NonAttribute<Usuario>;

  static initModel(sequelize: Sequelize): typeof CarpetaGrupo {
    CarpetaGrupo.init(
      {
        id: pk(),
        grupo_id: fk(),
        padre_id: { type: DataTypes.INTEGER, allowNull: true },
        nombre: { type: DataTypes.STRING(120), allowNull: false },
        creador_id: fk(),
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      { ...conFechas(sequelize, 'grupo_carpetas'), indexes: [{ fields: ['grupo_id', 'padre_id'] }] },
    );
    return CarpetaGrupo;
  }
}

/** Archivo subido a la carpeta compartida de un grupo (vive en Cloudinary). */
export class ArchivoGrupo extends Model<InferAttributes<ArchivoGrupo>, InferCreationAttributes<ArchivoGrupo>> {
  declare id: CreationOptional<number>;
  declare grupo_id: number;
  /** null = en la raíz. */
  declare carpeta_id: CreationOptional<number | null>;
  /** Quién lo subió. */
  declare usuario_id: number;
  declare nombre: string;
  declare url: string;
  /** public_id de Cloudinary (para borrarlo). */
  declare storage_id: CreationOptional<string | null>;
  declare mimetype: string;
  declare tipo: CreationOptional<TipoArchivoGrupo>;
  /** Bytes. */
  declare tamano: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare autor?: NonAttribute<Usuario>;
  declare carpeta?: NonAttribute<CarpetaGrupo | null>;
  declare grupo?: NonAttribute<Grupo>;

  static initModel(sequelize: Sequelize): typeof ArchivoGrupo {
    ArchivoGrupo.init(
      {
        id: pk(),
        grupo_id: fk(),
        carpeta_id: { type: DataTypes.INTEGER, allowNull: true },
        usuario_id: fk(),
        nombre: { type: DataTypes.STRING(255), allowNull: false },
        url: { type: DataTypes.STRING(500), allowNull: false },
        storage_id: { type: DataTypes.STRING(300), allowNull: true },
        mimetype: { type: DataTypes.STRING(120), allowNull: false },
        tipo: { type: DataTypes.ENUM(...TIPOS_ARCHIVO_GRUPO), allowNull: false, defaultValue: 'otro' },
        tamano: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      {
        ...conFechas(sequelize, 'grupo_archivos'),
        indexes: [{ fields: ['grupo_id', 'carpeta_id'] }, { fields: ['usuario_id'] }],
      },
    );
    return ArchivoGrupo;
  }
}

export function registrarModelosDocumentos(sequelize: Sequelize): void {
  [DocumentoColaborativo, DocumentoPermiso, DocumentoVersion, CarpetaGrupo, ArchivoGrupo].forEach((modelo) => modelo.initModel(sequelize));
  const cascada = { onDelete: 'CASCADE' as const };

  // Documentos
  DocumentoColaborativo.belongsTo(Usuario, { foreignKey: 'propietario_id', as: 'propietario', ...cascada });
  DocumentoColaborativo.belongsTo(Usuario, { foreignKey: 'ultimo_editor_id', as: 'ultimo_editor', onDelete: 'SET NULL' });
  DocumentoColaborativo.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo', ...cascada });
  DocumentoColaborativo.hasMany(DocumentoPermiso, { foreignKey: 'documento_id', as: 'permisos', ...cascada });
  DocumentoPermiso.belongsTo(DocumentoColaborativo, { foreignKey: 'documento_id', as: 'documento' });
  DocumentoPermiso.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
  DocumentoColaborativo.hasMany(DocumentoVersion, { foreignKey: 'documento_id', as: 'versiones', ...cascada });
  DocumentoVersion.belongsTo(DocumentoColaborativo, { foreignKey: 'documento_id', as: 'documento' });
  DocumentoVersion.belongsTo(Usuario, { foreignKey: 'autor_id', as: 'autor', onDelete: 'SET NULL' });

  // Archivos del grupo
  Grupo.hasMany(CarpetaGrupo, { foreignKey: 'grupo_id', as: 'carpetas', ...cascada });
  CarpetaGrupo.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo' });
  CarpetaGrupo.hasMany(CarpetaGrupo, { foreignKey: 'padre_id', as: 'subcarpetas', ...cascada });
  CarpetaGrupo.belongsTo(CarpetaGrupo, { foreignKey: 'padre_id', as: 'padre' });
  CarpetaGrupo.belongsTo(Usuario, { foreignKey: 'creador_id', as: 'creador', ...cascada });
  Grupo.hasMany(ArchivoGrupo, { foreignKey: 'grupo_id', as: 'archivos', ...cascada });
  ArchivoGrupo.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo' });
  CarpetaGrupo.hasMany(ArchivoGrupo, { foreignKey: 'carpeta_id', as: 'archivos', ...cascada });
  ArchivoGrupo.belongsTo(CarpetaGrupo, { foreignKey: 'carpeta_id', as: 'carpeta' });
  ArchivoGrupo.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'autor', ...cascada });
}
