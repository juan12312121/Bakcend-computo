# Pagos (`/api/pagos`)

Cobro de boletos con **Stripe** (Checkout Session) o **Mercado Pago** (Checkout Pro / Preference), detrás de la
interfaz `ProveedorPago` (`modules/pagos/proveedor-pago.ts`):

```ts
interface ProveedorPago {
  nombre: 'stripe' | 'mercadopago' | 'demo'; etiqueta: string; modoPrueba: boolean;
  crearCobro(datos): Promise<{ referencia: string; url: string }>;     // URL de pago
  verificarWebhook(peticion): Promise<AvisoPago | null>;                // firma / consulta a la API
  reembolsar(orden): Promise<void>;
}
```

- `StripeProveedor`: librería `stripe`. Crea la sesión con `client_reference_id` y `metadata.orden_id`, vence en 30 min
  (mínimo de Stripe) y usa `idempotencyKey`. Webhook firmado con `STRIPE_WEBHOOK_SECRET`:
  `checkout.session.completed` (con `payment_status = 'paid'`) y `checkout.session.async_payment_succeeded` → pagada;
  `checkout.session.expired` y `checkout.session.async_payment_failed` → fallida; lo demás se ignora.
  Reembolso: `refunds.create({ payment_intent })`.
- `MercadoPagoProveedor`: librería `mercadopago`. Crea la Preference (`external_reference` = orden, `back_urls` a la app,
  `notification_url` si la API es https pública, vence en 30 min). Notificación: acepta el webhook nuevo
  (`{ type: 'payment', data: { id } }`) y el IPN viejo (`?topic=payment&id=`); si hay `MERCADOPAGO_WEBHOOK_SECRET`
  valida `x-signature`; SIEMPRE consulta el pago en la API (`Payment.get`) y usa su `status`/`external_reference`
  (approved → pagada; rejected/cancelled → fallida; pending/in_process → se espera otro aviso).
  Reembolso: `PaymentRefund.create({ payment_id })`.
- `ProveedorDemo` (**MODO DE PRUEBA**): solo cuando no hay claves y NUNCA en producción (su constructor lo impide). No
  cobra: la URL de pago es la página de resultado de la app con `?demo=1`, donde un botón "Simular pago" llama a
  `POST /demo/ordenes/:id`. Las órdenes demo traen `modo_prueba: true`.

## Reglas de la orden

- `pendiente` → `pagada` con UNA sentencia condicional dentro de la transacción que emite los boletos: un webhook
  repetido (o dos a la vez) emite los boletos una sola vez y responde `duplicada`.
- El monto que informa el proveedor (`amount_total` / `transaction_amount`) debe coincidir con la orden; si no, se
  reembolsa y no se emiten boletos.
- Pago que llega tarde (la orden ya venció → `fallida`): si todavía hay cupo se aceptan los boletos; si no, se reembolsa.
- Si el evento ya se canceló cuando llega el pago, se reembolsa.
- `fallida` libera el cupo apartado. Al **cancelar el evento**: pagadas → reembolso con el proveedor (`reembolsada`,
  boletos `reembolsado`); gratis → boletos `cancelado`; pendientes → `fallida`. Un reembolso que falla deja la orden
  `pagada` y se reintenta con `POST /api/boletos/eventos/:evento_id/reembolsar`.

## Endpoints

| Método | Ruta | Sesión | Body | Respuesta |
|---|---|---|---|---|
| GET | `/proveedores` | no | — | `data: { proveedores: { id, nombre, modo_prueba }[], modo_prueba: boolean }` |
| POST | `/webhook/stripe` | no (firma `Stripe-Signature`) | evento de Stripe (cuerpo crudo) | `data: { resultado: 'confirmada' \| 'fallida' \| 'reembolsada' \| 'duplicada' \| 'ignorada', orden_id }` · 400 firma inválida · 404 si Stripe no está configurado |
| POST | `/webhook/mercadopago` | no (consulta a la API; `x-signature` opcional) | `{ type, data: { id } }` o `?topic=payment&id=` | igual · 400 firma inválida · 502 si no se pudo consultar el pago (Mercado Pago reintenta) |
| POST | `/demo/ordenes/:id` | dueño | `{ aprobar: boolean }` | `data: Orden` (ver `boletos.md`) · 403 en producción o si la orden no es demo · 404 si no es tuya |

## Conexión (lo hace el coordinador)

- `apiRoutes.use('/pagos', pagoRoutes)` (`modules/pagos/pago.routes.ts`).
- **Obligatorio para Stripe**: en `app.ts`, ANTES de `express.json(...)`:
  `app.use('/api/pagos/webhook', cuerpoCrudoWebhook);` (exportado por `pago.routes.ts`). La firma de Stripe se calcula
  sobre los bytes exactos; si `express.json` lee el cuerpo primero, la verificación falla (400).
  Alternativa equivalente: `express.json({ verify: (req, _res, buf) => { (req as { rawBody?: Buffer }).rawBody = buf; } })`.

## Variables de entorno

| Variable | Para qué |
|---|---|
| `STRIPE_SECRET_KEY` | Clave secreta (`sk_test_...` en pruebas). Activa Stripe. |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` del endpoint de webhook. Sin ella se rechazan los webhooks de Stripe. |
| `MERCADOPAGO_ACCESS_TOKEN` | Access token (`TEST-...` en pruebas). Activa Mercado Pago. |
| `MERCADOPAGO_WEBHOOK_SECRET` | (opcional) "Clave secreta" de Webhooks: valida `x-signature`. |
| `PAGOS_PROVEEDOR` | (opcional) `stripe` o `mercadopago`: cuál usar si el comprador no elige. |
| `PAGOS_URL_WEBHOOK` | (opcional) base pública https de la API para `notification_url` de Mercado Pago (por defecto `API_URL`). |
| `BOLETOS_SECRETO` | firma de los códigos QR (ver `boletos.md`). |

### Claves de prueba

- **Stripe**: crear cuenta en dashboard.stripe.com → modo "Test" → Developers → API keys → copiar la *Secret key*
  (`sk_test_...`). Webhook local: instalar Stripe CLI y correr
  `stripe listen --forward-to localhost:3000/api/pagos/webhook/stripe` (imprime el `whsec_...`). En producción:
  Developers → Webhooks → Add endpoint `https://<api>/api/pagos/webhook/stripe` con los eventos
  `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
  `checkout.session.expired`. Tarjeta de prueba `4242 4242 4242 4242`, cualquier fecha futura y CVC.
- **Mercado Pago**: mercadopago.com.mx/developers → Tus integraciones → Crear aplicación (Checkout Pro) →
  Credenciales de prueba → *Access Token* (`TEST-...`). Crear usuarios de prueba (vendedor y comprador) en la misma
  sección y pagar con el comprador de prueba y las tarjetas de prueba de la documentación. Webhooks: en la aplicación →
  Webhooks → URL `https://<api>/api/pagos/webhook/mercadopago`, evento "Pagos"; ahí está la *clave secreta*
  (`MERCADOPAGO_WEBHOOK_SECRET`). En local hace falta un túnel https (p. ej. ngrok) para recibir notificaciones.
- Sin ninguna clave (desarrollo): se usa el `ProveedorDemo` con el botón de simulación.
