# API · Likes y reacciones (`/api/likes`)

Contrato estándar (`success`, `mensaje`, `data`, `meta` en listados). Paginación: `?limit=` (1-100, 20) y `?offset=` (0).

Cada fila de `likes` es una **reacción**: `tipo` ∈ `me_gusta` 👍 · `me_encanta` ❤️ · `jaja` 😂 · `asombro` 😮 · `triste` 😢 ·
`enojo` 😡 · `aplauso` 👏. Una por persona y publicación. Un like de las rutas viejas es `me_gusta`.
`publicaciones.total_likes` cuenta **todas** las reacciones.

## `EstadoReaccion` (rutas de reacciones)

```json
{
  "publicacion_id": 12,
  "mi_reaccion": "jaja",
  "usuario_dio_like": true,
  "total_likes": 4,
  "reacciones": [{ "tipo": "jaja", "total": 2 }, { "tipo": "me_encanta", "total": 1 }, { "tipo": "aplauso", "total": 1 }]
}
```
`reacciones`: solo tipos con al menos una, de más a menos (empates en el orden del catálogo).

## `EstadoLike` (rutas viejas)

```json
{ "publicacion_id": 12, "liked": true, "usuario_dio_like": true, "total_likes": 3 }
```

## Endpoints

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| POST | `/reaccion` | sí | body `{ publicacion_id, tipo }` | `EstadoReaccion` (200). Pone o cambia mi reacción; repetir la misma no hace nada |
| DELETE | `/reaccion/:publicacion_id` | sí | — | `EstadoReaccion` (`mi_reaccion: null`). 404 si no había reaccionado |
| GET | `/:publicacion_id/reacciones` | opcional | `tipo?`, `limit`, `offset` | Paginado, más recientes primero: `[{ id, publicacion_id, usuario_id, tipo, fecha_creacion, usuario: UsuarioPublico }]` |
| GET | `/:publicacion_id/resumen` | opcional | — | `EstadoReaccion` (`mi_reaccion` null sin sesión) |
| POST | `/agregar` | sí | body `{ publicacion_id }` | `EstadoLike` (201). 409 si ya tenía cualquier reacción |
| DELETE | `/eliminar` | sí | body `{ publicacion_id }` | `EstadoLike`. 404 si no tenía reacción |
| POST | `/toggle` | sí | body `{ publicacion_id }` | `EstadoLike`: **201** si puso `me_gusta`, **200** si quitó la reacción (de cualquier tipo) |
| GET | `/publicacion/:publicacion_id` | opcional | `limit`, `offset` | Paginado: igual que `/reacciones` sin filtro |
| GET | `/verificar/:publicacion_id` | sí | — | `EstadoLike` |
| GET | `/total/:publicacion_id` | opcional | — | `{ publicacion_id, total, total_likes }` |
| GET | `/usuario/mis-likes` | sí | `limit`, `offset` | Paginado: `[{ id, publicacion_id, usuario_id, tipo, fecha_creacion, publicacion: { id, usuario_id, contenido, imagen_url, categoria, color_categoria, total_likes, total_comentarios, total_compartidos, fecha_creacion } }]` |

## Reglas y efectos
- Poner, cambiar, ver quién reaccionó o el resumen exige poder ver la publicación; si no → 404.
- Poner una reacción nueva suma 1 a `total_likes` (en transacción con el alta); cambiarla no cambia el total; quitarla resta 1.
- Notificación al autor (nunca por acciones propias): `tipo: 'like'` ("le gustó tu publicación") si es `me_gusta`;
  `tipo: 'reaccion'` ("reaccionó 😂 a tu publicación") en otro caso. Al cambiar de reacción se reemplaza; al quitarla se retira.
- Socket.IO `like_update` a todos en cada alta, cambio o baja:
  `{ publicacion_id, total, usuario_id, tipo /* null si la quitó */, reacciones: ResumenReaccion[] }`.
- Las publicaciones (`PublicacionVista`) traen `mi_reaccion`, `reacciones`, `usuario_dio_like` (= `mi_reaccion !== null`).

## Errores
400 `publicacion_id` o `tipo` inválido · 401 sin token · 404 publicación no visible / reacción inexistente al quitar · 409 like duplicado (`/agregar`).
