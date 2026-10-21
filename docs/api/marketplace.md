# Marketplace (`/api/marketplace`)

Compra y venta entre usuarios, estilo Facebook Marketplace: productos (nuevos o usados) y servicios, con hasta 10 fotos,
guardados, "¿Sigue disponible?" por el chat directo, reportes y calificación del vendedor.
Respuestas con el contrato estándar `{ success, mensaje, data, meta? }`.

Buscar, ver un anuncio y la ficha del vendedor no exigen sesión (`AuthGuard.opcional`); todo lo demás sí
(`Authorization: Bearer <token>`). Moderación: `AuthGuard.soloAdmin`.

## Reglas

- **Visibilidad**
  - Búsqueda: solo `activo` y `reservado`; `pausado` lo ve solo el dueño y `vendido` sale de la búsqueda
    (pero su detalle se puede abrir).
  - Bloqueos (en cualquier sentido): no se ven los anuncios del otro (ni en búsqueda, guardados, vistos ni detalle → 404)
    ni se le puede contactar.
  - Vendedor con la cuenta desactivada: sus anuncios no aparecen.
  - Anuncios de grupo: en la búsqueda general solo aparecen para miembros activos del grupo; con `?grupo_id=` se listan
    los del grupo (grupo privado: solo miembros, 403). El detalle de uno de grupo privado es 403 para quien no es miembro.
- **Crear / editar** (reglas entre campos, error 400 por campo):
  - Producto: `condicion` obligatoria, al menos 1 foto y al menos una forma de entrega (`entrega_en_persona` / `entrega_envio`).
  - Servicio: `condicion` siempre `null`; las fotos son opcionales. Sin `categoria`, un servicio queda en `servicios` y un producto en `otros`.
  - `modo_precio = fijo` exige `precio > 0` (máx. 2 decimales); `gratis` guarda `precio = 0`; `a_convenir` guarda `precio = null`.
  - Máximo 10 fotos por anuncio (multer corta con 400 si llegan más de 10 en una petición).
  - En un grupo solo publican sus miembros activos (403).
- **Estados**: `activo` · `reservado` · `vendido` · `pausado` (solo el vendedor los cambia). Al pasar a `vendido` se guarda
  `vendido_en` y se notifica `anuncio_vendido` a quienes lo tenían guardado. `comprador_id` (opcional) debe ser alguien que
  usó "Me interesa" (400 si no). Salir de `vendido` limpia `comprador_id` y `vendido_en`.
- **Renovar**: lo vuelve a poner entre los recientes (`renovado_en = ahora`); una vez cada 24 h y no si está vendido (400).
  Un anuncio pausado vuelve a `activo` al renovarse.
- **Vistas**: al abrir el detalle se suma una vista por persona (la primera vez); sin sesión, cada vez; el vendedor no cuenta.
  Las visitas con sesión alimentan "Vistos recientemente".
- **Eliminar**: el vendedor o un admin. Borra fotos (también de Cloudinary), guardados, visitas, interesados y reportes;
  las calificaciones se conservan con `anuncio_id = null`.

## Tipos

```ts
type Categoria = 'electronica' | 'hogar' | 'ropa' | 'vehiculos' | 'libros_escuela' | 'deportes' | 'juguetes' | 'servicios' | 'inmuebles' | 'otros';
type Tipo = 'producto' | 'servicio';
type Condicion = 'nuevo' | 'como_nuevo' | 'usado' | 'para_piezas';
type ModoPrecio = 'fijo' | 'a_convenir' | 'gratis';
type Moneda = 'MXN' | 'USD' | 'EUR' | 'COP' | 'ARS' | 'CLP' | 'PEN' | 'GTQ';
type Estado = 'activo' | 'reservado' | 'vendido' | 'pausado';
type MotivoReporte = 'estafa' | 'prohibido' | 'enganoso' | 'duplicado' | 'ofensivo' | 'ya_vendido' | 'otro';

interface UsuarioPublico { id: number; nombre_usuario: string; nombre_completo: string; foto_perfil_url: string | null; carrera: string | null }
interface GrupoDeAnuncio { id: number; nombre: string; imagen_url: string | null; privacidad: 'publico' | 'privado' }

/** Tarjeta (listados). */
interface AnuncioResumen {
  id: number;
  vendedor_id: number;
  grupo_id: number | null;
  titulo: string;
  descripcion: string | null;
  tipo: Tipo;
  categoria: Categoria;
  condicion: Condicion | null;
  modo_precio: ModoPrecio;
  precio: number | null;           // null = a convenir; 0 = gratis
  moneda: Moneda;
  ubicacion: string;               // ciudad o zona en texto
  entrega_en_persona: boolean;
  entrega_envio: boolean;
  estado: Estado;
  total_vistas: number;
  total_guardados: number;
  total_interesados: number;
  renovado_en: string;             // ISO; ordena "recientes"
  vendido_en: string | null;
  fecha_creacion: string;
  fecha_actualizacion: string;
  vendedor: UsuarioPublico;
  grupo: GrupoDeAnuncio | null;
  foto_principal: string | null;
  total_fotos: number;
  guardado: boolean;               // lo guardé yo
  es_mio: boolean;
}

interface FotoAnuncio { id: number; url: string; orden: number }   // orden 0 = principal
interface ResumenCalificaciones { promedio: number | null; total: number }   // promedio con 1 decimal

/** Detalle (GET /:id y respuesta de crear / editar / estado / renovar). */
interface AnuncioDetalle extends AnuncioResumen {
  fotos: FotoAnuncio[];
  vendedor_calificacion: ResumenCalificaciones;
  comprador_id: number | null;     // solo lo ven el vendedor y el propio comprador
  me_interesa: boolean;
  chat_id: number | null;          // mi chat con el vendedor si ya pregunté
  puede_renovar: boolean;
  renovable_desde: string | null;  // solo para el dueño (null si está vendido)
  puedo_calificar: boolean;        // soy el comprador, está vendido y no he calificado
  mi_calificacion: number | null;
}
```

## Endpoints

### `GET /` — buscar (sesión opcional)
Query (todo opcional): `q` (título o descripción), `categoria`, `tipo`, `condicion`, `precio_min`, `precio_max`
(los "a convenir" quedan fuera cuando se filtra por precio), `ubicacion` (contiene), `gratis=true`, `envio=true`,
`grupo_id`, `vendedor_id`, `orden` = `recientes` (def., por `renovado_en`) | `precio_asc` | `precio_desc` | `vistas`
(en los de precio los "a convenir" van al final), `limit` (1-100, def. 20), `offset`.
`data: AnuncioResumen[]`, `meta: { total, limit, offset, hayMas }`.
Errores: 400 (`precio_max < precio_min`, valores fuera de catálogo), 403 grupo privado ajeno, 404 grupo inexistente.

### `POST /` — publicar
Multipart con las fotos en el campo **`imagen`** (hasta 10, en orden; la primera es la principal) o JSON (servicio sin fotos).
Body: `titulo` (≤120)*, `ubicacion` (≤150)*, `descripcion` (≤5000), `tipo` (def. producto), `categoria`, `condicion`,
`modo_precio` (def. fijo), `precio`, `moneda` (def. MXN), `entrega_en_persona` (def. true), `entrega_envio` (def. false),
`grupo_id`. En multipart los booleanos van como `"true"`/`"false"` y `""` = no enviado.
201 `data: AnuncioDetalle`. Errores: 400 por campo (`titulo`, `ubicacion`, `condicion`, `precio`, `entrega_en_persona`, `fotos`...),
401, 403 (no eres miembro del grupo), 404 (grupo).

### `GET /mios` — mis anuncios
Query: `estado` (opcional), `limit`, `offset`. Todos los estados, los renovados más recientemente primero. `data: AnuncioResumen[]`.

### `GET /guardados` — mis guardados
Paginado, el último guardado primero (incluye vendidos para que se vea que ya no está). `data: AnuncioResumen[]`.

### `GET /vistos` — vistos recientemente
Paginado, lo último que abrí primero; solo `activo`/`reservado` y sin los míos. `data: AnuncioResumen[]`.

### `GET /:id` — detalle (sesión opcional)
Cuenta la vista (ver reglas). `data: AnuncioDetalle`. Errores: 404 (no existe, pausado ajeno, bloqueo), 403 (grupo privado).

### `PUT /:id` — editar (vendedor)
Multipart (fotos nuevas en `imagen`) o JSON. Todos los campos de crear son opcionales (`descripcion: null` o `""` la borra).
**`fotos`**: lista final, en orden, de ids de fotos guardadas y `"nueva:N"` (N = índice de la foto nueva en esta petición).
Acepta arreglo JSON, texto separado por comas (`"12,nueva:0,15"`) o un JSON en texto. Las fotos guardadas que no aparezcan
se borran (de la base y de Cloudinary); las nuevas no mencionadas van al final. Sin `fotos`, las nuevas se agregan al final.
`data: AnuncioDetalle`. Errores: 400 (nada que cambiar, reglas entre campos, foto ajena o `nueva:N` inexistente), 403, 404.

### `PATCH /:id/estado` — cambiar estado (vendedor)
Body: `{ estado: Estado, comprador_id?: number }` (`comprador_id` solo con `vendido`, debe ser un interesado).
`data: AnuncioDetalle`. Notifica `anuncio_vendido` (entidad `anuncio`) a quienes lo guardaron al pasar a vendido.
Errores: 400 (mismo estado, comprador sin vendido), 400 `comprador_id` (no es interesado), 403, 404.

### `POST /:id/renovar` — renovar (vendedor)
`data: AnuncioDetalle`. Errores: 400 (antes de 24 h, vendido), 403, 404.

### `DELETE /:id` — eliminar (vendedor o admin)
`mensaje: "Anuncio eliminado"`. Errores: 403, 404.

### `POST /:id/guardar` — guardar / quitar
`data: { anuncio_id, guardado: boolean, total_guardados }`. Errores: 400 (propio), 404.

### `POST /:id/interes` — "Me interesa / ¿Sigue disponible?"
Body: `{ mensaje?: string (≤1000) }`. Abre (o crea) el chat directo con el vendedor con `chatService.iniciar` y manda con
`chatService.enviar` el mensaje (por defecto `¡Hola! ¿Sigue disponible «<título>»?`) seguido del enlace
`<FRONTEND_URL>/marketplace/:id`. Si no se siguen mutuamente el chat nace como solicitud (`pending`), igual que en el chat.
La primera vez registra al interesado y notifica `anuncio_interes` al vendedor (entidad `anuncio`); las siguientes solo mandan el mensaje.
`data: { anuncio_id, chat_id, mensaje_id, primera_vez }`. Socket.IO: los eventos normales del chat (`new_message`) y la push del mensaje.
Errores: 400 (propio, vendido, pausado), 401, 403 (chat rechazado), 404 (no existe o bloqueo).

### `GET /:id/interesados` — quién preguntó (vendedor)
Paginado. `data: { usuario: UsuarioPublico, chat_id: number | null, desde: string }[]`. Errores: 403, 404.

### `POST /:id/reportar`
Body: `{ motivo: MotivoReporte, detalle?: string (≤500) }`. Uno por persona y anuncio.
201 `data: { id, anuncio_id, usuario_id, motivo, detalle, estado: 'pendiente', ... }`. Errores: 400 (propio o motivo inválido), 404, 409 (ya lo reportaste).

### `POST /:id/calificacion` — calificar al vendedor
Body: `{ puntuacion: 1-5, comentario?: string (≤500) }`. Solo el `comprador_id` de un anuncio `vendido`, una vez.
201 `data: { id, vendedor_id, comprador_id, anuncio_id, titulo_anuncio, puntuacion, comentario, fecha_creacion, comprador: UsuarioPublico }`.
Errores: 400, 403 (no eres el comprador / bloqueo), 404, 409 (ya calificaste).

### `GET /vendedores/:usuarioId` — ficha del vendedor (sesión opcional)
`data: { vendedor: UsuarioPublico, calificacion: ResumenCalificaciones, anuncios_activos, vendidos }`. 404 si no existe, está inactivo o hay bloqueo.

### `GET /vendedores/:usuarioId/calificaciones` — paginado (sesión opcional)
`data: Calificacion[]` (las de compradores con bloqueo se omiten).

### Moderación (admin)
- `GET /reportes?estado=pendiente|revisado|descartado&anuncio_id=` — paginado, el más reciente primero:
  `data: { id, motivo, detalle, estado, revisado_por, revisado_en, fecha_creacion, anuncio: { id, titulo, estado, vendedor_id, precio, modo_precio, moneda, vendedor }, usuario }[]`.
- `PATCH /reportes/:reporteId` — body `{ estado: 'revisado' | 'descartado' }`; guarda `revisado_por` y `revisado_en`.
- Para el panel general de moderación, desde código: `marketplaceService.listarReportes(filtro, paginacion)`,
  `revisarReporte(id, adminId, estado)` y `eliminar(id, adminId, { comoAdmin: true })`.

## Notificaciones
- `anuncio_interes` → al vendedor, la primera vez que alguien pregunta (`entidad_tipo: 'anuncio'`, `entidad_id`).
- `anuncio_vendido` → a quienes lo guardaron, al marcarse vendido (`entidad_tipo: 'anuncio'`).
- Ruta del frontend para la entidad `anuncio`: `/marketplace/:id`.
