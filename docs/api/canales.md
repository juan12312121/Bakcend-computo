# Canales (`/api/canales`)

Canales de difusión tipo Telegram: **solo los administradores publican** (texto, imagen o documento) y los suscriptores
leen, reaccionan con emoji y suman vistas. Públicos (aparecen en "descubrir") o privados (solo con el enlace de invitación).
Leer canales públicos no exige sesión (`auth.opcional`); todo lo demás sí.

Roles (`mi_rol`): `propietario` (quien lo creó: edita, publica, gestiona administradores y lo elimina) · `admin` (edita y
publica) · `suscriptor` (lee) · `null` (no soy miembro o sin sesión).

## Tipos

```jsonc
// CanalVista
{
  "id": 3, "creador_id": 1, "nombre": "Noticias", "descripcion": "Lo último" | null, "foto_url": "https://..." | null,
  "privacidad": "publico" | "privado",
  "total_suscriptores": 120, "total_publicaciones": 40, "ultima_publicacion_en": "ISO" | null,
  "fecha_creacion": "ISO", "fecha_actualizacion": "ISO",
  "creador": { /* usuario público */ },
  "codigo_invitacion": "Xy3_k9LmQ0aB" | null,   // solo propietario/admin; el enlace es /canales/invitacion/:codigo
  "mi_rol": "propietario" | "admin" | "suscriptor" | null,
  "silenciado": false
}
// MiCanal (GET /mios) = CanalVista + { "no_leidos": 2, "ultima_publicacion": { id, texto, tipo_archivo, autor_id, fecha_creacion } | null }

// PublicacionCanal
{
  "id": 10, "canal_id": 3, "autor_id": 1, "texto": "…", "archivo_url": "https://..." | null,
  "tipo_archivo": "image" | "document" | null, "nombre_archivo": "temario.pdf" | null,
  "total_vistas": 57, "fecha_creacion": "ISO",
  "autor": { /* usuario público */ },
  "reacciones": [{ "emoji": "🔥", "total": 12, "mia": true }]   // agrupadas, de más a menos votado
}

// MiembroCanal (administradores / suscriptores)
{ "usuario_id": 4, "rol": "admin", "fecha_union": "ISO", "usuario": { /* usuario público */ } }
```

## Endpoints

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| GET | `/` | opcional | query `q?` (nombre o descripción), `orden` = `populares` (def., más suscriptores) \| `recientes` (publicaron hace poco), `limit`, `offset` | `CanalVista[]` + `meta` — **solo públicos** |
| GET | `/mios` | sí | `limit`, `offset` | `MiCanal[]` + `meta`, el de publicación más reciente primero |
| GET | `/invitacion/:codigo` | opcional | — | `CanalVista` (vista previa, también de privados) |
| POST | `/invitacion/:codigo` | sí | — | `CanalVista` — **201** si me uní, **200** si ya era miembro |
| POST | `/` | sí | multipart (foto en **`imagen`**) o JSON: `nombre` (1-100), `descripcion?` (≤1000), `privacidad?` (`publico` def.) | `CanalVista` (201), quedo como `propietario` |
| GET | `/:id` | opcional | — | `CanalVista` |
| PUT | `/:id` | admin | multipart o JSON: `nombre?`, `descripcion?` (vacía = sin descripción), `privacidad?`, `quitar_foto?`, foto nueva en `imagen` | `CanalVista` (la foto anterior se borra de Cloudinary) |
| DELETE | `/:id` | propietario | — | mensaje. Borra publicaciones, reacciones, vistas, miembros y archivos |
| POST | `/:id/enlace` | admin | — | `CanalVista` con `codigo_invitacion` nuevo (el anterior deja de servir) |
| POST | `/:id/suscripcion` | sí | — | `CanalVista` (201). Solo públicos |
| DELETE | `/:id/suscripcion` | sí | — | mensaje. Salir del canal |
| PUT | `/:id/silencio` | miembro | `{ silenciado: boolean }` | `CanalVista` |
| PUT | `/:id/leer` | miembro | — | `{ canal_id, ultima_leida_id }` — pone en 0 sus no leídos |
| GET | `/:id/administradores` | opcional | — | `MiembroCanal[]` (propietario y admins) |
| POST | `/:id/administradores` | propietario | `{ usuario_id }` (debe ser miembro) | `MiembroCanal[]` actualizada |
| DELETE | `/:id/administradores/:usuarioId` | propietario | — | `MiembroCanal[]` (queda como suscriptor) |
| GET | `/:id/suscriptores` | admin | `limit`, `offset` | `MiembroCanal[]` + `meta` (todos los miembros, para elegir admins) |
| GET | `/:id/publicaciones` | opcional | `antes_de?` (cursor: id de la más vieja que ya tengo), `limit` (1-50, def. 20) | `PublicacionCanal[]` **más nuevas primero** + `meta` (`total` = las anteriores al cursor) |
| POST | `/:id/publicaciones` | admin | multipart o JSON: `texto` (≤4000) y/o `archivo` (imagen o documento) | `PublicacionCanal` (201) |
| DELETE | `/:id/publicaciones/:publicacionId` | admin | — | `{ canal_id, publicacion_id }` (borra también el archivo) |
| PUT | `/:id/publicaciones/:publicacionId/reaccion` | sí (y poder ver el canal) | `{ emoji }`: `❤️ 😂 😮 😢 🙏 👍 👎 🔥` | `{ canal_id, publicacion_id, reacciones }` — pone o cambia la mía |
| DELETE | `/:id/publicaciones/:publicacionId/reaccion` | sí | — | `{ canal_id, publicacion_id, reacciones }` |

### Vistas y no leídos

- `GET /:id/publicaciones` con sesión registra **una vista por persona** en cada publicación devuelta (`total_vistas` sube
  solo la primera vez y la respuesta ya lo refleja). Sin sesión no cuenta.
- Si soy miembro y pido la página más reciente (sin `antes_de`), queda leída para "mis canales". Lo que publico yo cuenta
  como leído.

## Reglas y errores

- Canal inexistente → **404**. Privado y no soy miembro → **403** (ver, publicaciones, reacciones, sala). Sin sesión donde
  hace falta → **401**.
- Editar / publicar / borrar publicación / regenerar enlace / ver suscriptores sin ser admin → **403**. Eliminar el canal o
  gestionar administradores sin ser propietario → **403**.
- Suscribirse a un privado → **403**; ya suscrito → **409**. Enlace inválido → **404** (formato inválido → **400**).
- Salir: no soy miembro → **404**; soy propietario → **400**. Silenciar sin ser miembro → **403**. Leer sin ser miembro → **404**.
- Agregar admin: usuario inexistente → **404**; no es miembro → **400**; ya es admin → **409**. Quitar a quien no es admin → **404**.
- Publicar sin texto ni archivo, con audio o texto > 4000 → **400** (el archivo subido se borra solo).
- Emoji fuera de la lista → **400**; publicación de otro canal o inexistente → **404**.

## Notificaciones

Al publicar se avisa a los miembros **no silenciados** (menos el autor), pensado para miles:
- **≤ 200** destinatarios: una notificación guardada por persona, tipo `canal_publicacion`, `entidad_tipo: 'canal'`,
  `entidad_id: <canalId>`, mensaje `publicó en «<nombre>»` (SSE + push como cualquier notificación).
- **> 200**: no se guarda ninguna notificación; solo push. Los tokens se leen por lotes de 500 usuarios y se envían en lotes
  de 500 tokens sin esperar a Firebase. Push: título = nombre del canal; cuerpo = texto (≤140) o `📷 Foto` / `📄 Archivo`;
  datos `{ tipo: 'canal_publicacion', de_usuario_id, entidad_tipo: 'canal', entidad_id }` → la app abre `/canales/:id`.

## Tiempo real (Socket.IO)

El cliente entra a la sala del canal con `join_canal` (id, acuse opcional → `{ ok: boolean }`) y sale con `leave_canal` (id).
Públicos: cualquiera (también sin sesión). Privados: solo miembros; si no puede, además recibe `sala_denegada { sala: 'canal', id }`.
Lo registra `manejadorCanales` (`modules/canales/canal.socket.ts`) con `realtime.usar(...)`.

| Evento | Sala | Payload |
|---|---|---|
| `canal_publicacion` | `canal_<id>` | `PublicacionCanal` (con `reacciones: []`) |
| `canal_publicacion_eliminada` | `canal_<id>` | `{ canal_id, publicacion_id }` |
| `canal_reaccion` | `canal_<id>` | `{ canal_id, publicacion_id, usuario_id, emoji \| null, reacciones: [{ emoji, total }] }` (sin `mia`) |
