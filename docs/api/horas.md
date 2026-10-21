# API · Control de horas (`/api/horas`)

Tiempo trabajado en las tareas de los tableros (`/api/tableros`): cronómetro (uno activo por persona), registros a mano,
resúmenes por persona y por tarea con tarifa por hora opcional (del tablero o del miembro) e importe, y exportar CSV.
Módulo `modules/aula/horas` (router `horaRoutes`). **Todo exige sesión**.

Permisos (los del tablero de la tarea, ver [`tableros.md`](tableros.md)):
- **ver** tiempo y resúmenes: quien puede ver el tablero.
- **registrar** (cronómetro, a mano, editar/borrar lo propio): nivel **editar** (no observadores) y tablero no archivado (400).
- **tarifas**: verlas quien ve el tablero; cambiarlas solo **administrar**.
- Solo se editan/borran los registros **propios** (403).

Al borrar una tarea o un tablero se borra su tiempo (cascada).

## Objetos

```ts
interface RegistroHoras {
  id: number; tarea_id: number; tablero_id: number; usuario_id: number;
  inicio: string; fin: string | null;   // fin null = cronómetro corriendo
  minutos: number;                      // si corre: los que lleva hasta ahora
  nota: string | null;                  // máx. 500
  facturable: boolean;                  // true por defecto
  corriendo: boolean;
  fecha_creacion: string; fecha_actualizacion: string;
  usuario: UsuarioPublico | null;
  tarea?: { id: number; clave: string; titulo: string; tablero: { id; nombre; clave; color } | null }; // en cronómetro y respuestas de escritura
}
```

## Endpoints

| Método | Ruta | Body / query | `data` |
|---|---|---|---|
| GET | `/activo` | — | `RegistroHoras` (con `tarea`) o `null` |
| POST | `/tareas/:tarea_id/iniciar` | `{ nota?, facturable? }` | `{ registro, detenido }` (201) |
| POST | `/detener` | — | `RegistroHoras` detenido (404 si no hay cronómetro) |
| GET | `/tareas/:tarea_id` | — | `TiempoDeTarea` |
| POST | `/tareas/:tarea_id` | `{ minutos, inicio? }` o `{ inicio, fin }` + `nota?`, `facturable?` | `RegistroHoras` (201) |
| PUT | `/registros/:id` | `inicio?`, `fin?` o `minutos?`, `nota?` (null borra), `facturable?` | `RegistroHoras` |
| DELETE | `/registros/:id` | — | mensaje |
| GET | `/tableros/:id/resumen` | `desde`*, `hasta`* (máx. 366 días), `usuario_id?`, `facturable?` | `ResumenHoras` |
| GET | `/tableros/:id/csv` | igual + `zona?` (IANA, p. ej. `America/Mexico_City`; UTC por defecto) | archivo CSV |
| GET | `/tableros/:id/tarifas` | — | `TarifasVista` |
| PUT | `/tableros/:id/tarifas` | `{ usuario_id?: number \| null, tarifa: number \| null, moneda?: "MXN" }` | `TarifasVista` |

### Cronómetro
- **Uno activo por persona** (índice único `cronometro_de`): iniciar en otra tarea **detiene** el que corría y lo
  devuelve en `detenido` (mensaje "Cronómetro iniciado (se detuvo el anterior)"). Iniciar en la misma tarea → **409**.
- Detener guarda `fin = ahora` y `minutos` redondeados al minuto.
- Mientras corre solo se cambian `nota`, `facturable` e `inicio` (no en el futuro); `fin`/`minutos` → 400
  ("Detén el cronómetro antes de cambiar su duración"). Borrarlo apaga el cronómetro.

### Registros a mano
- `{ minutos }` (1–1440): termina ahora; con `inicio`, termina `inicio + minutos`. `{ inicio, fin }`: `fin` > `inicio`.
- Un registro dura de 1 minuto a 24 horas y no puede terminar en el futuro (5 min de tolerancia) → 400.
- Editar solo el `inicio` conserva la duración; `minutos` o `fin` la cambian (no los dos: 400).

```ts
interface TiempoDeTarea {
  registros: RegistroHoras[];   // de todos, más recientes primero
  total_minutos: number; facturable_minutos: number; mis_minutos: number;
  activo: RegistroHoras | null; // MI cronómetro si corre en esta tarea
  puede_registrar: boolean;
}
```

### Resumen y tarifas
- Cuenta los registros que **empiezan** en `[desde, hasta)`, incluido el cronómetro que corre (hasta ahora).
- Tarifa aplicable: la del miembro si tiene; si no, la del tablero. Importe = minutos facturables / 60 × tarifa.
  Sin ninguna tarifa, `importe`/`importe_total` son `null`. Una sola moneda por tablero (código de 3 letras).

```ts
interface ResumenHoras {
  desde: string; hasta: string; moneda: string; registros: number;
  total_minutos: number; facturable_minutos: number; importe_total: number | null;
  por_persona: { usuario: UsuarioPublico; minutos: number; facturable_minutos: number; tarifa: number | null; importe: number | null }[]; // más tiempo primero
  por_tarea: { tarea: { id: number; clave: string; titulo: string }; minutos: number; facturable_minutos: number; importe: number | null }[];
}
interface TarifasVista { moneda: string; tablero: number | null; miembros: { usuario_id: number; tarifa: number }[] }
```

`tarifa: null` quita la tarifa (del tablero o del miembro). El miembro debe tener acceso al tablero (400).

**CSV** (`text/csv; charset=utf-8` con BOM, `horas-<clave>-<desde>-a-<hasta>.csv`): un renglón por registro
`Inicio, Fin, Persona, Usuario, Tarea, Título, Nota, Minutos, Horas, Facturable, Tarifa/h (MXN), Importe (MXN)`
(fechas `AAAA-MM-DD HH:mm` en `zona`; "En curso" si corre) y una fila `Total`.

## Socket.IO

| Evento | Sala | Datos | Cuándo |
|---|---|---|---|
| `horas_actualizadas` | `board_<tablero_id>` | `{ tablero_id, tarea_id \| null, por_usuario_id }` | iniciar, detener, registrar, editar, borrar, cambiar tarifas |
| `cronometro_actualizado` | `user_<id>` (personal) | `{ activo: RegistroHoras \| null }` | mi cronómetro arranca, se detiene o se borra (sincroniza otras pestañas/dispositivos) |

## Notificaciones

No genera notificaciones.
