# API · Encuestas (`/api/encuestas`)

Una encuesta por publicación. Contrato estándar (`success`, `mensaje`, `data`).

## `EncuestaVista`

```jsonc
{
  "id": 4,
  "multiple": false,
  "cierra_en": "2026-10-16T15:00:00.000Z", // null = no cierra
  "cerrada": false,                        // true si ya pasó cierra_en
  "total_votos": 10,                       // personas que votaron
  "opciones": [
    { "id": 11, "texto": "Café", "total_votos": 7, "porcentaje": 70 },
    { "id": 12, "texto": "Té", "total_votos": 3, "porcentaje": 30 }
  ],
  "mis_votos": [11]                        // vacío sin sesión o si no voté
}
```
`porcentaje` = votos de la opción / personas que votaron, redondeado (en una de opción múltiple pueden sumar más de 100).
La misma forma llega en `PublicacionVista.encuesta` (feed, perfil, detalle, guardados).

## Endpoints

| Método | Path | Auth | Entrada | `data` |
|---|---|---|---|---|
| POST | `/` | sí (autor de la publicación) | body `{ publicacion_id, opciones: string[] (2-6, 1-120 caracteres, sin repetir), multiple?: boolean (false), cierra_en?: fecha ISO futura \| null }` | `EncuestaVista` (201) |
| GET | `/:id` | opcional | — | `EncuestaVista` |
| POST | `/:id/votar` | sí | body `{ opcion_ids: number[] (1+, sin repetir) }` | `EncuestaVista`. **Reemplaza** mi voto anterior |
| DELETE | `/:id/voto` | sí | — | `EncuestaVista` (`mis_votos: []`) |

## Reglas
- Crear: 404 si la publicación no existe, 403 si no es mía, 409 si ya tiene encuesta. Se crea junto con sus opciones en una transacción.
- Votar / retirar / ver exige poder ver la publicación (404 si no). Votar o retirar en una encuesta cerrada → 400.
- Si no es `multiple`, solo una opción (400 si mandan más). Opciones de otra encuesta → 400. Retirar sin haber votado → 404.
- Los contadores (`total_votos` de cada opción y de la encuesta) se ajustan en la misma transacción que los votos.

## Socket.IO
`encuesta_actualizada` a todos al crear, votar o retirar: `{ publicacion_id, encuesta }` con la `EncuestaVista` **sin** `mis_votos`.

## Errores
400 validación / encuesta cerrada / opción inválida · 401 sin sesión · 403 no es el autor · 404 no existe o no visible · 409 ya hay encuesta.
