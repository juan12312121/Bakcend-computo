# API · Tableros de trabajo (`/api/tableros`)

Tableros tipo Trello + Jira para grupos de escuela, trabajo, ocio o personales: columnas Kanban con límite WIP,
tareas numeradas (`TRI-12`), responsables, etiquetas, checklist, comentarios, sprints, backlog, reporte y actividad.
Respuestas con el contrato estándar (`success`, `mensaje`, `data`, `meta` en paginados). **Todo exige sesión** (`Authorization: Bearer`).

> Control de horas de las tareas (cronómetro, registros, resumen, tarifas, CSV): [`horas.md`](horas.md) (`/api/horas`).
> Las tareas con `fecha_limite` de los tableros de un grupo salen también en su calendario ([`aula.md`](aula.md)).
> Borrar una tarea o un tablero borra su tiempo registrado.

## Permisos

| Nivel | Quién |
|---|---|
| **ver** | miembro del tablero (`tablero_miembros`) o miembro **activo** del grupo dueño |
| **editar** | ver y no tener rol `observador` |
| **administrar** | rol `admin` del tablero, su creador, o `admin`/`moderador` activo del grupo dueño |

Sin el nivel pedido → **403** (`"No tienes acceso a este tablero"`, `"Eres observador..."`, `"Solo los administradores..."`).
Tablero / tarea / sprint inexistente → **404**. Validación → **400** con `errores[]`.
`tableroRepository.puedeVer(tableroId, usuarioId)` aplica la regla "ver" (la usa `join_board` de Socket.IO).

## Objetos

```jsonc
// TableroVista (listado y respuesta de editar/archivar)
{
  "id": 1, "nombre": "Trino web", "descripcion": null, "grupo_id": 4 /* o null = personal */,
  "creador_id": 3, "clave": "TW", "color": "from-orange-400 to-orange-600", "contador_tareas": 12,
  "archivado": false, "fecha_creacion": "...", "fecha_actualizacion": "...",
  "grupo": { "id": 4, "nombre": "Equipo", "imagen_url": null } /* o null */,
  "miembros": [ { "id": 1, "tablero_id": 1, "usuario_id": 3, "rol": "admin", "fecha_creacion": "...", "usuario": UsuarioPublico } ],
  "mi_rol": "admin" /* | "miembro" | "observador" | null (entra por el grupo) */,
  "puede_editar": true, "puede_administrar": true,
  "total_tareas": 10, "tareas_completadas": 4          // no archivadas
}

// TableroDetalle = TableroVista + 
{
  "creador": UsuarioPublico,
  "columnas": [ { "id": 7, "tablero_id": 1, "nombre": "Por hacer", "posicion": 0, "limite_wip": null, "es_final": false,
                  "fecha_creacion": "...", "total_tareas": 3 /* sin filtros */, "tareas": TareaTarjeta[] /* filtradas, por posición */ } ],
  "etiquetas": [ { "id": 2, "tablero_id": 1, "nombre": "UI", "color": "bg-sky-500" } ],
  "sprint_activo": Sprint | null,
  "sprints": Sprint[],                     // activo + planeados
  "epicas": [ { "id": 5, "numero": 5, "clave": "TW-5", "titulo": "Login" } ]
}

// TareaTarjeta
{
  "id": 9, "tablero_id": 1, "columna_id": 7, "sprint_id": null, "numero": 12, "clave": "TW-12",
  "titulo": "Diseñar login", "descripcion": null, "tipo": "tarea" /* historia | bug | epica */,
  "prioridad": "media" /* baja | alta | urgente */, "puntos": 3, "fecha_limite": "..." /* o null */,
  "posicion": 2.5, "creador_id": 3, "epica_id": null, "completada_en": null, "recordatorio_enviado": false,
  "archivada": false, "fecha_creacion": "...", "fecha_actualizacion": "...",
  "asignados": UsuarioPublico[], "etiquetas": Etiqueta[],
  "checklist_total": 4, "checklist_hechos": 1, "total_comentarios": 2
}

// TareaDetalle = TareaTarjeta +
{
  "tablero": { "id": 1, "nombre": "Trino web", "clave": "TW", "color": "...", "grupo_id": 4 },
  "creador": UsuarioPublico | null,
  "columna": { "id": 7, "nombre": "Por hacer", "es_final": false },
  "sprint": { "id": 2, "nombre": "Sprint 1", "estado": "activo" } | null,
  "epica": { "id": 5, "numero": 5, "clave": "TW-5", "titulo": "Login" } | null,
  "checklist": [ { "id": 1, "tarea_id": 9, "texto": "Maqueta", "hecho": false, "posicion": 0 } ],
  "comentarios": [ { "id": 1, "tarea_id": 9, "usuario_id": 3, "texto": "...", "fecha_creacion": "...", "autor": UsuarioPublico } ],
  "actividad": Actividad[] /* las 20 más recientes */,
  "puede_editar": true, "puede_administrar": true
}

// Sprint
{ "id": 2, "tablero_id": 1, "nombre": "Sprint 1", "objetivo": null, "inicio": "..." | null, "fin": "..." | null,
  "estado": "planeado" /* activo | cerrado */, "fecha_creacion": "..." }

// Actividad
{ "id": 1, "tablero_id": 1, "tarea_id": 9 /* o null */, "usuario_id": 3, "accion": "movio",
  "detalle": "movió TW-12 a Hecho", "fecha_creacion": "...", "usuario": UsuarioPublico }
```

Acciones de actividad: `creo_tablero` `edito_tablero` `archivo_tablero` `desarchivo_tablero` `agrego_miembro` `cambio_rol`
`quito_miembro` `salio` `columna` `creo` `edito` `movio` `asigno` `desasigno` `etiqueto` `checklist` `comento` `archivo`
`desarchivo` `elimino` `creo_sprint` `inicio_sprint` `cerro_sprint` `elimino_sprint`.

### Filtros de tareas (query)

`q` (texto en título/descripción, o la clave `TW-12` / `12`) · `asignado` (id o `yo`) · `etiqueta` (id) · `tipo` · `prioridad` ·
`sprint` (`backlog` = sin sprint, `activo`, o id) · `vencidas` (`true`: fecha límite pasada y sin terminar).
Se aplican en `GET /:id` (a las tareas de las columnas) y en `GET /:id/tareas`. Las archivadas nunca aparecen.

## Endpoints

### Tableros

| Método | Path | Nivel | Entrada | `data` |
|---|---|---|---|---|
| GET | `/` | — | query `grupo_id?`, `archivados?` (`true` = solo archivados; def. solo activos) | `TableroVista[]` (más recientes primero) |
| POST | `/` | — | `nombre` (≤100), `descripcion?`, `grupo_id?` (debo ser miembro activo: 403; no existe: 404), `color?` (`from-x-400 to-x-600`), `plantilla?` (`kanban` def. \| `scrum` \| `escuela` \| `personal`) | `TableroDetalle` (201) |
| GET | `/mis-tareas` | — | — | `(TareaTarjeta & { tablero: { id, nombre, clave, color } })[]`: asignadas a mí, sin terminar ni archivar, de tableros (no archivados) que veo; por `fecha_limite` (nulas al final) |
| GET | `/:id` | ver | filtros de tareas | `TableroDetalle` |
| PUT | `/:id` | administrar | `nombre?`, `descripcion?`, `color?` (al menos uno) | `TableroVista` |
| POST | `/:id/archivar` · `/:id/desarchivar` | administrar | — | `TableroVista` |
| DELETE | `/:id` | administrar | — | solo `mensaje` (borra columnas, tareas, sprints, etiquetas, miembros y actividad) |
| GET | `/:id/reporte` | ver | — | `Reporte` (abajo) |
| GET | `/:id/actividad` | ver | `limit`, `offset` | `Actividad[]` + `meta` (más reciente primero) |

**Clave**: 2-4 letras mayúsculas sin acentos sacadas del nombre: una palabra → 3 primeras letras (`Trino` → `TRI`);
varias → iniciales sin artículos (`Proyecto final web` → `PFW`, `Diseño de la app` → `DA`); sin letras → `TAB`. No cambia al renombrar.
**Columnas por plantilla**: kanban/scrum → Por hacer, En progreso, En revisión, Hecho (final) · escuela → Pendiente, Haciendo,
Entregado (final) · personal → Por hacer, Haciendo, Listo (final). El creador queda como `admin`.

### Miembros

| Método | Path | Nivel | Entrada | `data` |
|---|---|---|---|---|
| GET | `/:id/miembros` | ver | — | `Miembro[]` |
| POST | `/:id/miembros` | administrar | `usuario_id`, `rol?` (`miembro` def. \| `admin` \| `observador`) | `Miembro[]` (201). Ya miembro → 409; usuario no existe → 404 |
| PUT | `/:id/miembros/:usuario_id` | administrar | `rol` | `Miembro[]`. Bajar al creador → 400; no es miembro → 404 |
| DELETE | `/:id/miembros/:usuario_id` | administrar | — | `Miembro[]`. Al creador → 400 |
| POST | `/:id/salir` | — | — | `mensaje`. Creador → 400; no soy miembro → 404 |

Si alguien pierde el acceso (y tampoco entra por el grupo), deja de ser responsable de las tareas del tablero.

### Columnas

| Método | Path | Nivel | Entrada | `data` |
|---|---|---|---|---|
| POST | `/:id/columnas` | editar | `nombre` (≤60), `limite_wip?` (≥1 o null), `es_final?` | `Columna[]` (201, con `total_tareas`) |
| PUT | `/:id/columnas/orden` | editar | `{ columnas: number[] }` con TODAS las columnas | `Columna[]`. Faltan/sobran/repetidas → 400 |
| PUT | `/:id/columnas/:columna_id` | editar | `nombre?`, `limite_wip?`, `es_final?` | `Columna[]`. Marcar final completa sus tareas; desmarcar las reabre |
| DELETE | `/:id/columnas/:columna_id` | editar | query `mover_a?` | `Columna[]`. Con tareas y sin `mover_a` → 400; `mover_a` inválido → 400; destino sin cupo WIP → 409; última columna → 400 |

### Etiquetas

| Método | Path | Nivel | Entrada | `data` |
|---|---|---|---|---|
| POST | `/:id/etiquetas` | editar | `nombre` (≤40), `color?` (`bg-x-500`, def. `bg-gray-500`) | `Etiqueta[]` (201). Nombre repetido → 409 |
| PUT | `/:id/etiquetas/:etiqueta_id` | editar | `nombre?`, `color?` | `Etiqueta[]` |
| DELETE | `/:id/etiquetas/:etiqueta_id` | editar | — | `Etiqueta[]` (se quita de las tareas) |

### Tareas

| Método | Path | Nivel | Entrada | `data` |
|---|---|---|---|---|
| GET | `/:id/tareas` | ver | `limit`, `offset` + filtros | `TareaTarjeta[]` + `meta` (por número descendente) |
| POST | `/:id/tareas` | editar | `titulo` (≤200), `descripcion?`, `columna_id?` (def. la primera), `tipo?`, `prioridad?`, `puntos?` (0-1000), `fecha_limite?`, `epica_id?`, `sprint_id?`, `asignados?: number[]`, `etiquetas?: number[]` | `TareaTarjeta` (201) |
| GET | `/tareas/:tarea_id` | ver | — | `TareaDetalle` |
| PUT | `/tareas/:tarea_id` | editar | `titulo?`, `descripcion?`, `tipo?`, `prioridad?`, `puntos?`, `fecha_limite?`, `epica_id?`, `sprint_id?` (null borra; al menos uno) | `TareaTarjeta` |
| POST | `/tareas/:tarea_id/mover` | editar | `columna_id`, `anterior_id?`, `siguiente_id?` (vecinas en la columna destino) | `TareaTarjeta` |
| POST | `/tareas/:tarea_id/archivar` · `/desarchivar` | editar | — | `TareaTarjeta` |
| DELETE | `/tareas/:tarea_id` | editar + (creador de la tarea o administrar) | — | `mensaje` |
| GET | `/tareas/:tarea_id/actividad` | ver | `limit`, `offset` | `Actividad[]` + `meta` |
| POST | `/tareas/:tarea_id/asignados` | editar | `usuario_id` | `TareaTarjeta`. Sin acceso al tablero → 400; ya asignado → 409 |
| DELETE | `/tareas/:tarea_id/asignados/:usuario_id` | editar | — | `TareaTarjeta`. No era responsable → 404 |
| POST | `/tareas/:tarea_id/etiquetas` | editar | `etiqueta_id` | `TareaTarjeta`. Ya la tiene → 409; de otro tablero → 404 |
| DELETE | `/tareas/:tarea_id/etiquetas/:etiqueta_id` | editar | — | `TareaTarjeta` |
| POST | `/tareas/:tarea_id/checklist` | editar | `texto` (≤300) | `ChecklistItem[]` (201) |
| PUT | `/tareas/:tarea_id/checklist/:item_id` | editar | `texto?`, `hecho?`, `posicion?` | `ChecklistItem[]` |
| DELETE | `/tareas/:tarea_id/checklist/:item_id` | editar | — | `ChecklistItem[]` |
| POST | `/tareas/:tarea_id/comentarios` | **ver** (también observadores) | `texto` (≤5000) | `Comentario` (201) |
| PUT | `/tareas/:tarea_id/comentarios/:comentario_id` | ver + autor | `texto` | `Comentario`. Ajeno → 403 |
| DELETE | `/tareas/:tarea_id/comentarios/:comentario_id` | ver + (autor o administrar) | — | `mensaje` |

Reglas:
- **Numeración**: `numero = ++contador_tareas` del tablero dentro de una transacción (nunca se reutiliza). Nace al final de su columna.
- **Posición** decimal: entre dos vecinas → punto medio; solo la de arriba → +1; solo la de abajo → −1; sin vecinas → al final.
  Si dos vecinas quedan a menos de 1e-6 se renumera la columna (1..n). Vecina que no está en la columna destino → 400.
- **WIP**: entrar (crear, mover desde otra columna o restaurar) a una columna con `limite_wip` lleno → **409**. Reordenar dentro de la misma no cuenta.
- **es_final**: al entrar se pone `completada_en`; al salir a una no final se limpia.
- Épica: debe ser una tarea `tipo: "epica"` del mismo tablero (400). Sprint: del mismo tablero y no cerrado (400).
  Si una épica cambia de tipo, sus hijas quedan sin épica. Cambiar `fecha_limite` reinicia `recordatorio_enviado`.

### Sprints y backlog

| Método | Path | Nivel | Entrada | `data` |
|---|---|---|---|---|
| GET | `/:id/sprints` | ver | — | `Sprint[]` (todos, más recientes primero) |
| GET | `/:id/backlog` | ver | — | `{ sprints: (Sprint & { tareas: TareaTarjeta[], puntos_total, puntos_completados })[] /* activo primero, luego planeados */, backlog: TareaTarjeta[] /* sin sprint y sin terminar */ }` |
| POST | `/:id/sprints` | editar | `nombre` (≤80), `objetivo?`, `inicio?`, `fin?` | `Sprint` (201). fin < inicio → 400 |
| PUT | `/sprints/:sprint_id` | editar | `nombre?`, `objetivo?`, `inicio?`, `fin?` | `Sprint`. Cerrado → 400 |
| DELETE | `/sprints/:sprint_id` | editar | — | `mensaje`; sus tareas vuelven al backlog. Activo → 400 |
| POST | `/sprints/:sprint_id/iniciar` | editar | `inicio?` (def. ahora), `fin?` (def. el guardado o +14 días) | `Sprint`. No planeado → 400; ya hay uno activo → **409** |
| POST | `/sprints/:sprint_id/cerrar` | editar | `mover_a_sprint_id?` (sprint planeado del tablero; null = backlog) | `{ sprint, tareas_movidas, destino_sprint_id }`. No activo → 400 |

Mover tareas al sprint / backlog: `PUT /tareas/:tarea_id` con `sprint_id` (o `null`).

### Reporte (`GET /:id/reporte`)

```jsonc
{
  "total": 10, "completadas": 4,                                   // no archivadas
  "por_columna": [ { "id": 7, "nombre": "Por hacer", "es_final": false, "total": 3 } ],
  "por_responsable": [ { "usuario": UsuarioPublico | null /* sin responsable, al final */, "total": 5, "completadas": 2 } ],
  "por_prioridad": [ { "prioridad": "baja", "total": 1 }, ... /* las 4, en orden */ ],
  "vencidas": TareaTarjeta[],                                      // sin terminar y con fecha pasada, la más vieja primero
  "sprint": null | {
    "id": 2, "nombre": "Sprint 1", "inicio": "2026-10-01", "fin": "2026-10-14",
    "unidad": "puntos" /* o "tareas" si ninguna tiene puntos */,
    "puntos_total": 21, "puntos_completados": 8, "tareas_total": 7, "tareas_completadas": 3,
    "burndown": [ { "fecha": "2026-10-01", "restantes": 21 /* null en días futuros */, "ideal": 21 } ]
  }
}
```

## Tiempo real (Socket.IO, sala `board_<id>` vía `join_board`)

Todos los eventos llevan `tablero_id` y `por_usuario_id` (quien hizo el cambio; el cliente lo ignora si es él mismo).

| Evento | Datos |
|---|---|
| `tarea_creada` | `{ tarea: TareaTarjeta }` |
| `tarea_actualizada` | `{ tarea: TareaTarjeta }` (editar, archivar/restaurar, responsables, etiquetas, checklist, comentarios) |
| `tarea_movida` | `{ tarea: TareaTarjeta, columna_origen_id }` |
| `tarea_eliminada` | `{ tarea_id, columna_id }` |
| `columnas_actualizadas` | `{ columnas: Columna[] }` (sin tareas, con `total_tareas`) |
| `tablero_actualizado` | `{ motivo: "datos" \| "miembros" \| "etiquetas" \| "sprints" \| "tareas" \| "eliminado", tablero?, miembros?, etiquetas?, sprint? }` |

## Notificaciones

| Tipo | Cuándo | `entidad_tipo` / `entidad_id` | Mensaje |
|---|---|---|---|
| `tarea_asignada` | me asignan (al crear o después) | `tarea` / id | "te asignó la tarea TW-12 «Diseñar login»" |
| `tarea_comentario` | comentan una tarea de la que soy responsable o creador | `tarea` / id | "comentó en la tarea TW-12 «...»" |
| `tarea_movida` | otro cambia de columna una tarea mía | `tarea` / id | "movió la tarea TW-12 «...» a Hecho" |
| `tarea_vence` | vence en < 24 h (recordatorio) | `tarea` / id | "te recuerda que la tarea TW-12 «...» vence en menos de 24 horas" |
| `invitacion_grupo` | me agregan a un tablero | `tablero` / id | "te agregó al tablero «Trino web»" |

## Recordatorios (tarea programada)

`programarRecordatoriosTareas()` (en `tarea.service.ts`) corre cada 15 min (`unref()`): tareas sin terminar ni archivar, con
`fecha_limite` en las próximas 24 h y `recordatorio_enviado = false` → `tarea_vence` a cada responsable y marca el flag.
El emisor es el creador de la tarea (o el del tablero); si el responsable es el único posible emisor, `notificar` no guarda
nada (no avisa de uno mismo) y se manda solo la push (`dispositivoService.avisar`). Una pasada: `enviarRecordatoriosTareas([ahora])`.
