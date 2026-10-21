/** Archivo ya subido, tal como lo entrega multer + el almacenamiento. */
export interface ArchivoSubido {
  /** URL pública lista para guardar en BD. */
  url: string;
  /** Identificador en el almacenamiento (public_id de Cloudinary) para poder borrarlo. */
  id: string;
  nombreOriginal: string;
  mimetype: string;
  tamano: number;
}

/** Contrato del almacenamiento de archivos: los servicios no saben si es Cloudinary u otro. */
export interface FileStorage {
  /** Acepta el id del almacenamiento o la URL pública del archivo. */
  eliminar(idOUrl: string | null | undefined): Promise<boolean>;
}

/** Convierte el objeto de multer al formato propio de la app. */
export function aArchivo(file: Express.Multer.File): ArchivoSubido {
  return {
    url: file.path,
    id: file.filename,
    nombreOriginal: file.originalname,
    mimetype: file.mimetype,
    tamano: file.size,
  };
}

/** Lee un archivo opcional de req.file o de req.files[campo]. */
export function archivoDe(req: { file?: Express.Multer.File; files?: unknown }, campo?: string): ArchivoSubido | undefined {
  if (!campo) return req.file ? aArchivo(req.file) : undefined;
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  const file = files?.[campo]?.[0];
  return file ? aArchivo(file) : undefined;
}

/** Todos los archivos de un campo múltiple (p. ej. "documentos"). */
export function archivosDe(req: { files?: unknown }, campo: string): ArchivoSubido[] {
  const files = req.files as Record<string, Express.Multer.File[]> | undefined;
  return (files?.[campo] ?? []).map(aArchivo);
}
