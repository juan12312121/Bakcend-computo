import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Asignacion, CalendarioToken, Evento, EventoAsistente, Grupo, GrupoMiembro, Tablero, Tarea } from '../src/infrastructure/database/models';
import { aulaRoutes } from '../src/modules/aula/aula.routes';
import { COLORES_CALENDARIO, deAsignacion, ordenarElementos, type ElementoCalendario } from '../src/modules/aula/calendario/calendario.elementos';
import { DURACION_LIMITE_MS, generarCalendarioIcs } from '../src/modules/aula/calendario/calendario.ics';
import { tableroRoutes } from '../src/modules/tableros/tablero.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/aula': aulaRoutes, '/tableros': tableroRoutes }));
beforeEach(reiniciarBD);

const DIA = 24 * 60 * 60 * 1000;
const base = new Date(Date.now() + 3 * DIA);
const enDias = (d: number) => new Date(base.getTime() + d * DIA);

interface Escenario {
  grupoId: number;
  profe: UsuarioPrueba;
  ana: UsuarioPrueba;
  beto: UsuarioPrueba;
  dani: UsuarioPrueba;
}

async function escenario(): Promise<Escenario> {
  const [profe, ana, beto, dani] = [await crearUsuario('profe'), await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('dani')];
  const grupo = await Grupo.create({ nombre: 'Club de Física', creador_id: profe.id });
  await GrupoMiembro.bulkCreate([
    { grupo_id: grupo.id, usuario_id: profe.id, rol: 'admin', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: ana.id, rol: 'miembro', estado: 'activo' },
    { grupo_id: grupo.id, usuario_id: beto.id, rol: 'miembro', estado: 'activo' },
  ]);
  return { grupoId: grupo.id, profe, ana, beto, dani };
}

/** Un tablero del grupo con una tarea con fecha límite, y uno archivado. */
async function tablerosDelGrupo(profe: UsuarioPrueba, grupoId: number): Promise<{ tableroId: number; tareaId: number; clave: string }> {
  const tablero = await api().post('/api/tableros').set(bearer(profe)).send({ nombre: 'Laboratorio', grupo_id: grupoId });
  expect(tablero.status, JSON.stringify(tablero.body)).toBe(201);
  const tarea = await api()
    .post(`/api/tableros/${tablero.body.data.id}/tareas`)
    .set(bearer(profe))
    .send({ titulo: 'Reporte de práctica', fecha_limite: enDias(1).toISOString() });
  expect(tarea.status, JSON.stringify(tarea.body)).toBe(201);
  await api().post(`/api/tableros/${tablero.body.data.id}/tareas`).set(bearer(profe)).send({ titulo: 'Sin fecha' }).expect(201);

  const archivado = await api().post('/api/tableros').set(bearer(profe)).send({ nombre: 'Viejo', grupo_id: grupoId });
  await api().post(`/api/tableros/${archivado.body.data.id}/tareas`).set(bearer(profe)).send({ titulo: 'Oculta', fecha_limite: enDias(1).toISOString() }).expect(201);
  await Tablero.update({ archivado: true }, { where: { id: archivado.body.data.id } });
  return { tableroId: tablero.body.data.id, tareaId: tarea.body.data.id, clave: tablero.body.data.clave };
}

const rango = (desde: Date, hasta: Date) => `desde=${desde.toISOString()}&hasta=${hasta.toISOString()}`;
const calendario = (u: UsuarioPrueba, grupoId: number, query = rango(enDias(-2), enDias(10))) =>
  api().get(`/api/aula/grupos/${grupoId}/calendario?${query}`).set(bearer(u));

describe('calendario del grupo: piezas puras', () => {
  it('ordena por fecha y, a la misma hora, evento → tarea → entrega', () => {
    const misma = new Date('2026-10-20T10:00:00Z');
    const elemento = (tipo: ElementoCalendario['tipo'], inicio: Date, id = 1) => ({ id: `${tipo}-${id}`, tipo, entidad_id: id, inicio }) as ElementoCalendario;
    const orden = ordenarElementos([elemento('asignacion', misma), elemento('tarea', misma), elemento('evento', new Date('2026-10-21T00:00:00Z')), elemento('evento', misma, 2)]);
    expect(orden.map((e) => e.id)).toEqual(['evento-2', 'tarea-1', 'asignacion-1', 'evento-1']);
  });

  it('una entrega ya hecha cuenta como completada; pendiente o devuelta no', () => {
    const asignacion = { id: 4, titulo: 'T', fecha_entrega: new Date(), puntos_maximos: 10 } as Asignacion;
    expect(deAsignacion(asignacion, 'entregada')).toMatchObject({ completado: true, color: COLORES_CALENDARIO.asignacion, enlace: '/asignaciones/4', detalle: '10 puntos' });
    expect(deAsignacion(asignacion, 'devuelta').completado).toBe(false);
    expect(deAsignacion(asignacion, null).completado).toBe(false);
  });

  it('el .ics trae un VEVENT por elemento; las fechas límite terminan a su hora y los cancelados van CANCELLED', () => {
    const limite = new Date('2026-10-20T18:00:00Z');
    const ics = generarCalendarioIcs(
      {
        nombre: 'TrinoFlow · Club',
        urlApp: 'https://app.trino/',
        elementos: [
          { id: 'tarea-3', tipo: 'tarea', entidad_id: 3, titulo: 'Reporte', inicio: limite, fin: null, color: '', enlace: '/tableros/1?tarea=3', detalle: 'LAB-1', cancelado: false, completado: false, estado: null },
          { id: 'evento-9', tipo: 'evento', entidad_id: 9, titulo: 'Junta, semanal', inicio: limite, fin: null, color: '', enlace: '/eventos/9', detalle: 'Aula 5', cancelado: true, completado: false, estado: null },
        ],
      },
      new Date('2026-10-16T00:00:00Z'),
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('X-WR-CALNAME:TrinoFlow · Club');
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('UID:tarea-3@trinoflow');
    expect(ics).toContain(`DTSTART:${new Date(limite.getTime() - DURACION_LIMITE_MS).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`);
    expect(ics).toContain('DTEND:20261020T180000Z');
    expect(ics).toContain('SUMMARY:Tarea: Reporte');
    expect(ics).toContain('SUMMARY:Junta\\, semanal');
    expect(ics).toContain('DTEND:20261020T200000Z');
    expect(ics).toContain('LOCATION:Aula 5');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).toContain('URL:https://app.trino/tableros/1?tarea=3');
  });
});

describe('calendario del grupo: GET', () => {
  it('junta eventos visibles, tareas con fecha de tableros activos y entregas, en un solo formato', async () => {
    const { grupoId, profe, ana } = await escenario();
    const { tableroId, tareaId, clave } = await tablerosDelGrupo(profe, grupoId);
    const evento = await Evento.create({ creador_id: profe.id, grupo_id: grupoId, titulo: 'Práctica', visibilidad: 'grupo', lugar: 'Lab 2', inicio: enDias(0), fin: new Date(enDias(0).getTime() + 3_600_000) });
    const asignacion = await Asignacion.create({ grupo_id: grupoId, creador_id: profe.id, titulo: 'Problemas', fecha_entrega: enDias(2), puntos_maximos: 20 });
    // Fuera del rango y de otro grupo: no aparecen.
    await Evento.create({ creador_id: profe.id, grupo_id: grupoId, titulo: 'Lejano', visibilidad: 'grupo', inicio: enDias(40) });
    const otro = await Grupo.create({ nombre: 'Otro', creador_id: profe.id });
    await Asignacion.create({ grupo_id: otro.id, creador_id: profe.id, titulo: 'Ajena', fecha_entrega: enDias(1) });

    const res = await calendario(ana, grupoId);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.map((e: ElementoCalendario) => e.id)).toEqual([`evento-${evento.id}`, `tarea-${tareaId}`, `asignacion-${asignacion.id}`]);
    const [ev, tarea, entrega] = res.body.data;
    expect(ev).toMatchObject({ tipo: 'evento', titulo: 'Práctica', enlace: `/eventos/${evento.id}`, detalle: 'Lab 2', color: COLORES_CALENDARIO.evento, cancelado: false });
    expect(ev.fin).not.toBeNull();
    expect(tarea).toMatchObject({ tipo: 'tarea', titulo: 'Reporte de práctica', enlace: `/tableros/${tableroId}?tarea=${tareaId}`, detalle: `${clave}-1 · Laboratorio`, completado: false });
    expect(entrega).toMatchObject({ tipo: 'asignacion', estado: 'pendiente', detalle: '20 puntos', color: COLORES_CALENDARIO.asignacion });

    // El maestro ve la entrega sin estado propio.
    const comoProfe = await calendario(profe, grupoId);
    expect(comoProfe.body.data.find((e: ElementoCalendario) => e.tipo === 'asignacion').estado).toBeNull();
  });

  it('respeta la visibilidad de los eventos: privados solo para invitados y para los maestros', async () => {
    const { grupoId, profe, ana, beto } = await escenario();
    const privado = await Evento.create({ creador_id: beto.id, grupo_id: grupoId, titulo: 'Sorpresa', visibilidad: 'privado', inicio: enDias(1) });
    const titulos = async (u: UsuarioPrueba) => (await calendario(u, grupoId)).body.data.map((e: ElementoCalendario) => e.titulo);

    expect(await titulos(ana)).toEqual([]);
    expect(await titulos(beto)).toEqual(['Sorpresa']);
    expect(await titulos(profe)).toEqual(['Sorpresa']);
    await EventoAsistente.create({ evento_id: privado.id, usuario_id: ana.id, estado: 'invitado' });
    expect(await titulos(ana)).toEqual(['Sorpresa']);
  });

  it('solo miembros activos; rango inválido o mayor a 62 días 400; grupo inexistente 404', async () => {
    const { grupoId, ana, dani } = await escenario();
    expect((await calendario(dani, grupoId)).status).toBe(403);
    expect((await calendario(ana, 999)).status).toBe(404);
    expect((await calendario(ana, grupoId, rango(enDias(0), enDias(63)))).status).toBe(400);
    expect((await calendario(ana, grupoId, rango(enDias(2), enDias(1)))).status).toBe(400);
    expect((await calendario(ana, grupoId, 'desde=ayer')).status).toBe(400);
    expect((await api().get(`/api/aula/grupos/${grupoId}/calendario?${rango(enDias(0), enDias(1))}`)).status).toBe(401);
  });
});

describe('calendario del grupo: suscripción .ics', () => {
  it('da un enlace secreto (https, webcal y Google) que sirve el .ics sin sesión; regenerarlo invalida el anterior', async () => {
    const { grupoId, profe, ana, dani } = await escenario();
    await Asignacion.create({ grupo_id: grupoId, creador_id: profe.id, titulo: 'Problemas; cap. 2', fecha_entrega: enDias(2) });
    await Evento.create({ creador_id: profe.id, grupo_id: grupoId, titulo: 'Repaso', visibilidad: 'grupo', inicio: enDias(1) });

    expect((await api().get(`/api/aula/grupos/${grupoId}/calendario/suscripcion`).set(bearer(dani))).status).toBe(403);
    const res = await api().get(`/api/aula/grupos/${grupoId}/calendario/suscripcion`).set(bearer(ana));
    expect(res.status).toBe(200);
    const { url, webcal, google } = res.body.data as { url: string; webcal: string; google: string };
    expect(url).toMatch(new RegExp(`/api/aula/ics/[a-f0-9]{48}/grupos/${grupoId}\\.ics$`));
    expect(webcal.startsWith('webcal://')).toBe(true);
    expect(google).toBe(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`);
    // El mismo enlace cada vez.
    expect((await api().get(`/api/aula/grupos/${grupoId}/calendario/suscripcion`).set(bearer(ana))).body.data.url).toBe(url);

    const ruta = new URL(url).pathname;
    const ics = await api().get(ruta);
    expect(ics.status).toBe(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('X-WR-CALNAME:TrinoFlow · Club de Física');
    expect(ics.text).toContain('SUMMARY:Entrega: Problemas\\; cap. 2');
    expect(ics.text).toContain('SUMMARY:Repaso');

    const nuevo = await api().post(`/api/aula/grupos/${grupoId}/calendario/suscripcion/regenerar`).set(bearer(ana));
    expect(nuevo.status).toBe(200);
    expect(nuevo.body.data.url).not.toBe(url);
    expect((await api().get(ruta)).status).toBe(404);
    expect((await api().get(new URL(nuevo.body.data.url).pathname)).status).toBe(200);
    expect(await CalendarioToken.count()).toBe(1);
  });

  it('el enlace deja de servir si su dueño ya no es miembro; token mal formado 400', async () => {
    const { grupoId, ana } = await escenario();
    const { url } = (await api().get(`/api/aula/grupos/${grupoId}/calendario/suscripcion`).set(bearer(ana))).body.data;
    await GrupoMiembro.update({ estado: 'rechazado' }, { where: { usuario_id: ana.id } });
    expect((await api().get(new URL(url).pathname)).status).toBe(404);
    expect((await api().get(`/api/aula/ics/xyz/grupos/${grupoId}.ics`)).status).toBe(400);
  });

  it('las tareas de tableros archivados no salen ni en el .ics', async () => {
    const { grupoId, profe } = await escenario();
    await tablerosDelGrupo(profe, grupoId);
    const { url } = (await api().get(`/api/aula/grupos/${grupoId}/calendario/suscripcion`).set(bearer(profe))).body.data;
    const ics = (await api().get(new URL(url).pathname)).text;
    expect(ics).toContain('SUMMARY:Tarea: Reporte de práctica');
    expect(ics).not.toContain('Oculta');
    expect(ics).not.toContain('Sin fecha');
    expect(await Tarea.count()).toBe(3);
  });
});
