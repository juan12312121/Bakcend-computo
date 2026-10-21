import { beforeEach, describe, expect, it } from 'vitest';
import { api, bearer, crearUsuario, reiniciarBD } from './helpers';

beforeEach(reiniciarBD);

describe('auth', () => {
  it('registra y devuelve token sin exponer la contraseña', async () => {
    const res = await api()
      .post('/api/auth/registro')
      .send({ nombre_usuario: 'ana_1', email: 'ANA@test.com', nombre_completo: 'Ana Pérez', contrasena: 'secreto123' });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ success: true, data: { usuario: { nombre_usuario: 'ana_1', email: 'ana@test.com' } } });
    expect(res.body.data.token).toBeTypeOf('string');
    expect(res.body.data.usuario.contrasena).toBeUndefined();
  });

  it('valida el cuerpo con mensajes por campo', async () => {
    const res = await api().post('/api/auth/registro').send({ nombre_usuario: 'a', email: 'no-es-email' });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    const campos = res.body.errores.map((e: { campo: string }) => e.campo);
    expect(campos).toEqual(expect.arrayContaining(['nombre_usuario', 'email', 'nombre_completo', 'contrasena']));
  });

  it('rechaza email duplicado con 409', async () => {
    await crearUsuario('repetido');
    const res = await api()
      .post('/api/auth/registro')
      .send({ nombre_usuario: 'otro', email: 'repetido@test.com', nombre_completo: 'Otro Usuario', contrasena: 'secreto123' });
    expect(res.status).toBe(409);
    expect(res.body.mensaje).toBe('El email ya está registrado');
  });

  it('inicia sesión con email o con nombre de usuario', async () => {
    await crearUsuario('beto');
    for (const credencial of ['beto@test.com', 'beto', '@beto']) {
      const res = await api().post('/api/auth/login').send({ email: credencial, contrasena: 'secreto123' });
      expect(res.status, credencial).toBe(200);
    }
  });

  it('bloquea la cuenta tras 5 intentos fallidos', async () => {
    await crearUsuario('carla');
    for (let i = 0; i < 5; i++) {
      await api().post('/api/auth/login').send({ email: 'carla', contrasena: 'mala' });
    }
    const res = await api().post('/api/auth/login').send({ email: 'carla', contrasena: 'secreto123' });
    expect(res.status).toBe(429);
  });

  it('exige token en rutas protegidas', async () => {
    const res = await api().get('/api/auth/verificar');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ success: false, mensaje: 'No hay token' });
  });
});

describe('usuarios', () => {
  it('obtiene y actualiza mi perfil', async () => {
    const u = await crearUsuario('dani');
    const res = await api().put('/api/usuarios/me').set(bearer(u)).send({ biografia: 'Hola', carrera: 'Sistemas' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ biografia: 'Hola', carrera: 'Sistemas' });

    const me = await api().get('/api/usuarios/me').set(bearer(u));
    expect(me.body.data.carrera).toBe('Sistemas');
  });

  it('no actualiza si no hay datos', async () => {
    const u = await crearUsuario('eva');
    const res = await api().put('/api/usuarios/me').set(bearer(u)).send({});
    expect(res.status).toBe(400);
  });

  it('busca por nombre y valida el término', async () => {
    const u = await crearUsuario('fer');
    await crearUsuario('fernanda');
    const res = await api().get('/api/usuarios/buscar?q=fer').set(bearer(u));
    expect(res.body.data).toHaveLength(2);

    const corto = await api().get('/api/usuarios/buscar?q=f').set(bearer(u));
    expect(corto.status).toBe(400);
  });

  it('presencia: heartbeat me pone en línea', async () => {
    const u = await crearUsuario('gael');
    await api().post('/api/usuarios/me/heartbeat').set(bearer(u));
    const res = await api().get('/api/usuarios/activos').set(bearer(u));
    expect(res.body.data.map((x: { id: number }) => x.id)).toContain(u.id);
  });

  it('eliminar cuenta la oculta (404 después)', async () => {
    const u = await crearUsuario('hugo');
    const otro = await crearUsuario('ines');
    await api().delete('/api/usuarios/me').set(bearer(u));
    const res = await api().get(`/api/usuarios/${u.id}`).set(bearer(otro));
    expect(res.status).toBe(404);
  });

  it('el perfil ajeno no expone email ni datos de la cuenta; el propio sí', async () => {
    const yo = await crearUsuario('kari');
    const otro = await crearUsuario('leo');

    const ajeno = await api().get(`/api/usuarios/${otro.id}`).set(bearer(yo));
    expect(ajeno.status).toBe(200);
    expect(ajeno.body.data).toMatchObject({ id: otro.id, nombre_usuario: 'leo' });
    for (const campo of ['email', 'rol', 'contrasena', 'activo', 'suspendido']) expect(ajeno.body.data).not.toHaveProperty(campo);

    const propio = await api().get(`/api/usuarios/${yo.id}`).set(bearer(yo));
    expect(propio.body.data.email).toBe('kari@test.com');
  });

  it('valida el id de la ruta', async () => {
    const u = await crearUsuario('juan');
    const res = await api().get('/api/usuarios/abc').set(bearer(u));
    expect(res.status).toBe(400);
  });
});
