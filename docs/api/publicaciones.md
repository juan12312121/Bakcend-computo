# API · Publicaciones (`/api/publicaciones`)

Todas las respuestas usan el contrato estándar (`success`, `mensaje`, `data`, `meta` en listados).
Los listados paginados aceptan `?limit=` (1-100, por defecto 20) y `?offset=` (por defecto 0) y devuelven
`meta: { total, limit, offset, hayMas }`.

## Forma de una publicación (`PublicacionVista`)

```jsonc
{
  "id": 12,
  "usuario_id": 3,
  "grupo_id": null,              // número si se publicó en un grupo
  "contenido": "Texto",
  "imagen_url": "https://res.cloudinary.com/...", // o null
  "imagen_s3": "trino/publicaciones/imagen-...",  // public_id de Cloudinary o null
  "video_url": null,             // URL del video (o null); una publicación lleva imagen O video, nunca ambos
  "video_s3": null,              // public_id de Cloudinary del video
  "video_duracion": null,        // segundos (1-180) si hay video
  "total_vistas": 0,             // reproducciones (POST /:id/vista)
  "categoria": "Tecnología",
  "color_categoria": "bg-teal-500",
  "visibilidad": "publico",      // publico | seguidores | privado
  "total_likes": 0,
  "total_dislikes": 0,
  "total_comentarios": 0,
  "total_compartidos": 0,
  "oculto": false,
  "estado": "publicada",         // publicada | programada | borrador  (fase 4, creadores)
  "programada_para": null,       // ISO; solo en las programadas
  "video_original_url": null,    // el video tal como se subió (video_url es la URL de reproducción ya editada)
  "edicion": null,               // ajustes del editor de video (ver "Editor de video")
  "fecha_creacion": "2026-10-14T15:00:00.000Z",
  "fecha_actualizacion": "2026-10-14T15:00:00.000Z",
  "autor": { "id": 3, "nombre_usuario": "ana", "nombre_completo": "Ana Pérez", "foto_perfil_url": null, "carrera": null },
  "documentos": [ /* Documento, ver docs/api/documentos.md (sin "usuario") */ ],
  "usuario_dio_like": false      // siempre presente; false si no hay sesión
}
```

Visibilidad: el autor ve todo; `publico` lo ve cualquiera; `seguidores` solo quien sigue al autor; `privado` solo el autor.
Lo que no se puede ver responde **404** (no se revela que existe).

## Endpoints

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| GET | `/buscar` | sí | query `q` (1-100, requerido), `limit`, `offset` | `PublicacionVista[]` paginado. Busca en contenido, `nombre_usuario` y `nombre_completo` del autor; excluye publicaciones de grupos |
| GET | `/categorias` | no | — | `[{ value, label, color }]` (14 categorías) |
| GET | `/reels` | opcional | `limit`, `offset` | `PublicacionVista[]` paginado (solo con video). Ver Reels |
| POST | `/:id/vista` | opcional | — | `{ publicacion_id, total_vistas }`. Ver Reels |
| GET | `/visibilidades` | no | — | `[{ value, label, description }]` |
| GET | `/mis-publicaciones` | sí | `limit`, `offset` | `PublicacionVista[]` paginado. Todas las mías (incluidas privadas y de grupos) |
| GET | `/usuario/:usuarioId` | opcional | `limit`, `offset` | `PublicacionVista[]` paginado. Si soy yo, todas; si no, solo las visibles y fuera de grupos |
| POST | `/` | sí | ver abajo | `PublicacionVista` (201) |
| PUT | `/:id` | sí (autor) | ver abajo | `PublicacionVista` |
| DELETE | `/:id` | sí (autor) | — | sin `data`; `mensaje: "Publicación eliminada correctamente"` |
| GET | `/` | opcional | `limit`, `offset`, `categoria`, `tipo=video`, `orden`, `con_media` | Feed `PublicacionVista[]` paginado |
| GET | `/:id` | opcional | — | `PublicacionVista` |

### Feed (`GET /`)
Publicaciones visibles para el usuario, **sin** las de grupos (`grupo_id` no nulo), **sin** las que el usuario
ocultó (`publicaciones_ocultas`) ni las que marcó "no me interesa" (`publicaciones_no_interesa`), y sin autores
suspendidos o con cuenta eliminada. Orden: más recientes primero. Sin sesión: solo públicas.
Filtros opcionales: `?categoria=` (una de `/categorias`) y `?tipo=video` (solo publicaciones con video); otro valor → 400.
`?con_media=true` → solo con imagen o video. `?orden=recientes` (por defecto) | `populares`: ordena por la misma
puntuación que Reels sobre las 300 más recientes que cumplen los filtros (`meta.total` = tamaño de esa ventana).
Todo se combina: `?orden=populares&con_media=true&categoria=Ocio`.

### Reels (`GET /reels`, `POST /:id/vista`)
- `GET /reels`: las mismas publicaciones que entran al feed pero solo **con video**. Se toman las 300 más recientes
  (ventana acotada) y se ordenan en memoria por `(likes·2 + comentarios·3 + vistas·0.2 + 1) / (horas + 2)^1.3`
  (mezcla recientes y populares; empate → id más nuevo). `meta.total` es el tamaño de esa ventana.
- `POST /:id/vista`: suma 1 a `total_vistas` (con o sin sesión) y responde `{ publicacion_id, total_vistas }`.
  404 si no existe o no se puede ver; 400 si no tiene video. El frontend la llama tras 2 s de reproducción.

### Crear (`POST /`)
JSON o `multipart/form-data`.

| Campo | Tipo | Reglas |
|---|---|---|
| `contenido` | texto | requerido, 1-5000 caracteres (se recorta) |
| `categoria` | texto | una de `/categorias`; por defecto `General` |
| `visibilidad` | texto | `publico` \| `seguidores` \| `privado`; por defecto `publico` |
| `grupo_id` | número | opcional; hay que ser miembro **activo** del grupo o responde 403 |
| `imagen` | archivo | opcional, 1 imagen (jpg, png, gif, webp) |
| `video` | archivo | opcional, 1 video (mp4, webm, mov; límite `MAX_VIDEO_SIZE`). No junto con `imagen` → 400 |
| `video_duracion` | número | segundos 1-180; **requerido si hay `video`** (400 en `video_duracion`); sin video se ignora |
| `documentos` | archivos | opcional, hasta 5 (pdf, Word, Excel, PowerPoint, csv, txt) |

`color_categoria` se asigna solo. Suma 1 a `usuarios.total_posts`.
**Hashtags**: extrae los `#tema` del contenido (letras con acentos/ñ, dígitos y _; 2-50; en minúsculas; los de URLs no
cuentan), crea los que falten y los enlaza (`publicacion_hashtags`, suma `hashtags.total_publicaciones`). Ver `hashtags.md`.
**Menciones**: notifica (tipo `mencion`, "te mencionó en una publicación") a cada `@usuario` activo que pueda ver la
publicación, sin repetir ni al autor. Ver `menciones.md`.
Socket.IO: `new_post` con la `PublicacionVista` (a todos, o solo a la sala `group_<id>` si es de grupo).

### Editar (`PUT /:id`)
JSON o multipart. Campos opcionales: `contenido`, `categoria` (actualiza `color_categoria`), `visibilidad`,
`imagen` (archivo; reemplaza a la imagen **o al video** anterior y lo borra de Cloudinary),
`video` + `video_duracion` (reemplaza al video o a la imagen anterior; sin `video_duracion` → 400),
`video_duracion` sola (corrige la duración del video actual), `quitar_video` (`true`/`"true"`/`"1"`: quita el video y lo borra).
`imagen` y `video` juntos → 400. `documentos` en la edición → 400 (se adjuntan al crear o desde Documentos).
Sin ningún cambio → 400 `No hay datos para actualizar`.
Si cambia el contenido: re-sincroniza los hashtags (ajusta los totales) y notifica la mención **solo a los nuevos** `@usuario`.
Socket.IO: `update_post` con la `PublicacionVista`.

### Borrar (`DELETE /:id`)
Borrado definitivo: elimina la publicación, sus documentos (registros y archivos en Cloudinary), su imagen y su video,
la desenlaza de sus hashtags (resta `total_publicaciones`) y resta 1 a `total_posts`. Likes, comentarios y notificaciones de la publicación se borran en cascada.
Socket.IO: `delete_post` con `{ id }`.

## Programadas y borradores (fase 4, creadores)

- Al crear (`POST /`) se puede mandar `programada_para` (ISO, **futura y hasta 6 meses**; si no → 400 en `programada_para`)
  → `estado: 'programada'`, o `borrador: true` → `estado: 'borrador'` (ambos juntos → 400).
- Mientras no estén publicadas: **no salen en ningún listado** (feed, populares, Reels, búsqueda, perfil, mis-publicaciones,
  grupo, hashtags, guardados, `publicas()`, categorías con totales); por id (`GET /:id`) solo las ve su autor (404 a los demás);
  no se procesan hashtags ni menciones, no suman a `total_posts`, no emiten `new_post`/`update_post`/`delete_post`.
  Se editan con el `PUT /:id` normal (sin anunciar nada).
- Al publicarse (sola o con "publicar ya"): `fecha_creacion` = hora de publicación, se procesan hashtags y menciones,
  suma a `total_posts`, emite `new_post`. Si era de un grupo y el autor ya no es miembro activo, queda como borrador.
- Tarea programada: `programarPublicaciones()` (cada minuto, `unref()`) publica hasta 50 por vuelta y crea al autor una
  notificación `publicacion_programada` (`entidad_tipo: 'publicacion'`, `entidad_id` y `publicacion_id` = la publicación;
  SSE `nueva_notificacion` + contador + push "Tu publicación programada ya está publicada").

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| GET | `/programadas` | sí | `estado=programada` (por defecto; la próxima primero) o `borrador` (la última editada primero), `limit`, `offset` | `PublicacionVista[]` paginado, solo las mías |
| PUT | `/:id/programacion` | sí (autor) | `{ programada_para }` | `PublicacionVista` programada (reprogramar o programar un borrador) |
| POST | `/:id/cancelar-programacion` | sí (autor) | — | `PublicacionVista` como borrador (`programada_para: null`); 400 si no estaba programada |
| POST | `/:id/publicar` | sí (autor) | — | `PublicacionVista` publicada; 400 si ya estaba publicada; 403 si ya no es miembro del grupo |

## Editor de video (fase 4, creadores)

Las fotos llegan ya editadas (el navegador exporta la imagen final). Del video, el navegador no puede recortar ni mezclar
audio, así que se guardan los ajustes y Cloudinary los aplica al reproducir: `video_url` pasa a ser la **URL de
reproducción** y `video_original_url` guarda el archivo tal como se subió (para volver a editar).

```ts
interface EdicionVideo {
  recorte_inicio: number | null;  // segundos (null = desde el inicio)
  recorte_fin: number | null;     // segundos (null = hasta el final); fin - inicio >= 1 y <= 180
  silenciar: boolean;             // quita el audio original
  musica_url: string | null;      // pista subida (audio)
  musica_s3: string | null;       // su public_id en Cloudinary
  musica_volumen: number;         // 0-100 (80 por defecto); 100 = volumen original de la pista
  texto: { contenido: string; color: string /* #rrggbb */; tamano: number /* 12-160 px */; x: number; y: number /* centro, 0-1 */ } | null;
}
```

- Al crear: campo `edicion` (JSON en texto si es multipart) con `recorte_inicio`, `recorte_fin`, `silenciar`,
  `musica_volumen`, `texto`. Solo con `video` (si no → 400). Con recorte, `video_duracion` = duración del recorte.
- `PUT /:id/edicion` (autor; multipart o JSON): los mismos campos (lo no enviado se conserva; `null` lo quita) +
  `archivo` = pista de audio (mp3, m4a, ogg, webm, wav, aac) que reemplaza a la anterior (se borra de Cloudinary) +
  `quitar_musica: true`. 400 si la publicación no tiene video o el archivo no es audio. Emite `update_post` si está publicada.
- Cambiar el video, cambiarlo por una imagen o quitarlo (`PUT /:id`) borra la edición y la música; borrar la publicación también.

**Cómo se arma la URL de reproducción** (`modules/publicaciones/edicion-video.ts` → `urlReproduccion`). A partir de
`https://res.cloudinary.com/<nube>/video/upload/v123/trino/videos/video-1.mp4` se insertan, después de `/upload/` y en este
orden, los componentes que apliquen (separados por `/`):

1. Recorte: `so_<inicio>,eo_<fin>` (segundos con hasta 2 decimales; solo `so_` u `eo_` si falta el otro; `so_0` se omite).
2. Silencio: `e_volume:mute`.
3. Música: `l_audio:<public_id con ":" en vez de "/">` / `du_<fin - inicio>,e_volume:<volumen - 100>` / `fl_layer_apply,so_0`
   (`du_` solo si hay `recorte_fin`; el volumen va de -100 = muda a 0 = original).
4. Texto: `l_text:Arial_<tamaño>_bold:<texto>,co_rgb:<hex sin #>` / `fl_layer_apply,g_center,x_<x - 0.5>,y_<y - 0.5>`
   (texto con `encodeURIComponent` y además `,` → `%252C` y `/` → `%252F`; x/y como fracción del video).

Ejemplo: recorte 2.5-12 s, silenciado, música `trino/chat/archivo-1` al 60 % y texto "Hola" abajo:
`.../video/upload/so_2.5,eo_12/e_volume:mute/l_audio:trino:chat:archivo-1/du_9.5,e_volume:-40/fl_layer_apply,so_0/l_text:Arial_64_bold:Hola,co_rgb:ffffff/fl_layer_apply,g_center,x_0,y_0.3/v123/trino/videos/video-1.mp4`.
Si el video no es de Cloudinary o no hay ajustes, `video_url` = original. Miniatura (primer cuadro): `.../upload/so_0/v123/.../video-1.jpg`.
Ojo: Cloudinary procesa estas transformaciones al pedir la URL por primera vez; videos muy pesados pueden tardar o requerir
transformaciones "eager" según el plan.

## Estadísticas (fase 4)
`POST /:id/vista` además suma una reproducción a `estadisticas_publicaciones_diarias` del día (ver `estadisticas.md`).

## Para otros módulos (backend)
- `publicacionService.publicas(ids, usuarioId?)` → `PublicacionVista[]` solo de las visibles, en el orden de `ids`.
- `publicacionService.paginaEntre(ids, usuarioId, paginacion)` → página de `PublicacionVista` visibles (fuera de grupos).

## Errores
- 400 validación (`errores: [{ campo, mensaje }]`), id no numérico, sin cambios al editar.
- 401 sin token en rutas con auth "sí".
- 403 editar/borrar publicación ajena (también programar, publicar ya o editar el video); publicar en un grupo sin ser miembro activo.
- 404 no existe o no se puede ver.
