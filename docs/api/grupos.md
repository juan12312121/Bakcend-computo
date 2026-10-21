# API · Grupos (`/api/grupos`)

Respuestas con el contrato estándar (`success`, `mensaje`, `data`, `meta` en paginados).
Auth: **sí** = `Authorization: Bearer <token>` obligatorio · **opcional** = si viene token se usa para `es_miembro` / `mi_rol`.

## Objeto `Grupo` (vista)

```jsonc
{
  "id": 1, "nombre": "Club de lectura", "descripcion": "Libros" /* o null */,
  "imagen_url": "https://res.cloudinary.com/..." /* o null */, "imagen_portada_url": null,
  "creador_id": 3, "privacidad": "publico" /* | "privado" */, "req_aprobacion": false,
  "fecha_creacion": "...", "fecha_actualizacion": "...",
  "creador": { "id": 3, "nombre_usuario": "ana", "nombre_completo": "...", "foto_perfil_url": null, "carrera": null },
  "total_miembros": 4,          // solo miembros con estado "activo"
  "es_miembro": true,           // miembro activo
  "mi_rol": "admin",            // "admin" | "moderador" | "miembro" | null (null si no es miembro activo o no hay sesión)
  "mi_estado": "activo"         // "activo" | "pendiente" | "rechazado" | null
}
```

## Endpoints

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| GET | `/` | opcional | query `limit` (1-100, def. 20), `offset` (def. 0) | `Grupo[]` + `meta` (paginado, más recientes primero) |
| GET | `/mis-grupos` | sí | — | `Grupo[]` donde soy miembro activo |
| GET | `/invitaciones` | sí | — | `Invitacion[]` pendientes para mí |
| POST | `/invitaciones/:invitacion_id/responder` | sí | body `{ accion: "aceptar" \| "rechazar" }` | `{ grupo_id, estado: "aceptada" \| "rechazada" }` |
| POST | `/` | sí | multipart o JSON: `nombre` (req., ≤100), `descripcion?` (≤2000), `privacidad?` (`publico` def.), `req_aprobacion?` (`true/false/1/0`); archivos `foto_perfil` → `imagen_url`, `foto_portada` → `imagen_portada_url` | `Grupo` (201) |
| GET | `/:id` | opcional | — | `Grupo` |
| POST | `/:id/unirse` | sí | — | `{ estado: "activo" \| "pendiente" }` |
| POST | `/:id/salir` | sí | — | sin `data` (solo `mensaje`) |
| GET | `/:id/publicaciones` | opcional | query `limit`, `offset` | `Publicacion[]` + `meta` (cada una con `autor` y `usuario_dio_like: boolean`) |
| POST | `/:id/invitar` | sí | body `{ usuario_id }` | `Invitacion` (201) |
| PUT | `/:id` | sí | igual que crear, todo opcional (`nombre`, `descripcion`, `privacidad`, `req_aprobacion`, fotos) | `Grupo` |

### Objeto `Invitacion`

```jsonc
{
  "id": 7, "grupo_id": 1, "remitente_id": 3, "invitado_id": 5, "estado": "pendiente", "fecha_creacion": "...",
  "grupo": { "id": 1, "nombre": "Club", "imagen_url": null, "privacidad": "privado" },
  "remitente": { /* usuario público */ }
}
```

## Reglas y errores

- Crear: el creador queda como miembro `admin` activo (transacción).
- Unirse: público sin `req_aprobacion` → `activo`; privado o con aprobación → `pendiente`. Ya miembro o con solicitud pendiente → **409**. Si antes fue `rechazado`, vuelve a solicitar.
- Salir: el creador → **400**; si no soy miembro → **404**.
- Editar e invitar: solo admins activos del grupo → si no, **403**. Editar sin ningún dato → **400**. Al cambiar fotos se borran las anteriores de Cloudinary.
- Invitar: a uno mismo → **400**; usuario inexistente → **404**; ya miembro activo o invitación pendiente → **409**. Notifica al invitado (`tipo: "invitacion_grupo"`).
- Responder: invitación inexistente o ya respondida → **404**; si no soy el invitado → **403**. Aceptar me deja como miembro activo.
- Publicaciones de un grupo **privado**: solo miembros activos; si no (o sin sesión) → **403**. Excluye publicaciones ocultas.
- Validación (ids, body, query) → **400** con `errores[]`.
