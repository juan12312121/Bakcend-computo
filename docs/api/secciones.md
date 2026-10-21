# Secciones · `/api/secciones`

Carpetas del perfil donde el dueño agrupa sus publicaciones.

**Seccion**:

```jsonc
{
  "id": 4,
  "usuario_id": 2,
  "nombre": "Apuntes",
  "icono": "fa-folder",                    // por defecto
  "color": "from-gray-400 to-gray-600",    // por defecto
  "imagen_portada": "https://res.cloudinary.com/…" | null,
  "total_posts": 3,
  "fecha_creacion": "2026-10-14T15:00:00.000Z"
}
```

**SeccionConPublicaciones**: `{ seccion: Seccion, publicaciones: Publicacion[] }` — cada publicación trae `autor`
(`id, nombre_usuario, nombre_completo, foto_perfil_url, carrera`), orden más reciente primero.

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| GET | `/usuario/:usuario_id` | no | — | `Seccion[]` (más reciente primero) |
| GET | `/usuario/:usuario_id/seccion/:seccion_id` | opcional | — | SeccionConPublicaciones (solo publicaciones visibles para quien consulta) |
| POST | `/` | sí | multipart o JSON: `nombre` (1-100), `icono?` (≤50), `color?` (≤100), archivo `imagen_portada?` (imagen) | Seccion (201) |
| GET | `/` | sí | — | mis `Seccion[]` |
| GET | `/mis-secciones` | sí | — | igual que `GET /` |
| GET | `/:id` | sí (dueño) | — | SeccionConPublicaciones (todas, incluidas privadas) |
| PUT | `/:id` | sí (dueño) | multipart o JSON: `nombre?`, `icono?`, `color?`, archivo `imagen_portada?` | Seccion |
| DELETE | `/:id` | sí (dueño) | — | sin `data` |
| POST | `/posts/agregar` | sí (dueño) | body `{ seccion_id, publicacion_id }` | Seccion (con `total_posts` actualizado) |
| POST | `/posts/quitar` | sí (dueño) | body `{ seccion_id, publicacion_id }` | Seccion (con `total_posts` actualizado) |
| GET | `/posts/:publicacion_id` | sí (dueño de la publicación) | — | `Seccion[]` donde está esa publicación (orden por nombre) |

Reglas:
- El nombre es único por usuario → **409** si se repite (al crear o renombrar).
- Campos vacíos `""` en multipart se ignoran (se usan los valores por defecto).
- PUT sin ningún cambio (ni archivo) → **400** "No hay datos para actualizar".
- Al reemplazar la portada o borrar la sección se elimina la imagen anterior de Cloudinary.
- Solo se pueden agregar publicaciones propias (**403**); repetida → **409**; quitar una que no está → **404**.
- Sección ajena → **403**; inexistente → **404**.
