# API · Guardados (`/api/guardados`)

Publicaciones que el usuario guarda para ver después. Contrato estándar (`success`, `mensaje`, `data`, `meta`).

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| POST | `/:publicacion_id` | sí | — | `{ publicacion_id, guardada }`: **201** si la guardó, **200** si la quitó (toggle) |
| GET | `/` | sí | `limit` (1-100, 20), `offset` (0) | `PublicacionVista[]` (igual que el feed, con `guardada: true`), de la guardada más reciente a la más antigua + `meta` |

## Reglas
- Guardar exige poder ver la publicación (404 si no). Quitar no lo exige (por si dejó de verse).
- El listado solo incluye las guardadas que el usuario **todavía puede ver**; `meta.total` cuenta solo esas.
- Cada publicación trae todo lo de `PublicacionVista`: autor, documentos, `mi_reaccion`, `reacciones`, `encuesta`...
- Las guardadas aparecen marcadas en cualquier listado con `guardada: true`.

## Errores
400 id inválido · 401 sin sesión · 404 publicación inexistente o no visible.
