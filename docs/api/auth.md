# Autenticación (`/api/auth`)

Respuestas con el contrato estándar `{ success, mensaje, data? }`; errores `{ success: false, mensaje, errores? }`.
Con sesión = header `Authorization: Bearer <token>`.

Rate limit (`RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX_REQUESTS`, 429 al pasarse) en: registro, login,
olvide-contrasena, restablecer-contrasena y restablecer-contrasena/validar.

## Tipos

```ts
// Usuario propio (nunca incluye contrasena, ids de Cloudinary, intentos_fallidos ni bloqueo_hasta)
interface UsuarioPropio {
  id: number;
  nombre_usuario: string;
  email: string;
  nombre_completo: string;
  rol: 'usuario' | 'admin';
  foto_perfil_url: string | null;
  foto_portada_url: string | null;
  biografia: string | null;
  ubicacion: string | null;
  carrera: string | null;
  total_seguidores: number;
  total_siguiendo: number;
  total_posts: number;
  mantener_sesion: boolean;
  activo: boolean;
  suspendido: boolean;
  en_linea: boolean;
  ultima_actividad: string | null; // ISO
  cuenta_privada: boolean;         // ver docs/api/seguidores.md (solicitudes)
  email_verificado: boolean;       // false hasta abrir el enlace del correo (no bloquea el login)
  fecha_creacion: string;          // ISO
  fecha_actualizacion: string;     // ISO
}

interface Sesion {
  usuario: UsuarioPropio;
  token: string; // JWT, vence según JWT_EXPIRE (7d por defecto)
}
```

## Registro y sesión

| Método | Path | Auth | Body | Respuesta |
|---|---|---|---|---|
| POST | `/registro` | no | `{ nombre_usuario, email, nombre_completo, contrasena }` | 201 `data: Sesion` |
| POST | `/login` | no | `{ email, contrasena }` (`email` acepta email, usuario o `@usuario`) | 200 `data: Sesion` |
| POST | `/logout` | sí | — | 200 sin `data` (marca al usuario fuera de línea) |
| GET | `/verificar` | sí | — | 200 `data: UsuarioPropio` |

Al registrarse se manda el correo "Verifica tu correo" (ver abajo). No verificar el correo **no** impide iniciar sesión.

Reglas de registro: `nombre_usuario` 3–50 caracteres (letras, números, `_`); `email` válido (se guarda en minúsculas);
`nombre_completo` 3–150; `contrasena` mínimo 6 caracteres.

Errores:
- 400 validación (`errores: [{ campo, mensaje }]`).
- 409 "El email ya está registrado" / "El nombre de usuario ya está en uso" (registro).
- 401 "Credenciales inválidas" (login).
- 403 "Cuenta desactivada" / "Tu cuenta está suspendida" (login).
- 429 cuenta bloqueada 15 minutos tras 5 intentos fallidos de login.
- 401 sin token o token inválido en rutas con sesión.

## Recuperar contraseña (sin sesión)

| Método | Path | Auth | Body / query | Respuesta |
|---|---|---|---|---|
| POST | `/olvide-contrasena` | no | `{ email }` | 200 sin `data`, siempre el mismo mensaje |
| GET | `/restablecer-contrasena/validar` | no | query `?token=` | 200 `data: { valido: boolean }` |
| POST | `/restablecer-contrasena` | no | `{ token, contrasena }` | 200 sin `data` |

Flujo para el frontend:
1. Página "Olvidé mi contraseña" → `POST /olvide-contrasena`. Responde **siempre** 200 con
   `mensaje: "Si el email está registrado, te enviaremos un enlace para restablecer tu contraseña."`
   (no revela si el email existe). Mostrar ese mensaje tal cual.
2. El correo lleva el enlace `${FRONTEND_URL}/restablecer-contrasena?token=<token>` (vence en 1 hora, un solo uso).
   El frontend debe tener esa ruta.
3. Al abrir la página, llamar `GET /restablecer-contrasena/validar?token=...`; si `data.valido` es `false`,
   mostrar "El enlace no es válido o ya venció" y ofrecer pedir otro (no pedir la contraseña).
4. Enviar `POST /restablecer-contrasena { token, contrasena }`; al 200, mandar al login.

Reglas:
- Solo cuentas activas reciben correo; máximo 3 solicitudes por usuario por hora (las de más responden igual, sin correo).
- Pedir un enlace nuevo invalida los anteriores sin usar; restablecer o cambiar la contraseña también.
- Restablecer quita el bloqueo por intentos fallidos. Las sesiones (JWT) ya emitidas siguen vigentes hasta que venzan.
- `contrasena` con las mismas reglas del registro (mínimo 6 caracteres).

Errores:
- 400 validación (`email` inválido, falta `token`, `contrasena` corta).
- 400 `mensaje: "El enlace para restablecer la contraseña no es válido o ya venció. Solicita uno nuevo."`
  (token inventado, usado o vencido).
- 429 rate limit.

## Cambiar contraseña (con sesión)

| Método | Path | Auth | Body | Respuesta |
|---|---|---|---|---|
| PUT | `/contrasena` | sí | `{ actual, nueva }` | 200 `data: { token }` — token NUEVO; guárdalo: el anterior deja de valer |

Cambiar (o restablecer) la contraseña sube `usuarios.token_version`, así que **todas las sesiones anteriores
dejan de valer** (responden 401 "Tu sesión ya no es válida…"). Por eso este endpoint devuelve un token nuevo.

Errores:
- 400 validación (`actual` requerida; `nueva` mínimo 6 caracteres).
- 400 `errores: [{ campo: 'actual', mensaje: 'La contraseña actual es incorrecta' }]`
  (no es 401 a propósito: un 401 haría que el frontend cierre la sesión).
- 400 "La nueva contraseña debe ser distinta de la actual".

## Bitácora (`logs_seguridad`)

Eventos que deja este módulo: `login_exitoso`, `login_fallido`, `cuenta_bloqueada`, `restablecimiento_solicitado`,
`restablecimiento_email_desconocido` (sin usuario), `restablecimiento_limite`, `restablecimiento_invalido` (sin usuario),
`contrasena_restablecida`, `cambio_contrasena_fallido`, `contrasena_cambiada`.

## Verificar el correo

| Método | Path | Auth | Body / query | Respuesta |
|---|---|---|---|---|
| GET | `/verificar-correo` | no | query `?token=` | 200 `data: { usuario_id: number, email_verificado: true }` |
| POST | `/reenviar-verificacion` | sí | — | 200 sin `data` (`mensaje: "Te enviamos un nuevo enlace para verificar tu correo."`) |

Flujo:
1. `POST /registro` crea un token aleatorio (solo se guarda su sha256 en `verificaciones_email`, vence en **24 h**,
   un solo uso) y manda el correo con `${FRONTEND_URL}/verificar-correo?token=<token>`. El frontend debe tener esa ruta
   (pública: sirve con o sin sesión).
2. La página llama `GET /verificar-correo?token=...`. Al 200, `usuarios.email_verificado = true`; si hay sesión con ese
   `usuario_id`, actualizar el usuario guardado (`email_verificado: true`).
3. Con sesión, `POST /reenviar-verificacion` manda otro enlace e invalida los anteriores.

Errores:
- 400 falta `token` (`errores: [{ campo: 'token', ... }]`).
- 400 `mensaje: "El enlace para verificar tu correo no es válido o ya venció. Pide uno nuevo desde tu cuenta."`
  (token inventado, ya usado o vencido).
- 400 "Tu correo ya está verificado" (reenviar).
- 429 "Ya te enviamos un correo hace menos de un minuto..." (reenviar: máximo 1 por minuto por usuario; el del registro cuenta).
- 429 rate limit general en `/verificar-correo`.

Para las cuentas que ya existían antes de esta función: `UPDATE usuarios SET email_verificado = 1;`
