# Arquitectura del backend (TrinoFlow API v2)

TypeScript + Express 5 + Sequelize 6, organizada por **módulos** (una carpeta por funcionalidad)
con capas al estilo Clean Architecture. Toda regla vive en un solo lugar y se reutiliza por herencia.

```
src/
  config/            env.ts (variables validadas con zod) · database.ts (instancia Sequelize)
  core/              Núcleo reutilizable, no sabe nada de los módulos
    errors/          AppError y sus hijas: BadRequest, Validation, Unauthorized, Forbidden, NotFound, Conflict, TooManyRequests
    http/            ApiResponse (respuestas estándar) · BaseController · HttpStatus
    domain/          BaseRepository<M> (CRUD genérico Sequelize) · BaseService<M, R>
    validation/      validate({ body, params, query }) · common.schemas (idParams, paginacionQuery, ...)
  infrastructure/    Detalles técnicos intercambiables
    database/models  Modelos Sequelize + asociaciones (index.ts)
    storage/         FileStorage (interfaz) · CloudinaryStorage · upload (multer)
    realtime/        RealtimeGateway (Socket.IO) · SseHub (Server-Sent Events)
    security/        TokenService (JWT) · PasswordHasher (bcrypt)
  middlewares/       AuthGuard (proteger, opcional, porQuery, soloAdmin) · errorHandler
  modules/<modulo>/  <m>.routes.ts → <m>.controller.ts → <m>.service.ts → <m>.repository.ts
                     <m>.schemas.ts (validación zod + tipos DTO)
  routes.ts          Monta todos los módulos bajo /api
  app.ts / server.ts
```

## Flujo de una petición

`routes` (auth + validate) → `controller` (lee req, llama al servicio, responde) →
`service` (reglas de negocio, lanza AppError) → `repository` (consultas Sequelize) → `model`.

- **Controladores** heredan de `BaseController`. Métodos como propiedades flecha
  (`listar = async (req, res) => {...}`) para poder pasarlos al router sin `bind`.
  Nunca `try/catch`: Express 5 manda los errores al `errorHandler`.
  Responden solo con `this.ok / this.created / this.message / this.paginated`.
- **Servicios** heredan de `BaseService`; reciben repositorios y servicios por constructor
  (inyección de dependencias) y se exporta una instancia lista: `export const xService = new XService(...)`.
  Lanzan errores de `core/errors` (`throw new NotFoundError('Sección')`), jamás escriben en `res`.
- **Repositorios** heredan de `BaseRepository<Modelo>`; definen `entidad` (nombre para mensajes) y,
  si hace falta, sobrescriben `opcionesPorDefecto()` para incluir asociaciones.
  Ningún otro lugar hace consultas a la base.
- **Schemas** (zod) validan `body`, `params` y `query` en la ruta con `validate(...)`.
  Los tipos DTO salen de `z.infer`. La query validada se lee con `validatedQuery<T>(res)`.

## Herencia y sobrecarga

- `AppError` → `NotFoundError`, `ConflictError`, ... (el errorHandler solo mira `statusCode`).
- `BaseRepository<M>` → `UsuarioRepository`, `PublicacionRepository`, ... (heredan CRUD, sobrescriben lo necesario).
- `BaseService` / `BaseController` → servicios y controladores de cada módulo.
- Sobrecargas reales de TypeScript, por ejemplo:
  - `repo.findById(id)` / `repo.findById(id, opciones)`
  - `repo.delete(id)` / `repo.delete(where)`
  - `repo.update(id, cambios)` / `repo.update(registro, cambios)`
  - `ApiResponse.ok(res)` / `ok(res, data)` / `ok(res, data, mensaje)` / `ok(res, data, mensaje, meta)`
  - `this.idParam(req)` / `this.idParam(req, 'publicacion_id')`

## Contrato de respuesta (lo usa el frontend)

```jsonc
// éxito
{ "success": true, "mensaje": "Texto", "data": { ... } }
// listado paginado
{ "success": true, "mensaje": "Texto", "data": [ ... ], "meta": { "total": 40, "limit": 20, "offset": 0, "hayMas": true } }
// error
{ "success": false, "mensaje": "Texto", "errores": [ { "campo": "email", "mensaje": "Email inválido" } ] }
```

Códigos: 400 validación/solicitud · 401 sin sesión · 403 sin permiso · 404 no existe ·
409 duplicado · 413 archivo grande · 429 demasiados intentos · 500 error inesperado.

## Piezas compartidas entre módulos

- `publicacionRepository.puedeVer / findVisibleOrFail / filtroVisibles` → regla de visibilidad
  (publico / seguidores / privado) para cualquier módulo que toque publicaciones.
- `publicacionRepository.ajustarContador(id, 'total_likes', +1)` y
  `usuarioRepository.ajustarContador(id, 'total_seguidores', -1)` → contadores desnormalizados.
- `notificacionService.notificar({...})` / `retirar({...})` → notificaciones + aviso SSE.
- `realtime.aTodos / aSala / aUsuario` → eventos Socket.IO (`salas.chat(id)`, `salas.grupo(id)`).
- `fileStorage.eliminar(publicIdOUrl)` (acepta el public_id o la URL de Cloudinary) y
  `archivoDe(req, campo)` / `archivosDe(req, campo)` → archivos subidos.
  Si una petición falla después de subir archivos, el `errorHandler` los borra solo (no quedan huérfanos).
- `publicacionService.eliminar(id, usuarioId)` / `eliminar(id, adminId, { comoAdmin: true })` → único flujo de borrado
  (documentos, secciones, contador del autor, Cloudinary y aviso `delete_post`).
- `logSeguridadRepository.registrar(...)` (módulo `seguridad`) + `contextoDe(req)` (`core/http/ContextoPeticion`)
  → bitácora de login, bloqueos y moderación.
- `ATRIBUTOS_USUARIO_PUBLICO` → columnas de usuario que se pueden mostrar en includes.

## Seguridad

- `AuthGuard.proteger` verifica el JWT **y** que la cuenta siga activa y sin suspender (la suspensión aplica al instante)
  y que el token sea de la versión vigente (`usuarios.token_version`): cambiar o restablecer la contraseña cierra
  todas las sesiones anteriores (el cambio con sesión devuelve un token nuevo).
- Login: 5 intentos fallidos bloquean 15 minutos; todo queda en `logs_seguridad`.
- Recuperar contraseña: token aleatorio de un solo uso (se guarda solo su sha256), vence en 1 h, máx. 3 por hora;
  la respuesta no revela si el correo existe.
- Rate limit en login, registro y recuperación de contraseña (`RATE_LIMIT_*` del `.env`).
- Socket.IO autenticado con el JWT (`auth.token`): cada usuario entra solo a su sala personal; `join_chat` /
  `join_group` se validan con `PermisosDeSalas` (los aporta `server.ts`, la infraestructura no conoce la lógica).

## Correo

`infrastructure/mail`: interfaz `MailService` con `SmtpMailService` (nodemailer, si hay `EMAIL_HOST` y `EMAIL_USER`)
o `ConsolaMailService` (escribe el correo en la consola en desarrollo). Plantillas en `mail/plantillas.ts`.

## Notificaciones push

`infrastructure/push`: interfaz `PushService` con `FirebasePushService` (firebase-admin, si `FIREBASE_SERVICE_ACCOUNT`
apunta al JSON de la cuenta de servicio) o `ConsolaPushService` (en desarrollo escribe la push en la consola).
El módulo `dispositivos` guarda los tokens de cada teléfono y su servicio implementa `AvisadorPush`:
`NotificacionService.notificar()` y `ChatService.enviar()` lo reciben por constructor y avisan al usuario.
Una push que falla nunca rompe la acción que la provocó, y los tokens que Firebase rechaza se borran solos.

## Tareas programadas

`server.ts` arranca `programarLimpieza()` del módulo de historias: cada 30 min borra las historias vencidas (24 h)
y sus archivos de Cloudinary.

## Contratos por módulo

`docs/api/<modulo>.md`: método, ruta, autenticación, body/query y forma de `data` de cada endpoint.

## Base de datos

`npm run db:init` crea `redstudent_db`, carga `database/redstudent_db.sql` si está vacía y luego
`SchemaSync` agrega las tablas, columnas y valores de ENUM que falten según los modelos (sin borrar datos).
`npm run db:init -- --force` la recrea desde cero.

## Pruebas

`npm test` corre Vitest + Supertest contra **SQLite en memoria** (no toca MySQL ni Cloudinary).
Helpers en `tests/helpers.ts`: `reiniciarBD()`, `crearUsuario()`, `bearer(usuario)`.
