# Llamadas y videollamadas (`/api/llamadas` + Socket.IO)

Llamadas de audio o video 1 a 1 y de grupo con **WebRTC**. El audio y el video viajan directo entre los teléfonos;
el servidor solo hace la **señalización** por Socket.IO (quién llama, quién contesta, reenviar ofertas/respuestas SDP y
candidatos ICE) y guarda el **registro** (historial). Todo requiere sesión.

- Llamadas de grupo en **malla** (cada quien con una `RTCPeerConnection` hacia cada uno de los demás): máximo **8 personas**.
  Quien entra recibe la lista de presentes y **les manda la oferta a cada uno**.
- Si nadie contesta en **40 s** → `perdida` + notificación `llamada_perdida`.
- El estado en curso vive en memoria del proceso (con varias instancias haría falta el adaptador de Redis y estado compartido).
- Montaje: `apiRoutes.use('/llamadas', llamadaRoutes)` y `realtime.usar(manejadorLlamadas)` antes de `realtime.adjuntar(...)`.
  Al arrancar: `llamadaService.cerrarHuerfanas()` (las que quedaron "sonando"/"en curso" de la vez anterior).

## Reglas

- **A un usuario**: que exista y esté activo (404), no uno mismo (400), **sin bloqueo en ningún sentido** (403).
  Si su cuenta es privada, solo si uno lo sigue o él lo sigue a uno (aceptado) (403).
- **A un grupo**: solo miembros activos (403). Suena a los demás miembros activos menos los bloqueados (en cualquier sentido).
  Un miembro activo puede **entrar tarde** (`llamada:aceptar` aunque no le haya sonado o ya se le haya dado por perdida).
  Solo una llamada en curso por grupo (`conflicto`, con `datos.llamada_id` para unirse).
- **Ocupado**: si el destinatario ya está dentro de otra llamada (o le está sonando otra 1 a 1) → error `ocupado`; la llamada
  queda registrada como `perdida` y le llega `llamada_perdida` ("…mientras estabas en otra llamada"). Quien ya está en una
  llamada no puede iniciar otra (400).
- **Privacidad de la señalización**: SDP/ICE/medios solo se reenvían entre personas que están DENTRO de esa llamada y solo
  desde el socket con el que entraron (otro dispositivo de la misma persona tampoco puede inyectar señales).
- **Termina**: 1 a 1 cuando cualquiera cuelga; en grupo cuando no queda nadie, o queda una sola persona y a nadie le suena.
- **Desconexión**: si se cae el socket de alguien que está dentro, se le esperan **15 s** a que haga `llamada:retomar`
  (los demás reciben `llamada:reconectando`); si no vuelve, sale (`motivo: 'desconexion'`).
- **Push**: si el destinatario no tiene ningún socket conectado (`realtime.estaConectado`), se le manda push con
  `datos: { tipo: 'llamada', llamada_id, llamada_tipo: 'audio' | 'video' }`. Al abrir la app y conectar el socket,
  si la llamada sigue sonando, le llega `llamada:entrante` sola.

## Tipos

```ts
type TipoLlamada = 'audio' | 'video';
type EstadoLlamada = 'sonando' | 'en_curso' | 'terminada' | 'perdida' | 'rechazada';
type EstadoParticipante = 'invitado' | 'unido' | 'salio' | 'rechazo' | 'perdida';
interface UsuarioPublico { id; nombre_usuario; nombre_completo; foto_perfil_url; carrera }
interface GrupoResumen { id: number; nombre: string; imagen_url: string | null; tipo: string }

/** Llamada en curso (socket y GET /grupos/:id/activa). */
interface LlamadaEnVivo {
  id: number;
  tipo: TipoLlamada;
  estado: 'sonando' | 'en_curso';
  grupo: GrupoResumen | null;
  iniciador: UsuarioPublico;
  presentes: UsuarioPublico[];   // dentro ahora
  sonando: number[];             // ids a quienes todavía les suena
  invitados: UsuarioPublico[];   // a quienes se llamó (para pintar "Llamando a ...")
  maximo: number;                // 8
  creada_en: string;
}
interface EntradaLlamada { llamada: LlamadaEnVivo; presentes: UsuarioPublico[] /* sin mí: a quienes mandar la oferta */ }
```

## REST

### GET `/api/llamadas` — historial
Query: `limit` (1-100, 20), `offset` (0), `filtro` (`todas` | `perdidas`, por defecto `todas`).
`data`: `LlamadaHistorial[]` (la más reciente primero), `meta` paginado.
```ts
interface LlamadaHistorial {
  id: number; tipo: TipoLlamada; estado: EstadoLlamada;
  direccion: 'saliente' | 'entrante';
  mi_estado: EstadoParticipante;      // perdida = me sonó y no contesté
  otro: UsuarioPublico | null;        // 1 a 1: la otra persona; grupo: null
  grupo: GrupoResumen | null;
  iniciador: UsuarioPublico;
  inicio: string | null; fin: string | null; duracion_seg: number;
  max_participantes: number; fecha_creacion: string;
}
```

### GET `/api/llamadas/ice` — servidores ICE
`data`: `{ ice_servers: RTCIceServer[]; turn: boolean }`. Siempre STUN públicos de Google; TURN si están las variables
`TURN_URL` (una o varias separadas por coma: `turn:...`, `turns:...`), `TURN_USUARIO`, `TURN_CLAVE`.
Sin TURN algunas redes (NAT simétrica, datos móviles estrictos) no podrán conectarse.

### GET `/api/llamadas/grupos/:grupoId/activa`
Solo miembros activos (403). `data`: `LlamadaEnVivo | null` (para mostrar "Unirse a la llamada" en el grupo).

## Socket.IO

Todos los eventos del cliente usan **acuse**: `socket.emit(evento, datos, (r) => ...)` con
`r = { ok: true, data } | { ok: false, error: string, codigo, datos? }` y
`codigo ∈ 'invalido' | 'sin_sesion' | 'prohibido' | 'no_encontrado' | 'conflicto' | 'ocupado' | 'llena' | 'error'`.

| Cliente → servidor | Datos | `data` del acuse |
|---|---|---|
| `llamada:iniciar` | `{ tipo?: 'audio'\|'video' (audio), usuario_id? , grupo_id? }` (solo uno) | `{ llamada: LlamadaEnVivo }` |
| `llamada:sonando` | `{ llamada_id }` (el teléfono ya está timbrando) | `{ llamada_id }` |
| `llamada:aceptar` | `{ llamada_id }` | `EntradaLlamada` → mandar oferta a cada `presentes[i]` |
| `llamada:rechazar` | `{ llamada_id }` | `{ llamada_id }` |
| `llamada:colgar` | `{ llamada_id }` (si aún suena, equivale a rechazar) | `{ llamada_id }` |
| `llamada:senal` | `{ llamada_id, para, tipo: 'oferta'\|'respuesta'\|'ice', sdp?, candidato? }` | `{ entregada: true }` |
| `llamada:medios` | `{ llamada_id, microfono, camara, pantalla? }` | `{ llamada_id }` |
| `llamada:retomar` | `{ llamada_id }` (tras reconectar el socket; luego reiniciar ICE) | `EntradaLlamada` |
| `llamada:pendientes` | `{}` | `LlamadaEnVivo[]` que me están sonando |

| Servidor → cliente | Datos | A quién |
|---|---|---|
| `llamada:entrante` | `{ llamada: LlamadaEnVivo }` | sala personal del invitado (todos sus dispositivos) |
| `llamada:sonando` | `{ llamada_id, usuario_id }` | presentes |
| `llamada:unido` | `{ llamada_id, usuario }` | presentes (menos quien entra) |
| `llamada:salio` | `{ llamada_id, usuario_id }` | presentes (grupo) |
| `llamada:rechazada` | `{ llamada_id, usuario_id }` | presentes |
| `llamada:terminada` | `{ llamada_id, estado, motivo, duracion_seg }` | quienes seguían dentro |
| `llamada:cancelada` | `{ llamada_id, motivo }` (dejar de sonar) | a quienes les sonaba / otros dispositivos |
| `llamada:senal` | `{ llamada_id, de, tipo, sdp?, candidato? }` | solo el socket de `para` |
| `llamada:medios` | `{ llamada_id, usuario_id, microfono, camara, pantalla }` | presentes |
| `llamada:reconectando` / `llamada:reconectado` | `{ llamada_id, usuario_id }` | presentes |

`motivo ∈ 'colgo' | 'sin_respuesta' | 'rechazada' | 'desconexion' | 'contestada_en_otro_dispositivo'`.

## Notificaciones

- `llamada_perdida` (SSE + push): al destinatario que no contestó (40 s), cuando quien llama cuelga antes, o si estaba
  ocupado. `entidad_tipo: 'usuario'` + `entidad_id` = quien llamó (1 a 1) o `entidad_tipo: 'grupo'` + id del grupo.
- Push directa (sin guardar notificación) `{ tipo: 'llamada', llamada_id }` cuando el destinatario no tiene socket.
