# API · Chat privado (`/api/chat`)

Todas las rutas exigen `Authorization: Bearer <token>`. Contrato estándar (`success`, `mensaje`, `data`, `meta`).

## Objeto `Chat` (vista)

```jsonc
{
  "id": 4, "usuario1_id": 2, "usuario2_id": 9,   // siempre usuario1_id < usuario2_id
  "iniciador_id": 2,                              // quien abrió el chat (null en chats viejos)
  "estado": "pending",                            // "pending" | "accepted" | "rejected"
  "ultima_interaccion": "...", "fecha_creacion": "...",
  "otro_usuario": { "id": 9, "nombre_usuario": "beto", "nombre_completo": "...", "foto_perfil_url": null, "carrera": null },
  "ultimo_mensaje": {                             // o null
    "id": 31, "texto": "", "emisor_id": 2,
    "tipo_archivo": "audio", "duracion_seg": 12,  // nota de voz
    "leido": false, "fecha_creacion": "..."
  },
  "no_leidos": 3                                  // mensajes que recibí y no he leído
}
```

## Objeto `Mensaje`

```jsonc
{
  "id": 31, "chat_id": 4, "emisor_id": 2, "texto": "Hola",
  "leido": true, "leido_en": "2026-10-14T15:02:00.000Z",  // null mientras el receptor no lo lea
  "archivo_url": null,
  "tipo_archivo": null,                           // "image" | "document" | "audio" si trae archivo
  "duracion_seg": null,                           // segundos de la nota de voz (solo "audio")
  "fecha_creacion": "...",
  "emisor": { /* usuario público */ }
}
```

## Endpoints

| Método | Path | Entrada | `data` |
|---|---|---|---|
| GET | `/lista` | query `limit` (def. 20), `offset` | `Chat[]` + `meta`, ordenados por `ultima_interaccion` desc |
| GET | `/mensajes/:chatId` | query `limit` (def. **50**, máx. 100), `offset` | `Mensaje[]` + `meta`. `offset=0` es la página **más reciente**; dentro de la página van en orden cronológico (viejo → nuevo). Para cargar anteriores: `offset += limit`. **Antes** de leer marca como leídos (con `leido_en`) los mensajes que recibí y emite `mensajes_leidos` si cambió algo. |
| POST | `/iniciar` | body `{ receptorId }` | `Chat` — **201** si se creó, **200** si ya existía (mismo chat sin importar quién lo inicie) |
| POST | `/enviar` | multipart o JSON: `chatId` (req.), `texto` (≤5000), archivo opcional `archivo` (imagen, documento o **audio**), `duracion_seg` (1-300, **obligatorio si el archivo es audio**; se ignora en otros tipos) | `Mensaje` (201) |
| PUT | `/:chatId/leer` | — | `{ chat_id, lector_id, hasta_id, leido_en, marcados }` — marca leído lo recibido sin pedir mensajes (chat abierto y llegó uno nuevo). `hasta_id: null` y `marcados: 0` si no había nada. |
| DELETE | `/mensajes/:mensajeId` | — | `{ chat_id, mensaje_id }` — elimina **para todos** un mensaje propio (y su archivo en Cloudinary) |
| PUT | `/aceptar/:chatId` | — | `Chat` con `estado: "accepted"` |

Audios aceptados (los filtra `upload.ts`): `audio/webm`, `ogg`, `mpeg`, `mp3`, `mp4`, `aac`, `wav`, `x-m4a`.
El mimetype debe ir **sin parámetros** (`audio/webm`, no `audio/webm;codecs=opus`).

## Reglas y errores

- Estado inicial: `accepted` si ambos se siguen mutuamente; si no, `pending`. Si un chat `pending` se vuelve a iniciar cuando ya se siguen mutuamente, pasa a `accepted`.
- Iniciar consigo mismo → **400**; receptor inexistente → **404**.
- Leer / enviar / aceptar / marcar leído: chat inexistente → **404**; no soy participante → **403**; chat `rejected` → **403** al enviar.
- Enviar sin texto ni archivo → **400**. Audio sin `duracion_seg` o fuera de 1-300 → **400** (el archivo subido se borra solo).
  Mientras está `pending` ambos participantes pueden escribir (igual que el legacy).
- Eliminar: mensaje inexistente → **404**; no soy el autor → **403**.
- Aceptar: solo quien **recibió** la solicitud (no quien escribió el primer mensaje) → si no, **403**; sin mensajes todavía → **400**. Si ya está aceptado, responde 200 sin cambios.

## Tiempo real (Socket.IO)

| Evento | Sala(s) | Payload |
|---|---|---|
| `new_message` | `chat_<chatId>` y `user_<receptorId>` (este con `is_global_notif: true`) | `Mensaje` |
| `mensajes_leidos` | `chat_<chatId>` y `user_<emisor>` (el otro participante) | `{ chat_id, lector_id, hasta_id, leido_en, marcados }`: todo lo que envié a `lector_id` con `id <= hasta_id` ya está leído |
| `mensaje_eliminado` | `chat_<chatId>` y `user_<otro>` | `{ chat_id, mensaje_id }` |
| `escribiendo` | `chat_<chatId>` (lo reenvía el gateway) | `{ tipo: 'chat', id, activo, usuarioId }` |

El cliente se une con `join_chat` / `leave_chat` (id del chat) y avisa que escribe emitiendo `escribiendo { tipo: 'chat', id, activo }`.

## Notificación push

Al receptor, en todos sus dispositivos: título = nombre de quien escribe; cuerpo = el texto, o `📷 Foto` / `📄 Archivo` /
`🎤 Nota de voz`; datos `{ tipo: 'mensaje', chat_id }`.

## Mensajes temporales y reacciones (fase 4)

Campos nuevos:
- `Chat.mensajes_temporales`: `'apagado' | '24h' | '7d'` (viene en `/lista`, `/iniciar` y `/aceptar`).
- `Mensaje.expira_en` (ISO o `null`): los mensajes nuevos de un chat con temporales activos vencen ahí. **Nunca se devuelven
  vencidos** (ni en `/mensajes`, ni en `ultimo_mensaje`, ni en `no_leidos`); la limpieza programada los borra con su archivo.
- `Mensaje.es_aviso` (boolean): aviso del sistema dentro de la conversación ("Ana activó los mensajes temporales…"). Se pinta
  centrado, sin burbuja; no se le puede reaccionar. `ultimo_mensaje` también trae `es_aviso`.
- `Mensaje.reacciones`: `[{ emoji, total, mia }]` agrupadas por emoji (de más a menos votado; si empatan, en el orden de
  la lista). Va en `/mensajes`, en `POST /enviar` y en `new_message` (vacía al crearse).

| Método | Path | Entrada | `data` |
|---|---|---|---|
| PUT | `/:chatId/temporales` | body `{ mensajes_temporales: 'apagado' \| '24h' \| '7d' }` | `{ tipo: 'chat', id, mensajes_temporales, usuario_id, aviso }` — `aviso` es el `Mensaje` (`es_aviso: true`) que quedó en el chat, o `null` si la opción ya era esa. Cualquiera de los dos participantes la cambia. |
| PUT | `/mensajes/:mensajeId/reaccion` | body `{ emoji }` — uno de `❤️ 😂 😮 😢 🙏 👍 👎 🔥` (`❤` sin selector de variación cuenta como `❤️`) | `{ chat_id, mensaje_id, reacciones }` — pone o **cambia** mi reacción (una por persona y mensaje) |
| DELETE | `/mensajes/:mensajeId/reaccion` | — | `{ chat_id, mensaje_id, reacciones }` — quita la mía (si no tenía, devuelve el estado actual) |

Errores: opción o emoji fuera de la lista → **400**; no soy participante → **403**; chat/mensaje inexistente o mensaje
vencido → **404**; reaccionar a un aviso → **400**; chat `rejected` o con bloqueo → **403** al cambiar temporales; con bloqueo
→ **403** al reaccionar.

| Evento Socket.IO | Sala(s) | Payload |
|---|---|---|
| `mensajes_temporales` | `chat_<chatId>` y `user_<otro>` | `{ tipo: 'chat', id, mensajes_temporales, usuario_id }` (el aviso llega aparte como `new_message`) |
| `reaccion_mensaje` | `chat_<chatId>` y `user_<otro>` | `{ chat_id, mensaje_id, usuario_id, emoji \| null, reacciones: [{ emoji, total }] }` — sin `mia`: el cliente lo calcula (si `usuario_id` soy yo, mi emoji es `emoji`; si no, conserva el suyo) |

Tarea programada: `programarLimpiezaMensajes()` (`modules/chat/limpieza-mensajes.ts`) cada 10 min borra los mensajes
vencidos de chats directos y de grupo y sus archivos de Cloudinary (las reacciones se van por cascada).
