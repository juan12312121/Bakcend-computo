# Usuarios (`/api/usuarios`)

Todas las rutas requieren sesión. Respuestas con el contrato estándar `{ success, mensaje, data }`.
`UsuarioPropio` está en `docs/api/auth.md` (incluye `cuenta_privada` y `email_verificado`).

## Tipos

```ts
interface RelacionUsuario {
  lo_sigo: boolean;             // lo sigo (aceptado)
  solicitud_pendiente: boolean; // le pedí seguirlo y no responde
  me_sigue: boolean;            // me sigue (aceptado)
  bloqueado_por_mi: boolean;    // yo lo bloqueé
}

// GET /usuarios/:id de otra persona: sin email, rol, activo, suspendido, mantener_sesion,
// fecha_actualizacion ni email_verificado.
interface PerfilAjeno {
  id: number;
  nombre_usuario: string;
  nombre_completo: string;
  foto_perfil_url: string | null;
  foto_portada_url: string | null;
  biografia: string | null;
  ubicacion: string | null;
  carrera: string | null;
  total_seguidores: number;
  total_siguiendo: number;
  total_posts: number;
  en_linea: boolean;
  ultima_actividad: string | null;
  cuenta_privada: boolean;
  fecha_creacion: string;
  relacion: RelacionUsuario;
}

interface UsuarioPublico { id: number; nombre_usuario: string; nombre_completo: string; foto_perfil_url: string | null; carrera: string | null }
interface UsuarioEnLinea extends UsuarioPublico { en_linea: boolean; ultima_actividad: string | null }
```

## Perfil

| Método | Path | Body | Respuesta |
|---|---|---|---|
| GET | `/me` | — | `data: UsuarioPropio` |
| GET | `/:id` | — | `data: UsuarioPropio` si es el mío; `PerfilAjeno` si es de otro |
| PUT | `/me` | JSON o multipart: `nombre_completo?`, `biografia?`, `ubicacion?`, `carrera?`, `cuenta_privada?` (boolean; en multipart `"true"`/`"false"`), archivos `foto_perfil?`, `foto_portada?` | `data: UsuarioPropio` |
| DELETE | `/me` | — | 200 sin `data` (borrado lógico) |

Reglas de `GET /:id`:
- 404 si la cuenta no existe, está eliminada o **me bloqueó**.
- Si **yo** la bloqueé, responde 200 con `relacion.bloqueado_por_mi: true` (para poder desbloquear desde su perfil);
  el frontend no muestra su contenido.
- Cuenta privada que no sigo (`cuenta_privada && !relacion.lo_sigo`): el frontend muestra el candado en lugar de las publicaciones.

`PUT /me` con `cuenta_privada: false` cuando era privada: se aceptan todas las solicitudes pendientes (notificación
`seguimiento_aceptado` a cada uno) y la respuesta ya trae `total_seguidores` actualizado.
Errores: 400 sin datos ("No hay datos para actualizar") o validación (`cuenta_privada` que no es booleano).

## Búsqueda y presencia

| Método | Path | Query / body | Respuesta |
|---|---|---|---|
| GET | `/buscar` | `q` (mín. 2), `limit` (1-50, def. 10) | `data: UsuarioPublico[]` (sin cuentas suspendidas ni usuarios con bloqueo conmigo) |
| GET | `/activos` | — | `data: UsuarioEnLinea[]` (sin usuarios con bloqueo conmigo) |
| GET | `/me/seguidores/activos` | — | `data: UsuarioEnLinea[]` (mis seguidores aceptados conectados) |
| POST | `/me/heartbeat` | — | `data: { en_linea: true, ultima_actividad }` |
| PUT | `/me/actividad` | `{ en_linea: boolean }` | `data: { en_linea, ultima_actividad }` |
