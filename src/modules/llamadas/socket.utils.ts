import type { Server, Socket } from 'socket.io';
import type { z, ZodTypeAny } from 'zod';
import { AppError, UnauthorizedError, ValidationError } from '../../core/errors';
import { HttpStatus } from '../../core/http/HttpStatus';
import { salas } from '../../infrastructure/realtime/RealtimeGateway';

/** Código corto que el cliente usa para decidir qué mostrar. */
export type CodigoErrorSocket = 'invalido' | 'sin_sesion' | 'prohibido' | 'no_encontrado' | 'conflicto' | 'ocupado' | 'llena' | 'error';

/** Respuesta por acuse de Socket.IO: { ok: true, data } o { ok: false, error, codigo, datos? }. */
export type RespuestaSocket<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; codigo: CodigoErrorSocket; datos?: Record<string, unknown> };

/** Error con un código propio para el cliente (p. ej. 'ocupado', 'llena') y datos extra. */
export class ErrorSocket extends AppError {
  constructor(
    message: string,
    public readonly codigo: CodigoErrorSocket,
    statusCode: number = HttpStatus.CONFLICT,
    public readonly datos?: Record<string, unknown>,
  ) {
    super(message, statusCode);
  }
}

/** La otra persona ya está en una llamada. */
export class OcupadoError extends ErrorSocket {
  constructor(message = 'Está en otra llamada') {
    super(message, 'ocupado');
  }
}

const CODIGO_POR_ESTADO: Record<number, CodigoErrorSocket> = {
  [HttpStatus.BAD_REQUEST]: 'invalido',
  [HttpStatus.UNAUTHORIZED]: 'sin_sesion',
  [HttpStatus.FORBIDDEN]: 'prohibido',
  [HttpStatus.NOT_FOUND]: 'no_encontrado',
  [HttpStatus.CONFLICT]: 'conflicto',
};

/** Convierte cualquier error en la respuesta de acuse (los inesperados no revelan detalles). */
export function respuestaDeError(error: unknown): RespuestaSocket<never> {
  if (error instanceof ErrorSocket) return { ok: false, error: error.message, codigo: error.codigo, ...(error.datos ? { datos: error.datos } : {}) };
  if (error instanceof AppError && error.isOperational) {
    return { ok: false, error: error.message, codigo: CODIGO_POR_ESTADO[error.statusCode] ?? 'error' };
  }
  return { ok: false, error: 'Ocurrió un error inesperado', codigo: 'error' };
}

type Responder<T> = (respuesta: RespuestaSocket<T>) => void;

/**
 * Registra un evento del cliente con validación zod, sesión obligatoria y respuesta por acuse:
 * `escuchar(socket, 'llamada:aceptar', schema, usuarioId, (datos) => servicio.aceptar(...))`.
 * Si el cliente no mandó acuse, el resultado se descarta (y los errores también: nunca tumban el socket).
 */
export function escuchar<S extends ZodTypeAny, T>(
  socket: Socket,
  evento: string,
  schema: S,
  usuarioId: number | undefined,
  manejar: (datos: z.infer<S>, usuarioId: number) => Promise<T> | T,
): void {
  socket.on(evento, async (crudo: unknown, responder?: unknown) => {
    const responderA: Responder<T> = typeof responder === 'function' ? (responder as Responder<T>) : () => undefined;
    try {
      if (usuarioId === undefined) throw new UnauthorizedError('Inicia sesión para continuar');
      const resultado = schema.safeParse(crudo ?? {});
      if (!resultado.success) {
        throw new ValidationError(resultado.error.issues.map((i) => ({ campo: i.path.join('.') || evento, mensaje: i.message })));
      }
      responderA({ ok: true, data: await manejar(resultado.data, usuarioId) });
    } catch (error) {
      responderA(respuestaDeError(error));
    }
  });
}

/** ¿El usuario tiene al menos un socket conectado? (con el `io` del contexto, sirve igual en pruebas). */
export async function conectado(io: Server, usuarioId: number): Promise<boolean> {
  return (await io.in(salas.usuario(usuarioId)).fetchSockets()).length > 0;
}
