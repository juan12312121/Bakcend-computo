# Historias (`/api/historias`)

Historias tipo Instagram/Facebook: imagen, video o texto sobre un gradiente; duran **24 horas**.
Todas las rutas requieren sesión (`Authorization: Bearer <token>`).
Respuestas con el contrato estándar `{ success, mensaje, data, meta? }`.

## Reglas

- **Vigencia:** `expira_en = fecha_creacion + 24 h`. Las vencidas no salen en la bandeja ni en `/usuario/:id`
  (404 al marcarlas vistas o pedir sus vistas). **Fase 4:** ya no se borran: una tarea cada 30 min
  (`programarLimpieza`) las pasa al **archivo** (`archivada: true`) y conserva su archivo de Cloudinary, para poder
  agregarlas a historias destacadas (ver `destacadas.md`). Solo se borran cuando su autor las elimina.
- **Quién ve las historias de una cuenta:** su dueño y quienes la **siguen**. Los demás reciben 403
  (en `/usuario/:usuarioId` y al marcar vista). Cuentas desactivadas no aparecen.
- **Vistas:** idempotentes (la segunda vez no suma); las propias nunca cuentan. `total_vistas` sube solo la primera vez.
- Las propias se marcan `vista_por_mi: true` (no hay nada pendiente de ver en ellas).

## Tipos

```ts
interface UsuarioPublico {
  id: number;
  nombre_usuario: string;
  nombre_completo: string;
  foto_perfil_url: string | null;
  carrera: string | null;
}

interface Historia {
  id: number;
  usuario_id: number;
  tipo: 'imagen' | 'video' | 'texto';
  media_url: string | null;     // null en las de texto
  texto: string | null;         // obligatorio en las de texto; pie opcional en imagen/video (máx. 500)
  fondo: string | null;         // gradiente Tailwind, solo en las de texto (null en imagen/video)
  duracion_seg: number;         // imagen/texto: 5 por defecto; video: la que mande el cliente (1-60)
  total_vistas: number;
  expira_en: string;            // ISO
  fecha_creacion: string;       // ISO
  vista_por_mi: boolean;        // si el usuario autenticado ya la vio (propias: true)
  archivada: boolean;           // fase 4: ya pasó al archivo
  media_original_url: string | null; // fase 4: video tal como se subió (media_url = URL de reproducción editada)
  edicion: EdicionVideo | null; // fase 4: ajustes del editor (ver publicaciones.md, "Editor de video")
}

// Elemento de la bandeja y respuesta de /usuario/:usuarioId
interface GrupoHistorias {
  usuario: UsuarioPublico;
  es_mio: boolean;
  historias: Historia[];        // de la más antigua a la más reciente
  todas_vistas: boolean;        // true si no queda ninguna sin ver
  ultima: string | null;        // ISO de la más reciente (null si no hay vigentes)
}
```

`fondo` se pinta con `bg-gradient-to-br ${fondo}`. Valores permitidos (también en `GET /fondos`):
`from-orange-500 to-pink-500` (por defecto), `from-pink-500 to-purple-600`, `from-purple-600 to-indigo-600`,
`from-blue-500 to-cyan-400`, `from-teal-400 to-emerald-500`, `from-green-400 to-lime-500`,
`from-yellow-400 to-orange-500`, `from-red-500 to-rose-600`, `from-fuchsia-500 to-cyan-500`, `from-slate-700 to-slate-900`.

## Endpoints

| Método | Path | Body / Query | Respuesta |
|---|---|---|---|
| GET | `/fondos` | — | `data: string[]` (gradientes permitidos) |
| POST | `/` | multipart o JSON (ver abajo) | 201 `data: Historia` |
| GET | `/` | — | `data: GrupoHistorias[]` (bandeja) |
| GET | `/usuario/:usuarioId` | — | `data: GrupoHistorias` (403 si no lo sigo, 404 si no existe) |
| POST | `/:id/vista` | — | `data: { historia_id, registrada: boolean, propia: boolean }` |
| GET | `/:id/vistas` | `limit` (1-100, def. 20), `offset` (def. 0) | paginado: `data: { usuario: UsuarioPublico, vista_en: string }[]`, `meta: { total, limit, offset, hayMas }` |
| DELETE | `/:id` | — | `mensaje: 'Historia eliminada'` |

### POST `/` (crear)

- **Texto** (JSON o multipart, sin archivo): `{ tipo: 'texto', texto: string, fondo?: string, duracion_seg?: number }`.
- **Imagen** (multipart): campo de archivo `media` (jpg, png, gif, webp) + `tipo=imagen`, `texto?`, `duracion_seg?`.
- **Video** (multipart): campo `media` (mp4, webm, mov) + `tipo=video`, `duracion_seg` (obligatorio, 1-60), `texto?`.

Límite de subida: `MAX_VIDEO_SIZE` (50 MB por defecto); las imágenes siguen limitadas a `MAX_FILE_SIZE` (10 MB).
Los archivos van a Cloudinary en `trino/historias`.

Errores (400 salvo que se indique):
- `tipo` ausente o distinto de imagen/video/texto (`errores: [{ campo: 'tipo' }]`).
- Texto vacío en una de texto, o más de 500 caracteres (`campo: 'texto'`).
- `fondo` fuera de la lista (`campo: 'fondo'`).
- `duracion_seg` no entero, < 1 o > 60, o ausente en un video (`campo: 'duracion_seg'`).
- Imagen o video sin archivo: "La historia de tipo imagen requiere un archivo en el campo media".
- Texto con archivo; imagen con un archivo que no es `image/*`; video con uno que no es `video/*`.
- Archivo de tipo no permitido en `media` (lo rechaza la subida).
- 413 archivo demasiado grande.

Efecto: emite por Socket.IO `nueva_historia` con `{ usuario_id }` a la sala personal de cada seguidor del autor
(para refrescar la bandeja).

### GET `/` (bandeja)

Historias vigentes de las cuentas que sigo y las mías, agrupadas por usuario. Orden de los grupos:
1. las mías (`es_mio: true`);
2. los grupos con algo sin ver (`todas_vistas: false`);
3. los ya vistos.

Dentro de cada bloque, del grupo con la historia más reciente al más antiguo. Dentro de cada grupo,
las historias van de la más antigua a la más reciente (orden de reproducción). Lista vacía si no hay nada.

### POST `/:id/vista`

Marca la historia como vista por el usuario autenticado. Mensajes: "Vista registrada" (`registrada: true`),
"Ya habías visto esta historia" (`registrada: false`), "Las historias propias no suman vistas" (`propia: true`).
403 si no sigue al autor; 404 si no existe o ya expiró.

### GET `/:id/vistas`

Solo el autor (403 a cualquier otro). Quién la vio, de la vista más reciente a la más antigua. 404 si expiró.

### DELETE `/:id`

Solo el autor (403 a cualquier otro; 404 si no existe). Borra la historia y sus vistas en una transacción
y después el archivo de Cloudinary.


## Fase 4 (creadores): archivo y editor de video

### GET `/archivo`

Todas mis historias (vigentes y pasadas), de la más reciente a la más antigua, paginado (`limit`, `offset`).
Cada elemento es una `Historia` + `vigente: boolean` (si sigue en la bandeja) + `destacada_ids: number[]`
(destacadas en las que está). Sirve para crear o completar destacadas.

### Crear con ajustes de video

`POST /` acepta `edicion` (JSON; en multipart como texto) **solo en las de video** (si no → 400 en `edicion`):
`recorte_inicio`, `recorte_fin`, `silenciar`, `musica_volumen`, `texto`. Con recorte, `duracion_seg` = duración del recorte
(máx. 60; si no, 400 en `recorte_fin`). `media_url` es la URL de reproducción y `media_original_url` la original
(mismas reglas que en publicaciones).

### PUT `/:id/edicion`

Solo el autor (403), solo historias de video (400). Multipart o JSON con los mismos campos + `archivo` (pista de audio)
y `quitar_musica`. La pista reemplazada se borra de Cloudinary. Responde la `Historia`.

### Borrar

`DELETE /:id` funciona también con historias del archivo: la saca de todas sus destacadas (y deja de ser portada) y borra
el archivo y la música de Cloudinary.

### Estadísticas

La primera vista de cada persona (`POST /:id/vista` con `registrada: true`) suma a `reproducciones_historias` del día del autor.
