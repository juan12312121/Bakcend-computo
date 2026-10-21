import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type NonAttribute,
  type Sequelize,
} from 'sequelize';
import type { Usuario } from './Usuario';
import type { Documento } from './Contenido';

export const CATEGORIAS = [
  'General',
  'Tecnología',
  'Ciencias',
  'Artes y Cultura',
  'Deportes',
  'Salud y Bienestar',
  'Vida Universitaria',
  'Opinión',
  'Entrevistas',
  'Trabajo',
  'Negocios',
  'Ocio',
  'Eventos',
  'Escuela',
] as const;
export type Categoria = (typeof CATEGORIAS)[number];

/** Color de etiqueta que usa el frontend para cada categoría. */
export const COLOR_POR_CATEGORIA: Record<Categoria, string> = {
  General: 'bg-orange-500',
  Tecnología: 'bg-teal-500',
  Ciencias: 'bg-purple-500',
  'Artes y Cultura': 'bg-pink-500',
  Deportes: 'bg-blue-500',
  'Salud y Bienestar': 'bg-green-500',
  'Vida Universitaria': 'bg-orange-600',
  Opinión: 'bg-indigo-500',
  Entrevistas: 'bg-yellow-500',
  Trabajo: 'bg-slate-600',
  Negocios: 'bg-emerald-600',
  Ocio: 'bg-fuchsia-500',
  Eventos: 'bg-rose-500',
  Escuela: 'bg-sky-500',
};

export const VISIBILIDADES = ['publico', 'seguidores', 'privado'] as const;
export type Visibilidad = (typeof VISIBILIDADES)[number];

/** publicada: la ve quien corresponda · programada: sale sola en `programada_para` · borrador: solo la ve su autor. */
export const ESTADOS_PUBLICACION = ['publicada', 'programada', 'borrador'] as const;
export type EstadoPublicacion = (typeof ESTADOS_PUBLICACION)[number];

/** Texto encima de un video (lo dibuja Cloudinary con `l_text:`). Posición del centro en fracciones 0-1. */
export interface TextoVideo {
  contenido: string;
  /** Hexadecimal "#ffffff". */
  color: string;
  /** Tamaño de la letra en px (para un video de ~1080 px de ancho). */
  tamano: number;
  x: number;
  y: number;
}

/**
 * Ajustes del editor de video que el navegador no puede "quemar" en el archivo: los aplica Cloudinary
 * al reproducir (ver `modules/publicaciones/edicion-video.ts`). Lo usan publicaciones e historias.
 */
export interface EdicionVideo {
  /** Segundo donde empieza el recorte (null = desde el inicio). */
  recorte_inicio: number | null;
  /** Segundo donde termina el recorte (null = hasta el final). */
  recorte_fin: number | null;
  /** Quita el sonido original del video. */
  silenciar: boolean;
  /** Pista de música (audio subido con el campo `archivo`). */
  musica_url: string | null;
  musica_s3: string | null;
  /** 0-100 (100 = volumen original de la pista). */
  musica_volumen: number;
  texto: TextoVideo | null;
}

export class Publicacion extends Model<InferAttributes<Publicacion>, InferCreationAttributes<Publicacion>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare grupo_id: CreationOptional<number | null>;
  declare contenido: string;
  declare imagen_url: CreationOptional<string | null>;
  declare imagen_s3: CreationOptional<string | null>;
  /** Video de la publicación (también aparece en Reels). */
  declare video_url: CreationOptional<string | null>;
  /** public_id de Cloudinary del video (para borrarlo). */
  declare video_s3: CreationOptional<string | null>;
  declare video_duracion: CreationOptional<number | null>;
  /** Reproducciones del video (Reels). */
  declare total_vistas: CreationOptional<number>;
  declare categoria: CreationOptional<Categoria>;
  declare color_categoria: CreationOptional<string>;
  declare visibilidad: CreationOptional<Visibilidad>;
  declare total_likes: CreationOptional<number>;
  declare total_dislikes: CreationOptional<number>;
  declare total_comentarios: CreationOptional<number>;
  declare total_compartidos: CreationOptional<number>;
  declare oculto: CreationOptional<boolean>;
  /** [creadores] Publicada, programada o borrador (solo las publicadas salen en listados). */
  declare estado: CreationOptional<EstadoPublicacion>;
  /** [creadores] Cuándo se publica sola (solo en las programadas). */
  declare programada_para: CreationOptional<Date | null>;
  /** [creadores] Video tal como se subió; `video_url` es la URL de reproducción con los ajustes del editor. */
  declare video_original_url: CreationOptional<string | null>;
  /** [creadores] Ajustes del editor de video (recorte, música, texto). */
  declare edicion: CreationOptional<EdicionVideo | null>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;

  declare autor?: NonAttribute<Usuario>;
  declare documentos?: NonAttribute<Documento[]>;

  static initModel(sequelize: Sequelize): typeof Publicacion {
    Publicacion.init(
      {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        usuario_id: { type: DataTypes.INTEGER, allowNull: false },
        grupo_id: { type: DataTypes.INTEGER, allowNull: true },
        contenido: { type: DataTypes.TEXT, allowNull: false },
        imagen_url: { type: DataTypes.STRING(500), allowNull: true },
        imagen_s3: { type: DataTypes.STRING(300), allowNull: true },
        video_url: { type: DataTypes.STRING(500), allowNull: true },
        video_s3: { type: DataTypes.STRING(300), allowNull: true },
        video_duracion: { type: DataTypes.INTEGER, allowNull: true },
        total_vistas: { type: DataTypes.INTEGER, defaultValue: 0 },
        categoria: { type: DataTypes.ENUM(...CATEGORIAS), defaultValue: 'General' },
        color_categoria: { type: DataTypes.STRING(30), defaultValue: 'bg-orange-500' },
        visibilidad: { type: DataTypes.ENUM(...VISIBILIDADES), allowNull: false, defaultValue: 'publico' },
        total_likes: { type: DataTypes.INTEGER, defaultValue: 0 },
        total_dislikes: { type: DataTypes.INTEGER, defaultValue: 0 },
        total_comentarios: { type: DataTypes.INTEGER, defaultValue: 0 },
        total_compartidos: { type: DataTypes.INTEGER, defaultValue: 0 },
        oculto: { type: DataTypes.BOOLEAN, defaultValue: false },
        estado: { type: DataTypes.ENUM(...ESTADOS_PUBLICACION), allowNull: false, defaultValue: 'publicada' },
        programada_para: { type: DataTypes.DATE, allowNull: true },
        video_original_url: { type: DataTypes.STRING(500), allowNull: true },
        edicion: { type: DataTypes.JSON, allowNull: true },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      {
        sequelize,
        tableName: 'publicaciones',
        timestamps: true,
        createdAt: 'fecha_creacion',
        updatedAt: 'fecha_actualizacion',
        indexes: [{ fields: ['estado', 'programada_para'] }],
      },
    );
    return Publicacion;
  }
}
