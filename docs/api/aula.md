# API · Aula y calendario del grupo (`/api/aula`)

Módulo `modules/aula` (router `aulaRoutes`). Agrupa el **calendario compartido del grupo** (este documento) y las
**tareas con entrega** de escuela (ver [`asignaciones.md`](asignaciones.md)). El control de horas de los tableros está
en [`horas.md`](horas.md) (`/api/horas`).

Respuestas con el contrato estándar `{ success, mensaje, data, meta? }`, salvo el `.ics` y los CSV (archivos).
Todo exige sesión (`Authorization: Bearer <token>`) **excepto** `GET /ics/:token/grupos/:grupo_id.ics`.

## Roles en el aula de un grupo

| Rol | Quién |
|---|---|
| **maestro** | miembro **activo** del grupo con rol `admin` o `moderador` |
| **alumno** | miembro **activo** con rol `miembro` |

Grupo inexistente → **404**. No ser miembro activo (incluye solicitudes pendientes) → **403**
(`"Solo los miembros del grupo pueden ver su aula"`).

## Resumen del aula

### `GET /grupos/:grupo_id`

```jsonc
{
  "grupo": { "id": 4, "nombre": "Matemáticas 3°", "tipo": "escuela" },
  "mi_rol": "alumno",            // | "maestro"
  "total_alumnos": 25,
  "total_asignaciones": 8,
  "pendientes": 2,               // alumno: tareas que aún puede entregar y no ha entregado (o devueltas)
  "por_calificar": 0             // maestro: entregas esperando calificación
}
```

## Calendario del grupo

### `GET /grupos/:grupo_id/calendario?desde=ISO&hasta=ISO`

Todo lo del grupo que cae en `[desde, hasta)` (máximo **62 días**; `hasta` > `desde`, si no **400**), sin paginar y
ordenado por fecha (a la misma hora: evento → tarea → entrega). Junta:

- **Eventos** con `grupo_id` del grupo que el usuario puede ver (misma regla que `/api/eventos`: `publico`, `grupo`,
  `seguidores` si sigue al creador, `privado` si es creador o invitado; los maestros ven todos). Incluye cancelados
  (`cancelado: true`). Un evento cuenta si se cruza con el rango.
- **Tareas de tableros** del grupo (no archivados, tarea no archivada) con `fecha_limite` en el rango.
- **Asignaciones** (tareas con entrega) del grupo con `fecha_entrega` en el rango.

```ts
interface ElementoCalendario {
  id: string;                 // "evento-3" | "tarea-12" | "asignacion-5" (único entre tipos)
  tipo: 'evento' | 'tarea' | 'asignacion';
  entidad_id: number;
  titulo: string;
  inicio: string;             // ISO. Evento: inicio. Tarea/asignación: fecha límite
  fin: string | null;         // solo eventos (null = sin fin; se asumen 2 h)
  color: string;              // hex por tipo: evento #f97316 · tarea #0ea5e9 · asignacion #8b5cf6
  enlace: string;             // ruta de la app: "/eventos/3" · "/tableros/4?tarea=12" · "/asignaciones/5"
  detalle: string | null;     // evento: lugar o "En línea" · tarea: "LAB-1 · Laboratorio" · asignación: "20 puntos"
  cancelado: boolean;         // evento cancelado
  completado: boolean;        // tarea terminada · asignación ya entregada por mí (no pendiente ni devuelta)
  estado: 'pendiente' | 'entregada' | 'tarde' | 'calificada' | 'devuelta' | null; // asignación vista por un alumno
}
```

### `GET /grupos/:grupo_id/calendario/suscripcion`

Enlaces secretos del usuario para suscribirse al calendario del grupo desde Google Calendar, Outlook o el teléfono.
El token es **uno por usuario** (sirve para todos sus grupos) y se crea la primera vez; siempre devuelve el mismo.

```jsonc
{
  "url": "https://api.trinoflow.app/api/aula/ics/<token>/grupos/4.ics",
  "webcal": "webcal://api.trinoflow.app/api/aula/ics/<token>/grupos/4.ics",
  "google": "https://calendar.google.com/calendar/r?cid=webcal%3A%2F%2F..."   // abre "Agregar calendario"
}
```

La base sale de `API_URL` (`.env`): debe ser la URL **pública** del backend para que Google pueda leerla.

### `POST /grupos/:grupo_id/calendario/suscripcion/regenerar`

Cambia el token: **todas** las suscripciones anteriores del usuario dejan de funcionar (404). Devuelve los enlaces nuevos.

### `GET /ics/:token/grupos/:grupo_id.ics` (sin sesión)

`text/calendar` (RFC 5545) con lo del grupo desde hace 60 días hasta dentro de 180, con la visibilidad del dueño del
token. `X-WR-CALNAME: TrinoFlow · <grupo>`, refresco sugerido cada hora. Cada elemento es un `VEVENT` con
`UID: <id>@trinoflow`, `URL` a la app (`FRONTEND_URL` + `enlace`) y `CATEGORIES` = tipo. Las tareas y entregas se
pintan como un bloque de 30 min que **termina** en la fecha límite (`SUMMARY: "Tarea: ..."`, `"Entrega: ..."`);
los eventos cancelados van con `STATUS:CANCELLED`.

Errores: token mal formado → **400**; token inexistente, regenerado, grupo inexistente o el dueño ya no es miembro
activo → **404** (no se distingue).

## Socket.IO y notificaciones

El calendario no emite eventos ni notificaciones.
