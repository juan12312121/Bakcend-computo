# Estadísticas para creadores (`/api/estadisticas`)

Todo requiere sesión. Cada quien ve **solo sus propias** estadísticas. Respuestas con el contrato estándar.

## Cómo se registran

| Qué | Dónde | Regla |
|---|---|---|
| Impresiones | `POST /impresiones` (lotes del frontend) | solo publicaciones publicadas que el usuario puede ver y que no son suyas; la misma persona y publicación cuenta una vez cada **30 min**; la primera del día de cada persona suma al `alcance` del día |
| Visitas al perfil | `POST /visitas-perfil/:usuarioId` | no la propia, no con bloqueo, una vez cada 30 min |
| Clics en enlaces | `POST /clics/:publicacionId` | publicación visible y ajena, una vez cada 30 min |
| Reproducciones de video / reel | `POST /api/publicaciones/:id/vista` (ya existía) | cada llamada suma (igual que `total_vistas`) |
| Reproducciones de historias | `POST /api/historias/:id/vista` (ya existía) | la primera vista de cada persona |
| Seguidores ganados / perdidos | hooks del modelo `Seguidor` | seguir (aceptado), aceptar una solicitud, dejar de seguir; se anota al confirmarse la transacción |
| Interacciones | se leen de `likes`, `comentarios`, `compartidos`, `publicaciones_guardadas` | solo de otras personas, por su fecha |

Tablas: `estadisticas_eventos` (crudos, para no duplicar y contar personas únicas; se borran a los 200 días con
`programarLimpiezaEstadisticas()`, una vez al día), `estadisticas_publicaciones_diarias` (por publicación y día:
impresiones, alcance, reproducciones, clics_enlace) y `estadisticas_perfiles_diarias` (por perfil y día: visitas_perfil,
seguidores_ganados, seguidores_perdidos, reproducciones_historias). Los días son de la hora local del servidor.

## Endpoints

| Método | Path | Entrada | `data` |
|---|---|---|---|
| POST | `/impresiones` | `{ publicacion_ids: number[] }` (1-100, sin repetir) | `{ registradas }` |
| POST | `/visitas-perfil/:usuarioId` | — | `{ registradas }` (0 o 1); 404 si la cuenta no existe |
| POST | `/clics/:publicacionId` | — | `{ registradas }` (0 o 1); 404 si no existe o no se puede ver |
| GET | `/resumen` | `?dias=7\|28\|90` (28 por defecto), `?zona=` minutos como `getTimezoneOffset()` (México: 360) | `ResumenCreador` |
| GET | `/publicaciones/:publicacionId` | `?zona=` | `DetallePublicacion`; 403 si no es mía, 404 si no existe |

`zona` solo afecta las mejores horas y días (el resto va por día del servidor).

```ts
interface ResumenCreador {
  rango: { dias: 7 | 28 | 90; desde: 'YYYY-MM-DD'; hasta: 'YYYY-MM-DD' };   // hasta = hoy
  totales: {
    alcance: number;              // personas únicas que vieron algo tuyo en el rango
    impresiones: number;
    interacciones: number;        // reacciones + comentarios + compartidos + guardados (de otras personas)
    reacciones: number; comentarios: number; compartidos: number; guardados: number;
    reproducciones: number;       // videos / reels
    reproducciones_historias: number;
    clics_enlace: number;
    visitas_perfil: number;
    seguidores_ganados: number; seguidores_perdidos: number; seguidores_netos: number;
    seguidores_actuales: number;  // total_seguidores hoy
  };
  anterior: { alcance; impresiones; interacciones; visitas_perfil; seguidores_netos };  // periodo anterior del mismo largo
  por_dia: { fecha; impresiones; alcance /* suma de únicos de cada día */; interacciones; reproducciones;
             visitas_perfil; seguidores_ganados; seguidores_perdidos }[];   // un elemento por día, del más viejo a hoy
  mejores_publicaciones: {        // hasta 5: más interacciones, luego más impresiones (solo las que tuvieron algo)
    publicacion: { id; contenido /* máx. 160 */; imagen_url; video_url; miniatura_url; fecha_creacion };
    impresiones; alcance; reproducciones; interacciones;
    tasa_interaccion: number;     // interacciones / alcance en %, 1 decimal
  }[];
  mejores_horas: { hora: 0..23; actividad: number }[];   // 24 elementos (impresiones + interacciones)
  mejores_dias: { dia: 0..6 /* 0 = domingo */; actividad: number }[];  // 7 elementos
  audiencia: {
    total_seguidores: number;
    ubicaciones: { nombre; total; porcentaje }[];   // top 6 de usuarios.ubicacion (sin distinguir mayúsculas)
    carreras: { nombre; total; porcentaje }[];      // top 6 de usuarios.carrera
    grupos: { grupo_id; nombre; total; porcentaje }[]; // top 5 grupos donde tus seguidores son miembros activos
  };
}

interface DetallePublicacion {
  publicacion: { id; contenido; imagen_url; video_url; miniatura_url; fecha_creacion;
                 total_likes; total_comentarios; total_compartidos; total_vistas };
  totales: { impresiones; alcance; reproducciones; clics_enlace; interacciones; reacciones; comentarios;
             compartidos; guardados; tasa_interaccion };      // desde que se publicó
  reacciones_por_tipo: { tipo; total }[];                    // de más a menos
  por_dia: { fecha; impresiones; alcance; reproducciones; interacciones }[];  // desde que se publicó (máx. 90 días)
  mejores_horas: { hora; actividad }[];                      // por interacciones
  audiencia: { seguidores: number; no_seguidores: number };  // de quienes la vieron, cuántos te siguen hoy
}
```

## Errores

400 validación (lote vacío o > 100, `dias` fuera de 7/28/90, `zona` fuera de ±840). 401 sin sesión.
403 detalle de una publicación ajena. 404 publicación o perfil inexistente.

Sin eventos de Socket.IO ni notificaciones.

## Tareas programadas

- `programarLimpiezaEstadisticas()` (una vez al día, `unref()`): borra eventos crudos de más de 200 días.
