import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Bloqueo, Historia, Publicacion, Seguidor, Usuario } from '../src/infrastructure/database/models';
import { chatRoutes } from '../src/modules/chat/chat.routes';
import { historiaRoutes } from '../src/modules/historias/historia.routes';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

/**
 * Cruces de privacidad con el resto de módulos: bloqueos, cuentas privadas y solicitudes pendientes
 * en el feed, el detalle, el perfil, el chat y las historias.
 */
beforeAll(() => usarModulos({ '/publicaciones': publicacionRoutes, '/chat': chatRoutes, '/historias': historiaRoutes }));
beforeEach(reiniciarBD);

const publicar = (autor: UsuarioPrueba, contenido: string, visibilidad: 'publico' | 'seguidores' = 'publico') =>
  Publicacion.create({ usuario_id: autor.id, contenido, visibilidad });

const contenidosDelFeed = async (quien?: UsuarioPrueba): Promise<string[]> => {
  const peticion = api().get('/api/publicaciones?limit=50');
  const res = quien ? await peticion.set(bearer(quien)) : await peticion;
  return res.body.data.map((p: { contenido: string }) => p.contenido);
};

describe('privacidad en publicaciones', () => {
  it('una cuenta privada solo la ven sus seguidores aceptados (no los pendientes ni sin sesión)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    await Usuario.update({ cuenta_privada: true }, { where: { id: ana.id } });
    const publicacion = await publicar(ana, 'privada de ana');
    await Seguidor.create({ seguidor_id: beto.id, siguiendo_id: ana.id, estado: 'aceptado' });
    await Seguidor.create({ seguidor_id: caro.id, siguiendo_id: ana.id, estado: 'pendiente' });

    expect(await contenidosDelFeed(beto)).toContain('privada de ana');
    expect(await contenidosDelFeed(caro)).not.toContain('privada de ana');
    expect(await contenidosDelFeed()).not.toContain('privada de ana');
    expect(await contenidosDelFeed(ana)).toContain('privada de ana');

    expect((await api().get(`/api/publicaciones/${publicacion.id}`).set(bearer(beto))).status).toBe(200);
    expect((await api().get(`/api/publicaciones/${publicacion.id}`).set(bearer(caro))).status).toBe(404);
  });

  it('"solo seguidores" no se le muestra a quien solo tiene la solicitud pendiente', async () => {
    const ana = await crearUsuario('ana');
    const caro = await crearUsuario('caro');
    await publicar(ana, 'para seguidores', 'seguidores');
    await Seguidor.create({ seguidor_id: caro.id, siguiendo_id: ana.id, estado: 'pendiente' });
    expect(await contenidosDelFeed(caro)).not.toContain('para seguidores');

    await Seguidor.update({ estado: 'aceptado' }, { where: { seguidor_id: caro.id } });
    expect(await contenidosDelFeed(caro)).toContain('para seguidores');
  });

  it('con un bloqueo, ninguno ve las publicaciones del otro (en los dos sentidos)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const caro = await crearUsuario('caro');
    const deAna = await publicar(ana, 'de ana');
    await publicar(beto, 'de beto');
    await Bloqueo.create({ bloqueador_id: ana.id, bloqueado_id: beto.id });

    expect(await contenidosDelFeed(beto)).not.toContain('de ana');
    expect(await contenidosDelFeed(ana)).not.toContain('de beto');
    expect(await contenidosDelFeed(caro)).toEqual(expect.arrayContaining(['de ana', 'de beto']));
    expect((await api().get(`/api/publicaciones/${deAna.id}`).set(bearer(beto))).status).toBe(404);
  });
});

describe('privacidad en el chat', () => {
  it('con un bloqueo no se puede abrir el chat ni escribir en uno que ya existía', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const chat = await api().post('/api/chat/iniciar').set(bearer(ana)).send({ receptorId: beto.id });
    expect(chat.status).toBe(201);

    await Bloqueo.create({ bloqueador_id: beto.id, bloqueado_id: ana.id });
    expect((await api().post('/api/chat/iniciar').set(bearer(ana)).send({ receptorId: beto.id })).status).toBe(403);
    const mensaje = await api().post('/api/chat/enviar').set(bearer(ana)).send({ chatId: chat.body.data.id, texto: 'hola' });
    expect(mensaje.status).toBe(403);
  });

  it('una solicitud de seguimiento pendiente no cuenta como "se siguen"', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await Seguidor.create({ seguidor_id: ana.id, siguiendo_id: beto.id, estado: 'aceptado' });
    await Seguidor.create({ seguidor_id: beto.id, siguiendo_id: ana.id, estado: 'pendiente' });
    const chat = await api().post('/api/chat/iniciar').set(bearer(ana)).send({ receptorId: beto.id });
    expect(chat.body.data.estado).toBe('pending');
  });
});

describe('privacidad en historias', () => {
  it('las historias solo las ven los seguidores aceptados', async () => {
    const ana = await crearUsuario('ana');
    const caro = await crearUsuario('caro');
    await Historia.create({ usuario_id: ana.id, tipo: 'texto', texto: 'hola', fondo: 'naranja', expira_en: new Date(Date.now() + 3_600_000) });
    await Seguidor.create({ seguidor_id: caro.id, siguiendo_id: ana.id, estado: 'pendiente' });

    const bandeja = await api().get('/api/historias').set(bearer(caro));
    expect(bandeja.body.data.map((g: { usuario: { id: number } }) => g.usuario.id)).not.toContain(ana.id);
    expect((await api().get(`/api/historias/usuario/${ana.id}`).set(bearer(caro))).status).toBe(403);

    await Seguidor.update({ estado: 'aceptado' }, { where: { seguidor_id: caro.id } });
    expect((await api().get(`/api/historias/usuario/${ana.id}`).set(bearer(caro))).status).toBe(200);
  });
});
