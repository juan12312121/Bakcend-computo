import type { Response } from 'express';
import type { CampoError } from '../errors';
import { HttpStatus } from './HttpStatus';

/** Metadatos de paginación que acompañan a cualquier listado. */
export interface PageMeta {
  total: number;
  limit: number;
  offset: number;
  hayMas: boolean;
}

/** Contrato único de respuesta de la API (lo consume el frontend tal cual). */
export interface ApiBody<T = unknown> {
  success: boolean;
  mensaje: string;
  data?: T;
  meta?: PageMeta | Record<string, unknown>;
  errores?: CampoError[];
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Fábrica de respuestas. Cada método está sobrecargado para cubrir
 * las variantes comunes sin repetir `res.status(...).json({...})` en cada controlador.
 */
export class ApiResponse {
  static ok(res: Response): Response;
  static ok<T>(res: Response, data: T): Response;
  static ok<T>(res: Response, data: T, mensaje: string): Response;
  static ok<T>(res: Response, data: T, mensaje: string, meta: Record<string, unknown>): Response;
  static ok<T>(res: Response, data?: T, mensaje = 'Operación exitosa', meta?: Record<string, unknown>): Response {
    return ApiResponse.send(res, HttpStatus.OK, { success: true, mensaje, data, meta });
  }

  static created<T>(res: Response, data: T): Response;
  static created<T>(res: Response, data: T, mensaje: string): Response;
  static created<T>(res: Response, data: T, mensaje = 'Creado correctamente'): Response {
    return ApiResponse.send(res, HttpStatus.CREATED, { success: true, mensaje, data });
  }

  /** Mensaje sin datos (p. ej. "Publicación eliminada"). */
  static message(res: Response, mensaje: string): Response;
  static message(res: Response, mensaje: string, statusCode: number): Response;
  static message(res: Response, mensaje: string, statusCode: number = HttpStatus.OK): Response {
    return ApiResponse.send(res, statusCode, { success: true, mensaje });
  }

  static paginated<T>(res: Response, page: Page<T>): Response;
  static paginated<T>(res: Response, page: Page<T>, mensaje: string): Response;
  static paginated<T>(res: Response, page: Page<T>, mensaje = 'Operación exitosa'): Response {
    const meta: PageMeta = {
      total: page.total,
      limit: page.limit,
      offset: page.offset,
      hayMas: page.offset + page.items.length < page.total,
    };
    return ApiResponse.send(res, HttpStatus.OK, { success: true, mensaje, data: page.items, meta });
  }

  static error(res: Response, mensaje: string): Response;
  static error(res: Response, mensaje: string, statusCode: number): Response;
  static error(res: Response, mensaje: string, statusCode: number, errores: CampoError[]): Response;
  static error(
    res: Response,
    mensaje: string,
    statusCode: number = HttpStatus.INTERNAL_SERVER_ERROR,
    errores?: CampoError[],
  ): Response {
    return ApiResponse.send(res, statusCode, { success: false, mensaje, errores });
  }

  private static send<T>(res: Response, statusCode: number, body: ApiBody<T>): Response {
    const limpio = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    return res.status(statusCode).json(limpio);
  }
}
