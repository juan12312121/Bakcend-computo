import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Publicacion, PublicacionNoInteresa, PublicacionOculta, Reporte, Usuario } from '../src/infrastructure/database/models';
import { reporteRoutes } from '../src/modules/reportes/reporte.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/reportes': reporteRoutes }));
beforeEach(reiniciarBD);

const publicar = (autor: UsuarioPrueba, extra: Partial<{ categoria: 'Deportes'; visibilidad: 'privado'; oculto: boolean }> = {}) =>
  Publicacion.create({ usuario_id: autor.id, contenido: `Hola de ${autor.nombre_usuario}`, ...extra });

async function loginAdmin(nombre: string): Promise<UsuarioPrueba> {
  const u = await crearUsuario(nombre);
  await Usuario.update({ rol: 'admin' }, { where: { id: u.id } });
  const res = await api().post('/api/auth/login').send({ email: nombre, contrasena: 'secreto123' });
  return { ...u, token: res.body.data.token };
}

const reportar = (u: UsuarioPrueba, publicacion_id: number, motivo = 'Spam o publicidad') =>
  api().post('/api/reportes/crear').set(bearer(u)).send({ publicacion_id, motivo });

describe('reportes', () => {
  it('crea un reporte y rechaza el duplicado con 409', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const pub = await publicar(ana);

    const res = await reportar(beto, pub.id);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ total_reportes: 1, publicacion_oculta: false, reporte: { motivo: 'Spam o publicidad' } });

    const dup = await reportar(beto, pub.id, 'Otro');
    expect(dup.status).toBe(409);
    expect(await Reporte.count()).toBe(1);
  });

  it('acepta publicacionId (alias del frontend anterior)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const pub = await publicar(ana);
    const res = await api().post('/api/reportes/crear').set(bearer(beto)).send({ publicacionId: pub.id, motivo: 'Otro', descripcion: 'x' });
    expect(res.status).toBe(201);
  });

  it('validaciones: motivo inválido, sin publicación, la propia, invisible', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const pub = await publicar(ana);
    const privada = await publicar(ana, { visibilidad: 'privado' });

    const motivo = await reportar(beto, pub.id, 'Me cae mal');
    expect(motivo.status).toBe(400);
    expect(motivo.body.errores[0].campo).toBe('motivo');

    const sinPub = await api().post('/api/reportes/crear').set(bearer(beto)).send({ motivo: 'Otro' });
    expect(sinPub.status).toBe(400);
    expect(sinPub.body.errores[0].campo).toBe('publicacion_id');

    expect((await reportar(ana, pub.id)).status).toBe(400);
    expect((await reportar(beto, privada.id)).status).toBe(404);
    expect((await reportar(beto, 9999)).status).toBe(404);
  });

  it('con 5 reportes la publicación se oculta; 3 ocultadas suspenden al autor', async () => {
    const autor = await crearUsuario('autor');
    const denunciantes = await Promise.all(['den1', 'den2', 'den3', 'den4', 'den5'].map((n) => crearUsuario(n)));
    const pubs = await Promise.all([publicar(autor), publicar(autor), publicar(autor)]);

    for (const [i, pub] of pubs.entries()) {
      let ultimo;
      for (const d of denunciantes) ultimo = await reportar(d, pub.id);
      expect(ultimo!.body.data).toMatchObject({ total_reportes: 5, publicacion_oculta: true });
      expect((await Publicacion.findByPk(pub.id))!.oculto).toBe(true);
      expect((await Usuario.findByPk(autor.id))!.suspendido).toBe(i === 2);
    }
  });

  it('consultas de reportes solo para admin', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');
    const pub1 = await publicar(ana);
    const pub2 = await publicar(ana);
    await reportar(beto, pub1.id, 'Spam o publicidad');
    await reportar(carla, pub1.id, 'Otro');
    await reportar(beto, pub2.id);

    for (const ruta of [`/publicacion/${pub1.id}`, '/todos', '/estadisticas']) {
      expect((await api().get(`/api/reportes${ruta}`).set(bearer(beto))).status, ruta).toBe(403);
    }

    const admin = await loginAdmin('root');
    const dePub = await api().get(`/api/reportes/publicacion/${pub1.id}`).set(bearer(admin));
    expect(dePub.body.data).toHaveLength(2);
    expect(dePub.body.data[0].usuario.nombre_usuario).toBeDefined();

    const todos = await api().get('/api/reportes/todos').set(bearer(admin));
    expect(todos.body.meta.total).toBe(2);
    expect(todos.body.data[0]).toMatchObject({ id: pub1.id, total_reportes: 2, autor: { id: ana.id } });
    expect(todos.body.data[0].motivos.sort()).toEqual(['Otro', 'Spam o publicidad']);

    const stats = await api().get('/api/reportes/estadisticas').set(bearer(admin));
    expect(stats.body.data).toEqual([
      expect.objectContaining({
        usuario: expect.objectContaining({ id: ana.id, suspendido: false }),
        publicaciones_reportadas: 2,
        reportes_recibidos: 3,
        publicaciones_ocultadas: 0,
      }),
    ]);
  });
});

describe('publicaciones ocultas', () => {
  it('ocultar / listar / mostrar (idempotente)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const pub = await publicar(ana);

    expect((await api().post('/api/reportes/ocultar').set(bearer(beto)).send({ publicacion_id: pub.id })).status).toBe(200);
    expect((await api().post('/api/reportes/ocultar').set(bearer(beto)).send({ publicacionId: pub.id })).status).toBe(200);
    expect(await PublicacionOculta.count()).toBe(1);

    const lista = await api().get('/api/reportes/ocultas').set(bearer(beto));
    expect(lista.body.meta.total).toBe(1);
    expect(lista.body.data[0]).toMatchObject({ id: pub.id, autor: { id: ana.id } });
    expect(lista.body.data[0].fecha_marcada).toBeDefined();

    expect((await api().post('/api/reportes/mostrar').set(bearer(beto)).send({ publicacion_id: pub.id })).status).toBe(200);
    expect(await PublicacionOculta.count()).toBe(0);

    expect((await api().post('/api/reportes/ocultar').set(bearer(beto)).send({})).status).toBe(400);
    expect((await api().post('/api/reportes/ocultar').set(bearer(beto)).send({ publicacion_id: 9999 })).status).toBe(404);
  });

  it('ocultar-propias / propias-ocultas / mostrar-propias respeta la moderación', async () => {
    const ana = await crearUsuario('ana');
    const otro = await crearUsuario('otro');
    const [p1, p2] = await Promise.all([publicar(ana), publicar(ana)]);
    const ajena = await publicar(otro);

    const ocultar = await api().post('/api/reportes/ocultar-propias').set(bearer(ana));
    expect(ocultar.body.data).toEqual({ cantidad: 2 });
    expect((await Publicacion.findByPk(ajena.id))!.oculto).toBe(false);

    const lista = await api().get('/api/reportes/propias-ocultas').set(bearer(ana));
    expect(lista.body.meta.total).toBe(2);

    // p2 la ocultó la moderación (5 reportes): mostrar-propias no la destapa
    const denunciantes = await Promise.all(['den1', 'den2', 'den3', 'den4', 'den5'].map((n) => crearUsuario(n)));
    await Reporte.bulkCreate(denunciantes.map((d) => ({ publicacion_id: p2.id, usuario_id: d.id, motivo: 'Otro' as const })));

    const mostrar = await api().post('/api/reportes/mostrar-propias').set(bearer(ana));
    expect(mostrar.body.data).toEqual({ cantidad: 1 });
    expect((await Publicacion.findByPk(p1.id))!.oculto).toBe(false);
    expect((await Publicacion.findByPk(p2.id))!.oculto).toBe(true);
  });
});

describe('no me interesa', () => {
  it('marca con la categoría, lista, desmarca y limpia', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const [p1, p2] = await Promise.all([publicar(ana, { categoria: 'Deportes' }), publicar(ana)]);

    const marca = await api().post('/api/reportes/no-interesa').set(bearer(beto)).send({ publicacion_id: p1.id });
    expect(marca.status).toBe(201);
    expect(marca.body.data).toMatchObject({ publicacion_id: p1.id, usuario_id: beto.id, categoria: 'Deportes' });

    const otraVez = await api().post('/api/reportes/no-interesa').set(bearer(beto)).send({ publicacion_id: p1.id });
    expect(otraVez.body.data.id).toBe(marca.body.data.id);
    await api().post('/api/reportes/no-interesa').set(bearer(beto)).send({ publicacion_id: p2.id });

    const lista = await api().get('/api/reportes/no-interesan?limit=1').set(bearer(beto));
    expect(lista.body.meta).toEqual({ total: 2, limit: 1, offset: 0, hayMas: true });

    await api().post('/api/reportes/si-interesa').set(bearer(beto)).send({ publicacion_id: p1.id });
    expect(await PublicacionNoInteresa.count()).toBe(1);

    const limpiar = await api().delete('/api/reportes/limpiar-no-interesa').set(bearer(beto));
    expect(limpiar.body.data).toEqual({ cantidad: 1 });
    expect(await PublicacionNoInteresa.count()).toBe(0);
  });

  it('valida el id y exige sesión', async () => {
    const beto = await crearUsuario('beto');
    expect((await api().post('/api/reportes/no-interesa').set(bearer(beto)).send({ publicacion_id: 'x' })).status).toBe(400);
    expect((await api().get('/api/reportes/no-interesan')).status).toBe(401);
  });
});
