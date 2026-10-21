# API · Menciones (`/api/menciones`)

Una mención es `@nombre_usuario` (letras, números y `_`, 3-50; no cuenta pegada a otra palabra, así `ana@correo.com`
no menciona a nadie).

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| GET | `/usuario/:nombre` | no | `nombre` con o sin `@` | `{ id, nombre_usuario }` — para resolver los enlaces `/u/:nombre` |
| GET | `/sugerencias` | sí | query `q` (opcional, con o sin `@`, máx 50) | `[{ id, nombre_usuario, nombre_completo, foto_perfil_url }]` (máx 8) |

- `/usuario/:nombre`: solo cuentas activas y no suspendidas; si no → 404 `Usuario no encontrado`. Nombre inválido → 400.
- `/sugerencias` (autocompletado de `@`): coincide si `nombre_usuario` **empieza** con `q` o `nombre_completo` lo
  **contiene**. Primero a quienes sigo (seguimiento aceptado), luego el resto; cada grupo por `nombre_usuario`.
  Nunca me incluye a mí. `q` vacío → primero a quienes sigo.

## Notificaciones que se generan (backend)

`mencionService.notificar(texto, autorId, { publicacion_id, comentario_id? }) → Promise<number[]>`
(`modules/menciones/mencion.service.ts`). La llama publicaciones al crear (y al editar, vía
`notificarNuevas(textoNuevo, textoAnterior, ...)`, solo para los nuevos mencionados); comentarios la puede llamar igual.

- Destinatarios: cada `@usuario` del texto que exista, esté activo y no suspendido, **pueda ver la publicación**, sin
  repetir y sin el autor (máx 20 por texto).
- Notificación: `tipo: 'mencion'`, `publicacion_id`, `mensaje`: "te mencionó en una publicación" o
  "te mencionó en un comentario" (si hay `comentario_id`), `entidad_tipo` `'publicacion'` / `'comentario'` y
  `entidad_id` (id de la publicación o del comentario). Llega por SSE y push como cualquier notificación.
- Devuelve los ids notificados.
