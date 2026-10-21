import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notificacion, Seguidor, Usuario } from '../src/infrastructure/database/models';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { mencionRoutes } from '../src/modules/menciones/mencion.routes';
import { extraerMenciones, mencionService } from '../src/modules/menciones/mencion.service';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/publicaciones': publicacionRoutes, '/menciones': mencionRoutes }));
beforeEach(async () => {
  await reiniciarBD();
  vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

async function publicar(u: UsuarioPrueba, contenido: string, extra: Record<string, unknown> = {}) {
  const res = await api().post('/api/publicaciones').set(bearer(u)).send({ contenido, ...extra });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data as { id: number };
}

const menciones = (usuarioId: number) => Notificacion.findAll({ where: { usuario_id: usuarioId, tipo: 'mencion' } });

describe('extraerMenciones', () => {
  it('nombres válidos sin repetir y sin tomar correos', () => {
    expect(extraerMenciones('hola @ana, @beto_2 y @ana otra vez; escribe a x@correo.com o @ab')).toEqual(['ana', 'beto_2']);
    expect(extraerMenciones(null)).toEqual([]);
  });
});

describe('menciones en publicaciones', () => {
  it('al crear notifica una vez a cada mencionado activo (ni al autor ni a inexistentes)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');
    await Usuario.update({ activo: false }, { where: { id: carla.id } });

    const pub = await publicar(ana, 'Hola @beto @beto @ana @carla @nadie');
    const deBeto = await menciones(beto.id);
    expect(deBeto).toHaveLength(1);
    expect(deBeto[0]).toMatchObject({
      de_usuario_id: ana.id,
      publicacion_id: pub.id,
      mensaje: 'te mencionó en una publicación',
      entidad_tipo: 'publicacion',
      entidad_id: pub.id,
    });
    expect(await menciones(ana.id)).toHaveLength(0);
    expect(await menciones(carla.id)).toHaveLength(0);
  });

  it('no notifica a quien no puede ver la publicación', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await publicar(ana, 'solo yo @beto', { visibilidad: 'privado' });
    await publicar(ana, 'seguidores @beto', { visibilidad: 'seguidores' });
    expect(await menciones(beto.id)).toHaveLength(0);

    await Seguidor.create({ seguidor_id: beto.id, siguiendo_id: ana.id });
    await publicar(ana, 'ahora sí @beto', { visibilidad: 'seguidores' });
    expect(await menciones(beto.id)).toHaveLength(1);
  });

  it('al editar solo notifica a los nuevos mencionados', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const carla = await crearUsuario('carla');
    const pub = await publicar(ana, 'Hola @beto');

    await api().put(`/api/publicaciones/${pub.id}`).set(bearer(ana)).send({ contenido: 'Hola @beto y @carla' });
    expect(await menciones(beto.id)).toHaveLength(1);
    expect(await menciones(carla.id)).toHaveLength(1);
  });

  it('mencionService.notificar en un comentario devuelve los ids notificados', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const pub = await publicar(ana, 'post');

    const ids = await mencionService.notificar('gracias @ana y @beto', beto.id, { publicacion_id: pub.id, comentario_id: 77 });
    expect(ids).toEqual([ana.id]);
    expect((await menciones(ana.id))[0]).toMatchObject({ mensaje: 'te mencionó en un comentario', entidad_tipo: 'comentario', entidad_id: 77 });
    expect(await mencionService.notificar('sin menciones', beto.id, { publicacion_id: pub.id })).toEqual([]);
    expect(await mencionService.notificar('@ana', beto.id, { publicacion_id: 9999 })).toEqual([]);
  });
});

describe('API /menciones', () => {
  it('usuario/:nombre resuelve el id (404 si no existe o está inactivo)', async () => {
    const ana = await crearUsuario('ana');
    const res = await api().get('/api/menciones/usuario/ana');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: ana.id, nombre_usuario: 'ana' });
    expect((await api().get('/api/menciones/usuario/%40ana')).body.data.id).toBe(ana.id);
    expect((await api().get('/api/menciones/usuario/nadie')).status).toBe(404);
    expect((await api().get('/api/menciones/usuario/a!')).status).toBe(400);
    await Usuario.update({ activo: false }, { where: { id: ana.id } });
    expect((await api().get('/api/menciones/usuario/ana')).status).toBe(404);
  });

  it('sugerencias: primero a quienes sigo, luego el resto; sin mí; máx 8; datos públicos', async () => {
    const yo = await crearUsuario('yo_mismo');
    const otros: UsuarioPrueba[] = [];
    for (const n of ['maria', 'mario', 'marta', 'mateo', 'matias', 'maxi', 'mia', 'milo', 'mora']) otros.push(await crearUsuario(n));
    await Seguidor.create({ seguidor_id: yo.id, siguiendo_id: otros.find((u) => u.nombre_usuario === 'mora')!.id });

    const res = await api().get('/api/menciones/sugerencias?q=m').set(bearer(yo));
    expect(res.status).toBe(200);
    const nombres = res.body.data.map((u: { nombre_usuario: string }) => u.nombre_usuario);
    expect(nombres).toHaveLength(8);
    expect(nombres[0]).toBe('mora');
    expect(nombres.slice(1)).toEqual(['maria', 'mario', 'marta', 'mateo', 'matias', 'maxi', 'mia']);
    expect(Object.keys(res.body.data[0]).sort()).toEqual(['foto_perfil_url', 'id', 'nombre_completo', 'nombre_usuario']);

    const conArroba = await api().get('/api/menciones/sugerencias?q=%40mar').set(bearer(yo));
    expect(conArroba.body.data.map((u: { nombre_usuario: string }) => u.nombre_usuario)).toEqual(['maria', 'mario', 'marta']);
    const vacio = await api().get('/api/menciones/sugerencias').set(bearer(yo));
    expect(vacio.body.data[0].nombre_usuario).toBe('mora');
    expect(vacio.body.data.map((u: { id: number }) => u.id)).not.toContain(yo.id);

    expect((await api().get('/api/menciones/sugerencias?q=m')).status).toBe(401);
  });
});
