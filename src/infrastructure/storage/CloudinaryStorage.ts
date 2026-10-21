import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage as MulterCloudinaryStorage } from 'multer-storage-cloudinary';
import { env } from '../../config/env';
import type { FileStorage } from './FileStorage';

if (env.CLOUDINARY_URL) {
  cloudinary.config({ cloudinary_url: env.CLOUDINARY_URL });
} else {
  cloudinary.config({
    cloud_name: env.CLOUDINARY_CLOUD_NAME,
    api_key: env.CLOUDINARY_API_KEY,
    api_secret: env.CLOUDINARY_API_SECRET,
  });
}

const CARPETA_POR_CAMPO: Record<string, string> = {
  foto_perfil: 'trino/perfiles',
  foto_portada: 'trino/portadas',
  imagen: 'trino/publicaciones',
  imagen_portada: 'trino/secciones',
  documentos: 'trino/documentos',
  archivo: 'trino/chat',
  media: 'trino/historias',
  video: 'trino/videos',
  portada: 'trino/eventos',
};

/** Cloudinary guarda imágenes, videos (y audio) y archivos "raw" por separado; para borrar hay que decir cuál. */
type TipoRecurso = 'image' | 'video' | 'raw';
const TIPOS_RECURSO: readonly TipoRecurso[] = ['image', 'video', 'raw'];

/** Motor de multer que sube directo a Cloudinary. */
export const motorCloudinary = new MulterCloudinaryStorage({
  cloudinary,
  params: async (_req, file) => ({
    folder: CARPETA_POR_CAMPO[file.fieldname] ?? 'trino/otros',
    public_id: `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1e4)}`,
    resource_type: 'auto',
  }),
});

export class CloudinaryFileStorage implements FileStorage {
  /**
   * Saca el public_id de una URL de Cloudinary (las tablas que solo guardan la URL lo necesitan para borrar).
   * https://res.cloudinary.com/demo/image/upload/v123/trino/perfiles/foto.jpg → trino/perfiles/foto
   */
  static idDesdeUrl(url: string | null | undefined): string | null {
    if (!url || !url.includes('res.cloudinary.com')) return null;
    const coincidencia = /\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-z0-9]+)?$/i.exec(url);
    return coincidencia ? coincidencia[1] : null;
  }

  /** Tipo de recurso según la URL (…/video/upload/… → 'video'); null si no se puede saber. */
  static tipoDesdeUrl(url: string | null | undefined): TipoRecurso | null {
    const tipo = url ? /res\.cloudinary\.com\/[^/]+\/(image|video|raw)\/upload\//i.exec(url)?.[1] : undefined;
    return (tipo?.toLowerCase() as TipoRecurso | undefined) ?? null;
  }

  /**
   * Borra por URL o por public_id. Con URL se sabe si es imagen, video o archivo; con solo el id
   * se prueba en orden (imagen → video → raw) hasta que Cloudinary lo encuentre.
   */
  async eliminar(idOUrl: string | null | undefined): Promise<boolean> {
    const esUrl = !!idOUrl?.startsWith('http');
    const id = esUrl ? CloudinaryFileStorage.idDesdeUrl(idOUrl) : idOUrl;
    if (!id) return false;
    const tipo = esUrl ? CloudinaryFileStorage.tipoDesdeUrl(idOUrl) : null;
    try {
      for (const resource_type of tipo ? [tipo] : TIPOS_RECURSO) {
        const { result } = (await cloudinary.uploader.destroy(id, { resource_type })) as { result?: string };
        if (result !== 'not found') return result === 'ok';
      }
      return false;
    } catch (error) {
      console.warn('No se pudo eliminar de Cloudinary:', (error as Error).message);
      return false;
    }
  }
}

export const fileStorage: FileStorage = new CloudinaryFileStorage();
