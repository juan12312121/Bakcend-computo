import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { BaseError, ForeignKeyConstraintError, UniqueConstraintError, ValidationError as SequelizeValidationError } from 'sequelize';
import { env } from '../config/env';
import { AppError, BadRequestError, ConflictError, NotFoundError, ValidationError } from '../core/errors';
import { ApiResponse } from '../core/http/ApiResponse';
import { HttpStatus } from '../core/http/HttpStatus';
import { fileStorage } from '../infrastructure/storage/CloudinaryStorage';

/** Traduce errores de librerías (Sequelize, multer, JSON) a errores propios de la app. */
function normalizar(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof UniqueConstraintError) {
    const campo = err.errors[0]?.path ?? 'registro';
    return new ConflictError(`Ya existe un registro con ese ${campo}`);
  }
  if (err instanceof ForeignKeyConstraintError) return new BadRequestError('El registro relacionado no existe');
  if (err instanceof SequelizeValidationError) {
    return new ValidationError(err.errors.map((e) => ({ campo: e.path ?? 'registro', mensaje: e.message })));
  }
  if (err instanceof MulterError) {
    const mensaje = err.code === 'LIMIT_FILE_SIZE' ? 'El archivo excede el tamaño permitido' : `Error al subir archivo: ${err.message}`;
    return new AppError(mensaje, err.code === 'LIMIT_FILE_SIZE' ? HttpStatus.PAYLOAD_TOO_LARGE : HttpStatus.BAD_REQUEST);
  }
  if (err instanceof SyntaxError && 'body' in err) return new BadRequestError('El cuerpo de la petición no es JSON válido');
  if (err instanceof BaseError) return new AppError('Error en la base de datos');

  return new AppError(err instanceof Error ? err.message : 'Error interno del servidor');
}

/** Si la petición falló después de subir archivos (p. ej. validación), se borran para no dejar huérfanos. */
function liberarArchivos(req: Request): void {
  const files = req.files as Express.Multer.File[] | Record<string, Express.Multer.File[]> | undefined;
  const lista = Array.isArray(files) ? files : Object.values(files ?? {}).flat();
  for (const archivo of req.file ? [req.file, ...lista] : lista) void fileStorage.eliminar(archivo.filename);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): Response {
  const error = normalizar(err);
  liberarArchivos(req);

  if (!error.isOperational) console.error('❌', err);

  const mensaje = error.isOperational || env.NODE_ENV !== 'production' ? error.message : 'Error interno del servidor';
  return error.errores
    ? ApiResponse.error(res, mensaje, error.statusCode, error.errores)
    : ApiResponse.error(res, mensaje, error.statusCode);
}

export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError('Ruta', `Ruta no encontrada: ${req.method} ${req.path}`));
}
