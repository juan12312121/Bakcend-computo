# API · Administración (`/api/admin`)

Todas las rutas exigen token **y** `rol: "admin"` en el token (si no, **401** / **403**).
El rol se lee del token: tras cambiar el rol de alguien en la BD debe volver a iniciar sesión.

| Método | Path | Entrada | `data` |
|---|---|---|---|
| GET | `/reportes` | query `limit` (def. 20), `offset` | `Reporte[]` + `meta`, más recientes primero |
| DELETE | `/publicaciones/:id` | body opcional `{ motivo? }` (≤500) | sin `data` (`mensaje: "Publicación eliminada por moderación"`) |
| PATCH | `/usuarios/:id/suspender` | body opcional `{ motivo? (≤500), dias? (1-3650) }` | `{ id, suspendido: boolean, hasta: fecha \| null }` |
| GET | `/logs` | query `limit`, `offset`, `evento?` (exacto), `usuario_id?` | `LogSeguridad[]` + `meta`, más recientes primero |

### `Reporte`

```jsonc
{
  "id": 1, "publicacion_id": 8, "usuario_id": 5, "motivo": "Lenguaje ofensivo", "descripcion": null, "fecha_reporte": "...",
  "usuario": { /* usuario público: quien reportó */ },
  "publicacion": { "id": 8, "contenido": "...", "imagen_url": null, "usuario_id": 3, "oculto": false, "fecha_creacion": "...",
                   "autor": { /* usuario público */ } }
}
```

### `LogSeguridad`

```jsonc
{
  "id": 10, "usuario_id": 1, "evento": "ADMIN_SUSPEND_USER",
  "detalles": "{\"targetUserId\":5,\"motivo\":\"Spam\"}",   // texto (JSON serializado)
  "ip": "::1", "user_agent": "...", "fecha_creacion": "...",
  "usuario": { /* usuario público */ }                   // o null
}
```

Eventos que genera este módulo: `ADMIN_DELETE_POST` (detalles `{ postId, postOwner, motivo }`),
`ADMIN_SUSPEND_USER` y `ADMIN_UNSUSPEND_USER` (detalles `{ targetUserId, motivo }`). El login genera
`login_exitoso`, `login_fallido` y `cuenta_bloqueada`.

## Reglas y errores

- Suspender **alterna**: si el usuario estaba activo lo suspende (y lo marca fuera de línea); si estaba suspendido lo reactiva. Un usuario suspendido no puede iniciar sesión (403).
- Suspender **alterna**: si estaba activo lo suspende (con `dias` es temporal y `hasta` trae el fin; sin `dias` es
  permanente) y si estaba suspendido lo reactiva (los `dias` se ignoran). Queda en la tabla `suspensiones`; la tarea
  `programarFinSuspensiones()` (módulo `moderacion`) levanta las temporales al vencer. Con `dias`, los detalles del log
  agregan `dias`.
- Borrar una publicación también marca como resueltos sus reportes pendientes de la bandeja de `/api/moderacion`.
- Un admin no puede suspenderse a sí mismo → **400**. Usuario inexistente o con cuenta eliminada → **404**.
- Borrar publicación: cualquiera (incluso oculta); inexistente → **404**. Borra también sus documentos (BD y Cloudinary) y su imagen, resta 1 a `total_posts` del autor, deja registro en la bitácora y emite por Socket.IO a todos `delete_post` con `{ id }`.
- Ids o query inválidos → **400**.
