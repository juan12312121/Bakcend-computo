# API · Hashtags (`/api/hashtags`)

Los temas (`#tema`) salen solos del contenido de las publicaciones al crearlas/editarlas (ver `publicaciones.md`):
letras con acentos/ñ, dígitos y `_`, de 2 a 50 caracteres, guardados **en minúsculas y sin `#`**. Un mismo tema
repetido en un texto cuenta una vez; los `#` dentro de URLs (`https://x.com/#ancla`) no cuentan.
`total_publicaciones` se mantiene al crear, editar y borrar publicaciones (cuenta todas, incluso privadas).

Forma de un tema (`HashtagVista`): `{ "id": 4, "nombre": "fútbol", "total_publicaciones": 12 }`.

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| GET | `/tendencias` | no | — | `TendenciaVista[]` (máx 10) = `HashtagVista` + `recientes` |
| GET | `/buscar` | no | query `q` (opcional, con o sin `#`, máx 50) | `HashtagVista[]` (máx 8) |
| GET | `/:nombre` | no | `nombre` con o sin `#` (URL-encoded) | `HashtagVista` |
| GET | `/:nombre/publicaciones` | opcional | `limit`, `offset` | `PublicacionVista[]` paginado |

- **Tendencias**: top 10 por número de publicaciones **públicas** (no ocultas) creadas en los últimos 7 días
  (`recientes`); empate → más `total_publicaciones`. Si hay menos de 10, se completa con los más usados de siempre
  (`recientes: 0`).
- **Buscar** (autocompletado de `#`): temas que **empiezan** con `q` (normalizado a minúsculas), con al menos una
  publicación, los más usados primero. `q` vacío → los 8 más usados.
- **Publicaciones del tema**: las que el usuario puede ver (misma regla de visibilidad que el feed), sin las de grupos,
  más recientes primero.

## Errores
- 400 `nombre` inválido (menos de 2 / más de 50 caracteres o con símbolos), `q` de más de 50.
- 404 el tema no existe (`/:nombre` y `/:nombre/publicaciones`).

No emite eventos de Socket.IO ni notificaciones.
