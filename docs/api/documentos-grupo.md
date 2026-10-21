# API · Documentos colaborativos (`/api/documentos-colaborativos`)

Documentos de texto que se editan entre varios **en tiempo real con Yjs** (tipo Google Docs sencillo).
No confundir con `/api/documentos` (adjuntos de publicaciones). Todas las rutas exigen `Authorization: Bearer <token>`.
Contrato estándar (`success`, `mensaje`, `data`, `meta`).

## Quién puede qué

| Documento | ver | editar (escribir, renombrar, versiones) | administrar (papelera, restaurar, borrar) | compartir |
|---|---|---|---|---|
| De un grupo (`grupo_id`) | miembros activos | miembros activos | su creador y los admin/moderadores del grupo | no aplica (400) |
| Personal (`grupo_id: null`) | dueño + compartidos | dueño + compartidos con `editar` | dueño | dueño |

Un documento en la papelera no se edita (409) ni se abre en vivo. No se comparte con uno mismo (400), con
usuarios inexistentes (404) ni si hay un bloqueo entre ambos (403).

## Objeto `Documento` (detalle)

```jsonc
{
  "id": 4, "titulo": "Acta de la reunión",
  "grupo_id": 7,                                   // null = personal
  "propietario_id": 2,
  "resumen": "Acuerdos sobre la fiesta…",          // primeros 280 caracteres del texto (vista previa)
  "en_papelera": false, "fecha_papelera": null,
  "ultimo_editor_id": 3, "fecha_edicion": "...",   // último que editó y cuándo
  "fecha_creacion": "...", "fecha_actualizacion": "...",
  "propietario": { /* usuario público */ },
  "ultimo_editor": { /* usuario público */ } ,     // o null
  "grupo": { "id": 7, "nombre": "Club", "imagen_url": null, "tipo": "comunidad" },   // o null
  // solo en el detalle (GET /:id, crear, renombrar, papelera, restaurar):
  "mi_acceso": { "rol": "miembro", "ver": true, "editar": true, "administrar": false, "compartir": false },
  "editando_ahora": [2, 3]                         // ids de quienes lo tienen abierto en este momento
}
```

`rol`: `'propietario' | 'moderador' | 'miembro' | 'editor' | 'lector'`. El contenido (estado de Yjs) nunca viaja por
REST: se carga en vivo por Socket.IO. Las listas traen las mismas columnas sin `mi_acceso` ni `editando_ahora`.

## Endpoints

| Método | Path | Entrada | `data` |
|---|---|---|---|
| GET | `/mios` | query `q`, `papelera` (`true`/`false`), `limit`, `offset` | `Documento[]` personales míos + `meta` |
| GET | `/compartidos` | query `q`, `limit`, `offset` | `Documento[]` personales que otros compartieron conmigo (fuera de la papelera) + `meta` |
| GET | `/grupo/:grupoId` | query `q`, `papelera`, `limit`, `offset` | `Documento[]` del grupo + `meta` (403 si no soy miembro activo) |
| POST | `/` | `{ titulo?, grupo_id? }` (sin título: "Documento sin título"; sin grupo: personal) | `Documento` (201) |
| GET | `/:id` | — | `Documento` |
| PATCH | `/:id` | `{ titulo }` (1-200) | `Documento` (editar) |
| POST | `/:id/papelera` | — | `Documento` (administrar). Saca a quien lo tenga abierto guardando lo pendiente |
| POST | `/:id/restaurar` | — | `Documento` (administrar) |
| DELETE | `/:id` | — | mensaje (administrar). Borra para siempre con sus permisos y versiones |
| GET | `/:id/exportar` | query `formato`: `html` (def.) \| `texto` | `{ nombre_archivo, tipo_mime, contenido }` (ver). El cliente arma el archivo y lo descarga |
| GET | `/:id/permisos` | — | `Permiso[]` (compartir) |
| PUT | `/:id/permisos` | `{ usuario_id, permiso?: 'ver' \| 'editar' }` (def. `ver`) | `Permiso` — da o cambia el permiso (solo personales) |
| DELETE | `/:id/permisos/:usuarioId` | — | mensaje. El dueño quita a alguien, o el propio usuario deja el documento |
| GET | `/:id/versiones` | query `limit`, `offset` | `Version[]` (sin texto) más nuevas primero + `meta` (ver) |
| POST | `/:id/versiones` | `{ nombre? }` (≤120) | `Version` (201, editar): instantánea manual del contenido actual, incluido lo que se está editando en vivo |
| GET | `/:id/versiones/:versionId` | — | `Version` + `texto_plano` + `html` (vista previa) |
| POST | `/:id/versiones/:versionId/restaurar` | — | `Documento` (editar). Antes guarda el contenido actual como versión `automatica` "Antes de restaurar"; si alguien edita, el cambio le llega en vivo |

`q` busca en el título y en el texto del documento. Listas ordenadas por `fecha_actualizacion` (lo editado más
recientemente primero).

```jsonc
// Permiso
{ "id": 1, "documento_id": 4, "usuario_id": 3, "permiso": "editar", "fecha_creacion": "...", "usuario": { /* público */ } }
// Version (lista)
{ "id": 9, "documento_id": 4, "autor_id": 2, "tipo": "manual", "nombre": "Borrador", "fecha_creacion": "...", "autor": { /* público */ } }
```

`tipo` de versión: `manual` (botón "Guardar versión") o `automatica` (cada `DOCUMENTOS_MINUTOS_VERSION` minutos de
edición, al cerrarse una sesión de edición con cambios y antes de restaurar). Se conservan las últimas
`DOCUMENTOS_MAX_VERSIONES_AUTO` automáticas por documento; las manuales no se borran solas.

## Errores

- Documento/versión inexistente → **404**. Sin acceso → **403** ("No tienes acceso…"); lector que intenta editar → **403**.
- Grupo inexistente → **404**; no miembro activo → **403**.
- Editar, renombrar o versionar un documento en la papelera → **409**.
- Compartir un documento de grupo, conmigo mismo o con `permiso` inválido → **400**; bloqueo → **403**; usuario inexistente → **404**.
- Quitar un permiso que no existe → **404**.

## Notificaciones

- `documento_compartido` (entidad `documento`, id del documento) al compartir un personal por primera vez con alguien
  (cambiar de `ver` a `editar` no vuelve a avisar). Mensaje: `te compartió el documento «Tesis» para editarlo`.
  Se retira al quitar el permiso. El frontend lleva a `/documentos/:id`.

## Tiempo real

### Lista del grupo

| Evento | Sala | Payload |
|---|---|---|
| `documentos_grupo_actualizado` | `group_<grupoId>` | `{ grupo_id, documento_id, accion: 'creado' \| 'actualizado' \| 'papelera' \| 'restaurado' \| 'eliminado', por_usuario_id }` |

### Edición en vivo (manejador `manejadorDocumentos`, registrado con `realtime.usar(...)`)

Mensajes binarios (`Uint8Array`; en el navegador llegan como `ArrayBuffer`). `mensaje` sigue el protocolo de
`y-protocols/sync` (paso 1, paso 2 o actualización) sin cabecera extra; `actualizacion` es una actualización de
`y-protocols/awareness`. El contenido vive en el `Y.XmlFragment` llamado **`contenido`** (TipTap Collaboration `field: 'contenido'`).

| Evento | Sentido | Payload |
|---|---|---|
| `doc:entrar` | cliente → servidor, **con acuse** | `{ documento_id }` → `{ ok: true, documento_id, puede_editar }` o `{ ok: false, mensaje, estado }` (401/400/403/404/409) |
| `doc:sync` | ambos | `{ documento_id, mensaje }` |
| `doc:awareness` | ambos | `{ documento_id, actualizacion }` (quién está y dónde está su cursor) |
| `doc:salir` | cliente → servidor | `{ documento_id }` |
| `doc:guardado` | servidor → cliente | `{ documento_id, fecha, ultimo_editor_id }` cuando lo editado quedó en la base |
| `doc:titulo` | servidor → cliente | `{ documento_id, titulo }` al renombrar |
| `doc:acceso` | servidor → cliente | `{ documento_id, puede_editar }` cuando el dueño cambia mi permiso |
| `doc:cerrado` | servidor → cliente | `{ documento_id, motivo: 'papelera' \| 'eliminado' \| 'sin_acceso' }`: hay que cerrar el editor |

Flujo del cliente: escuchar `doc:sync`/`doc:awareness` → emitir `doc:entrar` → al recibir `ok`, mandar su paso 1
(`writeSyncStep1`); el servidor ya le mandó el suyo y los estados de awareness. Cada cambio local se manda como
actualización (`writeUpdate`); los de los demás llegan igual. Quien solo puede leer únicamente puede pedir el estado
(paso 1): sus cambios se ignoran, así que el editor debe estar en solo lectura. Al desconectarse se sale de todo.

### Guardado

El servidor mantiene en memoria cada documento abierto y lo guarda en `documentos_colaborativos.estado_yjs`
(`Y.encodeStateAsUpdate`, LONGBLOB) junto con `texto_plano` (para buscar) y `resumen`: como máximo cada
`DOCUMENTOS_GUARDADO_MS` mientras hay cambios y al salir el último. Al apagar el servidor conviene llamar
`sesionesDocumentos.cerrarTodas()` para no perder los últimos segundos.

## Variables de entorno (opcionales)

| Variable | Por defecto | Uso |
|---|---|---|
| `DOCUMENTOS_GUARDADO_MS` | 5000 | Guardado diferido mientras se edita |
| `DOCUMENTOS_MINUTOS_VERSION` | 10 | Minutos de edición entre versiones automáticas |
| `DOCUMENTOS_MAX_VERSIONES_AUTO` | 50 | Versiones automáticas que se conservan por documento |
