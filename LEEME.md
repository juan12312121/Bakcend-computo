# TrinoFlow (RedStudent): todo en local

| Parte | Tecnología | Dirección |
|---|---|---|
| `backend/` | TypeScript · Express 5 · **Sequelize** · MySQL local · Socket.IO + SSE · Cloudinary | http://localhost:3000 |
| `frontend/` | Angular 20 (signals, standalone, lazy) · Tailwind v3 compilado | http://localhost:4200 |

Arquitectura y reglas de código:

- Backend: [backend/docs/ARQUITECTURA.md](backend/docs/ARQUITECTURA.md). Contratos de cada endpoint en `backend/docs/api/`.
- Frontend: [frontend/docs/ARQUITECTURA.md](frontend/docs/ARQUITECTURA.md). Capa de datos en `frontend/src/app/data/README.md`.

## 1. Configura el backend

Edita `backend/.env` (ya trae Cloudinary, JWT y límites; se quitaron AWS y Gemini):

- `DB_PASSWORD`: la contraseña del usuario `root` de tu MySQL local (servicio MySQL97). **Es lo único que falta.**

## 2. Crea la base local `redstudent_db`

```bash
cd backend
npm install
npm run db:init
```

Crea la base, carga `database/redstudent_db.sql` si está vacía y agrega las tablas, columnas y valores
que el código nuevo necesita (sin borrar datos). `npm run db:init -- --force` la borra y la recarga.
Corre `npm run db:init` cada vez que actualices el código: agrega lo nuevo sin tocar tus datos.

**Sin Node (solo MySQL):** `backend/database/trinoflow_completo.sql` trae las 89 tablas y los datos del respaldo.
Ojo: borra y vuelve a crear las tablas de `redstudent_db`.

```bash
mysql -u root -p < backend/database/trinoflow_completo.sql
```

## 3. Arranca

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm install
npm start
```

Abre http://localhost:4200

> OneDrive sincroniza `node_modules` y hace que `npm install` tarde muchísimo. Si se atora,
> pausa la sincronización de OneDrive mientras instalas o copia las carpetas fuera de OneDrive.

## Pruebas

```bash
cd backend
npm test
```

```bash
cd frontend
npx ng test --watch=false --browsers=ChromeHeadless
```

El backend se prueba contra SQLite en memoria (no toca tu MySQL ni Cloudinary).

## App móvil (Android con Capacitor)

La app de Android es la misma app web de Angular envuelta con Capacitor (`frontend/android`), con
barra de estado del color del tema, botón "atrás" nativo, compartir nativo, vibración y su propio ícono.

**APK sin Android Studio (lo más rápido):** ya está instalado el SDK de Android (solo línea de comandos) en
`%LOCALAPPDATA%\Android\Sdk`. En PowerShell:

```powershell
cd "C:\Users\User\OneDrive\Desktop\proyectos personales\frontend"; npm run movil:apk
```

Deja **`TrinoFlow.apk`** en `proyectos personales\`. Pásalo al teléfono (cable, Drive o WhatsApp a ti mismo), ábrelo y
permite "Instalar apps de origen desconocido" cuando Android lo pida. Tras cada cambio en la app, vuelve a correr el
comando e instala el APK nuevo encima (no se pierde la sesión).

**Con Android Studio (opcional, para emulador y depurar).** Requisitos (una sola vez): instalar [Android Studio](https://developer.android.com/studio) (trae el SDK).
El JDK 21 ya lo tienes.

**Generar y abrir** (en PowerShell):

```powershell
cd "C:\Users\User\OneDrive\Desktop\proyectos personales\frontend"; npm run movil:android; npm run movil:abrir
```

En Android Studio: conecta tu teléfono por USB (con "Depuración USB" activada) o crea un emulador y presiona ▶ Run.
Para un APK instalable: Build → Build App Bundle(s) / APK(s) → Build APK(s).

**Para que el teléfono llegue al backend:**
- El teléfono y la PC deben estar en el mismo Wi-Fi.
- La app busca el backend en la IP de la PC: `frontend/src/environments/environment.movil.ts` (hoy `192.168.1.172`).
  Si cambia (`ipconfig` → Dirección IPv4), actualízala y vuelve a correr `npm run movil:android`.
- La primera vez que corra el backend, Windows puede preguntar por el firewall: permite el acceso en redes privadas
  (puerto 3000).

**Ícono y pantalla de inicio:** se generan desde `frontend/assets/` con `npm run movil:iconos`.

**Cámara:** en la app, "Crear historia" muestra **Tomar foto** y **Grabar video**, que abren la cámara del teléfono
directo (Android pide el permiso la primera vez). En la web sigue el selector de archivos de siempre.

### Notificaciones push (Firebase)

Ya están conectadas al proyecto de Firebase `trinoflow-44aed`: `frontend/android/app/google-services.json`,
`pushNativas: true` y `backend/firebase-cuenta-servicio.json` con `FIREBASE_SERVICE_ACCOUNT` en `backend/.env`.
Ese archivo **es secreto** (está en `.gitignore`): no lo subas ni lo compartas.

La primera vez que entres a la app, Android 13+ pregunta si permite notificaciones. Al tocar una se abre la publicación,
el perfil, el chat, el evento, la tarea o lo que corresponda. Con la app abierta no se duplican.

**Permisos que pide la app:** notificaciones, cámara y micrófono (historias, llamadas, en vivo y el escáner de boletos).

## App para iPhone

El proyecto de iOS está en `frontend/ios` (Capacitor con Swift Package Manager). **Solo se compila en una Mac con Xcode.**

```bash
cd frontend
npm run movil:ios
npm run movil:abrir-ios
```

En Xcode: elige tu equipo de firma (Signing & Capabilities), conecta el iPhone y presiona ▶. Para push en iPhone hay
que registrar la app iOS en Firebase (descargar `GoogleService-Info.plist`) y subir la llave APNs de Apple
(requiere cuenta de desarrollador de Apple).

## Docker (opcional)

```bash
docker compose up --build
```

Levanta backend (3000) y frontend (4200) usando **tu MySQL de la PC** (`host.docker.internal`) con los datos
de `backend/.env`. Si MySQL rechaza la conexión del contenedor, el usuario de `DB_USER` debe aceptar conexiones
que no vengan de `localhost`.

## Pagos, boletos y llamadas (opcional)

En `backend/.env`:

- `BOLETOS_SECRETO`: firma los QR de los boletos (ya tiene un valor; no lo cambies o los QR viejos dejan de servir).
- `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`, o `MERCADOPAGO_ACCESS_TOKEN`: cobrar boletos de verdad. Sin ellos los
  pagos funcionan en **modo demo** (se aprueban con un botón; sirve para probar).
- `TURN_URL`, `TURN_USUARIO`, `TURN_CLAVE`: solo si las llamadas no conectan entre redes distintas (datos móviles,
  redes de empresa). En el mismo Wi-Fi no hacen falta.

## Correo

Sin `EMAIL_USER`/`EMAIL_PASSWORD` en `backend/.env`, los correos (recuperar contraseña) se escriben en la consola
del backend con el enlace. Para Gmail usa una "contraseña de aplicación" en `EMAIL_PASSWORD`.

## Funciones

Red social para ocio, trabajo, escuela y eventos, en web, Android e iPhone.

- **Social:** feed con categorías, publicaciones con imagen, video y documentos, reels con scroll, encuestas,
  reacciones, comentarios con respuestas, guardados, hashtags y menciones, historias de 24 h con destacadas y archivo,
  explorar, seguidores, cuenta privada con solicitudes, bloqueos, verificación de correo.
- **Creadores:** editor de fotos y videos, publicaciones programadas, estadísticas de perfil y de cada publicación.
- **Comunicación:** chat directo y de grupo en tiempo real (audio, archivos, reacciones, mensajes temporales), llamadas y
  videollamadas, transmisiones en vivo con comentarios, canales tipo Telegram.
- **Grupos de trabajo y escuela:** tipos de grupo, tableros tipo Trello/Jira (columnas, sprints, tareas, checklist,
  etiquetas, actividad), documentos colaborativos en vivo, archivos con visor de PDF, calendario, asignaciones con
  entregas y calificación, registro de horas.
- **Eventos:** asistentes, recordatorios, boletos con QR, escáner en la puerta y pagos (Stripe, Mercado Pago o demo).
- **Marketplace:** anuncios con fotos, guardados, interesados, calificación a vendedores.
- **Seguridad:** reportes y bandeja de moderación, palabras prohibidas, suspensiones, panel de administración,
  modo sin conexión, notificaciones en vivo y push, 12 temas visuales.

## Qué cambió

- **Sin AWS ni Gemini.** Cloudinary se queda para fotos y documentos.
- **Backend reescrito** en TypeScript + Sequelize con capas `routes → controller → service → repository`,
  clases base reutilizables (`BaseController`, `BaseService`, `BaseRepository`), errores con herencia
  (`AppError` → `NotFoundError`, `ConflictError`...), validación con zod y una sola forma de respuesta
  `{ success, mensaje, data, meta }`. El código JS anterior quedó en `backend/legacy/` solo como referencia
  (se puede borrar; ahí también están los archivos que antes se guardaban en disco, en `legacy/src/uploads`).
- **Frontend reescrito** por áreas (`features/`), con capa de datos (`data/`) que hereda de `BaseApiService`,
  sesión con signals, interceptores para el token, componentes compartidos (modal, avatar, avisos,
  confirmaciones) y formularios reactivos con los mismos validadores que el backend.
- **Seguridad:** bloqueo tras 5 intentos de login, suspensión inmediata, el perfil ajeno ya no muestra el email,
  `logs_seguridad` con todo lo importante, reportes y estadísticas solo para admin.
