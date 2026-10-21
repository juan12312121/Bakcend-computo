import { BadRequestError } from '../../core/errors';
import type { ArchivoSubido } from '../../infrastructure/storage/FileStorage';

/** Tipos de adjunto de un mensaje (chat directo y chat de grupo). */
export type TipoAdjunto = 'image' | 'document' | 'audio';

/** El servidor decide el tipo por el mimetype que aceptó `upload.ts`. */
export function tipoDeArchivo(mimetype: string): TipoAdjunto {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('audio/')) return 'audio';
  return 'document';
}

/** Texto de la push cuando el mensaje no trae texto (o para la vista previa). */
export function resumenAdjunto(tipo: TipoAdjunto | string | null | undefined): string {
  if (tipo === 'image') return '📷 Foto';
  if (tipo === 'audio') return '🎤 Nota de voz';
  return '📄 Archivo';
}

/** Lo que se guarda del adjunto en el mensaje. */
export interface DatosAdjunto {
  archivo_url: string | null;
  tipo_archivo: TipoAdjunto | null;
  duracion_seg: number | null;
}

/**
 * Reglas comunes al enviar un mensaje: texto o archivo obligatorio y, si es nota de voz, su duración (1-300 s).
 * La duración se ignora si el archivo no es audio.
 */
export function datosAdjunto(texto: string, archivo: ArchivoSubido | undefined, duracionSeg: number | undefined): DatosAdjunto {
  if (!texto && !archivo) throw new BadRequestError('Escribe un mensaje o adjunta un archivo');
  if (!archivo) return { archivo_url: null, tipo_archivo: null, duracion_seg: null };

  const tipo = tipoDeArchivo(archivo.mimetype);
  if (tipo === 'audio' && !duracionSeg) throw new BadRequestError('La nota de voz necesita su duración (duracion_seg)');
  return { archivo_url: archivo.url, tipo_archivo: tipo, duracion_seg: tipo === 'audio' ? (duracionSeg ?? null) : null };
}
