import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Bloqueo,
  Comentario,
  Compartido,
  EstadisticaPerfilDiaria,
  EstadisticaPublicacionDiaria,
  EventoEstadistica,
  Like,
  PublicacionGuardada,
  Seguidor,
  Usuario,
  fechaDia,
} from '../src/infrastructure/database/models';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { estadisticaRoutes } from '../src/modules/estadisticas/estadistica.routes';
import {
  actividadPorHorario,
  diasEntre,
  estadisticaService,
  horaYDia,
  masRepetidos,
  programarLimpiezaEstadisticas,
  rangoDeDias,
  tasaInteraccion,
} from '../src/modules/estadisticas/estadistica.service';
import { historiaRoutes } from '../src/modules/historias/historia.routes';
import { historiaService } from '../src/modules/historias/historia.service';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { publicacionService } from '../src/modules/publicaciones/publicacion.service';
import { seguidorRoutes } from '../src/modules/seguidores/seguidor.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() =>
  usarModulos({ '/estadisticas': estadisticaRoutes, '/publicaciones': publicacionRoutes, '/historias': historiaRoutes, '/seguidores': seguidorRoutes }),
);
beforeEach(async () => {
  await reiniciarBD();
  vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const hoy = () => fechaDia(new Date());
const publicar = (u: UsuarioPrueba, contenido = 'Hola', visibilidad: 'publico' | 'privado' = 'publico') =>
  publicacionService.crear(u.id, { contenido, categoria: 'General', visibilidad });
const impresiones = (u: UsuarioPrueba, ids: number[]) => api().post('/api/estadisticas/impresiones').set(bearer(u)).send({ publicacion_ids: ids });
const diaria = (publicacionId: number) => EstadisticaPublicacionDiaria.findOne({ where: { publicacion_id: publicacionId, fecha: hoy() } });
const perfilHoy = (usuarioId: number) => EstadisticaPerfilDiaria.findOne({ where: { usuario_id: usuarioId, fecha: hoy() } });
/** Corre hacia atrás los eventos crudos (como si hubieran pasado `minutos`). */
const envejecer = (minutos: number) => EventoEstadistica.update({ fecha_creacion: new Date(Date.now() - minutos * 60_000) }, { where: {} });

describe('estadísticas: registro', () => {
  it('impresiones: solo visibles y ajenas, sin duplicar en 30 min; el alcance cuenta una vez por persona al día', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const publica = await publicar(ana);
    const privada = await publicar(ana, 'solo yo', 'privado');
    const deBeto = await publicar(beto);

    const res = await impresiones(beto, [publica.id, privada.id, deBeto.id, 9999]);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ registradas: 1 });
    expect((await impresiones(beto, [publica.id])).body.data).toEqual({ registradas: 0 });
    expect(await diaria(publica.id)).toMatchObject({ impresiones: 1, alcance: 1, usuario_id: ana.id });
    expect(await diaria(privada.id)).toBeNull();

    await envejecer(31);
    // Si el evento movido cae ayer (justo después de medianoche) el alcance de hoy vuelve a contar
    const movidoHoy = fechaDia(new Date(Date.now() - 31 * 60_000)) === hoy();
    expect((await impresiones(beto, [publica.id])).body.data).toEqual({ registradas: 1 });
    expect(await diaria(publica.id)).toMatchObject({ impresiones: 2, alcance: movidoHoy ? 1 : 2 });
    expect(await EventoEstadistica.count({ where: { tipo: 'impresion' } })).toBe(2);
  });

  it('valida el lote y pide sesión', async () => {
    const ana = await crearUsuario('ana');
    expect((await impresiones(ana, [])).status).toBe(400);
    expect((await api().post('/api/estadisticas/impresiones').set(bearer(ana)).send({ publicacion_ids: Array.from({ length: 101 }, (_, i) => i + 1) })).status).toBe(400);
    expect((await api().post('/api/estadisticas/impresiones').send({ publicacion_ids: [1] })).status).toBe(401);
  });

  it('visitas al perfil: no la propia, no con bloqueo, sin duplicar; 404 si no existe', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const visitar = (de: UsuarioPrueba, a: number) => api().post(`/api/estadisticas/visitas-perfil/${a}`).set(bearer(de));
    expect((await visitar(beto, ana.id)).body.data).toEqual({ registradas: 1 });
    expect((await visitar(beto, ana.id)).body.data).toEqual({ registradas: 0 });
    expect((await visitar(ana, ana.id)).body.data).toEqual({ registradas: 0 });
    await Bloqueo.create({ bloqueador_id: ana.id, bloqueado_id: caro.id });
    expect((await visitar(caro, ana.id)).body.data).toEqual({ registradas: 0 });
    expect((await visitar(beto, 9999)).status).toBe(404);
    expect(await perfilHoy(ana.id)).toMatchObject({ visitas_perfil: 1 });
  });

  it('clics en enlaces, reproducciones de video y de historias', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const p = await publicacionService.crear(
      ana.id,
      { contenido: 'video https://ejemplo.com', categoria: 'General', visibilidad: 'publico', video_duracion: 10 },
      { video: { url: 'https://res.cloudinary.com/demo/video/upload/v1.mp4', id: 'v1', nombreOriginal: 'v', mimetype: 'video/mp4', tamano: 1 } },
    );
    expect((await api().post(`/api/estadisticas/clics/${p.id}`).set(bearer(beto))).body.data).toEqual({ registradas: 1 });
    expect((await api().post(`/api/estadisticas/clics/${p.id}`).set(bearer(beto))).body.data).toEqual({ registradas: 0 });
    expect((await api().post(`/api/estadisticas/clics/${p.id}`).set(bearer(ana))).body.data).toEqual({ registradas: 0 });

    await api().post(`/api/publicaciones/${p.id}/vista`).expect(200);
    await api().post(`/api/publicaciones/${p.id}/vista`).set(bearer(beto)).expect(200);
    expect(await diaria(p.id)).toMatchObject({ reproducciones: 2, clics_enlace: 1 });

    await Seguidor.create({ seguidor_id: beto.id, siguiendo_id: ana.id });
    const h = await historiaService.crear(ana.id, { tipo: 'texto', texto: 'hola' });
    await api().post(`/api/historias/${h.id}/vista`).set(bearer(beto)).expect(200);
    await api().post(`/api/historias/${h.id}/vista`).set(bearer(beto)).expect(200);
    expect(await perfilHoy(ana.id)).toMatchObject({ reproducciones_historias: 1 });
  });

  it('seguidores ganados y perdidos (también al aceptar una solicitud)', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    await api().post('/api/seguidores/seguir').set(bearer(beto)).send({ seguido_id: ana.id }).expect(201);
    await api().delete('/api/seguidores/dejar-de-seguir').set(bearer(beto)).send({ seguido_id: ana.id }).expect(200);
    expect(await perfilHoy(ana.id)).toMatchObject({ seguidores_ganados: 1, seguidores_perdidos: 1 });

    await Usuario.update({ cuenta_privada: true }, { where: { id: ana.id } });
    await api().post('/api/seguidores/seguir').set(bearer(caro)).send({ seguido_id: ana.id });
    expect(await perfilHoy(ana.id)).toMatchObject({ seguidores_ganados: 1 });
    await api().post(`/api/seguidores/solicitudes/${caro.id}/aceptar`).set(bearer(ana)).expect(200);
    expect(await perfilHoy(ana.id)).toMatchObject({ seguidores_ganados: 2, seguidores_perdidos: 1 });
  });
});

describe('estadísticas: panel del creador', () => {
  it('resumen: totales, por día, mejores publicaciones, horas y audiencia; solo lo propio', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    await Usuario.update({ ubicacion: 'Culiacán' }, { where: { id: beto.id } });
    await Usuario.update({ ubicacion: 'culiacán ', carrera: 'Agronomía' }, { where: { id: caro.id } });
    const popular = await publicar(ana, 'La buena');
    const otra = await publicar(ana, 'La otra');
    await publicar(beto, 'De beto');

    for (const u of [beto, caro]) {
      await api().post('/api/seguidores/seguir').set(bearer(u)).send({ seguido_id: ana.id });
      await impresiones(u, [popular.id, otra.id]);
    }
    await Like.create({ publicacion_id: popular.id, usuario_id: beto.id, tipo: 'me_encanta' });
    await Like.create({ publicacion_id: popular.id, usuario_id: ana.id }); // las propias no cuentan
    await Comentario.create({ publicacion_id: popular.id, usuario_id: caro.id, texto: 'genial' });
    await Compartido.create({ publicacion_id: popular.id, usuario_id: caro.id });
    await PublicacionGuardada.create({ publicacion_id: otra.id, usuario_id: beto.id });
    await api().post(`/api/estadisticas/visitas-perfil/${ana.id}`).set(bearer(beto));

    const res = await api().get('/api/estadisticas/resumen?dias=7&zona=360').set(bearer(ana));
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r.rango).toMatchObject({ dias: 7, hasta: hoy() });
    expect(r.totales).toMatchObject({
      alcance: 2,
      impresiones: 4,
      interacciones: 4,
      reacciones: 1,
      comentarios: 1,
      compartidos: 1,
      guardados: 1,
      visitas_perfil: 1,
      seguidores_ganados: 2,
      seguidores_perdidos: 0,
      seguidores_netos: 2,
      seguidores_actuales: 2,
    });
    expect(r.anterior).toEqual({ alcance: 0, impresiones: 0, interacciones: 0, visitas_perfil: 0, seguidores_netos: 0 });
    expect(r.por_dia).toHaveLength(7);
    expect(r.por_dia[6]).toMatchObject({ fecha: hoy(), impresiones: 4, alcance: 4, interacciones: 4, visitas_perfil: 1, seguidores_ganados: 2 });
    expect(r.mejores_publicaciones.map((m: { publicacion: { id: number } }) => m.publicacion.id)).toEqual([popular.id, otra.id]);
    expect(r.mejores_publicaciones[0]).toMatchObject({ impresiones: 2, alcance: 2, interacciones: 3, tasa_interaccion: 150 });
    expect(r.mejores_horas).toHaveLength(24);
    expect(r.mejores_dias).toHaveLength(7);
    expect(r.mejores_horas.reduce((t: number, h: { actividad: number }) => t + h.actividad, 0)).toBe(8); // 4 impresiones + 4 interacciones
    expect(r.audiencia.total_seguidores).toBe(2);
    expect(r.audiencia.ubicaciones).toEqual([{ nombre: 'Culiacán', total: 2, porcentaje: 100 }]);
    expect(r.audiencia.carreras).toEqual([{ nombre: 'Agronomía', total: 1, porcentaje: 50 }]);

    // Beto solo ve lo suyo (nada)
    const deBeto = (await api().get('/api/estadisticas/resumen').set(bearer(beto))).body.data;
    expect(deBeto.rango.dias).toBe(28);
    expect(deBeto.totales.impresiones).toBe(0);
    expect((await api().get('/api/estadisticas/resumen?dias=10').set(bearer(ana))).status).toBe(400);
    expect((await api().get('/api/estadisticas/resumen')).status).toBe(401);
  });

  it('detalle de una publicación: solo su autor; interacciones por tipo y audiencia seguidores / no seguidores', async () => {
    const [ana, beto, caro] = [await crearUsuario('ana'), await crearUsuario('beto'), await crearUsuario('caro')];
    const p = await publicar(ana, 'Detalle');
    await api().post('/api/seguidores/seguir').set(bearer(beto)).send({ seguido_id: ana.id });
    await impresiones(beto, [p.id]);
    await impresiones(caro, [p.id]);
    await Like.create({ publicacion_id: p.id, usuario_id: beto.id, tipo: 'jaja' });
    await Like.create({ publicacion_id: p.id, usuario_id: caro.id, tipo: 'jaja' });

    expect((await api().get(`/api/estadisticas/publicaciones/${p.id}`).set(bearer(beto))).status).toBe(403);
    expect((await api().get('/api/estadisticas/publicaciones/9999').set(bearer(ana))).status).toBe(404);
    const res = await api().get(`/api/estadisticas/publicaciones/${p.id}`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.data.totales).toMatchObject({ impresiones: 2, alcance: 2, interacciones: 2, reacciones: 2, tasa_interaccion: 100 });
    expect(res.body.data.reacciones_por_tipo).toEqual([{ tipo: 'jaja', total: 2 }]);
    expect(res.body.data.audiencia).toEqual({ seguidores: 1, no_seguidores: 1 });
    expect(res.body.data.por_dia.at(-1)).toMatchObject({ fecha: hoy(), impresiones: 2, interacciones: 2 });
    expect(res.body.data.publicacion).toMatchObject({ id: p.id, contenido: 'Detalle', miniatura_url: null });
  });

  it('limpia los eventos crudos viejos y conserva los totales diarios', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const p = await publicar(ana);
    await impresiones(beto, [p.id]);
    await envejecer(201 * 24 * 60);
    expect(await estadisticaService.limpiarEventosAntiguos()).toBe(1);
    expect(await EventoEstadistica.count()).toBe(0);
    expect(await diaria(p.id)).toMatchObject({ impresiones: 1 });

    vi.useFakeTimers();
    const limpiar = vi.spyOn(estadisticaService, 'limpiarEventosAntiguos').mockResolvedValue(0);
    const temporizador = programarLimpiezaEstadisticas();
    vi.advanceTimersByTime(24 * 3_600_000);
    expect(limpiar).toHaveBeenCalledTimes(1);
    clearInterval(temporizador);
  });
});

describe('estadísticas: agregados', () => {
  it('rango de días y lista de días', () => {
    const ahora = new Date(2026, 9, 16, 15, 30);
    const { desde, hasta } = rangoDeDias(7, ahora);
    expect(desde).toEqual(new Date(2026, 9, 10));
    expect(hasta).toEqual(new Date(2026, 9, 16, 23, 59, 59, 999));
    expect(diasEntre(desde, hasta)).toEqual(['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16']);
    expect(diasEntre(new Date(2026, 1, 27), new Date(2026, 2, 1, 10))).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
  });

  it('hora y día en la zona del navegador; actividad por horario', () => {
    const momento = new Date(Date.UTC(2026, 9, 16, 3, 0)); // viernes 03:00 UTC
    expect(horaYDia(momento, 360)).toEqual({ hora: 21, dia: 4 }); // jueves 21:00 en México
    expect(horaYDia(momento, -60)).toEqual({ hora: 4, dia: 5 });
    const { horas, dias } = actividadPorHorario([momento, momento, new Date(Date.UTC(2026, 9, 16, 18))], 0);
    expect(horas[3].actividad).toBe(2);
    expect(horas[18].actividad).toBe(1);
    expect(dias[5].actividad).toBe(3);
  });

  it('más repetidos sin distinguir mayúsculas ni espacios, con porcentaje; tasa de interacción', () => {
    expect(masRepetidos(['CDMX', 'cdmx ', null, '', 'Mazatlán'], 4, 5)).toEqual([
      { nombre: 'CDMX', total: 2, porcentaje: 50 },
      { nombre: 'Mazatlán', total: 1, porcentaje: 25 },
    ]);
    expect(masRepetidos(['a', 'b', 'c'], 3, 2)).toHaveLength(2);
    expect(tasaInteraccion(1, 3)).toBe(33.3);
    expect(tasaInteraccion(5, 0)).toBe(0);
  });
});
