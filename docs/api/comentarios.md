# Comentarios · `/api/comentarios`

Todas las respuestas usan el contrato estándar (`success`, `mensaje`, `data`, `meta`).

**Comentario** (forma de cada elemento en `data`):

```jsonc
{
  "id": 7,
  "publicacion_id": 3,
  "usuario_id": 2,
  "texto": "Buen post @beto",
  "padre_id": null,          // id del comentario de primer nivel al que responde (null = primer nivel)
  "total_likes": 4,
  "total_respuestas": 2,     // solo cuenta en los de primer nivel
  "yo_di_like": true,        // false sin sesión
  "fecha_creacion": "2026-10-14T15:00:00.000Z",
  "autor": { "id": 2, "nombre_usuario": "ana", "nombre_completo": "Ana Pérez", "foto_perfil_url": "https://…", "carrera": "Sistemas" }
}
```

Visibilidad: comentar, responder, dar like, listar o ver un comentario exige poder ver la publicación
(público / seguidores / privado / grupo). Si no se puede ver → **404**.

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| POST | `/` | sí | body `{ publicacion_id, texto (1-1000, se recorta), padre_id? }` | Comentario (201) |
| GET | `/publicacion/:publicacion_id` | opcional | `limit` (1-100, def. 20), `offset` | Comentarios **de primer nivel**, más recientes primero + `meta` |
| GET | `/:id/respuestas` | opcional | `limit`, `offset` | Respuestas del comentario, **más viejas primero** + `meta` |
| GET | `/usuario/:usuario_id` | opcional | `limit`, `offset` | Comentarios (y respuestas) del usuario en publicaciones visibles + `meta` |
| GET | `/:id` | opcional | — | Comentario |
| PUT | `/:id` | sí (autor del comentario) | body `{ texto }` | Comentario |
| POST | `/:id/like` | sí | — | `{ comentario_id, publicacion_id, yo_di_like, total_likes }` (toggle) |
| DELETE | `/:id` | sí (autor del comentario o de la publicación) | — | sin `data` (`mensaje: "Comentario eliminado"`) |

`meta` = `{ total, limit, offset, hayMas }`.

## Respuestas (un solo nivel)
- `padre_id` debe ser un comentario de la misma publicación (404 si no existe, 400 si es de otra).
- Si `padre_id` es una respuesta, la nueva se cuelga del comentario de primer nivel de ese hilo.

## Efectos
- Crear suma 1 a `publicaciones.total_comentarios` (y 1 a `total_respuestas` del padre) en una transacción.
- Notificaciones (nunca por acciones propias):
  - `comment` ("comentó tu publicación") al autor de la publicación. Si se responde a un comentario del propio autor
    de la publicación, solo recibe `respuesta_comentario`.
  - `respuesta_comentario` ("respondió a tu comentario") al autor del comentario respondido, con `publicacion_id`,
    `entidad_tipo: 'comentario'`, `entidad_id` = id de la respuesta.
  - `mencion` a cada `@nombre_usuario` del texto que pueda ver la publicación (al editar, solo a los mencionados nuevos).
  - `like_comentario` ("le gustó tu comentario") al autor del comentario, con `publicacion_id`, `entidad_tipo: 'comentario'`,
    `entidad_id`; se retira al quitar el like.
- Borrar un comentario de primer nivel borra también sus respuestas y los likes de todos; resta a `total_comentarios`
  cuantos se borraron y, si era respuesta, 1 a `total_respuestas` del padre. Se retiran los avisos `respuesta_comentario`
  de lo borrado y el `comment` de quien ya no tenga comentarios en la publicación.
- Socket.IO a todos: `new_comment` con el Comentario creado (trae `padre_id`) y
  `comentario_like_update` `{ comentario_id, publicacion_id, total_likes }`.

Errores: 400 validación (`errores[]` por campo) o padre de otra publicación, 401 sin sesión, 403 sin permiso,
404 comentario/publicación no visible.
