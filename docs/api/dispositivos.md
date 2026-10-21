# Dispositivos para notificaciones push (`/api/dispositivos`)

Todas las rutas requieren sesión (`Authorization: Bearer <token>`).
Respuestas con el contrato estándar `{ success, mensaje, data, meta? }`.

La app de Android registra aquí el token de Firebase del teléfono al iniciar sesión y lo quita al cerrarla.
Desde ese momento, cada notificación (like, comentario, seguidor, invitación a grupo) y cada mensaje de chat
también llega como push al teléfono.

## Acciones

| Método | Path | Body | Respuesta |
|---|---|---|---|
| POST | `/` | `{ token: string, plataforma?: 'android' \| 'ios' \| 'web' }` (por defecto `android`) | 200 `data: { id, plataforma }` |
| DELETE | `/:token` | — (token con `encodeURIComponent`) | 200 `mensaje: 'Dispositivo quitado'` |

- Registrar el mismo token otra vez no lo duplica. Si el token era de otra cuenta (otra persona abrió sesión
  en ese teléfono), pasa a la cuenta actual.
- `DELETE` solo borra el token si es del usuario de la sesión; si no existe responde igual (no revela nada).

Errores:
- 400 `token` ausente o de largo inválido, `plataforma` desconocida (`errores: [{ campo, mensaje }]`).
- 401 sin sesión.

## Datos de cada push

Todos los valores viajan como texto (así lo exige Firebase):

| Origen | Título | Cuerpo | `data` |
|---|---|---|---|
| Notificación | `TrinoFlow` | `"<nombre> <mensaje>"` | `{ tipo, notificacion_id, de_usuario_id, publicacion_id }` (`''` si no hay) |
| Mensaje de chat | nombre de quien escribe | texto, `📷 Foto` o `📄 Archivo` | `{ tipo: 'mensaje', chat_id }` |

Al tocarla, la app marca la notificación como leída y abre lo mismo que en la bandeja (o el chat).
