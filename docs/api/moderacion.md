# Moderación (`/api/moderacion`)

Reportes de cualquier contenido en una bandeja común, acciones de los admins con historial y notas internas,
suspensiones con fecha de fin, palabras prohibidas y estadísticas.
Todo requiere sesión (`Authorization: Bearer <token>`); lo marcado **admin** responde 403 a los demás.
Paginación (`limit` 1-100 def. 20, `offset` def. 0) → `meta: { total, limit, offset, hayMas }`.

Tipos de contenido (`tipo`): `publicacion` · `comentario` · `mensaje_chat` · `mensaje_grupo` · `usuario` · `grupo` ·
`evento` · `publicacion_canal` (este último solo cuando el módulo de canales registra su proveedor).
Motivos: los mismos que en `/api/reportes` ('Acoso o bullying', 'Violencia o daño', 'Spam o publicidad', 'Información falsa',
'Suplantación de identidad', 'Lenguaje ofensivo', 'Otro').

## Reportar (cualquier usuario)

| Método | Path | Body / Query | Respuesta |
|---|---|---|---|
| GET | `/opciones` | — | `data: { motivos: string[], tipos: Tipo[] }` (tipos que hoy se pueden reportar) |
| POST | `/reportes` | `{ tipo, id, motivo, descripcion? (≤500) }` | 201 `data: { reporte: ReporteContenido, total_reportes, publicacion_oculta? }` |

- `id` es el id del contenido (para `usuario`, el id del usuario reportado).
- Se guarda una **copia** del contenido (`copia`) por si después lo borran.
- Un reporte por persona y contenido → **409** "Ya reportaste este contenido".
- Lo propio → **400** ("No puedes reportar tu propio contenido" / "No puedes reportarte a ti mismo").
- Visibilidad: publicación/comentario/evento que no puedes ver → **404**; mensaje de chat directo de un chat en el que no
  participas → **403**; mensaje de grupo sin ser miembro activo → **403**; usuario inexistente o eliminado → **404**.
- `publicacion` usa el mismo flujo que `POST /api/reportes/crear` (umbral de 5 reportes, `publicacion_oculta`).
- Tipo sin proveedor registrado → **400** "Todavía no se puede reportar ...".

```ts
interface ReporteContenido {
  id; tipo; contenido_id; usuario_id /* quien reporta */; autor_id: number | null;
  motivo; descripcion: string | null; copia: CopiaContenido | null;
  estado: 'pendiente' | 'resuelto' | 'descartado'; resuelto_por: number | null; fecha_resolucion: fecha | null; fecha_creacion;
  reportante?: UsuarioPublico; autor?: UsuarioPublico & { suspendido: boolean };
}
interface CopiaContenido {
  texto: string; titulo?: string | null; imagen_url?: string | null; archivo_url?: string | null; tipo_archivo?: string | null;
  contexto?: Record<string, number | string | null>; // publicacion_id (comentario), chat_id, grupo_id, inicio (evento)...
}
```

## Bandeja (admin)

| Método | Path | Body / Query | Respuesta |
|---|---|---|---|
| GET | `/bandeja` | `tipo?`, `estado?` ('pendiente' def. \| 'resuelto' \| 'descartado'), `motivo?`, `limit`, `offset` | paginado `ContenidoReportado[]` |
| GET | `/contenidos/:tipo/:contenidoId` | — | `DetalleContenidoReportado` (404 si no tiene reportes) |
| POST | `/contenidos/:tipo/:contenidoId/resolver` | `ResolverDto` | `ResultadoResolucion` |
| POST | `/contenidos/:tipo/:contenidoId/notas` | `{ texto (≤2000) }` | 201 `NotaModeracion` (con `admin`) · 404 si no tiene reportes |
| GET | `/historial` | `accion?`, `tipo?`, `contenido_id?`, `admin_id?`, `autor_id?`, `limit`, `offset` | paginado `AccionModeracion[]` |
| POST | `/importar-reportes-publicaciones` | — | `data: { cantidad }` — copia a la bandeja los reportes de publicaciones anteriores (idempotente) |

La bandeja agrupa por contenido. Pendientes: el más reportado primero; resueltos/descartados: el último cerrado primero.
Con `motivo` solo cuentan los reportes de ese motivo.

```ts
interface ContenidoReportado {
  tipo; contenido_id; estado; total_reportes: number;
  motivos: { motivo; total }[];                 // de más a menos
  primer_reporte: fecha; ultimo_reporte: fecha;
  copia: CopiaContenido | null;                 // la del reporte más reciente
  autor: (UsuarioPublico & { suspendido: boolean; suspension_hasta: fecha | null }) | null;
  reportantes: UsuarioPublico[];                // hasta 5, más recientes
  descripciones: { usuario: UsuarioPublico | null; motivo; descripcion; fecha }[]; // hasta 5
  existe: boolean;                              // false si el contenido ya se borró
  acciones: ('descartar' | 'ocultar' | 'borrar' | 'advertir' | 'suspender')[]; // las que admite
}
interface DetalleContenidoReportado extends ContenidoReportado {
  reportes: ReporteContenido[]; notas: NotaModeracion[]; historial: AccionModeracion[];
}
interface NotaModeracion { id; admin_id; tipo; contenido_id; texto; fecha_creacion; admin: UsuarioPublico }
interface AccionModeracion {
  id; admin_id: number | null; accion: 'descartar' | 'ocultar' | 'borrar' | 'advertir' | 'suspender' | 'levantar_suspension';
  tipo: Tipo | null; contenido_id: number | null; autor_id: number | null; detalle: string | null; fecha_creacion;
  admin: UsuarioPublico | null; autor: UsuarioPublico | null;
}
```

### Resolver

```ts
interface ResolverDto {
  acciones: ('descartar' | 'ocultar' | 'borrar' | 'advertir' | 'suspender')[]; // ≥ 1, sin repetir
  mensaje?: string;              // ≤1000, requerido con 'advertir' (también es el motivo de la suspensión)
  dias?: number | null;          // 1-3650 con 'suspender'; sin días = permanente
  nota?: string;                 // ≤2000, nota interna
  avisar_reportantes?: boolean;  // def. true
}
interface ResultadoResolucion {
  tipo; contenido_id; estado: 'resuelto' | 'descartado'; acciones; reportes_cerrados: number;
  reportantes_avisados: number; suspension: { id, suspendido: true, hasta: fecha | null } | null;
}
```

- `descartar` no se combina con otras; `ocultar` y `borrar` son excluyentes → **400**.
- Qué admite cada tipo: `ocultar` solo publicaciones; `borrar` publicaciones, comentarios, mensajes, grupos y eventos
  (y publicaciones de canal si su proveedor lo dice); usuarios solo `advertir`/`suspender` → si no aplica **400**.
- Sin reportes pendientes → **409**. Suspenderse a uno mismo → **400**.
- Borrar usa el flujo del dueño del contenido: `publicacionService.eliminar(..., { comoAdmin })`, `comentarioService.eliminar`
  (contadores y avisos), `chatService.eliminarMensaje` (socket `mensaje_eliminado`), `chatGrupoService.eliminar`
  (`mensaje_grupo_eliminado`), `eventoService.eliminar`; un grupo se borra con todo en cascada. Si ya no existe, sigue.
- Todos los reportes pendientes del contenido pasan a `resuelto` (o `descartado`), se guarda una `AccionModeracion` por
  acción y la nota si viene.
- Bitácora de seguridad: `ADMIN_DELETE_CONTENT` (`{ tipo, contenido_id, autorId }`) y `ADMIN_SUSPEND_USER`
  (`{ targetUserId, motivo, dias, tipo, contenido_id }`).
- Notificaciones (`tipo: 'reporte_resuelto'`, `de_usuario_id` = admin):
  - `advertir` → al autor: "Advertencia de moderación: <mensaje>", apuntando al contenido si sigue existiendo
    (`publicacion_id` en publicaciones y comentarios; `entidad_tipo` 'comentario' | 'usuario' | 'grupo' | 'evento').
  - `avisar_reportantes` → a cada quien reportó (menos el autor): "Revisamos tu reporte sobre ... y tomamos medidas" o
    "... y no encontramos una falta a las normas de la comunidad" (sin entidad).

## Suspensiones (admin)

| Método | Path | Body / Query | Respuesta |
|---|---|---|---|
| GET | `/suspensiones` | `activas?` ('true' def. \| 'false' = todas), `limit`, `offset` | paginado `Suspension[]` (con `usuario` y `admin`) |
| POST | `/usuarios/:id/suspender` | `{ dias? (1-3650), motivo? (≤500) }` | `{ id, suspendido: true, hasta: fecha \| null }` |
| DELETE | `/usuarios/:id/suspension` | — | `{ id, suspendido: false, hasta: null }` · 400 si no estaba suspendido |

`usuarios.suspendido` sigue siendo lo que revisa `AuthGuard` (efecto inmediato). La tabla `suspensiones` guarda
`{ id, usuario_id, admin_id (null = automática), motivo, hasta (null = permanente), activa, levantada_en, fecha_creacion }`.
Una suspensión nueva reemplaza a la activa. Tarea programada: `programarFinSuspensiones()` (cada 5 min) levanta las vencidas
y deja `SUSPENSION_VENCIDA` en la bitácora. Ambas acciones quedan en el historial (`suspender` / `levantar_suspension`)
y en la bitácora (`ADMIN_SUSPEND_USER` / `ADMIN_UNSUSPEND_USER`).

## Estadísticas (admin)

| Método | Path | Query | Respuesta |
|---|---|---|---|
| GET | `/estadisticas` | `dias` (1-90, def. 14) | `EstadisticasModeracion` |
| GET | `/usuarios-reportados` | `limit` (1-50, def. 10) | `UsuarioMasReportado[]` |

```ts
interface EstadisticasModeracion {
  pendientes: { reportes: number; contenidos: number; por_tipo: Record<Tipo, number> };
  resueltos_por_dia: { fecha: 'YYYY-MM-DD' /* UTC */; resueltos: number; descartados: number }[]; // contenidos cerrados
  total_resueltos: number; total_descartados: number;
  motivos: { motivo; total }[];                      // todos los reportes, del más común al menos
  usuarios_mas_reportados: UsuarioMasReportado[];    // top 5
}
interface UsuarioMasReportado {
  usuario: UsuarioPublico & { suspendido: boolean; suspension_hasta: fecha | null };
  reportes: number; pendientes: number; contenidos_reportados: number;
}
```

## Palabras prohibidas (admin)

| Método | Path | Body / Query | Respuesta |
|---|---|---|---|
| GET | `/palabras` | `q?`, `accion?`, `activa?` ('true' \| 'false'), `limit`, `offset` | paginado `PalabraProhibida[]` (orden alfabético) |
| POST | `/palabras` | `{ palabra (≤100), coincidencia? ('exacta' def. \| 'contiene'), accion? ('censurar' def. \| 'bloquear'), aplica_a? (Contexto[] ≥1, def. todos), activa? }` | 201 `PalabraProhibida` · 409 si ya existe (sin mayúsculas ni acentos) |
| PATCH | `/palabras/:id` | cualquiera de los campos anteriores (≥1) | `PalabraProhibida` |
| DELETE | `/palabras/:id` | — | mensaje · 404 si no existe |
| POST | `/palabras/probar` | `{ texto (≤5000), contexto? (def. 'publicacion') }` | `ResultadoRevision` |

```ts
type Contexto = 'publicacion' | 'comentario' | 'mensaje' | 'nombre';
interface PalabraProhibida { id; palabra; coincidencia; accion; aplica_a: Contexto[]; activa; creado_por; fecha_creacion; fecha_actualizacion }
interface ResultadoRevision {
  permitido: boolean;   // false si alguna coincidencia bloquea
  texto: string;        // con las coincidencias cambiadas por * (los espacios se respetan)
  coincidencias: { id; palabra; accion; coincidencia; fragmento /* tal como estaba escrito */ }[];
}
```

Reglas: se compara sin mayúsculas ni acentos y con espacios normalizados. `exacta` respeta límites de palabra ("mal" no
coincide en "maleta"); `contiene` coincide en cualquier parte. En el contexto `nombre` cualquier coincidencia bloquea
(un nombre con *** no sirve).

### Uso desde otros módulos

```ts
import { asegurarTextoPermitido, revisarTexto } from '../moderacion/palabras.service';
// o moderacionService.revisarTexto(texto, contexto)
const texto = await asegurarTextoPermitido(dto.texto, 'comentario'); // texto censurado, o 400 BadRequestError
```

Mensaje del 400: "El comentario contiene palabras no permitidas («x»). Cámbialas para poder continuar."
Las reglas activas viven en caché en memoria; se recargan al crear/editar/borrar y cada 5 minutos.
