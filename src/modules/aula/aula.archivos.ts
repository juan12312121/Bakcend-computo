import type { Response } from 'express';
import type { ArchivoTexto } from './aula.csv';

/** Única respuesta fuera del contrato JSON: un archivo (CSV o iCalendar) para descargar o suscribirse. */
export function enviarArchivo(res: Response, archivo: ArchivoTexto, adjunto = true): Response {
  if (adjunto) res.attachment(archivo.nombre);
  res.set('Content-Type', archivo.tipo);
  res.set('Cache-Control', 'private, no-store');
  return res.send(archivo.contenido);
}
