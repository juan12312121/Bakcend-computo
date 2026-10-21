import { HttpStatus } from '../http/HttpStatus';

export interface CampoError {
  campo: string;
  mensaje: string;
}

/**
 * Error de dominio base. Todo error "esperado" de la API hereda de aquí,
 * y el errorHandler lo traduce a la respuesta estándar sin más lógica.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
    public readonly errores?: CampoError[],
  ) {
    super(message);
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  get isOperational(): boolean {
    return this.statusCode < HttpStatus.INTERNAL_SERVER_ERROR;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Solicitud inválida') {
    super(message, HttpStatus.BAD_REQUEST);
  }
}

export class ValidationError extends AppError {
  constructor(errores: CampoError[], message = 'Errores de validación') {
    super(message, HttpStatus.BAD_REQUEST, errores);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'No autorizado') {
    super(message, HttpStatus.UNAUTHORIZED);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'No tienes permiso para esta acción') {
    super(message, HttpStatus.FORBIDDEN);
  }
}

export class NotFoundError extends AppError {
  /** new NotFoundError('Publicación') → "Publicación no encontrado(a)" */
  constructor(recurso = 'Recurso', message?: string) {
    super(message ?? `${recurso} no encontrado`, HttpStatus.NOT_FOUND);
  }
}

export class ConflictError extends AppError {
  constructor(message = 'El registro ya existe') {
    super(message, HttpStatus.CONFLICT);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Demasiados intentos, intenta más tarde') {
    super(message, HttpStatus.TOO_MANY_REQUESTS);
  }
}
