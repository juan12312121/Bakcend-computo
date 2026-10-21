# Eventos (`/api/eventos`)

Fiestas, reuniones, clases, juntas de trabajo, torneos, conferencias... con fecha, lugar o enlace, cupo,
asistencia ("voy" / "me interesa" / "no voy") e invitaciones. Pueden pertenecer a un grupo.
Respuestas con el contrato estándar `{ success, mensaje, data, meta? }`, salvo `GET /:id/ics` (archivo iCalendar).

Leer no exige sesión (`AuthGuard.opcional`: sin sesión solo se ven los públicos); escribir sí (`Authorization: Bearer <token>`).

## Reglas

- **Visibilidad** (se aplica en TODAS las lecturas: listado, calendario, detalle, asistentes, .ics, asistencia e invitar):
  - `publico`: cualquiera, incluso sin sesión.
  - `seguidores`: quien sigue al creador con `estado = 'aceptado'` (una solicitud pendiente no basta).
  - `grupo`: miembros **activos** del grupo.
  - `privado`: el creador y sus invitados.
  - Siempre lo ven: el creador, cualquiera que tenga fila en el evento (invitado, voy, interesado, no voy) y los
    admin/moderadores del grupo del evento.
  - Sin acceso: 401 si no hay sesión, 403 con el motivo ("Este evento es privado: solo para invitados", ...). No existe: 404.
- **Crear**: el creador queda con "voy" (`total_asistentes = 1`, cuenta para el cupo). Con `grupo_id` hay que ser
  miembro activo (403) y la visibilidad por defecto es `grupo`; sin grupo, `publico`.
- **Editar / cancelar / eliminar**: el creador o un admin/moderador activo del grupo del evento (403).
  Un evento cancelado ya no se edita (400).
- **Terminado**: cuando pasa `fin`; si no tiene fin, 2 h después de `inicio`. Los terminados o cancelados no aceptan
  asistencia ni invitaciones (400).
- **Cupo**: máximo de personas con "voy" (`null` = sin límite). "Me interesa" no ocupa lugar.
- **Boletos** (módulo `boletos`, ver `boletos.md` y `pagos.md`): con `requiere_boleto = true`, marcar "voy" exige
  tener un boleto válido o usado (400 "Este evento requiere boleto..."); al emitirse un boleto el dueño queda con "voy"
  (sin revisar `cupo`: manda el cupo de cada tipo de boleto). **Cancelar** reembolsa los pagos, cancela los boletos
  gratis y libera las órdenes pendientes (un reembolso que falla no impide cancelar; se reintenta con
  `POST /api/boletos/eventos/:id/reembolsar`). **Eliminar** con pagos sin reembolsar → 409 (cancelar primero).
  `requiere_boleto` y `moneda` se cambian en `PUT /api/boletos/eventos/:id/configuracion`.
- **Fechas**: ISO 8601 con zona (`2026-10-18T19:00:00.000Z`). El frontend convierte el `datetime-local` con `toISOString()`.

## Tipos

```ts
type Modalidad = 'presencial' | 'en_linea' | 'hibrido';
type Categoria = 'social' | 'trabajo' | 'escuela' | 'deporte' | 'cultura' | 'tecnologia' | 'otro';
type Visibilidad = 'publico' | 'seguidores' | 'grupo' | 'privado';
type EstadoAsistencia = 'voy' | 'interesado' | 'no_voy' | 'invitado';

interface UsuarioPublico { id: number; nombre_usuario: string; nombre_completo: string; foto_perfil_url: string | null; carrera: string | null }
interface GrupoDeEvento { id: number; nombre: string; imagen_url: string | null; privacidad: 'publico' | 'privado' }

interface Evento {
  id: number;
  creador_id: number;
  grupo_id: number | null;
  titulo: string;
  descripcion: string | null;
  modalidad: Modalidad;
  categoria: Categoria;
  visibilidad: Visibilidad;
  lugar: string | null;            // presencial / híbrido
  enlace: string | null;           // en línea / híbrido (videollamada)
  inicio: string;                  // ISO
  fin: string | null;              // ISO
  portada_url: string | null;      // Cloudinary
  cupo: number | null;
  total_asistentes: number;        // con "voy"
  total_interesados: number;
  cancelado: boolean;
  recordatorio_enviado: boolean;
  requiere_boleto: boolean;        // [boletos] "voy" exige boleto
  moneda: string;                  // [boletos] ISO 4217, 'MXN' por defecto
  fecha_creacion: string;
  fecha_actualizacion: string;
  creador: UsuarioPublico;
  grupo: GrupoDeEvento | null;
  mi_estado: EstadoAsistencia | null;  // null sin sesión o sin relación
  puedo_editar: boolean;               // creador o admin/moderador del grupo
  lleno: boolean;                      // cupo !== null && total_asistentes >= cupo
  terminado: boolean;
}

// GET /:id, POST /, PUT /:id, POST /:id/cancelar
interface EventoDetalle extends Evento {
  asistentes_preview: UsuarioPublico[];  // hasta 8 con "voy", del primero en confirmar al último
  total_invitados: number;               // invitaciones aún sin responder
}

interface AsistenteDeEvento { usuario: UsuarioPublico; estado: EstadoAsistencia; invitado_por: number | null; desde: string }
```

## Endpoints

| Método | Path | Auth | Body / Query | Respuesta |
|---|---|---|---|---|
| GET | `/` | opcional | ver "Listado" | paginado `data: Evento[]`, `meta: { total, limit, offset, hayMas }` |
| GET | `/calendario` | opcional | `desde`, `hasta` (ISO, obligatorios, máx. 62 días) | `data: Evento[]` (sin paginar, máx. 500) |
| POST | `/` | sí | JSON o multipart (ver "Crear") | 201 `data: EventoDetalle` |
| GET | `/:id` | opcional | — | `data: EventoDetalle` |
| GET | `/:id/asistentes` | opcional | `estado` (`voy` por defecto, o `interesado` / `no_voy` / `invitado`), `limit`, `offset` | paginado `data: AsistenteDeEvento[]` |
| GET | `/:id/ics` | opcional | — | `text/calendar` (ver ".ics") |
| PUT | `/:id` | sí | JSON o multipart (ver "Editar") | `data: EventoDetalle` |
| POST | `/:id/cancelar` | sí | — | `data: EventoDetalle` (`cancelado: true`) |
| DELETE | `/:id` | sí | — | `mensaje: 'Evento eliminado'` |
| POST | `/:id/asistencia` | sí | `{ estado: 'voy' \| 'interesado' \| 'no_voy' }` | `data: { evento_id, mi_estado, total_asistentes, total_interesados, lleno }` |
| POST | `/:id/invitar` | sí | `{ usuario_ids: number[] }` (1-50) | `data: { invitados: number[], omitidos: number[] }` |

### Listado `GET /`

Query (todo opcional): `limit` (1-100, def. 20), `offset`, `categoria`, `grupo_id`, `texto` (busca en título,
descripción y lugar), `desde` / `hasta` (por fecha de inicio), `mios` y `cuando`.

- `cuando`: `proximos` (por defecto: los que no han terminado, del más cercano al más lejano), `pasados` (terminados,
  del más reciente al más viejo) o `todos` (por inicio ascendente).
- `mios` (requiere sesión, si no 401): `creados` · `voy` · `interesado` · `invitado` (invitaciones sin responder).
- Los cancelados también aparecen (con `cancelado: true`).

### Calendario `GET /calendario`

Eventos visibles que se cruzan con `[desde, hasta)`: `inicio < hasta` y (`fin >= desde` o, sin fin, `inicio >= desde`).
Errores 400 (`campo: 'hasta'`): `hasta <= desde` o rango de más de 62 días.

### Crear `POST /`

JSON, o multipart con la imagen en el campo **`portada`** (jpg, png, gif, webp; va a Cloudinary).
En multipart los vacíos (`""`) cuentan como no enviados.

| Campo | Regla |
|---|---|
| `titulo` | obligatorio, 1-150 |
| `descripcion` | opcional, máx. 5000 |
| `modalidad` | `presencial` (def.) / `en_linea` / `hibrido` |
| `categoria` | `social` (def.) / `trabajo` / `escuela` / `deporte` / `cultura` / `tecnologia` / `otro` |
| `visibilidad` | def. `grupo` si hay `grupo_id`, si no `publico`; `grupo` sin `grupo_id` → 400 |
| `lugar` | máx. 200; obligatorio si es presencial o híbrido |
| `enlace` | URL http(s), máx. 500; obligatorio si es en línea o híbrido |
| `inicio` | obligatorio, no en el pasado (tolerancia de 1 min) |
| `fin` | opcional, posterior a `inicio` |
| `cupo` | opcional, entero 1-100000 |
| `grupo_id` | opcional; hay que ser miembro activo (403), el grupo debe existir (404) |

Errores 400 con `errores: [{ campo, mensaje }]` (`fin`, `lugar`, `enlace`, `inicio`, `visibilidad`, `cupo`, ...). 401 sin sesión.

### Editar `PUT /:id`

Mismos campos, todos opcionales (no se cambia `grupo_id`). `descripcion`, `lugar`, `enlace`, `fin` y `cupo` aceptan
`null` (o `""` en multipart) para borrarlos. `portada` (archivo) reemplaza la anterior; `quitar_portada: true` la quita.
La portada anterior se borra de Cloudinary.

- La coherencia (fin > inicio, lugar / enlace según modalidad, visibilidad `grupo`) se revisa contra lo ya guardado.
- Si cambia `inicio`, no puede quedar en el pasado y se vuelve a programar el recordatorio.
- `cupo` no puede ser menor que `total_asistentes` (400, `campo: 'cupo'`).
- Sin cambios → 400 "No hay datos para actualizar". Cancelado → 400. Sin permiso → 403.

### Asistencia `POST /:id/asistencia`

Cambia mi estado y mueve los contadores (`voy` ↔ `total_asistentes`, `interesado` ↔ `total_interesados`).
Repetir el mismo estado no hace nada. Una invitación se acepta marcando `voy` o `interesado`.

- Cupo lleno al marcar `voy` → **409 "El evento ya está lleno"**.
- Evento cancelado → 400 "El evento fue cancelado"; terminado → 400 "El evento ya terminó".
- Sin acceso → 403.

### Invitar `POST /:id/invitar`

Quien puede ver el evento puede invitar; si es **privado**, solo quien lo puede editar (403).
Crea a cada persona con estado `invitado` e `invitado_por`, y le notifica. Se omiten (en `omitidos`) los repetidos,
uno mismo, cuentas inexistentes o desactivadas y quien ya tiene fila en el evento. Si solo me invito a mí → 400.
Cancelado o terminado → 400.

### `.ics` `GET /:id/ics`

`Content-Type: text/calendar; charset=utf-8`, `Content-Disposition: attachment; filename="evento-<id>.ics"`.
Un `VCALENDAR` con un `VEVENT`: `UID:evento-<id>@trinoflow`, `DTSTART` / `DTEND` en UTC (`20261018T190000Z`;
sin fin = inicio + 2 h), `SUMMARY`, `DESCRIPTION` (descripción, organizador, enlace y la URL del evento en la app),
`LOCATION` (lugar o enlace), `URL`, `STATUS:CONFIRMED` o `CANCELLED`. Líneas CRLF plegadas a 75 bytes.
Sirve para Google Calendar, Outlook y el calendario del teléfono. Misma regla de visibilidad (401 / 403).

## Notificaciones

Todas con `entidad_tipo: 'evento'` y `entidad_id: <id del evento>` (además de SSE y push al teléfono).
Nunca se notifica a quien provoca la acción.

| Tipo | Cuándo | A quién | `mensaje` (sigue al nombre de quien la provoca) |
|---|---|---|---|
| `evento_invitacion` | POST `/:id/invitar` | cada invitado nuevo | `te invitó al evento «Fiesta»` |
| `evento_actualizado` | PUT `/:id` cambia fecha (inicio/fin), lugar o enlace | `voy` + `interesado` | `cambió la fecha y el lugar del evento «Fiesta»` |
| `evento_cancelado` | POST `/:id/cancelar` | `voy` + `interesado` + `invitado` | `canceló el evento «Fiesta»` |
| `evento_recordatorio` | tarea programada | `voy` + `interesado` | `organiza «Fiesta», que empieza en menos de una hora` (emisor: el creador) |

No se notifica al creador cada vez que alguien marca "voy".

## Tarea programada

`programarRecordatoriosEventos()` (en `evento.service.ts`; se llama una vez en `server.ts`): cada 10 min busca eventos
no cancelados, sin recordatorio, que empiezan dentro de la próxima hora; marca `recordatorio_enviado` y avisa.
`enviarRecordatoriosEventos([ahora])` hace una sola pasada (devuelve cuántos eventos procesó).

## Socket.IO

Este módulo no emite eventos de Socket.IO.
