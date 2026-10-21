import multer, { type FileFilterCallback } from 'multer';
import type { Request } from 'express';
import { env } from '../../config/env';
import { BadRequestError } from '../../core/errors';
import { motorCloudinary } from './CloudinaryStorage';

const IMAGEN = /^image\/(jpeg|jpg|png|gif|webp)$/;
const DOCUMENTOS = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/csv',
  'text/plain',
]);
const CAMPOS_IMAGEN = new Set(['imagen', 'foto_perfil', 'foto_portada', 'imagen_portada', 'portada']);
/** Videos de historias (mp4, webm y mov). */
const VIDEO = /^video\/(mp4|webm|quicktime)$/;
/** Notas de voz del chat (lo que graban Chrome/Android y Safari). */
const AUDIO = /^audio\/(webm|ogg|mpeg|mp3|mp4|aac|wav|x-m4a)$/;

function filtro(_req: Request, file: Express.Multer.File, cb: FileFilterCallback): void {
  if (CAMPOS_IMAGEN.has(file.fieldname)) {
    return IMAGEN.test(file.mimetype) ? cb(null, true) : cb(new BadRequestError('Solo se permiten imágenes (jpg, png, gif, webp)'));
  }
  if (file.fieldname === 'documentos') {
    return DOCUMENTOS.has(file.mimetype) ? cb(null, true) : cb(new BadRequestError(`Tipo de documento no permitido: ${file.mimetype}`));
  }
  if (file.fieldname === 'archivo') {
    return IMAGEN.test(file.mimetype) || DOCUMENTOS.has(file.mimetype) || AUDIO.test(file.mimetype)
      ? cb(null, true)
      : cb(new BadRequestError('Tipo de archivo no permitido'));
  }
  if (file.fieldname === 'video') {
    return VIDEO.test(file.mimetype) ? cb(null, true) : cb(new BadRequestError('Solo se permiten videos (mp4, webm, mov)'));
  }
  if (file.fieldname === 'media') {
    return IMAGEN.test(file.mimetype) || VIDEO.test(file.mimetype)
      ? cb(null, true)
      : cb(new BadRequestError('Solo se permiten imágenes (jpg, png, gif, webp) o videos (mp4, webm, mov)'));
  }
  cb(new BadRequestError(`Campo de archivo inesperado: ${file.fieldname}`));
}

/** Instancia única de multer: cada ruta elige .single / .fields según lo que reciba. */
export const upload = multer({
  storage: motorCloudinary,
  fileFilter: filtro,
  limits: { fileSize: env.MAX_FILE_SIZE, files: env.MAX_FILES_PER_REQUEST },
});

/** Historias: un solo archivo `media` (imagen o video) con el límite de tamaño de video. */
export const subidaHistoria = multer({
  storage: motorCloudinary,
  fileFilter: filtro,
  limits: { fileSize: env.MAX_VIDEO_SIZE, files: 1 },
}).single('media');

/** Publicaciones: imagen o video (con el límite de video) y documentos. */
const subidaConVideo = multer({
  storage: motorCloudinary,
  fileFilter: filtro,
  limits: { fileSize: env.MAX_VIDEO_SIZE, files: env.MAX_FILES_PER_REQUEST },
});

/** Combinaciones de campos que se repiten en varias rutas. */
export const camposUpload = {
  perfil: upload.fields([
    { name: 'foto_perfil', maxCount: 1 },
    { name: 'foto_portada', maxCount: 1 },
  ]),
  publicacion: subidaConVideo.fields([
    { name: 'imagen', maxCount: 1 },
    { name: 'video', maxCount: 1 },
    { name: 'documentos', maxCount: 5 },
  ]),
};
