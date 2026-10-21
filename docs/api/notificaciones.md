# Notificaciones (`/api/notificaciones`)

Todas requieren sesión (`Authorization: Bearer <token>`) salvo el stream, que usa `?token=`.
Solo se ve y modifica lo del usuario autenticado.

## Tipo

```ts
interface Notificacion {
  id: number;
  usuario_id: number;            // destinatario (el autenticado)
  de_usuario_id: number | null;  // quien la provocó
  tipo: 'like' | 'comment' | 'follow' | 'share' | 'invitacion_grupo';
  publicacion_id: number | null;
  mensaje: string | null;
  leida: boolean;
  fecha_creacion: string;
  emisor: { id, nombre_usuario, nombre_completo, foto_perfil_url, carrera } | null;
}
```

## Endpoints

| Método | Path | Auth | Query / Body | Respuesta |
|---|---|---|---|---|
| GET | `/stream/:usuarioId` | `?token=<jwt>` (o header) | — | `text/event-stream` (ver abajo) |
| GET | `/` | sí | `limit` (1-100, def. 20), `offset` | paginado `data: Notificacion[]`, más recientes primero |
| GET | `/no-leidas` | sí | `limit`, `offset` | paginado, solo `leida = false` |
| GET | `/contador` | sí | — | `data: { total: number }` (no leídas) |
| PUT | `/leer-todas` | sí | — | `data: { actualizadas: number }` |
| PUT | `/:id/leer` | sí | — | `data: Notificacion` (ya con `leida: true`) |
| DELETE | `/limpiar-antiguas` | sí | `dias` (1-365, def. 30) | `data: { eliminadas: number }` |
| DELETE | `/:id` | sí | — | `mensaje: 'Notificación eliminada'` (sin data) |
| GET | `/sse/stats` | admin | — | `data: { usuariosConectados: number, conexionesTotales: number }` |

Errores: 404 "Notificación no encontrada" si el id no existe **o es de otra persona**;
400 si `:id` o `dias` no son válidos; 403 en `/sse/stats` sin rol admin.

`limpiar-antiguas` borra solo las notificaciones **leídas** del propio usuario con más de `dias` días.

Tras marcar leídas o borrar, el servidor emite `actualizar_contador` por SSE.

## Stream SSE

```
GET /api/notificaciones/stream/:usuarioId?token=<jwt>
```

- 401 sin token o token inválido; 403 si `:usuarioId` no es el del token.
- Eventos:
  - `conectado` → `{ usuarioId, timestamp }` al abrir.
  - `nueva_notificacion` → `Notificacion` completa (con `emisor`).
  - `actualizar_contador` → `{ total }` no leídas.
  - Comentario `: ping` cada 30 s (mantiene viva la conexión).
- Al cerrar la pestaña el servidor libera la conexión.
