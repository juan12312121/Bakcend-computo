# API · Archivos del grupo (`/api/archivos-grupo`)

Carpeta compartida de cada grupo: carpetas anidadas y archivos subidos (Cloudinary). Todas las rutas exigen
`Authorization: Bearer <token>` y ser **miembro activo** del grupo. Contrato estándar (`success`, `mensaje`, `data`, `meta`).

Mover, renombrar o borrar: quien lo creó/subió **o** un admin/moderador del grupo. Una carpeta con cosas de otros
miembros (archivos o subcarpetas) solo la borra un admin/moderador.

## Objetos

```jsonc
// Carpeta
{ "id": 3, "grupo_id": 7, "padre_id": null, "nombre": "Clases", "creador_id": 2, "fecha_creacion": "...", "fecha_actualizacion": "..." }

// Archivo
{
  "id": 10, "grupo_id": 7, "carpeta_id": 3,          // null = en la raíz
  "usuario_id": 2,                                   // quién lo subió
  "nombre": "Temario.pdf", "url": "https://res.cloudinary.com/...", "storage_id": "trino/chat/...",
  "mimetype": "application/pdf",
  "tipo": "documento",                               // 'imagen' | 'documento' | 'audio' | 'video' | 'otro'
  "tamano": 52344,                                   // bytes
  "fecha_creacion": "...", "fecha_actualizacion": "...",
  "autor": { /* usuario público */ }
}
```

## Endpoints

| Método | Path | Entrada | `data` |
|---|---|---|---|
| GET | `/grupo/:grupoId` | query `carpeta_id?` (sin él: la raíz) | `ContenidoCarpeta` (ver abajo) |
| GET | `/grupo/:grupoId/carpetas` | — | `Carpeta[]` todas las del grupo, planas (para elegir a dónde mover) |
| GET | `/grupo/:grupoId/buscar` | query `q?` (nombre), `tipo?`, `limit`, `offset` | `Archivo[]` de todas las carpetas, más nuevos primero + `meta` |
| GET | `/grupo/:grupoId/uso` | — | `{ total_bytes, total_archivos, limite_bytes, por_tipo: { imagen: { bytes, archivos }, documento, audio, video, otro } }` |
| POST | `/grupo/:grupoId/carpetas` | `{ nombre (1-120, sin / ni \), padre_id? }` | `Carpeta` (201) |
| POST | `/grupo/:grupoId/archivos` | **multipart**: `archivo` + `carpeta_id?` + `nombre?` (por defecto el del archivo) | `Archivo` (201) |
| PATCH | `/carpetas/:id` | `{ nombre?, padre_id? }` (`padre_id: null` = a la raíz; al menos uno) | `Carpeta` |
| DELETE | `/carpetas/:id` | — | `{ carpetas, archivos }` borrados (con subcarpetas y archivos, también de Cloudinary) |
| GET | `/:id` | — | `Archivo` + `carpeta { id, nombre, padre_id }`, `grupo { id, nombre, imagen_url }`, `ruta: Miga[]`, `puede_modificar` |
| PATCH | `/:id` | `{ nombre?, carpeta_id? }` (`carpeta_id: null` = a la raíz; al menos uno) | igual que `GET /:id` |
| DELETE | `/:id` | — | mensaje; también se borra de Cloudinary |

```jsonc
// ContenidoCarpeta
{
  "grupo": { "id": 7, "nombre": "Club" },
  "carpeta": { /* Carpeta */ },                      // null en la raíz
  "ruta": [ { "id": 3, "nombre": "Clases" }, { "id": 5, "nombre": "Mate" } ],   // migas desde la raíz (sin ella)
  "carpetas": [ { /* Carpeta */, "total_elementos": 4 } ],                       // subcarpetas (archivos + carpetas adentro)
  "archivos": [ /* Archivo */ ],                    // por nombre
  "puede_moderar": false                            // soy admin/moderador
}
```

### Tipos aceptados

El campo `archivo` de `upload.ts`: imágenes (jpg, png, gif, webp), documentos (pdf, Word, Excel, PowerPoint, csv,
txt) y audio (webm, ogg, mpeg/mp3, mp4, aac, wav, m4a). **Video no** (el campo `archivo` no lo admite; ver el reporte).
El tamaño máximo es `MAX_FILE_SIZE`.

## Errores

- Grupo, carpeta o archivo inexistente → **404** (también carpeta destino de otro grupo).
- No miembro activo → **403**; mover/renombrar/borrar sin ser autor ni admin/moderador → **403**.
- Nombre de carpeta repetido en el mismo lugar (sin distinguir mayúsculas) → **409**.
- Mover una carpeta dentro de sí misma o de una de sus hijas → **400**. PATCH sin cambios → **400**.
- Subir sin archivo o de un tipo no permitido → **400**; archivo grande → **413**.
- El grupo superó su espacio (`ARCHIVOS_GRUPO_LIMITE_MB`, def. 2048) → **413** (el archivo subido se borra solo).

## Notificaciones

`archivo_subido` (entidad `archivo`, id del archivo → `/archivos/:id`) a los **demás** miembros activos, sin saturar:
como mucho **un aviso por persona y grupo cada 10 minutos**. El primero sale al instante
(`subió «Temario.pdf» a los archivos de «Club»`); los que llegan dentro de la ventana se juntan y salen en uno al
terminarla (`subió 3 archivos a «Club»`, o `y otras personas subieron 3 archivos a «Club»` si fueron varios), apuntando
al último archivo. El agrupador vive en memoria del proceso.

## Tiempo real

| Evento | Sala | Payload |
|---|---|---|
| `archivos_grupo_actualizado` | `group_<grupoId>` | `{ grupo_id, carpeta_id, accion, por_usuario_id }`; `accion`: `carpeta_creada`, `carpeta_actualizada`, `carpeta_eliminada`, `archivo_subido`, `archivo_actualizado`, `archivo_eliminado`. `carpeta_id` = carpeta afectada (al mover se avisa la de origen y la de destino) |
