# Historias destacadas (`/api/destacadas`)

Colecciones del perfil (título + portada) con historias **propias** que no vencen. Las historias vencidas pasan al
archivo (`GET /api/historias/archivo`) en lugar de borrarse, así que se pueden agregar cuando sea; una historia en una
destacada conserva su archivo de Cloudinary. Respuestas con el contrato estándar `{ success, mensaje, data }`.

## Reglas

- **Quién las ve:** quien puede ver las publicaciones del dueño (`privacidadService.puedeVerPublicacionesDe`): el dueño,
  cualquiera si la cuenta es pública y no hay bloqueo, o seguidores aceptados si es privada. Si no → 403; cuenta
  inexistente o desactivada → 404. Ver no exige sesión (sin sesión, solo cuentas públicas).
- Las destacadas vacías (sin historias) solo las ve su dueño.
- Máximo 100 destacadas por perfil y 100 historias por destacada; título 1-40 caracteres.
- **Portada:** imagen subida (`portada`) → si no, la historia elegida (`portada_historia_id`, debe estar en la destacada)
  → si no, la primera. De una historia de imagen se usa la imagen; de un video, su primer cuadro (`so_0` de Cloudinary);
  de una de texto, su gradiente y texto.
- Borrar una historia (`DELETE /api/historias/:id`) la saca de todas las destacadas y deja de ser portada.

## Tipos

```ts
type PortadaDestacada =
  | { tipo: 'imagen'; url: string }
  | { tipo: 'texto'; fondo: string | null; texto: string | null }   // pintar con bg-gradient-to-br + fondo
  | { tipo: 'ninguna' };

interface Destacada {
  id: number;
  usuario_id: number;
  titulo: string;
  orden: number;                 // posición en el perfil (0 = primera)
  portada: PortadaDestacada;
  portada_subida: boolean;       // la portada es una imagen subida
  portada_historia_id: number | null;
  total_historias: number;
  historia_ids: number[];        // en orden de reproducción
  fecha_creacion: string;
  fecha_actualizacion: string;
}

interface DestacadaConHistorias extends Destacada {
  usuario: UsuarioPublico;       // dueño (id, nombre_usuario, nombre_completo, foto_perfil_url, carrera)
  historias: Historia[];         // ver historias.md (vista_por_mi: true)
}
```

## Endpoints

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| GET | `/mias` | sí | — | `Destacada[]` (incluye vacías) |
| GET | `/usuario/:usuarioId` | opcional | — | `Destacada[]` en orden (sin las vacías si no es el dueño) |
| GET | `/:id` | opcional | — | `DestacadaConHistorias` |
| POST | `/` | sí | JSON o multipart: `titulo`, `historia_ids` (arreglo, o texto `"3,5"` / `"[3,5]"` en multipart), `portada_historia_id?`, archivo `portada?` (imagen) | `DestacadaConHistorias` (201) |
| PUT | `/:id` | sí (dueño) | JSON o multipart, todo opcional: `titulo`, `historia_ids` (reemplaza contenido y orden), `portada_historia_id` (`null` = la primera), `quitar_portada`, archivo `portada` | `DestacadaConHistorias` |
| POST | `/:id/historias` | sí (dueño) | `{ historia_id }` (propia, vigente o del archivo; se agrega al final, si ya estaba no se duplica) | `Destacada` |
| DELETE | `/:id/historias/:historiaId` | sí (dueño) | — | `Destacada` (404 si no estaba) |
| PUT | `/orden` | sí | `{ ids: number[] }` (solo mías) | `Destacada[]` en el nuevo orden |
| DELETE | `/:id` | sí (dueño) | — | sin `data`; las historias siguen en el archivo; la portada subida se borra de Cloudinary |

## Errores

- 400: título vacío o > 40, `historia_ids` vacío o > 100, historias ajenas o inexistentes ("Solo puedes destacar tus propias
  historias"), portada fuera de la lista, portada que no es imagen, `PUT` sin cambios, orden con destacadas ajenas,
  más de 100 destacadas.
- 401 sin sesión en rutas con auth "sí". 403 modificar una ajena o ver una cuenta que no se puede ver. 404 no existe.

Sin eventos de Socket.IO ni notificaciones.
