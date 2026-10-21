# Boletos (`/api/boletos`)

Boletos con código QR para eventos: tipos de boleto por evento (gratis o de pago), obtener / comprar, mis boletos,
transferir, validar en la puerta (organizador o staff), estadísticas de acceso y CSV de asistentes.
La parte de cobro (proveedores, webhooks, modo de prueba) está en `pagos.md`.
Respuestas con el contrato estándar `{ success, mensaje, data, meta? }`, salvo `GET /eventos/:evento_id/csv` (archivo CSV).

## Reglas

- **Organizador** = quien puede editar el evento (creador o admin/moderador del grupo). **Puerta** = organizador o
  staff autorizado por él (`/eventos/:evento_id/staff`, máx. 30).
- **Precios** en la moneda del evento (`moneda`, MXN por defecto). Se envían en unidades con hasta 2 decimales
  (`precio: 150.5`) y se guardan en centavos (`precio_centavos: 15050`). `precio: 0` = gratis.
- **Cupo sin sobreventa**: `vendidos` = boletos emitidos + lugares apartados por órdenes pendientes de pago. La reserva es
  una sola sentencia condicional (`vendidos + n <= cupo`) dentro de la transacción de la compra: dos compras simultáneas
  nunca pasan del cupo. Una orden pendiente aparta su lugar 30 min; si vence o falla, el lugar se libera.
- **Máximo por persona** (`max_por_persona`, 10 por defecto): cuenta boletos vigentes + apartados del mismo tipo.
- **Ventana de venta** opcional (`venta_desde`, `venta_hasta`). No se vende en eventos cancelados o terminados.
- **Gratis**: los boletos se emiten al instante. **De pago**: se crea una orden `pendiente` y se devuelve `url_pago`;
  los boletos se emiten SOLO cuando el proveedor confirma el pago (ver `pagos.md`).
- **"Voy"**: al emitirse un boleto, el dueño queda con "voy" en el evento. Con `requiere_boleto = true`, `POST
  /api/eventos/:id/asistencia { estado: 'voy' }` exige tener boleto (400).
- **Código** (lo que va en el QR): `TF1.<evento_id>.<aleatorio de 144 bits>.<firma HMAC-SHA256 truncada>`, firmado con
  `BOLETOS_SECRETO`. No se puede adivinar ni fabricar; un código alterado se rechaza sin consultar la base. Solo el dueño
  recibe `codigo`; el organizador y el staff ven el boleto con `codigo: null`. El CSV no incluye códigos.
- **Estados del boleto**: `valido` → `usado` (con `usado_en` y `escaneado_por`) · `cancelado` (gratis de un evento
  cancelado) · `reembolsado` (se devolvió el dinero).
- **Validar**: marca `usado` con una sentencia condicional (`WHERE estado = 'valido'`): si llegan dos escaneos del mismo
  boleto a la vez, solo uno es válido y el otro responde "ya usado".
- **Transferir**: solo boletos `valido`, de eventos abiertos, a alguien activo, sin bloqueo, que pueda ver el evento y
  no pase del máximo por persona. El código CAMBIA (el QR anterior responde "falso"). Quien recibe queda con "voy";
  quien transfiere pasa a "me interesa" si se quedó sin boletos del evento.
- **Tipos**: editar no deja el cupo por debajo de `vendidos`; borrar un tipo con órdenes solo lo desactiva
  (`activo: false`; los boletos emitidos siguen valiendo). La moneda no cambia una vez que hay órdenes (409).

## Tipos

```ts
type EstadoBoleto = 'valido' | 'usado' | 'cancelado' | 'reembolsado';
type EstadoOrden = 'pendiente' | 'pagada' | 'fallida' | 'reembolsada';
type Proveedor = 'gratis' | 'demo' | 'stripe' | 'mercadopago';

interface TipoBoleto {
  id: number; evento_id: number; nombre: string; descripcion: string | null;
  precio: number;              // unidades (150.5)
  precio_centavos: number;     // 15050
  moneda: string; gratis: boolean;
  cupo: number | null;         // null = sin límite
  vendidos: number;            // emitidos + apartados
  quedan: number | null;       // null = sin límite
  venta_desde: string | null; venta_hasta: string | null;
  max_por_persona: number; activo: boolean; orden: number;
  disponible: boolean;         // se puede obtener ahora
  motivo: string | null;       // 'Agotado' | 'La venta aún no empieza' | 'La venta terminó' | 'El evento fue cancelado' | 'El evento ya terminó' | 'No disponible'
}

interface ResumenBoletosEvento {
  evento_id: number; requiere_boleto: boolean; moneda: string;
  tipos: TipoBoleto[];         // el organizador ve también los inactivos
  mis_boletos: number;         // válidos + usados
  puedo_organizar: boolean; puedo_escanear: boolean;
  proveedores: { id: 'stripe' | 'mercadopago' | 'demo'; nombre: string; modo_prueba: boolean }[];
  modo_prueba: boolean;
}

interface EventoDeBoleto { id; titulo; inicio; fin; lugar; enlace; modalidad; portada_url; cancelado; moneda; creador_id; grupo_id }

interface Boleto {
  id: number;
  codigo: string | null;       // solo al dueño
  evento_id: number; estado: EstadoBoleto;
  usado_en: string | null; fecha_creacion: string; transferido_de: number | null;
  es_mio: boolean;
  tipo: { id: number; nombre: string; precio_centavos: number; precio: number };
  evento: EventoDeBoleto | null;
  dueno: UsuarioPublico | null;
  escaneado_por: UsuarioPublico | null;
}

interface Orden {
  id: number; evento_id: number; tipo_boleto_id: number; cantidad: number;
  precio_unitario_centavos: number; total_centavos: number; total: number; moneda: string;
  proveedor: Proveedor; estado: EstadoOrden;
  url_pago: string | null;     // solo mientras está pendiente
  motivo_fallo: string | null; expira_en: string | null; pagada_en: string | null; reembolsada_en: string | null;
  fecha_creacion: string;
  evento: EventoDeBoleto | null; tipo: { id; nombre; precio_centavos } | null;
  boletos: Boleto[];           // emitidos que siguen siendo míos (vacío mientras no se paga)
  modo_prueba: boolean;        // demo o claves de prueba: mostrarlo MUY claro
}

interface ResultadoValidacion {
  valido: boolean;
  motivo: 'valido' | 'ya_usado' | 'otro_evento' | 'cancelado' | 'reembolsado' | 'evento_cancelado' | 'falso';
  mensaje: string;             // 'Acceso válido', 'Este boleto ya se usó', ...
  boleto: { id; estado; tipo: { id; nombre }; dueno: UsuarioPublico | null; usado_en: string | null; escaneado_por: UsuarioPublico | null } | null;
  estadisticas: { vendidos: number; escaneados: number };
}

interface EstadisticasBoletos {
  evento_id: number; moneda: string;
  vendidos: number; escaneados: number; apartados: number;
  ingresos_centavos: number | null;  // null para el staff
  ordenes_pagadas: number | null;    // null para el staff
  por_tipo: { tipo_id; nombre; precio_centavos; cupo; vendidos; apartados; escaneados; ingresos_centavos: number | null }[];
  puedo_organizar: boolean;
}
```

## Endpoints

| Método | Ruta | Sesión | Body / query | Respuesta |
|---|---|---|---|---|
| GET | `/eventos/:evento_id` | opcional | — | `data: ResumenBoletosEvento` (respeta la visibilidad del evento: 401/403/404) |
| PUT | `/eventos/:evento_id/configuracion` | organizador | `{ requiere_boleto?: boolean, moneda?: 'MXN' \| 'USD' \| 'ARS' \| 'BRL' \| 'CLP' \| 'COP' \| 'PEN' \| 'UYU' \| 'EUR' }` | `data: ResumenBoletosEvento` · 409 si cambia la moneda con órdenes |
| POST | `/eventos/:evento_id/tipos` | organizador | `{ nombre, descripcion?, precio=0, cupo?, venta_desde?, venta_hasta?, max_por_persona=10 }` | 201 `data: TipoBoleto` |
| PUT | `/tipos/:id` | organizador | lo mismo, todo opcional (+ `activo`, `orden`); null borra descripción/cupo/fechas | `data: TipoBoleto` · 400 si `cupo < vendidos` |
| DELETE | `/tipos/:id` | organizador | — | `mensaje`: 'Tipo de boleto eliminado' o '...se dejó de vender...' |
| POST | `/comprar` | sí | `{ tipo_boleto_id, cantidad=1 (1-20), proveedor?: 'stripe' \| 'mercadopago' \| 'demo' }` | 201 `data: { orden: Orden, url_pago: string \| null, boletos: Boleto[] }` |
| GET | `/ordenes/:id` | dueño | — | `data: Orden` (si venció, la marca fallida y libera el cupo) · 404 si no es tuya |
| GET | `/mios` | sí | `?cuando=proximos\|pasados\|todos&limit&offset` | paginado `data: Boleto[]` (próximos del más cercano; pasados del más reciente) |
| GET | `/:id` | dueño o puerta | — | `data: Boleto` (`codigo` solo al dueño) · 404 a cualquier otro |
| POST | `/:id/transferir` | dueño | `{ usuario_id }` | `data: Boleto` (ya no es tuyo: `codigo: null`) |
| POST | `/validar` | puerta | `{ codigo, evento_id }` | `data: ResultadoValidacion`, `mensaje` = `data.mensaje` (200 también si no es válido) · 403 si no es organizador ni staff |
| GET | `/eventos/:evento_id/estadisticas` | puerta | — | `data: EstadisticasBoletos` (el dinero solo al organizador) |
| GET | `/eventos/:evento_id/boletos` | puerta | `?estado&q&limit&offset` (`q` busca en nombre y usuario del dueño) | paginado `data: Boleto[]` |
| GET | `/eventos/:evento_id/csv` | organizador | — | `text/csv` con BOM: Boleto, Tipo, Precio, Estado, Nombre, Usuario, Emitido, Escaneado en, Escaneado por (fechas ISO UTC, sin códigos) |
| POST | `/eventos/:evento_id/reembolsar` | organizador | — | solo con el evento cancelado: reintenta reembolsos → `data: { reembolsadas, canceladas, liberadas, errores }` |
| GET | `/eventos/:evento_id/staff` | organizador | — | `data: UsuarioPublico[]` |
| POST | `/eventos/:evento_id/staff` | organizador | `{ usuario_id }` | 201 `data: UsuarioPublico[]` · 409 si ya está · 400 si es el organizador · 403 con bloqueo |
| DELETE | `/eventos/:evento_id/staff/:usuario_id` | organizador | — | `data: UsuarioPublico[]` · 404 si no estaba |

Errores de compra: 400 (tipo inactivo, fuera de la ventana de venta, evento cancelado/terminado, método de pago no
disponible, "los pagos en línea no están configurados"), 409 ("Solo quedan N boletos", "máximo por persona",
"Se agotaron mientras comprabas"), 502 si el proveedor no pudo crear el cobro (la orden queda `fallida` y el cupo libre).

## Notificaciones

| Tipo | Cuándo | A quién | `de_usuario_id` | Entidad |
|---|---|---|---|---|
| `boleto_comprado` | boletos emitidos (gratis o pago confirmado) | comprador ("te entregó tus 2 boletos para «X»") | organizador | `boleto` (primer boleto) |
| `boleto_comprado` | lo mismo | organizador ("compró / obtuvo 2 boletos para «X»") | comprador | `boleto` |
| `boleto_comprado` | transferencia | quien recibe ("te transfirió un boleto para «X»") | quien transfiere | `boleto` |
| `boleto_usado` | validación correcta | dueño ("registró tu entrada a «X»") | quien escaneó | `boleto` |

(No se avisa una acción sobre uno mismo.) La app abre `/boletos/:id` al tocar una notificación con entidad `boleto`.

## Socket.IO

`boletos_escaneo` a la sala personal del organizador y de cada staff tras cada validación correcta:
`{ evento_id, vendidos, escaneados }` (contador en vivo de la puerta).

## Tarea programada

`programarExpiracionOrdenes()` (de `modules/boletos/orden.service.ts`): cada 5 min marca `fallida` las órdenes
pendientes vencidas y libera su cupo. Llamarla una vez al arrancar el servidor. Además, consultar una orden vencida
la libera en ese momento.

## Variables de entorno

`BOLETOS_SECRETO` (≥ 16 caracteres) firma los códigos. Sin ella se usa un secreto de desarrollo y se avisa en la
consola (en producción con un aviso fuerte). Cambiarla invalida los códigos ya emitidos.
