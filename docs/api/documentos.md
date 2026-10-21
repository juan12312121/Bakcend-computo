# API · Documentos (`/api/documentos`)

Contrato estándar (`success`, `mensaje`, `data`, `meta` en listados). Paginación: `?limit=` (1-100, 20) y `?offset=` (0).

## Forma de un documento

```jsonc
{
  "id": 7,
  "usuario_id": 3,
  "publicacion_id": 12,               // o null si está suelto
  "documento_url": "https://res.cloudinary.com/.../doc.pdf",
  "documento_s3": "trino/documentos/documentos-...", // public_id de Cloudinary
  "nombre_archivo": "Apuntes.pdf",
  "tamano_archivo": 2048,
  "tipo_archivo": "application/pdf",
  "icono": "fa-file-pdf",             // fa-file-pdf | -word | -excel | -powerpoint | -archive | -csv | -code | fa-file
  "color": "text-red-500",
  "descripcion": null,
  "fecha_creacion": "2026-10-14T15:00:00.000Z",
  "usuario": { "id": 3, "nombre_usuario": "ana", "nombre_completo": "Ana Pérez", "foto_perfil_url": null, "carrera": null }
}
```
(Dentro de una publicación, `documentos[]` no trae `usuario`.)

`icono` y `color` se calculan según el mimetype: pdf rojo, Word azul, Excel verde, PowerPoint naranja,
zip/rar morado, csv amarillo, txt índigo, otro `fa-file` gris.

## Endpoints

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| GET | `/mis-documentos` | sí | `limit`, `offset` | Documentos paginados (todos los míos) |
| GET | `/usuario/:usuario_id` | opcional | `limit`, `offset` | Paginado. Para otros: los sueltos y los de publicaciones que el visitante puede ver |
| GET | `/publicacion/:publicacion_id` | sí | — | `Documento[]` (404 si la publicación no es visible) |
| POST | `/` | sí | multipart: archivo en el campo **`documentos`**; `nombre_archivo_custom?`, `descripcion?`, `publicacion_id?` (publicación propia) | Documento (201). 400 si no hay archivo |
| PATCH | `/:id/vincular` | sí (dueño) | body `{ publicacion_id }` (publicación propia) | Documento |
| PATCH | `/:id/desvincular` | sí (dueño) | — | Documento con `publicacion_id: null` |
| PUT | `/:id` | sí (dueño) | JSON o multipart: `nombre_archivo_custom?`, `descripcion?`, `icono?`, `color?`, `publicacion_id?` (id propio o `null`), archivo `documentos?` (reemplaza y recalcula ícono/color) | Documento |
| DELETE | `/:id` | sí (dueño) | — | sin `data`; borra también el archivo de Cloudinary |
| GET | `/` | sí, **solo admin** | `limit`, `offset` | Todos los documentos, paginado |
| GET | `/:id` | opcional | — | Documento (404 si está adjunto a una publicación que no puedes ver) |

Tipos de archivo aceptados: pdf, doc/docx, xls/xlsx, ppt/pptx, csv, txt.

## Errores
400 validación / sin archivo / sin cambios · 401 sin token · 403 documento ajeno, vincular a publicación ajena,
listado completo sin ser admin · 404 no existe o no visible.
