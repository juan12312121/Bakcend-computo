import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistroHoras, Tablero, Tarea } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { horaRoutes } from '../src/modules/aula/horas/hora.routes';
import { EVENTOS_HORAS, horaService } from '../src/modules/aula/horas/hora.service';
import { armarResumen, importeDe, minutosDe, tarifaDe, type RegistroResumible, type Tarifas } from '../src/modules/aula/horas/horas.resumen';
import { tableroRoutes } from '../src/modules/tableros/tablero.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/horas': horaRoutes, '/tableros': tableroRoutes }));
beforeEach(reiniciarBD);
afterEach(() => vi.restoreAllMocks());

const MINUTO = 60_000;
const HORA = 60 * MINUTO;
const haceMin = (m: number) => new Date(Date.now() - m * MINUTO);

interface Escenario {
  tableroId: number;
  clave: string;
  tareaA: number;
  tareaB: number;
  ana: UsuarioPrueba; // creadora (admin)
  beto: UsuarioPrueba; // miembro
  oscar: UsuarioPrueba; // observador
  dani: UsuarioPrueba; // de fuera
}

async function escenario(): Promise<Escenario> {
  const [ana, beto, oscar, dani] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('oscar'), await crearUsuario('dani')];
  const tablero = await api().post('/api/tableros').set(bearer(ana)).send({ nombre: 'Cliente Acme' });
  expect(tablero.status, JSON.stringify(tablero.body)).toBe(201);
  const id = tablero.body.data.id;
  await api().post(`/api/tableros/${id}/miembros`).set(bearer(ana)).send({ usuario_id: beto.id, rol: 'miembro' }).expect(201);
  await api().post(`/api/tableros/${id}/miembros`).set(bearer(ana)).send({ usuario_id: oscar.id, rol: 'observador' }).expect(201);
  const a = await api().post(`/api/tableros/${id}/tareas`).set(bearer(ana)).send({ titulo: 'Diseño' });
  const b = await api().post(`/api/tableros/${id}/tareas`).set(bearer(ana)).send({ titulo: 'Desarrollo' });
  return { tableroId: id, clave: tablero.body.data.clave, tareaA: a.body.data.id, tareaB: b.body.data.id, ana, beto, oscar, dani };
}

const iniciar = (u: UsuarioPrueba, tareaId: number, cuerpo: Record<string, unknown> = {}) =>
  api().post(`/api/horas/tareas/${tareaId}/iniciar`).set(bearer(u)).send(cuerpo);
const detener = (u: UsuarioPrueba) => api().post('/api/horas/detener').set(bearer(u));
const activo = (u: UsuarioPrueba) => api().get('/api/horas/activo').set(bearer(u));
const registrar = (u: UsuarioPrueba, tareaId: number, cuerpo: Record<string, unknown>) =>
  api().post(`/api/horas/tareas/${tareaId}`).set(bearer(u)).send(cuerpo);
const resumen = (u: UsuarioPrueba, tableroId: number, extra = '') =>
  api().get(`/api/horas/tableros/${tableroId}/resumen?desde=${haceMin(60 * 24 * 7).toISOString()}&hasta=${new Date(Date.now() + HORA).toISOString()}${extra}`).set(bearer(u));

describe('horas: cálculos puros', () => {
  const tarifas: Tarifas = { moneda: 'MXN', tablero: 20_000, porUsuario: new Map([[2, 50_000]]) };
  const registro = (extra: Partial<RegistroResumible>): RegistroResumible => ({
    tarea_id: 1,
    usuario_id: 1,
    inicio: new Date('2026-10-16T10:00:00Z'),
    fin: new Date('2026-10-16T11:30:00Z'),
    minutos: 90,
    facturable: true,
    ...extra,
  });

  it('minutos de un registro terminado y de uno que sigue corriendo', () => {
    expect(minutosDe(registro({}))).toBe(90);
    expect(minutosDe(registro({ fin: null, minutos: 0 }), new Date('2026-10-16T10:45:20Z'))).toBe(45);
  });

  it('la tarifa del miembro gana a la del tablero; lo no facturable no cobra', () => {
    expect(tarifaDe(tarifas, 2)).toBe(50_000);
    expect(tarifaDe(tarifas, 1)).toBe(20_000);
    expect(importeDe(registro({}), tarifas)).toBe(30_000);
    expect(importeDe(registro({ usuario_id: 2 }), tarifas)).toBe(75_000);
    expect(importeDe(registro({ facturable: false }), tarifas)).toBe(0);
    expect(importeDe(registro({}), { moneda: 'MXN', tablero: null, porUsuario: new Map() })).toBeNull();
  });

  it('armarResumen: totales, por persona y por tarea (ordenados por tiempo)', () => {
    const usuario = (id: number, nombre: string) => ({ id, nombre_usuario: nombre, nombre_completo: nombre, foto_perfil_url: null, carrera: null });
    const r = armarResumen(
      [registro({}), registro({ usuario_id: 2, tarea_id: 2, minutos: 120 }), registro({ facturable: false, minutos: 30 })],
      tarifas,
      {
        desde: new Date('2026-10-01'),
        hasta: new Date('2026-11-01'),
        usuarios: new Map([
          [1, usuario(1, 'Ana')],
          [2, usuario(2, 'Beto')],
        ]),
        tareas: new Map([
          [1, { id: 1, clave: 'ACM-1', titulo: 'Diseño' }],
          [2, { id: 2, clave: 'ACM-2', titulo: 'Desarrollo' }],
        ]),
      },
    );
    expect(r).toMatchObject({ moneda: 'MXN', registros: 3, total_minutos: 240, facturable_minutos: 210, importe_total: 1300 });
    expect(r.por_persona.map((p) => [p.usuario.nombre_completo, p.minutos, p.facturable_minutos, p.tarifa, p.importe])).toEqual([
      ['Ana', 120, 90, 200, 300],
      ['Beto', 120, 120, 500, 1000],
    ]);
    expect(r.por_tarea.map((t) => [t.tarea.clave, t.minutos, t.importe])).toEqual([
      ['ACM-1', 120, 300],
      ['ACM-2', 120, 1000],
    ]);
  });
});

describe('horas: cronómetro', () => {
  it('iniciar y detener; solo hay uno activo por persona (iniciar otro detiene el anterior)', async () => {
    const { tareaA, tareaB, beto, clave } = await escenario();
    const avisos = vi.spyOn(realtime, 'aUsuario');

    expect((await activo(beto)).body.data).toBeNull();
    const primero = await iniciar(beto, tareaA, { nota: 'Bocetos' });
    expect(primero.status, JSON.stringify(primero.body)).toBe(201);
    expect(primero.body.data.registro).toMatchObject({ tarea_id: tareaA, corriendo: true, fin: null, nota: 'Bocetos', facturable: true, tarea: { clave: `${clave}-1` } });
    expect(primero.body.data.registro).not.toHaveProperty('cronometro_de');
    expect(primero.body.data.detenido).toBeNull();
    expect(avisos).toHaveBeenCalledWith(beto.id, EVENTOS_HORAS.cronometro, expect.objectContaining({ activo: expect.objectContaining({ tarea_id: tareaA }) }));

    expect((await iniciar(beto, tareaA)).status).toBe(409);

    // Simula que lleva 25 minutos.
    await RegistroHoras.update({ inicio: haceMin(25) }, { where: { id: primero.body.data.registro.id } });
    const segundo = await iniciar(beto, tareaB);
    expect(segundo.status).toBe(201);
    expect(segundo.body.mensaje).toContain('se detuvo el anterior');
    expect(segundo.body.data.detenido).toMatchObject({ tarea_id: tareaA, corriendo: false, minutos: 25 });
    expect(await RegistroHoras.count({ where: { fin: null } })).toBe(1);
    expect((await activo(beto)).body.data).toMatchObject({ tarea_id: tareaB, corriendo: true, tarea: { titulo: 'Desarrollo' } });

    const detenido = await detener(beto);
    expect(detenido.status).toBe(200);
    expect(detenido.body.data).toMatchObject({ tarea_id: tareaB, corriendo: false });
    expect(avisos).toHaveBeenLastCalledWith(beto.id, EVENTOS_HORAS.cronometro, { activo: null });
    expect((await detener(beto)).status).toBe(404);
  });

  it('cada persona tiene su propio cronómetro; observadores y gente de fuera no registran', async () => {
    const { tareaA, ana, beto, oscar, dani } = await escenario();
    await iniciar(ana, tareaA).expect(201);
    await iniciar(beto, tareaA).expect(201);
    expect(await RegistroHoras.count({ where: { fin: null } })).toBe(2);
    expect((await iniciar(oscar, tareaA)).status).toBe(403);
    expect((await iniciar(dani, tareaA)).status).toBe(403);
    expect((await iniciar(ana, 999)).status).toBe(404);
    expect((await api().post(`/api/horas/tareas/${tareaA}/iniciar`)).status).toBe(401);
  });

  it('no se registra tiempo en tableros archivados', async () => {
    const { tableroId, tareaA, ana } = await escenario();
    await Tablero.update({ archivado: true }, { where: { id: tableroId } });
    expect((await iniciar(ana, tareaA)).status).toBe(400);
    expect((await registrar(ana, tareaA, { minutos: 10 })).status).toBe(400);
  });

  it('avisa a la sala del tablero para que la pestaña Horas se actualice', async () => {
    const { tableroId, tareaA, beto } = await escenario();
    const sala = vi.spyOn(realtime, 'aSala');
    await iniciar(beto, tareaA).expect(201);
    expect(sala).toHaveBeenCalledWith(`board_${tableroId}`, EVENTOS_HORAS.horas, { tablero_id: tableroId, tarea_id: tareaA, por_usuario_id: beto.id });
  });
});

describe('horas: registros a mano', () => {
  it('por minutos o por inicio y fin; valida duración y futuro', async () => {
    const { tareaA, beto } = await escenario();
    const porMinutos = await registrar(beto, tareaA, { minutos: 45, nota: 'Llamada', facturable: false });
    expect(porMinutos.status, JSON.stringify(porMinutos.body)).toBe(201);
    expect(porMinutos.body.data).toMatchObject({ minutos: 45, nota: 'Llamada', facturable: false, corriendo: false });

    const porRango = await registrar(beto, tareaA, { inicio: haceMin(180).toISOString(), fin: haceMin(60).toISOString() });
    expect(porRango.body.data.minutos).toBe(120);

    expect((await registrar(beto, tareaA, {})).status).toBe(400);
    expect((await registrar(beto, tareaA, { minutos: 0 })).status).toBe(400);
    expect((await registrar(beto, tareaA, { minutos: 1441 })).status).toBe(400);
    expect((await registrar(beto, tareaA, { minutos: 10, fin: new Date().toISOString() })).status).toBe(400);
    expect((await registrar(beto, tareaA, { inicio: haceMin(10).toISOString(), fin: haceMin(20).toISOString() })).status).toBe(400);
    expect((await registrar(beto, tareaA, { inicio: haceMin(10).toISOString(), fin: new Date(Date.now() + HORA).toISOString() })).status).toBe(400);
    expect((await registrar(beto, tareaA, { inicio: haceMin(26 * 60).toISOString(), fin: haceMin(60).toISOString() })).status).toBe(400);
  });

  it('el tiempo de la tarea suma a todos; editar y borrar solo los propios', async () => {
    const { tareaA, ana, beto, oscar } = await escenario();
    const deBeto = (await registrar(beto, tareaA, { minutos: 30 })).body.data;
    await registrar(ana, tareaA, { minutos: 60, facturable: false }).expect(201);
    await iniciar(beto, tareaA).expect(201);

    const tiempo = await api().get(`/api/horas/tareas/${tareaA}`).set(bearer(beto));
    expect(tiempo.status).toBe(200);
    expect(tiempo.body.data).toMatchObject({ total_minutos: 90, facturable_minutos: 30, mis_minutos: 30, puede_registrar: true, activo: { corriendo: true } });
    expect(tiempo.body.data.registros).toHaveLength(3);
    const comoObservador = await api().get(`/api/horas/tareas/${tareaA}`).set(bearer(oscar));
    expect(comoObservador.body.data).toMatchObject({ puede_registrar: false, activo: null, mis_minutos: 0 });

    expect((await api().put(`/api/horas/registros/${deBeto.id}`).set(bearer(ana)).send({ nota: 'x' })).status).toBe(403);
    expect((await api().delete(`/api/horas/registros/${deBeto.id}`).set(bearer(ana))).status).toBe(403);
    expect((await api().put(`/api/horas/registros/${deBeto.id}`).set(bearer(beto)).send({})).status).toBe(400);

    const nuevoInicio = haceMin(300);
    const editado = await api().put(`/api/horas/registros/${deBeto.id}`).set(bearer(beto)).send({ inicio: nuevoInicio.toISOString(), nota: 'Revisión' });
    expect(editado.status).toBe(200);
    expect(editado.body.data).toMatchObject({ minutos: 30, nota: 'Revisión' });
    expect(new Date(editado.body.data.fin).getTime()).toBe(nuevoInicio.getTime() + 30 * MINUTO);
    const otraDuracion = await api().put(`/api/horas/registros/${deBeto.id}`).set(bearer(beto)).send({ minutos: 50, facturable: false });
    expect(otraDuracion.body.data).toMatchObject({ minutos: 50, facturable: false });

    expect((await api().delete(`/api/horas/registros/${deBeto.id}`).set(bearer(beto))).status).toBe(200);
    expect(await RegistroHoras.count()).toBe(2);
  });

  it('mientras corre solo se cambian nota, facturable e inicio; borrarlo apaga el cronómetro', async () => {
    const { tareaA, beto } = await escenario();
    const { registro } = (await iniciar(beto, tareaA)).body.data;
    expect((await api().put(`/api/horas/registros/${registro.id}`).set(bearer(beto)).send({ minutos: 10 })).status).toBe(400);
    const conNota = await api().put(`/api/horas/registros/${registro.id}`).set(bearer(beto)).send({ nota: 'Sigue', inicio: haceMin(15).toISOString() });
    expect(conNota.body.data).toMatchObject({ nota: 'Sigue', corriendo: true, minutos: 15 });
    await api().delete(`/api/horas/registros/${registro.id}`).set(bearer(beto)).expect(200);
    expect((await activo(beto)).body.data).toBeNull();
  });

  it('borrar la tarea borra su tiempo', async () => {
    const { tareaA, ana } = await escenario();
    await registrar(ana, tareaA, { minutos: 30 }).expect(201);
    await api().delete(`/api/tableros/tareas/${tareaA}`).set(bearer(ana)).expect(200);
    expect(await Tarea.count({ where: { id: tareaA } })).toBe(0);
    expect(await RegistroHoras.count({ where: { tarea_id: tareaA } })).toBe(0);
  });
});

describe('horas: resumen, tarifas y CSV', () => {
  it('tarifas: solo administradores las cambian; la del miembro gana; null la quita', async () => {
    const { tableroId, ana, beto, dani } = await escenario();
    const tarifa = (u: UsuarioPrueba, cuerpo: Record<string, unknown>) => api().put(`/api/horas/tableros/${tableroId}/tarifas`).set(bearer(u)).send(cuerpo);
    expect((await tarifa(beto, { tarifa: 100 })).status).toBe(403);
    expect((await tarifa(ana, { tarifa: -1 })).status).toBe(400);
    expect((await tarifa(ana, { usuario_id: dani.id, tarifa: 100 })).status).toBe(400);

    await tarifa(ana, { tarifa: 200, moneda: 'usd' }).expect(200);
    const res = await tarifa(ana, { usuario_id: beto.id, tarifa: 350.5 });
    expect(res.body.data).toEqual({ moneda: 'USD', tablero: 200, miembros: [{ usuario_id: beto.id, tarifa: 350.5 }] });
    const quitada = await tarifa(ana, { usuario_id: beto.id, tarifa: null });
    expect(quitada.body.data.miembros).toEqual([]);
    expect((await api().get(`/api/horas/tableros/${tableroId}/tarifas`).set(bearer(beto))).body.data.tablero).toBe(200);
    expect((await api().get(`/api/horas/tableros/${tableroId}/tarifas`).set(bearer(dani))).status).toBe(403);
  });

  it('resumen por persona y por tarea con importes; filtros por persona y rango', async () => {
    const { tableroId, tareaA, tareaB, ana, beto, oscar, dani, clave } = await escenario();
    await api().put(`/api/horas/tableros/${tableroId}/tarifas`).set(bearer(ana)).send({ tarifa: 100 }).expect(200);
    await api().put(`/api/horas/tableros/${tableroId}/tarifas`).set(bearer(ana)).send({ usuario_id: beto.id, tarifa: 300 }).expect(200);
    await registrar(beto, tareaA, { minutos: 90 }).expect(201);
    await registrar(beto, tareaB, { minutos: 30, facturable: false }).expect(201);
    await registrar(ana, tareaB, { minutos: 60 }).expect(201);
    // Fuera del rango (hace 10 días).
    await registrar(ana, tareaA, { minutos: 60, inicio: haceMin(60 * 24 * 10).toISOString() }).expect(201);

    const res = await resumen(oscar, tableroId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ moneda: 'MXN', registros: 3, total_minutos: 180, facturable_minutos: 150, importe_total: 550 });
    expect(res.body.data.por_persona.map((p: { usuario: { id: number }; minutos: number; importe: number; tarifa: number }) => [p.usuario.id, p.minutos, p.tarifa, p.importe])).toEqual([
      [beto.id, 120, 300, 450],
      [ana.id, 60, 100, 100],
    ]);
    expect(res.body.data.por_tarea.map((t: { tarea: { clave: string }; minutos: number }) => [t.tarea.clave, t.minutos])).toEqual([
      [`${clave}-1`, 90],
      [`${clave}-2`, 90],
    ]);

    const soloAna = await resumen(ana, tableroId, `&usuario_id=${ana.id}`);
    expect(soloAna.body.data).toMatchObject({ registros: 1, total_minutos: 60 });
    const facturables = await resumen(ana, tableroId, '&facturable=true');
    expect(facturables.body.data.total_minutos).toBe(150);

    expect((await resumen(dani, tableroId)).status).toBe(403);
    const sinRango = await api().get(`/api/horas/tableros/${tableroId}/resumen`).set(bearer(ana));
    expect(sinRango.status).toBe(400);
    const largo = await api()
      .get(`/api/horas/tableros/${tableroId}/resumen?desde=2025-01-01T00:00:00Z&hasta=2026-06-01T00:00:00Z`)
      .set(bearer(ana));
    expect(largo.status).toBe(400);
  });

  it('CSV con un renglón por registro, zona horaria y totales', async () => {
    const { tableroId, tareaA, ana, beto, clave } = await escenario();
    await api().put(`/api/horas/tableros/${tableroId}/tarifas`).set(bearer(ana)).send({ tarifa: 120 }).expect(200);
    await registrar(beto, tareaA, { inicio: '2026-10-15T15:00:00Z', fin: '2026-10-15T16:30:00Z', nota: '=HACK()' }).expect(201);

    const csv = await api()
      .get(`/api/horas/tableros/${tableroId}/csv?desde=2026-10-01T00:00:00Z&hasta=2026-10-31T00:00:00Z&zona=America/Mexico_City`)
      .set(bearer(beto));
    expect(csv.status, csv.text).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('2026-10-01-a-2026-10-31.csv');
    const lineas = csv.text.replace('﻿', '').trim().split('\r\n');
    expect(lineas[0]).toBe('Inicio,Fin,Persona,Usuario,Tarea,Título,Nota,Minutos,Horas,Facturable,Tarifa/h (MXN),Importe (MXN)');
    expect(lineas[1]).toBe(`2026-10-15 09:00,2026-10-15 10:30,Usuario beto,beto,${clave}-1,Diseño,'=HACK(),90,1.5,Sí,120,180`);
    expect(lineas[2]).toBe('Total,,,,,,,90,1.5,,,180');

    const zonaMala = await api().get(`/api/horas/tableros/${tableroId}/csv?desde=2026-10-01T00:00:00Z&hasta=2026-10-31T00:00:00Z&zona=Marte/Base`).set(bearer(beto));
    expect(zonaMala.status).toBe(400);
  });

  it('el servicio cuenta el tiempo del cronómetro que sigue corriendo', async () => {
    const { tableroId, tareaA, beto } = await escenario();
    const { registro } = (await iniciar(beto, tareaA)).body.data;
    await RegistroHoras.update({ inicio: haceMin(40) }, { where: { id: registro.id } });
    const r = await horaService.resumen(tableroId, beto.id, { desde: haceMin(120), hasta: new Date(Date.now() + HORA) });
    expect(r.total_minutos).toBe(40);
    expect(r.importe_total).toBeNull();
  });
});
