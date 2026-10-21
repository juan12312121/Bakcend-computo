# API · Chat de grupo (`/api/grupos-chat`)

Todas las rutas exigen `Authorization: Bearer <token>` y que el usuario sea **miembro activo** del grupo
(`grupo_miembros.estado = 'activo'`). Contrato estándar (`success`, `mensaje`, `data`, `meta`).

## Objeto `MensajeGrupo`

```jsonc
{
  "id": 120, "grupo_id": 7, "emisor_id": 2,
  "texto": "Hola equipo",                        // puede venir vacío si trae archivo
  "archivo_url": null,
  "tipo_archivo": null,                          // "image" | "document" | "audio"
  "duracion_seg": null,                          // segundos de la nota de voz (solo "audio")
  "fecha_creacion": "...",
  "emisor": { "id": 2, "nombre_usuario": "ana", "nombre_completo": "...", "foto_perfil_url": null, "carrera": null }
}
```

## Endpoints

| Método | Path | Entrada | `data` |
|---|---|---|---|
| GET | `/no-leidos` | — | `ResumenChatGrupo[]` (ver abajo): **mis** grupos (miembro activo), el de mensaje más reciente primero; los que no tienen mensajes al final |
| GET | `/:grupoId/mensajes` | query `limit` (1-100, def. 50), `antes_de` (id, opcional) | `MensajeGrupo[]` **más nuevos primero** + `meta`. Para los anteriores: `antes_de = id del más viejo que ya tengo`. `meta.total` cuenta los mensajes anteriores al cursor, así que `meta.hayMas` dice si quedan más viejos. |
| POST | `/:grupoId/mensajes` | multipart o JSON: `texto` (≤5000), archivo opcional `archivo` (imagen, documento o audio), `duracion_seg` (1-300, obligatorio si es audio) | `MensajeGrupo` (201). El mensaje propio queda como leído. |
| PUT | `/:grupoId/leer` | — | `{ grupo_id, anterior_leido_id, ultimo_mensaje_leido_id }`: marca leído hasta el último mensaje. `anterior_leido_id` es lo que tenía leído antes (sirve para el separador "Mensajes nuevos"; `null` si nunca había leído). |
| DELETE | `/:grupoId/mensajes/:mensajeId` | — | `{ grupo_id, mensaje_id }`: elimina **para todos** (su autor, o un admin/moderador del grupo) y borra el archivo |

### `ResumenChatGrupo`

```jsonc
{
  "grupo_id": 7,
  "grupo": { "id": 7, "nombre": "Club", "imagen_url": null, "tipo": "comunidad", "privacidad": "publico" },
  "no_leidos": 3,                                // mensajes de otros después de mi última lectura
  "ultimo_mensaje_leido_id": 117,                // null si nunca abrí el chat
  "ultimo_mensaje": {                            // o null
    "id": 120, "texto": "", "emisor_id": 2, "tipo_archivo": "audio", "duracion_seg": 8, "fecha_creacion": "...",
    "emisor": { /* usuario público */ }
  }
}
```

Si nunca abrí el chat (`ultimo_mensaje_leido_id: null`) cuentan como no leídos los mensajes desde que me uní al grupo.

## Errores

- Grupo inexistente → **404**. No soy miembro activo (pendiente, rechazado o ajeno) → **403**. Sin sesión → **401**.
- Enviar sin texto ni archivo → **400**. Audio sin `duracion_seg` o fuera de 1-300 → **400** (el archivo subido se borra solo).
- `limit` fuera de 1-100 o ids inválidos → **400**.
- Eliminar: mensaje inexistente en ese grupo → **404**; ni autor ni admin/moderador → **403**.

## Tiempo real (Socket.IO)

| Evento | Sala(s) | Payload |
|---|---|---|
| `mensaje_grupo` | `user_<id>` de **cada miembro activo** (emisor incluido, para sus otros dispositivos) | `MensajeGrupo` |
| `mensaje_grupo_eliminado` | `user_<id>` de cada miembro activo | `{ grupo_id, mensaje_id }` |
| `escribiendo` | `group_<grupoId>` (lo reenvía el gateway) | `{ tipo: 'grupo', id, activo, usuarioId }` |

Los mensajes viajan por las salas personales y **no** por `group_<id>`: a esa sala puede entrar cualquiera que vea un
grupo público (`join_group`), y el chat es solo para miembros. Para el "escribiendo…" el cliente sí entra a la sala del
grupo (`join_group` / `leave_group`) y emite `escribiendo { tipo: 'grupo', id, activo }`.

## Notificación push

A cada miembro activo menos el emisor: título `"<grupo> · <nombre del emisor>"`; cuerpo = el texto, o `📷 Foto` /
`📄 Archivo` / `🎤 Nota de voz`; datos `{ tipo: 'mensaje_grupo', grupo_id }`.

## Mensajes temporales y reacciones (fase 4)

Campos nuevos: `MensajeGrupo.expira_en`, `MensajeGrupo.es_aviso`, `MensajeGrupo.reacciones` (`[{ emoji, total, mia }]`) y
`grupo.mensajes_temporales` en `/no-leidos` (el `ultimo_mensaje` trae `es_aviso`). Igual que en el chat directo, **nunca se
devuelven mensajes vencidos** (página, último mensaje, no leídos ni `leer`).

| Método | Path | Entrada | `data` |
|---|---|---|---|
| GET | `/:grupoId/ajustes` | — | `{ grupo_id, mensajes_temporales, puede_cambiar }` (`puede_cambiar`: soy admin o moderador) |
| PUT | `/:grupoId/temporales` | body `{ mensajes_temporales: 'apagado' \| '24h' \| '7d' }` | `{ tipo: 'grupo', id, mensajes_temporales, usuario_id, aviso }` — solo **admin/moderador** (si no, **403**); `aviso` es el `MensajeGrupo` con `es_aviso: true` o `null` si no cambió nada |
| PUT | `/:grupoId/mensajes/:mensajeId/reaccion` | body `{ emoji }` (`❤️ 😂 😮 😢 🙏 👍 👎 🔥`) | `{ grupo_id, mensaje_id, reacciones }` — pone o cambia la mía (miembros activos) |
| DELETE | `/:grupoId/mensajes/:mensajeId/reaccion` | — | `{ grupo_id, mensaje_id, reacciones }` |

Errores: no soy miembro activo → **403**; mensaje de otro grupo, inexistente o vencido → **404**; emoji/opción inválidos o
reaccionar a un aviso → **400**.

| Evento Socket.IO | Sala(s) | Payload |
|---|---|---|
| `mensajes_temporales` | `user_<id>` de cada miembro activo | `{ tipo: 'grupo', id, mensajes_temporales, usuario_id }` (el aviso llega como `mensaje_grupo`) |
| `reaccion_mensaje_grupo` | `user_<id>` de cada miembro activo | `{ grupo_id, mensaje_id, usuario_id, emoji \| null, reacciones: [{ emoji, total }] }` |
