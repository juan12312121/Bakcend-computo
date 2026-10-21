import type { Request, Response } from 'express';
import { BadRequestError, UnauthorizedError } from '../errors';
import { ApiResponse, type Page } from './ApiResponse';

export interface UsuarioAutenticado {
  id: number;
  email: string;
  nombre_usuario?: string;
  rol: 'usuario' | 'admin';
  /** Versión de las credenciales: al cambiar la contraseña sube y los tokens anteriores dejan de valer. */
  version?: number;
}

/**
 * Controlador base: concentra cómo se lee la petición y cómo se responde.
 * Los controladores concretos solo orquestan: leen → llaman al servicio → responden.
 * (Express 5 ya reenvía al errorHandler las promesas rechazadas, no hace falta try/catch.)
 */
export abstract class BaseController {
  // ---------- Lectura de la petición ----------

  /** Id del usuario autenticado; lanza 401 si la ruta no pasó por AuthGuard.proteger. */
  protected usuarioId(req: Request): number {
    if (!req.usuario) throw new UnauthorizedError('No hay sesión activa');
    return req.usuario.id;
  }

  /** Id del usuario si hay sesión (rutas con AuthGuard.opcional). */
  protected usuarioIdOpcional(req: Request): number | undefined {
    return req.usuario?.id;
  }

  /** Lee un parámetro de ruta numérico: this.idParam(req) o this.idParam(req, 'publicacion_id'). */
  protected idParam(req: Request): number;
  protected idParam(req: Request, nombre: string): number;
  protected idParam(req: Request, nombre = 'id'): number {
    const valor = Number(req.params[nombre]);
    if (!Number.isInteger(valor) || valor <= 0) throw new BadRequestError(`El parámetro ${nombre} no es válido`);
    return valor;
  }

  // ---------- Respuestas (delegan en ApiResponse) ----------

  protected ok<T>(res: Response, data: T): Response;
  protected ok<T>(res: Response, data: T, mensaje: string): Response;
  protected ok<T>(res: Response, data: T, mensaje?: string): Response {
    return mensaje === undefined ? ApiResponse.ok(res, data) : ApiResponse.ok(res, data, mensaje);
  }

  protected created<T>(res: Response, data: T, mensaje?: string): Response {
    return mensaje === undefined ? ApiResponse.created(res, data) : ApiResponse.created(res, data, mensaje);
  }

  protected message(res: Response, mensaje: string): Response {
    return ApiResponse.message(res, mensaje);
  }

  protected paginated<T>(res: Response, page: Page<T>, mensaje?: string): Response {
    return mensaje === undefined ? ApiResponse.paginated(res, page) : ApiResponse.paginated(res, page, mensaje);
  }
}
