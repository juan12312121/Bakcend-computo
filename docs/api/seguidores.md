# Seguidores (`/api/seguidores`)

Todas las rutas requieren sesión (`Authorization: Bearer <token>`).
Respuestas con el contrato estándar `{ success, mensaje, data, meta? }`.

Cuentas privadas (`usuarios.cuenta_privada`): seguirlas crea una **solicitud** (`seguidores.estado = 'pendiente'`)
que el dueño acepta o rechaza. Contadores (`total_seguidores` / `total_siguiendo`), estadísticas y listados
**solo cuentan relaciones `'aceptado'`**.

## Tipos

```ts
// Resultado de seguir / dejar de seguir / toggle
interface EstadoSeguimiento {
  siguiendo: boolean;                         // true solo si quedó aceptada
  estado: 'aceptado' | 'pendiente' | null;    // null = ya no hay relación
  total_seguidores: number;                   // seguidores (aceptados) del usuario seguido después de la operación
}

// Elemento de los listados de seguidores / seguidos
interface UsuarioEnLista {
  id: number;
  nombre_usuario: string;
  nombre_completo: string;
  foto_perfil_url: string | null;
  carrera: string | null;
  siguiendo_desde: string;      // ISO, cuándo empezó la relación
  lo_sigo: boolean;             // si el usuario autenticado lo sigue (aceptado)
  solicitud_pendiente: boolean; // si el usuario autenticado le pidió seguirlo y no ha respondido
}

// Elemento de GET /solicitudes
interface SolicitudSeguimiento {
  id: number;                   // id del usuario que pidió seguirme (úsalo en :seguidorId)
  nombre_usuario: string;
  nombre_completo: string;
  foto_perfil_url: string | null;
  carrera: string | null;
  solicitado_en: string;        // ISO
}
```

## Acciones

| Método | Path | Body | Respuesta |
|---|---|---|---|
| POST | `/seguir` | `{ seguido_id: number }` | 201 `data: EstadoSeguimiento` (`estado: 'pendiente'` si la cuenta es privada) |
| DELETE | `/dejar-de-seguir` | `{ seguido_id: number }` | 200 `data: EstadoSeguimiento` (también **cancela** una solicitud pendiente) |
| POST | `/toggle` | `{ seguido_id: number }` | 201 si ahora lo sigue o pidió seguirlo; 200 si quitó la relación (aceptada o pendiente) |

Mensajes: "Ahora sigues a este usuario" · "Solicitud de seguimiento enviada" · "Dejaste de seguir a este usuario".

Errores:
- 400 `seguido_id` ausente o no numérico (`errores: [{ campo: 'seguido_id', ... }]`).
- 400 "No puedes seguirte a ti mismo".
- 404 el usuario a seguir no existe o su cuenta está desactivada.
- 403 "No puedes seguir a este usuario" (hay un bloqueo en cualquier sentido).
- 409 "Ya sigues a este usuario" / "Ya le enviaste una solicitud a este usuario" (solo `/seguir`; `/toggle` alterna).
- 404 "No sigues a este usuario" (`/dejar-de-seguir` sin relación previa).

Efectos (sin eventos de Socket.IO; las notificaciones llegan por SSE + push):
- Cuenta pública: crea la relación aceptada, ajusta `usuarios.total_seguidores` / `total_siguiendo` en la misma
  transacción y notifica `tipo: 'follow'` ("comenzó a seguirte").
- Cuenta privada: crea la relación pendiente (sin tocar contadores) y notifica `tipo: 'solicitud_seguimiento'`
  ("quiere seguirte", `entidad_tipo: 'usuario'`, `entidad_id`: id de quien la pide).
- Dejar de seguir retira la notificación `follow` (o `solicitud_seguimiento` si estaba pendiente).

## Solicitudes de seguimiento (las que recibí)

| Método | Path | Query | Respuesta |
|---|---|---|---|
| GET | `/solicitudes` | `limit` (1-100, def. 20), `offset` | paginado: `data: SolicitudSeguimiento[]` (más recientes primero; sin bloqueados) |
| POST | `/solicitudes/:seguidorId/aceptar` | — | 200 `data: { seguidor_id, estado: 'aceptado', total_seguidores }` (mis seguidores tras aceptar) |
| DELETE | `/solicitudes/:seguidorId` | — | 200 sin `data` ("Solicitud rechazada") |

`:seguidorId` = id del usuario que mandó la solicitud. Errores: 400 id no numérico; 404 "No hay una solicitud
pendiente de este usuario".

Efectos: aceptar suma los contadores, retira de mi bandeja la notificación `solicitud_seguimiento` y avisa al otro con
`tipo: 'seguimiento_aceptado'` ("aceptó tu solicitud de seguimiento", `entidad_tipo: 'usuario'`, `entidad_id`: mi id).
Rechazar borra la relación y retira la notificación. Al pasar la cuenta a pública (`PUT /usuarios/me
{ cuenta_privada: false }`) todas las pendientes se aceptan solas, con el mismo aviso.

## Consultas

| Método | Path | Query | Respuesta |
|---|---|---|---|
| GET | `/estadisticas/:usuario_id` | — | `data: { seguidores: number, seguidos: number }` (solo aceptados; 404 si el usuario no existe) |
| GET | `/seguidores/:usuario_id` | `limit` (1-100, def. 20), `offset` (def. 0) | paginado: `data: UsuarioEnLista[]`, `meta: { total, limit, offset, hayMas }` |
| GET | `/seguidos/:usuario_id` | igual | paginado (a quiénes sigue) |
| GET | `/siguiendo/:usuario_id` | igual | alias de `/seguidos/:usuario_id` |
| GET | `/verificar/:usuario_id` | — | `data: { siguiendo: boolean, solicitud_pendiente: boolean }` (del autenticado hacia `usuario_id`) |

Listados: excluyen cuentas desactivadas y a los usuarios con bloqueo con quien consulta; van del más reciente al más
antiguo. Errores: 400 `:usuario_id` no numérico; 404 si hay bloqueo entre quien consulta y `usuario_id`;
403 "Esta cuenta es privada" si es privada y quien consulta no la sigue (aceptado).
