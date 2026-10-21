# Transmisiones en vivo (`/api/transmisiones` + Socket.IO)

Video en vivo estilo Instagram Live con WebRTC: comentarios flotantes, reacciones y contador de espectadores.
Todo requiere sesión. Montaje: `apiRoutes.use('/transmisiones', transmisionRoutes)` y
`realtime.usar(manejadorTransmisiones)`; al arrancar, `transmisionService.cerrarHuerfanas()`.

## Modelo de medios (importante)

**Uno-a-muchos en malla**: el anfitrión abre una `RTCPeerConnection` por espectador y le manda su cámara y micrófono
(el espectador solo recibe). La subida del teléfono del anfitrión se reparte entre todos, así que sirve para
**audiencias chicas (~20 personas, límite `MAXIMO_ESPECTADORES = 20`)**. Para cientos o miles se necesita un servidor
de medios (SFU) como **LiveKit**, mediasoup o Janus: el anfitrión sube un solo flujo y el servidor lo reparte; en ese caso
esta señalización se reemplaza por la del SFU (los REST, comentarios, reacciones y contador siguen sirviendo).

## Reglas

- **Quién la ve**: si es de un grupo, sus miembros activos; si no, quien puede ver las publicaciones del anfitrión
  (cuenta pública o seguidor aceptado). Con bloqueo en cualquier sentido → 404. Sin acceso → 403.
- **Iniciar**: una sola en vivo por persona (409). Con `grupo_id` hay que ser miembro activo (403).
  Avisa `transmision_en_vivo` a los seguidores aceptados (o a los miembros activos del grupo), sin bloqueados.
- **Terminar**: solo el anfitrión (403). Guarda `fin`, `max_espectadores` (pico), `total_espectadores` (personas
  distintas), `total_reacciones`. Si el anfitrión no conecta su socket o lo pierde y no vuelve en **30 s**, termina sola
  (`motivo: 'desconexion'`).
- **Comentarios**: hasta 300 caracteres, solo quien está en la sala (espectador o anfitrión), mínimo 400 ms entre
  comentarios de la misma persona (429 → `codigo: 'error'`). Se guardan; al entrar llegan los últimos 30.
- **Reacciones**: `corazon | fuego | aplauso | risa | wow`; no se guardan una por una, solo el total.

## Tipos

```ts
interface TransmisionVista {
  id: number; anfitrion_id: number; titulo: string; grupo_id: number | null;
  estado: 'en_vivo' | 'terminada'; inicio: string; fin: string | null;
  max_espectadores: number; total_espectadores: number; total_comentarios: number; total_reacciones: number;
  fecha_creacion: string;
  anfitrion: UsuarioPublico; grupo: GrupoResumen | null;
  espectadores: number;      // conectados ahora (0 si terminó)
  soy_anfitrion: boolean;
}
interface ComentarioEnVivo { id: number; transmision_id: number; texto: string; fecha_creacion: string; usuario: UsuarioPublico }
```

## REST

| Método | Ruta | Body / query | `data` |
|---|---|---|---|
| GET | `/` | `limit`, `offset`, `grupo_id?`, `anfitrion_id?` | `TransmisionVista[]` en vivo visibles (paginado) |
| POST | `/` | `{ titulo (1-150), grupo_id? }` | `TransmisionVista` (201) |
| GET | `/:id` | | `TransmisionVista` (también terminadas) |
| POST | `/:id/terminar` | | `TransmisionVista` terminada |
| GET | `/:id/comentarios` | `limit` (50), `offset` | `ComentarioEnVivo[]`, el más nuevo primero |
| GET | `/:id/espectadores` | | `UsuarioPublico[]` viendo ahora (solo anfitrión, 403) |

## Socket.IO

Acuse `{ ok: true, data } | { ok: false, error, codigo }` igual que en llamadas
(`codigo` incluye `'llena'` cuando ya hay 20 espectadores).

| Cliente → servidor | Datos | `data` del acuse |
|---|---|---|
| `transmision:anfitrion` | `{ transmision_id }` (el anfitrión conecta/reconecta) | `{ transmision, espectadores: UsuarioPublico[] }` → mandar oferta a cada uno |
| `transmision:unirse` | `{ transmision_id }` | `{ transmision, comentarios, espectadores }` |
| `transmision:salir` | `{ transmision_id }` | `{ transmision_id }` |
| `transmision:senal` | `{ transmision_id, para, tipo: 'oferta'\|'respuesta'\|'ice', sdp?, candidato? }` | `{ entregada: true }` |
| `transmision:comentar` | `{ transmision_id, texto }` | `ComentarioEnVivo` |
| `transmision:reaccion` | `{ transmision_id, tipo? }` | `{ transmision_id }` |
| `transmision:terminar` | `{ transmision_id }` | `{ transmision_id }` |

| Servidor → cliente | Datos | A quién |
|---|---|---|
| `transmision:espectador` | `{ transmision_id, usuario }` → crear conexión y mandar oferta | socket del anfitrión |
| `transmision:espectador_salio` | `{ transmision_id, usuario_id }` | socket del anfitrión |
| `transmision:contador` | `{ transmision_id, espectadores }` | sala |
| `transmision:comentario` | `{ transmision_id, comentario }` | sala |
| `transmision:reaccion` | `{ transmision_id, usuario_id, tipo }` | sala |
| `transmision:senal` | `{ transmision_id, de, tipo, sdp?, candidato? }` | solo el destinatario (anfitrión ↔ un espectador) |
| `transmision:anfitrion_reconectando` / `transmision:anfitrion_volvio` | `{ transmision_id }` | sala |
| `transmision:terminada` | `{ transmision_id, motivo: 'anfitrion' \| 'desconexion' }` | sala (y los saca de ella) |

Las señales solo se aceptan entre el socket del anfitrión y el socket con el que el espectador entró.

## Notificaciones

`transmision_en_vivo` con `entidad_tipo: 'transmision'`, `entidad_id` → el frontend abre `/en-vivo/:id`.
