# Bloqueos (`/api/bloqueos`)

Todas las rutas requieren sesión. Respuestas con el contrato estándar `{ success, mensaje, data, meta? }`.

Un bloqueo es de un sentido en la tabla (`bloqueador_id` → `bloqueado_id`) pero aplica en **ambos sentidos**:
ninguno de los dos puede seguir al otro, no se ven en búsquedas ni listados, y las reglas de
`privacidadService` (feed, chat...) los separan.

## Tipos

```ts
interface UsuarioBloqueado {
  id: number;
  nombre_usuario: string;
  nombre_completo: string;
  foto_perfil_url: string | null;
  carrera: string | null;
  bloqueado_desde: string; // ISO
}

interface ResultadoBloqueo {
  usuario_id: number;
  bloqueado: boolean;
}
```

## Endpoints

| Método | Path | Body / query | Respuesta |
|---|---|---|---|
| GET | `/` | `limit` (1-100, def. 20), `offset` | paginado: `data: UsuarioBloqueado[]` (mis bloqueados, más recientes primero; sin cuentas eliminadas) |
| POST | `/` | `{ usuario_id: number }` | 201 `data: ResultadoBloqueo` (`bloqueado: true`), "Usuario bloqueado" |
| DELETE | `/:usuarioId` | — | 200 `data: ResultadoBloqueo` (`bloqueado: false`), "Usuario desbloqueado" |

Errores:
- 400 `usuario_id` ausente o no numérico / `:usuarioId` no numérico.
- 400 "No puedes bloquearte a ti mismo".
- 404 el usuario no existe o está desactivado (POST); "No has bloqueado a este usuario" (DELETE).
- 409 "Ya bloqueaste a este usuario".

Efectos de bloquear (en una transacción): se borran los seguimientos en ambos sentidos (los aceptados descuentan
`total_seguidores` / `total_siguiendo`) y las solicitudes pendientes; se retiran las notificaciones `follow`,
`solicitud_seguimiento` y `seguimiento_aceptado` entre los dos. Desbloquear no restaura los seguimientos.
No emite eventos de Socket.IO.

## Para otros módulos: `privacidadService` (`src/modules/privacidad/privacidad.service.ts`)

- `idsOcultosPara(usuarioId): Promise<number[]>` → a quiénes bloqueó y quiénes lo bloquearon (excluir de feed, búsqueda, chat).
- `hayBloqueo(a, b): Promise<boolean>` → bloqueo en cualquier sentido (uno mismo: false).
- `bloqueo(bloqueadorId, bloqueadoId): Promise<boolean>` → solo ese sentido.
- `puedeVerPublicacionesDe(autorId, viewerId?): Promise<boolean>` → el propio autor; cuenta pública sin bloqueo;
  cuenta privada solo si `viewerId` la sigue con estado `'aceptado'`. Sin sesión, solo cuentas públicas.
- `relacion(viewerId, otroId): Promise<RelacionUsuario>` → `{ lo_sigo, solicitud_pendiente, me_sigue, bloqueado_por_mi }`.
