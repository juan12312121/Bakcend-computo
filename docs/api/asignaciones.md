# API · Tareas con entrega (`/api/aula`)

Tareas de escuela dentro de un grupo ("asignaciones"): el **maestro** (admin/moderador activo del grupo) las crea con
instrucciones, archivo de apoyo opcional, fecha de entrega, puntos y si acepta entregas tardías; los **alumnos**
(miembros activos con rol `miembro`) entregan archivo + comentario; el maestro califica, devuelve para corregir y lleva
la libreta de calificaciones. Mismo router que el calendario (`aulaRoutes`, ver [`aula.md`](aula.md)).

Todo exige sesión. Grupo/asignación inexistente → **404**; sin el rol pedido → **403**; validación → **400** con `errores[]`.

## Estados de una entrega (por alumno)

| Estado | Significado |
|---|---|
| `pendiente` | no ha entregado (no hay fila, o solo hay una calificación sin entrega) |
| `entregada` | entregó a tiempo, espera calificación |
| `tarde` | entregó después de la fecha (solo si `acepta_tardias`), espera calificación |
| `calificada` | tiene puntos; ya **no** puede reentregar (409) salvo que el maestro la devuelva |
| `devuelta` | el maestro la devolvió para corregir (se quitan los puntos); puede reentregar **aunque haya vencido** |

Reglas de entrega:
- Puede reentregar mientras no esté calificada (sube `intentos`, reemplaza el archivo si manda uno nuevo; si no manda
  archivo conserva el anterior).
- Después de la fecha: si `acepta_tardias` queda `tarde` (`fue_tarde: true`, se conserva al calificar); si no → **400**
  (`"La fecha de entrega ya pasó y esta tarea no acepta entregas tardías"`), excepto si está `devuelta`.
- Hace falta archivo o comentario (contando el archivo que ya estaba) → si no, **400**.

## Objetos

```ts
interface Asignacion {
  id: number; grupo_id: number; creador_id: number;
  titulo: string; instrucciones: string | null;
  archivo_url: string | null; archivo_nombre: string | null; archivo_tipo: string | null;  // apoyo (Cloudinary)
  fecha_entrega: string;          // ISO
  puntos_maximos: number;         // 1..10000 (100 por defecto)
  acepta_tardias: boolean;        // true por defecto
  fecha_creacion: string; fecha_actualizacion: string;
  creador: UsuarioPublico | null;
  vencida: boolean;               // ya pasó la fecha
  mi_rol: 'maestro' | 'alumno';
  mi_estado: EstadoAlumno | null; // solo alumnos
  mi_entrega: Entrega | null;     // solo alumnos
  puede_entregar: boolean;        // solo alumnos (regla de arriba)
  resumen: {                      // solo maestros
    total_alumnos: number; por_calificar: number; calificadas: number; devueltas: number;
    sin_entregar: number; tarde: number;   // tarde = de las por calificar, cuántas llegaron tarde
  } | null;
}

interface Entrega {
  id: number; asignacion_id: number; alumno_id: number;
  estado: 'entregada' | 'tarde' | 'calificada' | 'devuelta';
  comentario: string | null;
  archivo_url: string | null; archivo_nombre: string | null; archivo_tipo: string | null;
  entregada_en: string | null;    // null si se calificó sin entrega
  fue_tarde: boolean; intentos: number;
  puntos: number | null;          // hasta 2 decimales
  retroalimentacion: string | null;
  calificada_en: string | null; calificada_por: number | null;
  fecha_creacion: string; fecha_actualizacion: string;
  alumno?: UsuarioPublico;
}

interface FilaEntregas { alumno: UsuarioPublico; estado: EstadoAlumno; entrega: Entrega | null }
```

## Endpoints

| Método | Ruta | Quién | Body / query | `data` |
|---|---|---|---|---|
| GET | `/grupos/:grupo_id/asignaciones` | miembro | `cuando=todas\|proximas\|pasadas` (todas), `limit`, `offset` | `Asignacion[]` + `meta` |
| POST | `/grupos/:grupo_id/asignaciones` | maestro | JSON o multipart: `titulo`*, `instrucciones`, `fecha_entrega`* (futura), `puntos_maximos`, `acepta_tardias`, `archivo` (imagen/documento) | `Asignacion` (201) |
| GET | `/asignaciones/:id` | miembro | — | `Asignacion` |
| PUT | `/asignaciones/:id` | maestro | JSON o multipart, todo opcional (al menos uno): `titulo`, `instrucciones` (null/"" borra), `fecha_entrega`, `puntos_maximos`, `acepta_tardias`, `quitar_archivo`, `archivo` | `Asignacion` |
| DELETE | `/asignaciones/:id` | maestro | — | mensaje (borra entregas y archivos) |
| GET | `/asignaciones/:id/entregas` | maestro | — | `FilaEntregas[]` (todos los alumnos activos, por nombre; los que faltan con `entrega: null`) |
| POST | `/asignaciones/:id/entrega` | alumno | multipart: `archivo`, `comentario` | `Asignacion` (mensaje "Tarea entregada" / "Tarea entregada (tarde)") |
| POST | `/asignaciones/:id/entregas/:alumno_id/calificar` | maestro | `{ puntos (0..puntos_maximos), retroalimentacion? }` | `FilaEntregas` |
| POST | `/asignaciones/:id/entregas/:alumno_id/devolver` | maestro | `{ retroalimentacion* }` | `FilaEntregas` |
| GET | `/grupos/:grupo_id/libreta` | miembro | — | `Libreta` |
| GET | `/grupos/:grupo_id/libreta/csv` | maestro | — | archivo CSV |

Detalles:
- **Listado**: `todas` y `proximas` de la fecha más cercana a la más lejana; `pasadas` de la más reciente a la más vieja.
- **Editar**: `puntos_maximos` no puede quedar por debajo de una calificación ya puesta (400). Cambiar `fecha_entrega`
  reactiva el recordatorio. Un archivo nuevo o `quitar_archivo` borra el anterior de Cloudinary.
- **Calificar** a un alumno que no entregó crea su fila calificada (p. ej. un 0, `entregada_en: null`, `intentos: 0`).
  `alumno_id` debe ser alumno activo (403). Se puede recalificar.
- **Devolver** exige que haya entregado algo (400).
- Un maestro no entrega (403 `"Solo los alumnos (miembros del grupo) entregan tareas"`).

### Libreta

```ts
interface Libreta {
  mi_rol: 'maestro' | 'alumno';
  asignaciones: { id: number; titulo: string; fecha_entrega: string; puntos_maximos: number }[]; // por fecha
  alumnos: {
    alumno: UsuarioPublico;
    celdas: { asignacion_id: number; estado: EstadoAlumno; puntos: number | null; fue_tarde: boolean }[]; // mismo orden
    puntos_obtenidos: number; puntos_posibles: number;
    promedio: number | null;      // obtenidos / posibles de lo CALIFICADO × 100, 1 decimal
    entregadas: number;           // asignaciones con algo (estado ≠ pendiente)
    faltantes: number;            // vencidas sin entregar
  }[];
  promedio_grupo: number | null;  // media de los promedios (null para alumnos)
  por_asignacion: { asignacion_id: number; promedio: number | null; entregadas: number; calificadas: number }[]; // [] para alumnos
}
```

El maestro ve a todos los alumnos activos (por nombre); un alumno solo su propia fila.

**CSV** (`text/csv; charset=utf-8`, con BOM, `libreta-<grupo>.csv`): `Alumno, Usuario, "<Título> (/máx)"..., Promedio %,
Entregadas, Faltantes`; en cada celda los puntos si está calificada o el texto del estado (Entregada / Tarde / Devuelta);
última fila "Promedio del grupo". Textos que empiezan con `= + - @` se prefijan con `'`.

## Notificaciones (`entidad_tipo: 'asignacion'`, `entidad_id` = asignación → `/asignaciones/:id`)

| Tipo | Cuándo | A quién | `mensaje` |
|---|---|---|---|
| `asignacion_nueva` | crear | cada alumno activo | `dejó la tarea «X» en <grupo>` |
| `entrega_recibida` | entregar / reentregar | el creador de la asignación | `entregó «X»` · `volvió a entregar «X» (tarde)` |
| `entrega_calificada` | calificar | el alumno | `calificó «X»: 8.5/10` |
| `entrega_calificada` | devolver | el alumno | `te devolvió «X» para corregir` |
| `tarea_vence` | recordatorio | alumnos sin entregar o con entrega devuelta | `te recuerda que «X» se entrega en menos de 24 horas` (emisor: el creador) |

## Tarea programada

`programarRecordatoriosEntregas()` (en `asignaciones/asignacion.service.ts`; llamarla una vez en `server.ts`): cada
15 min busca asignaciones sin recordatorio que vencen en las próximas 24 h, las marca y avisa a quien falta.
`enviarRecordatoriosEntregas([ahora])` hace una pasada y devuelve cuántos avisos mandó.

## Socket.IO

No emite eventos (los avisos llegan por notificaciones SSE + push).
