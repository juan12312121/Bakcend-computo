import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Boleto, Notificacion, OrdenBoleto, TipoBoleto } from '../src/infrastructure/database/models';
import { boletoRoutes } from '../src/modules/boletos/boleto.routes';
import { expirarOrdenesVencidas, programarExpiracionOrdenes } from '../src/modules/boletos/orden.service';
import { eventoRoutes } from '../src/modules/eventos/evento.routes';
import { ProveedorDemo } from '../src/modules/pagos/demo.proveedor';
import { MercadoPagoProveedor } from '../src/modules/pagos/mercadopago.proveedor';
import { PagoService, pagoService } from '../src/modules/pagos/pago.service';
import { pagoRoutes } from '../src/modules/pagos/pago.routes';
import { crearPasarela, pasarelaPagos } from '../src/modules/pagos/pasarela';
import { StripeProveedor } from '../src/modules/pagos/stripe.proveedor';
import { ordenBoletoRepository } from '../src/modules/boletos/boleto.repository';
import { ordenService } from '../src/modules/boletos/orden.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

// ---------- Librerías de pago simuladas: nunca se llama a Stripe ni a Mercado Pago ----------

const stripeMock = vi.hoisted(() => ({
  crearSesion: vi.fn(),
  reembolsar: vi.fn(),
  construirEvento: vi.fn(),
  claves: [] as string[],
}));

vi.mock('stripe', () => ({
  default: class StripeFalso {
    checkout = { sessions: { create: stripeMock.crearSesion } };
    refunds = { create: stripeMock.reembolsar };
    webhooks = { constructEvent: stripeMock.construirEvento };
    constructor(clave: string) {
      stripeMock.claves.push(clave);
    }
  },
}));

const mpMock = vi.hoisted(() => ({
  crearPreferencia: vi.fn(),
  obtenerPago: vi.fn(),
  reembolsar: vi.fn(),
  validarFirma: vi.fn(),
}));

vi.mock('mercadopago', () => ({
  MercadoPagoConfig: class {
    constructor(public readonly config: unknown) {}
  },
  Preference: class {
    create = mpMock.crearPreferencia;
  },
  Payment: class {
    get = mpMock.obtenerPago;
  },
  PaymentRefund: class {
    create = mpMock.reembolsar;
  },
  WebhookSignatureValidator: { validate: mpMock.validarFirma },
}));

beforeAll(() => usarModulos({ '/eventos': eventoRoutes, '/boletos': boletoRoutes, '/pagos': pagoRoutes }));
beforeEach(async () => {
  await reiniciarBD();
  vi.clearAllMocks();
  pasarelaPagos.reemplazar([new ProveedorDemo()]);
});
afterEach(() => {
  vi.restoreAllMocks();
  pasarelaPagos.reemplazar([new ProveedorDemo()]);
});

const HORA = 60 * 60 * 1000;
const enHoras = (h: number) => new Date(Date.now() + h * HORA).toISOString();

async function preparar(precio = 250, cupo: number | null = 5) {
  const ana = await crearUsuario('ana');
  const beto = await crearUsuario('beto');
  const ev = await api().post('/api/eventos').set(bearer(ana)).send({ titulo: 'Festival', lugar: 'Parque', inicio: enHoras(48) });
  const evento = ev.body.data as { id: number };
  const tipo = await api().post(`/api/boletos/eventos/${evento.id}/tipos`).set(bearer(ana)).send({ nombre: 'General', precio, cupo });
  return { ana, beto, evento, tipoId: tipo.body.data.id as number };
}

const comprar = (u: UsuarioPrueba, tipoId: number, cantidad = 2, proveedor?: string) =>
  api().post('/api/boletos/comprar').set(bearer(u)).send({ tipo_boleto_id: tipoId, cantidad, ...(proveedor ? { proveedor } : {}) });
const vendidos = async (tipoId: number) => (await TipoBoleto.findByPk(tipoId))!.vendidos;
const boletosDe = (ordenId: number) => Boleto.count({ where: { orden_id: ordenId } });

/** Evento de Stripe ya "verificado" (constructEvent simulado lo devuelve tal cual). */
function eventoStripe(tipo: string, ordenId: number, extra: Record<string, unknown> = {}) {
  return {
    id: `evt_${tipo}_${ordenId}`,
    type: tipo,
    data: {
      object: {
        id: `cs_test_${ordenId}`,
        client_reference_id: String(ordenId),
        metadata: { orden_id: String(ordenId) },
        payment_status: 'paid',
        payment_intent: `pi_test_${ordenId}`,
        amount_total: 50000,
        ...extra,
      },
    },
  };
}

const webhookStripe = (cuerpo: object, firma = 't=1,v1=abc') =>
  api().post('/api/pagos/webhook/stripe').set('Stripe-Signature', firma).send(cuerpo);

function usarStripe() {
  stripeMock.crearSesion.mockImplementation(async (params: { client_reference_id: string }) => ({
    id: `cs_test_${params.client_reference_id}`,
    url: `https://checkout.stripe.com/c/pay/cs_test_${params.client_reference_id}`,
  }));
  stripeMock.construirEvento.mockImplementation((crudo: Buffer) => JSON.parse(crudo.toString('utf8')));
  stripeMock.reembolsar.mockResolvedValue({ id: 're_test_1', status: 'succeeded' });
  pasarelaPagos.reemplazar([new StripeProveedor({ secretKey: 'sk_test_falsa', webhookSecret: 'whsec_falso' })]);
}

describe('pagos: proveedor demo (modo de prueba)', () => {
  it('sin claves solo existe el demo; la orden queda pendiente y aparta el cupo sin emitir boletos', async () => {
    const { beto, tipoId } = await preparar();
    const info = await api().get('/api/pagos/proveedores');
    expect(info.body.data).toEqual({ proveedores: [{ id: 'demo', nombre: 'Pago simulado (modo de prueba)', modo_prueba: true }], modo_prueba: true });

    const res = await comprar(beto, tipoId, 2);
    expect(res.status).toBe(201);
    expect(res.body.mensaje).toMatch(/continúa con el pago/);
    const orden = res.body.data.orden;
    expect(orden).toMatchObject({ estado: 'pendiente', proveedor: 'demo', cantidad: 2, total_centavos: 50000, total: 500, modo_prueba: true, boletos: [] });
    expect(res.body.data.url_pago).toBe(`http://localhost:4200/boletos/compra/${orden.id}?demo=1`);
    expect(res.body.data.boletos).toEqual([]);
    expect(await vendidos(tipoId)).toBe(2);
    expect(await boletosDe(orden.id)).toBe(0);
  });

  it('simular aprobado emite los boletos una sola vez; rechazado libera el cupo', async () => {
    const { ana, beto, tipoId } = await preparar();
    const { id } = (await comprar(beto, tipoId, 2)).body.data.orden;

    const ajeno = await api().post(`/api/pagos/demo/ordenes/${id}`).set(bearer(ana)).send({ aprobar: true });
    expect(ajeno.status).toBe(404);

    const pagar = await api().post(`/api/pagos/demo/ordenes/${id}`).set(bearer(beto)).send({ aprobar: true });
    expect(pagar.status).toBe(200);
    expect(pagar.body.data).toMatchObject({ estado: 'pagada', url_pago: null });
    expect(pagar.body.data.boletos).toHaveLength(2);
    expect(await notificaciones(beto, 'boleto_comprado')).toHaveLength(1);
    expect((await notificaciones(ana, 'boleto_comprado'))[0].mensaje).toMatch(/compró 2 boletos/);

    await api().post(`/api/pagos/demo/ordenes/${id}`).set(bearer(beto)).send({ aprobar: true });
    expect(await boletosDe(id)).toBe(2);
    expect(await vendidos(tipoId)).toBe(2);

    const otra = (await comprar(beto, tipoId, 1)).body.data.orden;
    expect(await vendidos(tipoId)).toBe(3);
    const rechazar = await api().post(`/api/pagos/demo/ordenes/${otra.id}`).set(bearer(beto)).send({ aprobar: false });
    expect(rechazar.body.data).toMatchObject({ estado: 'fallida', motivo_fallo: 'Pago rechazado (simulación)', boletos: [] });
    expect(await vendidos(tipoId)).toBe(2);

    // La consulta de la orden
    const consulta = await api().get(`/api/boletos/ordenes/${id}`).set(bearer(beto));
    expect(consulta.body.data).toMatchObject({ estado: 'pagada', evento: { titulo: 'Festival' }, tipo: { nombre: 'General' } });
    expect((await api().get(`/api/boletos/ordenes/${id}`).set(bearer(ana))).status).toBe(404);
  });

  it('la simulación no existe en producción ni con proveedores reales', async () => {
    const { beto, tipoId } = await preparar();
    const { id } = (await comprar(beto, tipoId, 1)).body.data.orden;

    const enProduccion = new PagoService(ordenBoletoRepository, pasarelaPagos, ordenService, 'production');
    await expect(enProduccion.simularDemo(id, beto.id, true)).rejects.toThrow(/modo de prueba/);
    expect(() => new ProveedorDemo('production')).toThrow(/producción/);

    usarStripe();
    expect((await api().post(`/api/pagos/demo/ordenes/${id}`).set(bearer(beto)).send({ aprobar: true })).status).toBe(403);
    expect(await boletosDe(id)).toBe(0);
  });

  it('las órdenes vencidas liberan su cupo (al consultarlas o con la tarea programada)', async () => {
    const { beto, tipoId } = await preparar();
    const primera = (await comprar(beto, tipoId, 2)).body.data.orden;
    const segunda = (await comprar(beto, tipoId, 1)).body.data.orden;
    expect(await vendidos(tipoId)).toBe(3);

    await OrdenBoleto.update({ expira_en: new Date(Date.now() - 1000) }, { where: { id: primera.id } });
    const consulta = await api().get(`/api/boletos/ordenes/${primera.id}`).set(bearer(beto));
    expect(consulta.body.data).toMatchObject({ estado: 'fallida', motivo_fallo: 'El tiempo para pagar se agotó' });
    expect(await vendidos(tipoId)).toBe(1);

    expect(await expirarOrdenesVencidas(new Date(Date.now() + 2 * HORA))).toBe(1);
    expect((await OrdenBoleto.findByPk(segunda.id))?.estado).toBe('fallida');
    expect(await vendidos(tipoId)).toBe(0);

    const temporizador = programarExpiracionOrdenes(60_000);
    expect(temporizador.hasRef()).toBe(false);
    clearInterval(temporizador);
  });
});

describe('pagos: Stripe (librería simulada)', () => {
  it('crea la Checkout Session con los datos de la orden', async () => {
    const { beto, tipoId } = await preparar();
    usarStripe();
    const res = await comprar(beto, tipoId, 2, 'stripe');
    expect(res.status).toBe(201);
    const ordenId = res.body.data.orden.id;
    expect(res.body.data.url_pago).toBe(`https://checkout.stripe.com/c/pay/cs_test_${ordenId}`);
    expect(res.body.data.orden).toMatchObject({ proveedor: 'stripe', modo_prueba: true });
    expect(stripeMock.claves).toContain('sk_test_falsa');

    const [params, opciones] = stripeMock.crearSesion.mock.calls[0];
    expect(params).toMatchObject({
      mode: 'payment',
      client_reference_id: String(ordenId),
      metadata: { orden_id: String(ordenId) },
      customer_email: 'beto@test.com',
      success_url: `http://localhost:4200/boletos/compra/${ordenId}`,
      line_items: [{ quantity: 2, price_data: { currency: 'mxn', unit_amount: 25000, product_data: { name: 'General · Festival' } } }],
    });
    expect(params.expires_at).toBeGreaterThan(Date.now() / 1000 + 29 * 60);
    expect(opciones).toEqual({ idempotencyKey: `trinoflow-orden-${ordenId}` });
    expect((await OrdenBoleto.findByPk(ordenId))?.referencia_externa).toBe(`cs_test_${ordenId}`);
  });

  it('webhook idempotente: el mismo aviso dos veces emite los boletos una sola vez', async () => {
    const { beto, tipoId } = await preparar();
    usarStripe();
    const ordenId = (await comprar(beto, tipoId, 2, 'stripe')).body.data.orden.id;

    const aviso = eventoStripe('checkout.session.completed', ordenId);
    const primero = await webhookStripe(aviso);
    expect(primero.status).toBe(200);
    expect(primero.body.data).toEqual({ resultado: 'confirmada', orden_id: ordenId });
    expect(stripeMock.construirEvento).toHaveBeenCalledWith(expect.any(Buffer), 't=1,v1=abc', 'whsec_falso');

    const repetido = await webhookStripe(aviso);
    expect(repetido.body.data.resultado).toBe('duplicada');
    expect(await boletosDe(ordenId)).toBe(2);
    expect(await vendidos(tipoId)).toBe(2);
    expect(await OrdenBoleto.findByPk(ordenId)).toMatchObject({ estado: 'pagada', pago_externo_id: `pi_test_${ordenId}` });
    expect(await notificaciones(beto, 'boleto_comprado')).toHaveLength(1);

    // Eventos que no nos importan
    expect((await webhookStripe({ id: 'evt_x', type: 'customer.created', data: { object: {} } })).body.data.resultado).toBe('ignorada');
    // Pago asíncrono todavía sin pagar (OXXO): se espera el siguiente aviso
    expect((await webhookStripe(eventoStripe('checkout.session.completed', ordenId, { payment_status: 'unpaid' }))).body.data.resultado).toBe('ignorada');
  });

  it('firma inválida → 400 y no toca la orden; sesión vencida → fallida', async () => {
    const { beto, tipoId } = await preparar();
    usarStripe();
    const ordenId = (await comprar(beto, tipoId, 2, 'stripe')).body.data.orden.id;

    stripeMock.construirEvento.mockImplementationOnce(() => {
      throw new Error('No signatures found matching the expected signature');
    });
    const mala = await webhookStripe(eventoStripe('checkout.session.completed', ordenId));
    expect(mala.status).toBe(400);
    expect(mala.body.mensaje).toBe('Firma de Stripe inválida');
    expect((await api().post('/api/pagos/webhook/stripe').send({})).status).toBe(400);
    expect((await OrdenBoleto.findByPk(ordenId))?.estado).toBe('pendiente');

    const vencida = await webhookStripe(eventoStripe('checkout.session.expired', ordenId, { payment_status: 'unpaid' }));
    expect(vencida.body.data.resultado).toBe('fallida');
    expect(await vendidos(tipoId)).toBe(0);
  });

  it('si el monto cobrado no coincide, reembolsa y no emite boletos', async () => {
    const { beto, tipoId } = await preparar();
    usarStripe();
    const ordenId = (await comprar(beto, tipoId, 2, 'stripe')).body.data.orden.id;

    const res = await webhookStripe(eventoStripe('checkout.session.completed', ordenId, { amount_total: 100 }));
    expect(res.body.data.resultado).toBe('reembolsada');
    expect(stripeMock.reembolsar).toHaveBeenCalledWith({ payment_intent: `pi_test_${ordenId}` }, { idempotencyKey: `trinoflow-reembolso-${ordenId}` });
    expect(await boletosDe(ordenId)).toBe(0);
    expect(await vendidos(tipoId)).toBe(0);
    expect((await OrdenBoleto.findByPk(ordenId))?.estado).toBe('reembolsada');
  });

  it('pago tardío: se acepta si aún hay cupo y se reembolsa si ya no', async () => {
    const { ana, beto, tipoId } = await preparar(250, 2);
    usarStripe();
    const tarde = (await comprar(beto, tipoId, 2, 'stripe')).body.data.orden.id;
    await ordenService.marcarFallida(tarde, 'El tiempo para pagar se agotó');
    expect((await webhookStripe(eventoStripe('checkout.session.completed', tarde))).body.data.resultado).toBe('confirmada');
    expect(await vendidos(tipoId)).toBe(2);

    // Otra orden vencida cuando el cupo ya se llenó
    await TipoBoleto.update({ cupo: 4 }, { where: { id: tipoId } });
    const sinCupo = (await comprar(ana, tipoId, 2, 'stripe')).body.data.orden.id;
    await ordenService.marcarFallida(sinCupo, 'El tiempo para pagar se agotó');
    await TipoBoleto.update({ cupo: 2 }, { where: { id: tipoId } });
    expect((await webhookStripe(eventoStripe('checkout.session.completed', sinCupo))).body.data.resultado).toBe('reembolsada');
    expect(stripeMock.reembolsar).toHaveBeenCalledTimes(1);
    expect(await boletosDe(sinCupo)).toBe(0);
  });

  it('si Stripe falla al crear el cobro: 502 y el cupo queda libre', async () => {
    const { beto, tipoId } = await preparar();
    usarStripe();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stripeMock.crearSesion.mockRejectedValueOnce(new Error('api_key_expired'));
    const res = await comprar(beto, tipoId, 2, 'stripe');
    expect(res.status).toBe(502);
    expect(await vendidos(tipoId)).toBe(0);
    expect(await OrdenBoleto.findOne({ order: [['id', 'DESC']] })).toMatchObject({ estado: 'fallida' });

    expect((await comprar(beto, tipoId, 1, 'mercadopago')).status).toBe(400);
  });
});

describe('pagos: Mercado Pago (librería simulada)', () => {
  function usarMercadoPago(webhookSecret?: string) {
    mpMock.crearPreferencia.mockImplementation(async ({ body }: { body: { external_reference: string } }) => ({
      id: `pref-${body.external_reference}`,
      init_point: `https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=pref-${body.external_reference}`,
    }));
    mpMock.reembolsar.mockResolvedValue({ id: 1 });
    pasarelaPagos.reemplazar([new MercadoPagoProveedor({ accessToken: 'TEST-123', webhookSecret, urlNotificacion: 'https://api.ejemplo.com/api/pagos/webhook/mercadopago' })]);
  }

  it('crea la preferencia y confirma con el pago consultado en la API', async () => {
    const { beto, tipoId } = await preparar(99.9);
    usarMercadoPago();
    const res = await comprar(beto, tipoId, 3);
    const ordenId = res.body.data.orden.id;
    expect(res.body.data.url_pago).toMatch(/mercadopago\.com\.mx/);
    const { body, requestOptions } = mpMock.crearPreferencia.mock.calls[0][0];
    expect(body).toMatchObject({
      external_reference: String(ordenId),
      items: [{ quantity: 3, unit_price: 99.9, currency_id: 'MXN', title: 'General · Festival' }],
      notification_url: 'https://api.ejemplo.com/api/pagos/webhook/mercadopago',
      auto_return: 'approved',
      expires: true,
    });
    expect(requestOptions).toEqual({ idempotencyKey: `trinoflow-orden-${ordenId}` });

    mpMock.obtenerPago.mockResolvedValue({ id: 555, status: 'approved', external_reference: String(ordenId), transaction_amount: 299.7 });
    const aviso = await api().post('/api/pagos/webhook/mercadopago').send({ type: 'payment', action: 'payment.created', data: { id: '555' } });
    expect(aviso.status).toBe(200);
    expect(aviso.body.data).toEqual({ resultado: 'confirmada', orden_id: ordenId });
    expect(mpMock.obtenerPago).toHaveBeenCalledWith({ id: '555' });
    expect(await boletosDe(ordenId)).toBe(3);

    // IPN viejo por query: mismo pago → duplicada
    const ipn = await api().post('/api/pagos/webhook/mercadopago?topic=payment&id=555').send({});
    expect(ipn.body.data.resultado).toBe('duplicada');
    // Otros temas se ignoran sin consultar
    expect((await api().post('/api/pagos/webhook/mercadopago').send({ type: 'merchant_order', data: { id: '1' } })).body.data.resultado).toBe('ignorada');
  });

  it('pago rechazado → fallida; con secreto valida la firma', async () => {
    const { beto, tipoId } = await preparar();
    usarMercadoPago('secreto-webhook');
    const ordenId = (await comprar(beto, tipoId, 1)).body.data.orden.id;

    mpMock.obtenerPago.mockResolvedValue({ id: 7, status: 'rejected', external_reference: String(ordenId) });
    const res = await api().post('/api/pagos/webhook/mercadopago').set('x-signature', 'ts=1,v1=abc').set('x-request-id', 'req-1').send({ type: 'payment', data: { id: '7' } });
    expect(res.body.data.resultado).toBe('fallida');
    expect(mpMock.validarFirma).toHaveBeenCalledWith({ xSignature: 'ts=1,v1=abc', xRequestId: 'req-1', dataId: '7', secret: 'secreto-webhook' });
    expect(await vendidos(tipoId)).toBe(0);

    mpMock.validarFirma.mockImplementationOnce(() => {
      throw new Error('SignatureMismatch');
    });
    const mala = await api().post('/api/pagos/webhook/mercadopago').send({ type: 'payment', data: { id: '7' } });
    expect(mala.status).toBe(400);
  });
});

describe('pagos: reembolso al cancelar el evento', () => {
  it('reembolsa lo pagado, cancela los gratis, libera lo pendiente y bloquea borrar con pagos', async () => {
    const { ana, beto, evento, tipoId } = await preparar(250, 10);
    const caro = await crearUsuario('caro');
    const gratis = await api().post(`/api/boletos/eventos/${evento.id}/tipos`).set(bearer(ana)).send({ nombre: 'Cortesía' });
    usarStripe();

    const pagada = (await comprar(beto, tipoId, 2, 'stripe')).body.data.orden.id;
    await webhookStripe(eventoStripe('checkout.session.completed', pagada));
    const pendiente = (await comprar(caro, tipoId, 1, 'stripe')).body.data.orden.id;
    const cortesia = (await api().post('/api/boletos/comprar').set(bearer(caro)).send({ tipo_boleto_id: gratis.body.data.id })).body.data.orden.id;

    const borrar = await api().delete(`/api/eventos/${evento.id}`).set(bearer(ana));
    expect(borrar.status).toBe(409);
    expect(borrar.body.mensaje).toMatch(/cancélalo primero/);

    const cancelar = await api().post(`/api/eventos/${evento.id}/cancelar`).set(bearer(ana));
    expect(cancelar.status).toBe(200);
    expect(stripeMock.reembolsar).toHaveBeenCalledWith({ payment_intent: `pi_test_${pagada}` }, { idempotencyKey: `trinoflow-reembolso-${pagada}` });
    expect(await OrdenBoleto.findByPk(pagada)).toMatchObject({ estado: 'reembolsada', motivo_fallo: 'El evento fue cancelado' });
    expect(await Boleto.count({ where: { orden_id: pagada, estado: 'reembolsado' } })).toBe(2);
    expect((await OrdenBoleto.findByPk(pendiente))?.estado).toBe('fallida');
    expect(await Boleto.count({ where: { orden_id: cortesia, estado: 'cancelado' } })).toBe(1);
    expect(await vendidos(tipoId)).toBe(0);

    // Reintento manual: ya no hay nada que reembolsar
    const reintento = await api().post(`/api/boletos/eventos/${evento.id}/reembolsar`).set(bearer(ana));
    expect(reintento.body.data).toEqual({ reembolsadas: 0, canceladas: 0, liberadas: 0, errores: 0 });
    expect((await api().delete(`/api/eventos/${evento.id}`).set(bearer(ana))).status).toBe(200);
  });

  it('un reembolso que falla no impide cancelar y se puede reintentar', async () => {
    const { ana, beto, evento, tipoId } = await preparar();
    usarStripe();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pagada = (await comprar(beto, tipoId, 1, 'stripe')).body.data.orden.id;
    await webhookStripe(eventoStripe('checkout.session.completed', pagada, { amount_total: 25000 }));

    stripeMock.reembolsar.mockRejectedValueOnce(new Error('Stripe caído'));
    expect((await api().post(`/api/eventos/${evento.id}/cancelar`).set(bearer(ana))).status).toBe(200);
    expect((await OrdenBoleto.findByPk(pagada))?.estado).toBe('pagada');

    expect((await api().post(`/api/boletos/eventos/${evento.id}/reembolsar`).set(bearer(beto))).status).toBe(403);
    const reintento = await api().post(`/api/boletos/eventos/${evento.id}/reembolsar`).set(bearer(ana));
    expect(reintento.body.data.reembolsadas).toBe(1);
    expect((await OrdenBoleto.findByPk(pagada))?.estado).toBe('reembolsada');
  });
});

describe('pagos: pasarela según el entorno', () => {
  it('elige proveedores por las claves; en producción sin claves no hay demo', () => {
    expect(crearPasarela({ NODE_ENV: 'development' }).disponibles().map((p) => p.id)).toEqual(['demo']);
    const produccion = crearPasarela({ NODE_ENV: 'production' });
    expect(produccion.disponibles()).toEqual([]);
    expect(() => produccion.elegir()).toThrow(/no están configurados/);

    const ambas = crearPasarela(
      { NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_x', MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-1', PAGOS_PROVEEDOR: 'mercadopago' },
      'http://localhost:3000',
    );
    expect(ambas.disponibles()).toEqual([
      { id: 'stripe', nombre: 'Tarjeta (Stripe)', modo_prueba: false },
      { id: 'mercadopago', nombre: 'Mercado Pago', modo_prueba: false },
    ]);
    expect(ambas.modoPrueba).toBe(false);
    expect(ambas.elegir().nombre).toBe('mercadopago');
    expect(ambas.elegir('stripe').nombre).toBe('stripe');
    expect(() => ambas.elegir('demo')).toThrow(/no está disponible/);
  });

  it('el servicio expone la info para la app', () => {
    expect(pagoService.info()).toEqual({ proveedores: [{ id: 'demo', nombre: 'Pago simulado (modo de prueba)', modo_prueba: true }], modo_prueba: true });
  });
});

function notificaciones(u: UsuarioPrueba, tipo: string) {
  return Notificacion.findAll({ where: { usuario_id: u.id, tipo } });
}
