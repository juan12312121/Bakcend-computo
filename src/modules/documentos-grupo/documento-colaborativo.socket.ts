import { AppError } from '../../core/errors';
import type { ManejadorSocket } from '../../infrastructure/realtime/RealtimeGateway';
import { sesionesDocumentos } from './documento-almacen';
import { documentoColaborativoService } from './documento-colaborativo.service';
import { EVENTOS_DOCUMENTO, type SesionesDocumentos } from './documento-sesiones';

/** Acuse de `doc:entrar`. */
export type RespuestaEntrar =
  | { ok: true; documento_id: number; puede_editar: boolean }
  | { ok: false; mensaje: string; estado: number };

/** Decide si el usuario puede abrir el documento (lanza AppError 401/403/404/409 si no). */
export type VerificadorDocumento = (documentoId: number, usuarioId: number) => Promise<{ puede_editar: boolean }>;

function idDe(datos: unknown): number | null {
  const id = Number((datos as { documento_id?: unknown } | null | undefined)?.documento_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Socket.IO entrega Buffer en Node y ArrayBuffer en el navegador. */
function bytesDe(valor: unknown): Uint8Array | null {
  if (valor instanceof Uint8Array) return valor;
  if (valor instanceof ArrayBuffer) return new Uint8Array(valor);
  return null;
}

/**
 * Eventos de la edición en vivo (ver EVENTOS_DOCUMENTO). Cada conexión valida el permiso al entrar a un documento;
 * los mensajes de quien no entró (o solo puede leer y manda cambios) se ignoran.
 */
export function crearManejadorDocumentos(sesiones: SesionesDocumentos, verificar: VerificadorDocumento): ManejadorSocket {
  return (socket, { usuarioId }) => {
    socket.on(EVENTOS_DOCUMENTO.entrar, async (datos: unknown, acuse?: unknown) => {
      const responder = (respuesta: RespuestaEntrar) => {
        if (typeof acuse === 'function') (acuse as (r: RespuestaEntrar) => void)(respuesta);
      };
      if (usuarioId === undefined) return responder({ ok: false, mensaje: 'Inicia sesión para abrir el documento', estado: 401 });
      const documentoId = idDe(datos);
      if (!documentoId) return responder({ ok: false, mensaje: 'Documento inválido', estado: 400 });
      try {
        const { puede_editar } = await verificar(documentoId, usuarioId);
        await sesiones.unir(documentoId, socket, usuarioId, puede_editar);
        responder({ ok: true, documento_id: documentoId, puede_editar });
      } catch (error) {
        const conocido = error instanceof AppError && error.isOperational;
        responder({
          ok: false,
          mensaje: conocido ? error.message : 'No se pudo abrir el documento',
          estado: conocido ? error.statusCode : 500,
        });
      }
    });

    socket.on(EVENTOS_DOCUMENTO.sync, (datos: unknown) => {
      const documentoId = idDe(datos);
      const mensaje = bytesDe((datos as { mensaje?: unknown } | null)?.mensaje);
      if (documentoId && mensaje) sesiones.recibirSync(documentoId, socket.id, mensaje);
    });

    socket.on(EVENTOS_DOCUMENTO.awareness, (datos: unknown) => {
      const documentoId = idDe(datos);
      const actualizacion = bytesDe((datos as { actualizacion?: unknown } | null)?.actualizacion);
      if (documentoId && actualizacion) sesiones.recibirAwareness(documentoId, socket.id, actualizacion);
    });

    socket.on(EVENTOS_DOCUMENTO.salir, (datos: unknown) => {
      const documentoId = idDe(datos);
      if (documentoId) sesiones.salir(documentoId, socket.id);
    });

    socket.on('disconnect', () => sesiones.desconectar(socket.id));
  };
}

/** Para server.ts: `realtime.usar(manejadorDocumentos)` (antes de `adjuntar`). */
export const manejadorDocumentos: ManejadorSocket = crearManejadorDocumentos(sesionesDocumentos, (id, usuarioId) =>
  documentoColaborativoService.accesoEnVivo(id, usuarioId),
);
