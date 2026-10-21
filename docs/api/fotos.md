# Fotos · `/api/fotos`

Galería de imágenes de un usuario. Las URLs de Cloudinary se devuelven tal cual; si alguna no empieza con `http`
(datos viejos) se construye `${API_URL}/uploads/<perfiles|portadas|publicaciones>/…`.
Las fotos de publicaciones salen de `imagen_url` (nunca de `imagen_s3`) y respetan la visibilidad.

**Galeria**:

```jsonc
{
  "usuario": { "id": 2, "nombre_completo": "Ana Pérez", "nombre_usuario": "ana" },
  "fotos": {
    "perfil_actual":  { "url": "https://…", "tipo": "perfil",  "es_actual": true, "fecha": "…" } | null,
    "portada_actual": { "url": "https://…", "tipo": "portada", "es_actual": true, "fecha": "…" } | null,
    "perfil_historial":  [ /* 0 o 1 elemento: la actual */ ],
    "portada_historial": [ /* 0 o 1 elemento: la actual */ ],
    "publicaciones": [ { "id": 9, "url": "https://…", "descripcion": "primeros 100 caracteres", "fecha": "…", "tipo": "publicacion" } ]
  },
  "estadisticas": { "total_fotos": 3, "fotos_perfil_total": 1, "fotos_portada_total": 1, "fotos_publicaciones": 1 },
  "paginacion": { "total": 1, "limit": 100, "offset": 0, "hayMas": false }   // de fotos.publicaciones
}
```

**FotoPerfilSimple**: `{ id, nombre_completo, nombre_usuario, foto_perfil_url: string | null }`

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| GET | `/usuario/:usuario_id` | opcional | query `limit` (1-100, def. 100), `offset` (def. 0) | Galeria (publicaciones visibles para quien consulta) |
| GET | `/usuario/:usuario_id/foto-perfil-simple` | no | — | FotoPerfilSimple |
| POST | `/usuarios/fotos-batch` | no | body `{ usuarios_ids: number[] }` (mín. 1; se quitan repetidos y se toman los primeros 50) | `FotoPerfilSimple[]` (cuentas inexistentes o deshabilitadas se omiten) |
| GET | `/mis-fotos` | sí | query `limit`, `offset` | Galeria propia (incluye privadas) |

Errores: 400 validación, 401 sin sesión (`/mis-fotos`), 404 usuario inexistente o deshabilitado.
