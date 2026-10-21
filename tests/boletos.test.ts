import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bloqueo, Boleto, Evento, EventoAsistente, Notificacion, OrdenBoleto, TipoBoleto, Usuario } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { FirmaBoletos, PREFIJO_CODIGO, SECRETO_DESARROLLO, firmaBoletos, secretoDeBoletos } from '../src/modules/boletos/boleto.codigo';
import { celdaCsv, slug } from '../src/modules/boletos/boleto.csv';
import { tipoBoletoRepository } from '../src/modules/boletos/boleto.repository';
import { boletoRoutes } from '../src/modules/boletos/boleto.routes';
import { eventoRoutes } from '../src/modules/eventos/evento.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/eventos': eventoRoutes, '/boletos': boletoRoutes }));
beforeEach(() => reiniciarBD());
afterEach(() => vi.restoreAllMocks());

const HORA = 60 * 60 * 1000;
const enHoras = (h: number) => new Date(Date.now() + h * HORA).toISOString();

interface Respuesta {
  id: number;
  [k: string]: unknown;
}

async function crearEvento(u: UsuarioPrueba, extra: Record<string, unknown> = {}): Promise<Respuesta> {
  const res = await api().post('/api/eventos').set(bearer(u)).send({ titulo: 'Concierto', lugar: 'Foro', inicio: enHoras(48), ...extra });
  if (res.status !== 201) throw new Error(`No se pudo crear el evento: ${JSON.stringify(res.body)}`);
  return res.body.data as Respuesta;
}

async function crearTipo(u: UsuarioPrueba, eventoId: number, extra: Record<string, unknown> = {}): Promise<Respuesta> {
  const res = await api().post(`/api/boletos/eventos/${eventoId}/tipos`).set(bearer(u)).send({ nombre: 'General', ...extra });
  if (res.status !== 201) throw new Error(`No se pudo crear el tipo: ${JSON.stringify(res.body)}`);
  return res.body.data as Respuesta;
}

const obtener = (u: UsuarioPrueba, tipoId: number, cantidad = 1) =>
  api().post('/api/boletos/comprar').set(bearer(u)).send({ tipo_boleto_id: tipoId, cantidad });

async function boletosGratis(u: UsuarioPrueba, tipoId: number, cantidad = 1): Promise<{ id: number; codigo: string }[]> {
  const res = await obtener(u, tipoId, cantidad);
  if (res.status !== 201) throw new Error(`No se pudo obtener: ${JSON.stringify(res.body)}`);
  return res.body.data.boletos as { id: number; codigo: string }[];
}

const validar = (u: UsuarioPrueba, eventoId: number, codigo: string) =>
  api().post('/api/boletos/validar').set(bearer(u)).send({ codigo, evento_id: eventoId });

const notificaciones = (u: UsuarioPrueba, tipo: string) => Notificacion.findAll({ where: { usuario_id: u.id, tipo } });

describe('boletos: código firmado', () => {
  it('genera códigos únicos con el formato TF1.<evento>.<aleatorio>.<firma> y los verifica', () => {
    const firma = new FirmaBoletos('un-secreto-de-pruebas-123');
    const a = firma.generar(42);
    const b = firma.generar(42);
    expect(a).not.toBe(b);
    expect(a.startsWith(`${PREFIJO_CODIGO}.42.`)).toBe(true);
    expect(a.split('.')).toHaveLength(4);
    expect(firma.leer(a)).toEqual({ eventoId: 42, token: a.split('.')[2] });
    expect(firma.leer(`  ${a}  `)?.eventoId).toBe(42);
  });

  it('rechaza códigos alterados, de otro secreto o mal formados', () => {
    const firma = new FirmaBoletos('un-secreto-de-pruebas-123');
    const codigo = firma.generar(7);
    const [prefijo, , token, sello] = codigo.split('.');

    expect(firma.leer(`${prefijo}.8.${token}.${sello}`)).toBeNull(); // otro evento
    expect(firma.leer(`${prefijo}.7.${token.slice(1)}x.${sello}`)).toBeNull(); // token cambiado
    expect(firma.leer(`${prefijo}.7.${token}.${sello.slice(0, -1)}A`)).toBeNull(); // firma cambiada
    expect(new FirmaBoletos('otro-secreto-distinto-456').leer(codigo)).toBeNull();
    for (const malo of ['', 'hola', 'TF2.7.abc.def', 'TF1.x.abcdefghijk.def', 'TF1.7.abc', `${codigo}.extra`]) {
      expect(firma.leer(malo)).toBeNull();
    }
    expect(() => new FirmaBoletos('corto')).toThrow(/16/);
  });

  it('usa BOLETOS_SECRETO y, sin él, el de desarrollo con aviso (no en pruebas)', () => {
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(secretoDeBoletos({ BOLETOS_SECRETO: '  mi-secreto-largo-1234  ' })).toBe('mi-secreto-largo-1234');
    expect(secretoDeBoletos({ NODE_ENV: 'test' })).toBe(SECRETO_DESARROLLO);
    expect(aviso).not.toHaveBeenCalled();
    secretoDeBoletos({ NODE_ENV: 'development' });
    secretoDeBoletos({ NODE_ENV: 'production' });
    expect(aviso).toHaveBeenCalledTimes(2);
    expect(String(aviso.mock.calls[1][0])).toMatch(/producción/);
  });
});

describe('boletos: tipos y configuración', () => {
  it('el organizador crea tipos (precio en centavos) y el resumen muestra cuántos quedan', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const evento = await crearEvento(ana);

    const vip = await crearTipo(ana, evento.id, { nombre: 'VIP', precio: 150.5, cupo: 20, max_por_persona: 4, descripcion: 'Primera fila' });
    expect(vip).toMatchObject({ nombre: 'VIP', precio: 150.5, precio_centavos: 15050, cupo: 20, quedan: 20, gratis: false, disponible: true, moneda: 'MXN' });
    await crearTipo(ana, evento.id);

    const ajeno = await api().post(`/api/boletos/eventos/${evento.id}/tipos`).set(bearer(beto)).send({ nombre: 'Pirata' });
    expect(ajeno.status).toBe(403);

    const decimales = await api().post(`/api/boletos/eventos/${evento.id}/tipos`).set(bearer(ana)).send({ nombre: 'X', precio: 10.555 });
    expect(decimales.status).toBe(400);
    const ventana = await api()
      .post(`/api/boletos/eventos/${evento.id}/tipos`)
      .set(bearer(ana))
      .send({ nombre: 'X', venta_desde: enHoras(5), venta_hasta: enHoras(2) });
    expect(ventana.body.errores.map((e: { campo: string }) => e.campo)).toEqual(['venta_hasta']);

    const resumen = await api().get(`/api/boletos/eventos/${evento.id}`).set(bearer(beto));
    expect(resumen.status).toBe(200);
    expect(resumen.body.data).toMatchObject({ requiere_boleto: false, moneda: 'MXN', mis_boletos: 0, puedo_organizar: false, puedo_escanear: false });
    expect(resumen.body.data.tipos.map((t: { nombre: string }) => t.nombre)).toEqual(['VIP', 'General']);
    expect(resumen.body.data.proveedores.map((p: { id: string }) => p.id)).toEqual(['demo']);

    const anonimo = await api().get(`/api/boletos/eventos/${evento.id}`);
    expect(anonimo.status).toBe(200);
    const deAna = await api().get(`/api/boletos/eventos/${evento.id}`).set(bearer(ana));
    expect(deAna.body.data).toMatchObject({ puedo_organizar: true, puedo_escanear: true });
  });

  it('configura requiere_boleto y la moneda (que no cambia con órdenes)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const evento = await crearEvento(ana);

    const res = await api().put(`/api/boletos/eventos/${evento.id}/configuracion`).set(bearer(ana)).send({ requiere_boleto: true, moneda: 'usd' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ requiere_boleto: true, moneda: 'USD' });
    expect((await Evento.findByPk(evento.id))?.requiere_boleto).toBe(true);

    expect((await api().put(`/api/boletos/eventos/${evento.id}/configuracion`).set(bearer(beto)).send({ moneda: 'MXN' })).status).toBe(403);
    expect((await api().put(`/api/boletos/eventos/${evento.id}/configuracion`).set(bearer(ana)).send({ moneda: 'XYZ' })).status).toBe(400);

    const tipo = await crearTipo(ana, evento.id);
    await boletosGratis(beto, tipo.id);
    const otraMoneda = await api().put(`/api/boletos/eventos/${evento.id}/configuracion`).set(bearer(ana)).send({ moneda: 'MXN' });
    expect(otraMoneda.status).toBe(409);
  });

  it('editar respeta lo vendido; borrar con ventas solo desactiva', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const evento = await crearEvento(ana);
    const tipo = await crearTipo(ana, evento.id, { cupo: 10 });
    await boletosGratis(beto, tipo.id, 3);

    const menor = await api().put(`/api/boletos/tipos/${tipo.id}`).set(bearer(ana)).send({ cupo: 2 });
    expect(menor.status).toBe(400);
    expect(menor.body.errores[0].campo).toBe('cupo');

    const ok = await api().put(`/api/boletos/tipos/${tipo.id}`).set(bearer(ana)).send({ cupo: 5, nombre: 'Preventa', precio: 0 });
    expect(ok.body.data).toMatchObject({ cupo: 5, quedan: 2, nombre: 'Preventa' });

    const borrar = await api().delete(`/api/boletos/tipos/${tipo.id}`).set(bearer(ana));
    expect(borrar.body.mensaje).toMatch(/dejó de vender/);
    expect((await TipoBoleto.findByPk(tipo.id))?.activo).toBe(false);
    // Inactivo: el público ya no lo ve y no se puede obtener
    const resumen = await api().get(`/api/boletos/eventos/${evento.id}`).set(bearer(beto));
    expect(resumen.body.data.tipos).toEqual([]);
    expect((await obtener(beto, tipo.id)).status).toBe(400);

    const vacio = await crearTipo(ana, evento.id, { nombre: 'Sin ventas' });
    expect((await api().delete(`/api/boletos/tipos/${vacio.id}`).set(bearer(ana))).body.mensaje).toBe('Tipo de boleto eliminado');
    expect(await TipoBoleto.findByPk(vacio.id)).toBeNull();
  });
});

describe('boletos: obtener gratis, cupo y "voy"', () => {
  it('emite boletos al instante, deja "voy" y avisa al comprador y al organizador', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const evento = await crearEvento(ana);
    const tipo = await crearTipo(ana, evento.id, { cupo: 5 });

    const res = await obtener(beto, tipo.id, 2);
    expect(res.status).toBe(201);
    expect(res.body.mensaje).toBe('¡Ya tienes tus boletos!');
    expect(res.body.data.url_pago).toBeNull();
    expect(res.body.data.orden).toMatchObject({ estado: 'pagada', proveedor: 'gratis', cantidad: 2, total: 0 });
    const boletos = res.body.data.boletos as { id: number; codigo: string; estado: string; es_mio: boolean }[];
    expect(boletos).toHaveLength(2);
    for (const b of boletos) {
      expect(b).toMatchObject({ estado: 'valido', es_mio: true });
      expect(firmaBoletos.leer(b.codigo)?.eventoId).toBe(evento.id);
    }

    expect((await TipoBoleto.findByPk(tipo.id))?.vendidos).toBe(2);
    const asistencia = await EventoAsistente.findOne({ where: { evento_id: evento.id, usuario_id: beto.id } });
    expect(asistencia?.estado).toBe('voy');
    expect((await Evento.findByPk(evento.id))?.total_asistentes).toBe(2);

    const paraBeto = await notificaciones(beto, 'boleto_comprado');
    expect(paraBeto).toHaveLength(1);
    expect(paraBeto[0]).toMatchObject({ de_usuario_id: ana.id, entidad_tipo: 'boleto', entidad_id: boletos[0].id });
    const paraAna = await notificaciones(ana, 'boleto_comprado');
    expect(paraAna[0]).toMatchObject({ de_usuario_id: beto.id, mensaje: expect.stringMatching(/obtuvo 2 boletos/) });

    // Una segunda compra no vuelve a sumar a los asistentes
    await boletosGratis(beto, tipo.id);
    expect((await Evento.findByPk(evento.id))?.total_asistentes).toBe(2);
  });

  it('sin sobreventa: respeta el cupo y el máximo por persona', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const evento = await crearEvento(ana);
    const tipo = await crearTipo(ana, evento.id, { cupo: 3, max_por_persona: 2 });

    const demasiados = await obtener(beto, tipo.id, 3);
    expect(demasiados.status).toBe(409);
    expect(demasiados.body.mensaje).toMatch(/Solo puedes obtener 2/);

    await boletosGratis(beto, tipo.id, 2);
    const otroMas = await obtener(beto, tipo.id, 1);
    expect(otroMas.status).toBe(409);
    expect(otroMas.body.mensaje).toMatch(/máximo/);

    const pasaDelCupo = await obtener(caro, tipo.id, 2);
    expect(pasaDelCupo.status).toBe(409);
    expect(pasaDelCupo.body.mensaje).toBe('Solo queda 1 boleto de este tipo');
    await boletosGratis(caro, tipo.id, 1);

    const agotado = await obtener(caro, tipo.id, 1);
    expect(agotado.status).toBe(400);
    expect(agotado.body.mensaje).toBe('Ya no quedan boletos de este tipo');
    expect(await Boleto.count({ where: { tipo_boleto_id: tipo.id } })).toBe(3);
    const resumen = await api().get(`/api/boletos/eventos/${evento.id}`).set(bearer(caro));
    expect(resumen.body.data.tipos[0]).toMatchObject({ quedan: 0, disponible: false, motivo: 'Agotado' });
  });

  it('la reserva del cupo es atómica: muchas compras simultáneas nunca pasan del cupo', async () => {
    const ana = await crearUsuario('ana');
    const evento = await crearEvento(ana);
    const tipo = await crearTipo(ana, evento.id, { cupo: 3 });

    const intentos = await Promise.all(Array.from({ length: 10 }, () => tipoBoletoRepository.reservar(tipo.id, 1)));
    expect(intentos.filter(Boolean)).toHaveLength(3);
    expect((await TipoBoleto.findByPk(tipo.id))?.vendidos).toBe(3);

    const dobles = await Promise.all([tipoBoletoRepository.reservar(tipo.id, 2), tipoBoletoRepository.reservar(tipo.id, 1)]);
    expect(dobles).toEqual([false, false]);

    await tipoBoletoRepository.liberar(tipo.id, 2);
    const trasLiberar = await Promise.all([tipoBoletoRepository.reservar(tipo.id, 2), tipoBoletoRepository.reservar(tipo.id, 2)]);
    expect(trasLiberar.filter(Boolean)).toHaveLength(1);
    await tipoBoletoRepository.liberar(tipo.id, 50);
    expect((await TipoBoleto.findByPk(tipo.id))?.vendidos).toBe(0);
  });

  it('respeta la ventana de venta y no vende en eventos cancelados', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const evento = await crearEvento(ana);
    const futuro = await crearTipo(ana, evento.id, { nombre: 'Preventa', venta_desde: enHoras(5) });
    const vencido = await crearTipo(ana, evento.id, { nombre: 'Taquilla', venta_hasta: enHoras(-1) });
    const normal = await crearTipo(ana, evento.id);

    expect((await obtener(beto, futuro.id)).body.mensaje).toBe('La venta aún no empieza');
    expect((await obtener(beto, vencido.id)).body.mensaje).toBe('La venta terminó');

    await api().post(`/api/eventos/${evento.id}/cancelar`).set(bearer(ana));
    const cancelado = await obtener(beto, normal.id);
    expect(cancelado.status).toBe(400);
    expect(cancelado.body.mensaje).toBe('El evento fue cancelado');
  });

  it('en eventos que requieren boleto, "voy" exige tener uno', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const evento = await crearEvento(ana);
    await api().put(`/api/boletos/eventos/${evento.id}/configuracion`).set(bearer(ana)).send({ requiere_boleto: true });
    const tipo = await crearTipo(ana, evento.id);

    const sinBoleto = await api().post(`/api/eventos/${evento.id}/asistencia`).set(bearer(beto)).send({ estado: 'voy' });
    expect(sinBoleto.status).toBe(400);
    expect(sinBoleto.body.mensaje).toMatch(/requiere boleto/);
    expect((await api().post(`/api/eventos/${evento.id}/asistencia`).set(bearer(beto)).send({ estado: 'interesado' })).status).toBe(200);

    await boletosGratis(beto, tipo.id);
    const detalle = await api().get(`/api/eventos/${evento.id}`).set(bearer(beto));
    expect(detalle.body.data).toMatchObject({ mi_estado: 'voy', requiere_boleto: true, moneda: 'MXN', total_asistentes: 2, total_interesados: 0 });
    expect((await api().post(`/api/eventos/${evento.id}/asistencia`).set(bearer(beto)).send({ estado: 'no_voy' })).status).toBe(200);
    expect((await api().post(`/api/eventos/${evento.id}/asistencia`).set(bearer(beto)).send({ estado: 'voy' })).status).toBe(200);
  });
});

describe('boletos: validar en la puerta', () => {
  async function preparar() {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const staff = await crearUsuario('staff');
    const extrano = await crearUsuario('extrano');
    const evento = await crearEvento(ana);
    const tipo = await crearTipo(ana, evento.id, { nombre: 'VIP' });
    const boletos = await boletosGratis(beto, tipo.id, 3);
    return { ana, beto, staff, extrano, evento, tipo, boletos };
  }

  it('válido la primera vez (con dueño y tipo) y "ya usado" la segunda; avisa al dueño', async () => {
    const { ana, beto, evento, boletos } = await preparar();
    const emitir = vi.spyOn(realtime, 'aUsuario');

    const primera = await validar(ana, evento.id, boletos[0].codigo);
    expect(primera.status).toBe(200);
    expect(primera.body.mensaje).toBe('Acceso válido');
    expect(primera.body.data).toMatchObject({
      valido: true,
      motivo: 'valido',
      boleto: { id: boletos[0].id, estado: 'usado', tipo: { nombre: 'VIP' }, dueno: { id: beto.id, nombre_completo: 'Usuario beto' }, escaneado_por: { id: ana.id } },
      estadisticas: { vendidos: 3, escaneados: 1 },
    });
    expect(emitir).toHaveBeenCalledWith(ana.id, 'boletos_escaneo', { evento_id: evento.id, vendidos: 3, escaneados: 1 });

    const segunda = await validar(ana, evento.id, boletos[0].codigo);
    expect(segunda.body.data).toMatchObject({ valido: false, motivo: 'ya_usado', mensaje: 'Este boleto ya se usó' });
    expect(segunda.body.data.boleto.usado_en).toBe(primera.body.data.boleto.usado_en);

    const aviso = await notificaciones(beto, 'boleto_usado');
    expect(aviso).toHaveLength(1);
    expect(aviso[0]).toMatchObject({ de_usuario_id: ana.id, entidad_tipo: 'boleto', entidad_id: boletos[0].id });
  });

  it('dos escaneos simultáneos del mismo boleto: solo uno es válido', async () => {
    const { ana, evento, boletos } = await preparar();
    const resultados = await Promise.all([validar(ana, evento.id, boletos[1].codigo), validar(ana, evento.id, boletos[1].codigo), validar(ana, evento.id, boletos[1].codigo)]);
    const motivos = resultados.map((r) => r.body.data.motivo).sort();
    expect(motivos).toEqual(['valido', 'ya_usado', 'ya_usado']);
    expect((await Boleto.findByPk(boletos[1].id))?.estado).toBe('usado');
  });

  it('distingue falso, de otro evento, cancelado y reembolsado', async () => {
    const { ana, evento, boletos, tipo } = await preparar();
    const otroEvento = await crearEvento(ana, { titulo: 'Otro' });

    const falso = await validar(ana, evento.id, 'TF1.1.inventadoinventado.firmafalsa');
    expect(falso.body.data).toMatchObject({ valido: false, motivo: 'falso', boleto: null });
    const alterado = boletos[0].codigo.slice(0, -2) + 'zz';
    expect((await validar(ana, evento.id, alterado)).body.data.motivo).toBe('falso');
    expect((await validar(ana, otroEvento.id, boletos[0].codigo)).body.data.motivo).toBe('otro_evento');
    // Firma válida pero sin boleto (p. ej. un QR viejo de un boleto transferido)
    expect((await validar(ana, evento.id, firmaBoletos.generar(evento.id))).body.data.motivo).toBe('falso');

    await Boleto.update({ estado: 'cancelado' }, { where: { id: boletos[1].id } });
    await Boleto.update({ estado: 'reembolsado' }, { where: { id: boletos[2].id } });
    expect((await validar(ana, evento.id, boletos[1].codigo)).body.data).toMatchObject({ motivo: 'cancelado', valido: false });
    expect((await validar(ana, evento.id, boletos[2].codigo)).body.data).toMatchObject({ motivo: 'reembolsado', valido: false });
    expect(tipo.id).toBeGreaterThan(0);

    const vacio = await api().post('/api/boletos/validar').set(bearer(ana)).send({ codigo: '', evento_id: evento.id });
    expect(vacio.status).toBe(400);
  });

  it('solo organizador y staff autorizado; el organizador administra el staff', async () => {
    const { ana, beto, staff, extrano, evento, boletos } = await preparar();

    expect((await validar(extrano, evento.id, boletos[0].codigo)).status).toBe(403);
    expect((await validar(beto, evento.id, boletos[0].codigo)).status).toBe(403);

    const agregar = await api().post(`/api/boletos/eventos/${evento.id}/staff`).set(bearer(ana)).send({ usuario_id: staff.id });
    expect(agregar.status).toBe(201);
    expect(agregar.body.data.map((u: { id: number }) => u.id)).toEqual([staff.id]);
    expect((await api().post(`/api/boletos/eventos/${evento.id}/staff`).set(bearer(ana)).send({ usuario_id: staff.id })).status).toBe(409);
    expect((await api().post(`/api/boletos/eventos/${evento.id}/staff`).set(bearer(ana)).send({ usuario_id: ana.id })).status).toBe(400);
    expect((await api().post(`/api/boletos/eventos/${evento.id}/staff`).set(bearer(staff)).send({ usuario_id: extrano.id })).status).toBe(403);
    await Bloqueo.create({ bloqueador_id: extrano.id, bloqueado_id: ana.id });
    expect((await api().post(`/api/boletos/eventos/${evento.id}/staff`).set(bearer(ana)).send({ usuario_id: extrano.id })).status).toBe(403);

    const porStaff = await validar(staff, evento.id, boletos[0].codigo);
    expect(porStaff.body.data).toMatchObject({ valido: true, boleto: { escaneado_por: { id: staff.id } } });
    const resumen = await api().get(`/api/boletos/eventos/${evento.id}`).set(bearer(staff));
    expect(resumen.body.data).toMatchObject({ puedo_escanear: true, puedo_organizar: false });

    // El staff ve estadísticas sin dinero y la lista, pero no el CSV
    const stats = await api().get(`/api/boletos/eventos/${evento.id}/estadisticas`).set(bearer(staff));
    expect(stats.body.data).toMatchObject({ vendidos: 3, escaneados: 1, ingresos_centavos: null, puedo_organizar: false });
    expect((await api().get(`/api/boletos/eventos/${evento.id}/boletos`).set(bearer(staff))).body.meta.total).toBe(3);
    expect((await api().get(`/api/boletos/eventos/${evento.id}/csv`).set(bearer(staff))).status).toBe(403);
    // El staff ve el boleto (sin el código) desde la puerta
    const visto = await api().get(`/api/boletos/${boletos[0].id}`).set(bearer(staff));
    expect(visto.body.data).toMatchObject({ id: boletos[0].id, codigo: null, es_mio: false });

    const quitar = await api().delete(`/api/boletos/eventos/${evento.id}/staff/${staff.id}`).set(bearer(ana));
    expect(quitar.body.data).toEqual([]);
    expect((await validar(staff, evento.id, boletos[1].codigo)).status).toBe(403);
    expect((await api().delete(`/api/boletos/eventos/${evento.id}/staff/${staff.id}`).set(bearer(ana))).status).toBe(404);
  });
});

describe('boletos: mis boletos, detalle y transferencia', () => {
  it('lista mis boletos próximos con evento y tipo; el detalle trae el código solo al dueño', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const extrano = await crearUsuario('extrano');
    const lejano = await crearEvento(ana, { titulo: 'Lejano', inicio: enHoras(100) });
    const cercano = await crearEvento(ana, { titulo: 'Cercano', inicio: enHoras(10) });
    const [b1] = await boletosGratis(beto, (await crearTipo(ana, lejano.id)).id);
    await boletosGratis(beto, (await crearTipo(ana, cercano.id)).id);
    await Evento.update({ inicio: new Date(Date.now() - 50 * HORA), fin: new Date(Date.now() - 48 * HORA) }, { where: { id: lejano.id } });

    const proximos = await api().get('/api/boletos/mios').set(bearer(beto));
    expect(proximos.status).toBe(200);
    expect(proximos.body.data.map((b: { evento: { titulo: string } }) => b.evento.titulo)).toEqual(['Cercano']);
    expect(proximos.body.data[0]).toMatchObject({ tipo: { nombre: 'General', precio: 0 }, dueno: { id: beto.id }, es_mio: true });
    const pasados = await api().get('/api/boletos/mios?cuando=pasados').set(bearer(beto));
    expect(pasados.body.data.map((b: { evento: { titulo: string } }) => b.evento.titulo)).toEqual(['Lejano']);
    expect((await api().get('/api/boletos/mios?cuando=todos').set(bearer(beto))).body.meta.total).toBe(2);

    const mio = await api().get(`/api/boletos/${b1.id}`).set(bearer(beto));
    expect(mio.body.data.codigo).toBe(b1.codigo);
    const organizador = await api().get(`/api/boletos/${b1.id}`).set(bearer(ana));
    expect(organizador.body.data.codigo).toBeNull();
    expect((await api().get(`/api/boletos/${b1.id}`).set(bearer(extrano))).status).toBe(404);
    expect((await api().get('/api/boletos/mios')).status).toBe(401);
  });

  it('transfiere: cambia el código (el QR viejo deja de servir) y mueve el "voy"', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const evento = await crearEvento(ana);
    const [boleto] = await boletosGratis(beto, (await crearTipo(ana, evento.id)).id);

    expect((await api().post(`/api/boletos/${boleto.id}/transferir`).set(bearer(caro)).send({ usuario_id: ana.id })).status).toBe(404);
    expect((await api().post(`/api/boletos/${boleto.id}/transferir`).set(bearer(beto)).send({ usuario_id: beto.id })).status).toBe(400);
    expect((await api().post(`/api/boletos/${boleto.id}/transferir`).set(bearer(beto)).send({ usuario_id: 999 })).status).toBe(404);

    const res = await api().post(`/api/boletos/${boleto.id}/transferir`).set(bearer(beto)).send({ usuario_id: caro.id });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ es_mio: false, codigo: null, transferido_de: beto.id, dueno: { id: caro.id } });

    const deCaro = await api().get(`/api/boletos/${boleto.id}`).set(bearer(caro));
    expect(deCaro.body.data.codigo).not.toBe(boleto.codigo);
    expect((await validar(ana, evento.id, boleto.codigo)).body.data.motivo).toBe('falso');
    expect((await validar(ana, evento.id, deCaro.body.data.codigo)).body.data.motivo).toBe('valido');

    const estado = async (u: UsuarioPrueba) => (await EventoAsistente.findOne({ where: { evento_id: evento.id, usuario_id: u.id } }))?.estado;
    expect(await estado(caro)).toBe('voy');
    expect(await estado(beto)).toBe('interesado');
    expect(await notificaciones(caro, 'boleto_comprado')).toHaveLength(1);

    // Ya usado: no se transfiere
    expect((await api().post(`/api/boletos/${boleto.id}/transferir`).set(bearer(caro)).send({ usuario_id: beto.id })).status).toBe(400);
  });
});

describe('boletos: estadísticas y CSV del organizador', () => {
  it('cuenta vendidos, escaneados e ingresos por tipo y exporta el CSV sin códigos', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('caro');
    await Usuario.update({ nombre_completo: '=HIPERVINCULO("x")' }, { where: { id: beto.id } });
    const evento = await crearEvento(ana, { titulo: 'Concierto de Año' });
    const general = await crearTipo(ana, evento.id, { cupo: 10 });
    await crearTipo(ana, evento.id, { nombre: 'VIP', precio: 200 });
    const boletos = await boletosGratis(beto, general.id, 2);
    await validar(ana, evento.id, boletos[0].codigo);
    // Una orden pagada simulada para los ingresos
    const vip = await TipoBoleto.findOne({ where: { nombre: 'VIP' } });
    await OrdenBoleto.create({
      usuario_id: beto.id,
      evento_id: evento.id,
      tipo_boleto_id: vip!.id,
      cantidad: 2,
      precio_unitario_centavos: 20000,
      total_centavos: 40000,
      moneda: 'MXN',
      proveedor: 'demo',
      estado: 'pagada',
    });

    const stats = await api().get(`/api/boletos/eventos/${evento.id}/estadisticas`).set(bearer(ana));
    expect(stats.body.data).toMatchObject({ vendidos: 2, escaneados: 1, ingresos_centavos: 40000, ordenes_pagadas: 2, puedo_organizar: true, moneda: 'MXN' });
    expect(stats.body.data.por_tipo).toEqual([
      expect.objectContaining({ nombre: 'General', vendidos: 2, escaneados: 1, ingresos_centavos: 0, cupo: 10 }),
      expect.objectContaining({ nombre: 'VIP', vendidos: 0, ingresos_centavos: 40000 }),
    ]);

    const lista = await api().get(`/api/boletos/eventos/${evento.id}/boletos?estado=usado`).set(bearer(ana));
    expect(lista.body.data.map((b: { id: number }) => b.id)).toEqual([boletos[0].id]);
    expect((await api().get(`/api/boletos/eventos/${evento.id}/boletos?q=caro`).set(bearer(ana))).body.meta.total).toBe(2);

    const csv = await api().get(`/api/boletos/eventos/${evento.id}/csv`).set(bearer(ana));
    expect(csv.status).toBe(200);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/asistentes-concierto-de-ano-\d+\.csv/);
    const texto = csv.text;
    expect(texto.split('\r\n')[0]).toMatch(/Boleto,Tipo,Precio \(MXN\),Estado,Nombre/);
    expect(texto).toMatch(/Usado/);
    expect(texto).toContain(`"'=HIPERVINCULO(""x"")"`);
    expect(texto).not.toContain(boletos[0].codigo);
  });

  it('celdas CSV y slug', () => {
    expect(celdaCsv('hola, mundo')).toBe('"hola, mundo"');
    expect(celdaCsv('dice "hola"')).toBe('"dice ""hola"""');
    expect(celdaCsv('=SUMA(A1)')).toBe("'=SUMA(A1)");
    expect(celdaCsv(-5)).toBe('-5');
    expect(celdaCsv(null)).toBe('');
    expect(slug('¡Fiesta de Año Nuevo!')).toBe('fiesta-de-ano-nuevo');
    expect(slug('???')).toBe('evento');
  });
});
