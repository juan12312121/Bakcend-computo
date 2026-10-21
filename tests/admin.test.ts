import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { LogSeguridad, Publicacion, Reporte, Usuario } from '../src/infrastructure/database/models';
import { adminRoutes } from '../src/modules/admin/admin.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/admin': adminRoutes }));
beforeEach(reiniciarBD);

/** Crea un usuario, le da rol admin con el modelo y vuelve a iniciar sesión para que el token traiga el rol. */
async function crearAdmin(nombre = 'root'): Promise<UsuarioPrueba> {
  const u = await crearUsuario(nombre);
  await Usuario.update({ rol: 'admin' }, { where: { id: u.id } });
  const res = await api().post('/api/auth/login').send({ email: nombre, contrasena: 'secreto123' });
  return { ...u, token: res.body.data.token };
}

describe('admin: acceso', () => {
  it('sin token 401 y con usuario normal 403', async () => {
    const normal = await crearUsuario('normal');
    expect((await api().get('/api/admin/logs')).status).toBe(401);
    for (const peticion of [
      api().get('/api/admin/reportes').set(bearer(normal)),
      api().get('/api/admin/logs').set(bearer(normal)),
      api().patch(`/api/admin/usuarios/${normal.id}/suspender`).set(bearer(normal)),
      api().delete('/api/admin/publicaciones/1').set(bearer(normal)),
    ]) {
      expect((await peticion).status).toBe(403);
    }
  });
});

describe('admin: suspensión', () => {
  it('suspende y reactiva, registrando en la bitácora', async () => {
    const admin = await crearAdmin();
    const beto = await crearUsuario('beto');

    const s = await api().patch(`/api/admin/usuarios/${beto.id}/suspender`).set(bearer(admin)).send({ motivo: 'Spam' });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ mensaje: 'Usuario suspendido exitosamente', data: { id: beto.id, suspendido: true } });
    expect((await Usuario.findByPk(beto.id))?.suspendido).toBe(true);

    // Un suspendido ya no puede iniciar sesión.
    expect((await api().post('/api/auth/login').send({ email: 'beto', contrasena: 'secreto123' })).status).toBe(403);

    const r = await api().patch(`/api/admin/usuarios/${beto.id}/suspender`).set(bearer(admin));
    expect(r.body.data.suspendido).toBe(false);

    const logs = await api().get('/api/admin/logs?evento=ADMIN_SUSPEND_USER').set(bearer(admin));
    expect(logs.status).toBe(200);
    expect(logs.body.meta.total).toBe(1);
    expect(logs.body.data[0]).toMatchObject({ usuario_id: admin.id, evento: 'ADMIN_SUSPEND_USER', usuario: { id: admin.id } });
    expect(JSON.parse(logs.body.data[0].detalles)).toEqual({ targetUserId: beto.id, motivo: 'Spam' });

    const todos = await api().get('/api/admin/logs?limit=50').set(bearer(admin));
    const eventos = todos.body.data.map((l: { evento: string }) => l.evento);
    expect(eventos).toEqual(expect.arrayContaining(['ADMIN_SUSPEND_USER', 'ADMIN_UNSUSPEND_USER', 'login_exitoso']));
  });

  it('un admin no puede suspenderse a sí mismo; usuario inexistente 404; id inválido 400', async () => {
    const admin = await crearAdmin();
    expect((await api().patch(`/api/admin/usuarios/${admin.id}/suspender`).set(bearer(admin))).status).toBe(400);
    expect((await api().patch('/api/admin/usuarios/999/suspender').set(bearer(admin))).status).toBe(404);
    expect((await api().patch('/api/admin/usuarios/abc/suspender').set(bearer(admin))).status).toBe(400);
    expect((await api().get('/api/admin/logs?limit=0').set(bearer(admin))).status).toBe(400);
  });
});

describe('admin: moderación de publicaciones', () => {
  it('lista reportes y borra cualquier publicación descontando el post al autor', async () => {
    const admin = await crearAdmin();
    const autor = await crearUsuario('autor');
    const testigo = await crearUsuario('testigo');
    await Usuario.update({ total_posts: 1 }, { where: { id: autor.id } });
    const pub = await Publicacion.create({ usuario_id: autor.id, contenido: 'Contenido ofensivo' });
    await Reporte.create({ publicacion_id: pub.id, usuario_id: testigo.id, motivo: 'Lenguaje ofensivo' });

    const reportes = await api().get('/api/admin/reportes').set(bearer(admin));
    expect(reportes.status).toBe(200);
    expect(reportes.body.meta.total).toBe(1);
    expect(reportes.body.data[0]).toMatchObject({
      motivo: 'Lenguaje ofensivo',
      usuario: { id: testigo.id },
      publicacion: { id: pub.id, contenido: 'Contenido ofensivo', autor: { id: autor.id } },
    });

    const res = await api().delete(`/api/admin/publicaciones/${pub.id}`).set(bearer(admin)).send({ motivo: 'Ofensivo' });
    expect(res.status).toBe(200);
    expect(await Publicacion.findByPk(pub.id)).toBeNull();
    expect((await Usuario.findByPk(autor.id))?.total_posts).toBe(0);
    expect(await LogSeguridad.count({ where: { evento: 'ADMIN_DELETE_POST' } })).toBe(1);

    expect((await api().delete(`/api/admin/publicaciones/${pub.id}`).set(bearer(admin))).status).toBe(404);
  });
});
