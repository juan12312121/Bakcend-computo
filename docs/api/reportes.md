# Reportes, ocultas y "no me interesa" (`/api/reportes`)

Todas requieren sesión (`Authorization: Bearer <token>`).
Los bodies con publicación aceptan `publicacion_id` (preferido) o `publicacionId` (compatibilidad).
Paginación (`limit` 1-100 def. 20, `offset` def. 0) → `meta: { total, limit, offset, hayMas }`.

## Reportes

| Método | Path | Auth | Body / Query | Respuesta |
|---|---|---|---|---|
| POST | `/crear` | sí | `{ publicacion_id, motivo, descripcion? (≤500) }` | 201 `data: { reporte, total_reportes, publicacion_oculta, reporte_moderacion }` |
| GET | `/publicacion/:publicacionId` | admin | — | `data: Reporte[]` (con `usuario` público), más recientes primero |
| GET | `/todos` | admin | `limit`, `offset` | paginado `data: PublicacionReportada[]`, de más a menos reportes |
| GET | `/estadisticas` | admin | — | `data: EstadisticaUsuario[]` |

`motivo` ∈ 'Acoso o bullying' | 'Violencia o daño' | 'Spam o publicidad' | 'Información falsa' |
'Suplantación de identidad' | 'Lenguaje ofensivo' | 'Otro'.

Errores de `/crear`: 400 motivo inválido o sin `publicacion_id`; 400 "No puedes reportar tu propia publicación";
404 no existe o no la puedes ver; 409 "Ya has reportado esta publicación".

Moderación automática: con 5 reportes la publicación queda `oculto = true` (`publicacion_oculta: true`);
con 3 publicaciones ocultadas así, el autor queda suspendido (permanente, queda en `suspensiones` sin admin).

**Bandeja común (fase 4):** cada reporte de publicación también se guarda en `reportes_contenido` (tipo `'publicacion'`,
con copia del contenido) y aparece en la bandeja de `/api/moderacion` (ver `moderacion.md`); `reporte_moderacion` es ese
registro. Lo mismo pasa al reportar con `POST /api/moderacion/reportes { tipo: 'publicacion', id }`.

```ts
interface Reporte { id; publicacion_id; usuario_id; motivo; descripcion: string | null; fecha_reporte; usuario?: UsuarioPublico }
type PublicacionReportada = Publicacion /* con autor */ & { total_reportes: number; motivos: string[] };
interface EstadisticaUsuario {
  usuario: UsuarioPublico & { suspendido: boolean };
  publicaciones_ocultadas: number;
  publicaciones_reportadas: number;
  reportes_recibidos: number;
}
```

## Ocultar publicaciones ajenas (solo para mí)

| Método | Path | Body / Query | Respuesta |
|---|---|---|---|
| POST | `/ocultar` | `{ publicacion_id }` | `data: { publicacion_id }` (idempotente; 404 si no existe o no es visible) |
| POST | `/mostrar` | `{ publicacion_id }` | `data: { publicacion_id }` (idempotente) |
| GET | `/ocultas` | `limit`, `offset` | paginado `data: PublicacionMarcada[]` |

## Mis publicaciones

| Método | Path | Body / Query | Respuesta |
|---|---|---|---|
| POST | `/ocultar-propias` | — | `data: { cantidad }` (oculto = true en todas las mías) |
| POST | `/mostrar-propias` | — | `data: { cantidad }` (visibles de nuevo, excepto las ocultadas por moderación) |
| GET | `/propias-ocultas` | `limit`, `offset` | paginado `data: Publicacion[]` |

## No me interesa

| Método | Path | Body / Query | Respuesta |
|---|---|---|---|
| POST | `/no-interesa` | `{ publicacion_id }` | 201 `data: { id, usuario_id, publicacion_id, categoria, fecha_creacion }` (idempotente) |
| POST | `/si-interesa` | `{ publicacion_id }` | `data: { publicacion_id }` |
| GET | `/no-interesan` | `limit`, `offset` | paginado `data: PublicacionMarcada[]` |
| DELETE | `/limpiar-no-interesa` | — | `data: { cantidad }` |

```ts
type PublicacionMarcada = Publicacion & { autor: UsuarioPublico; fecha_marcada: string };
```

Los listados de ocultas y "no me interesa" solo muestran publicaciones que el usuario aún puede ver.
