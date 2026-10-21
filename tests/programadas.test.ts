import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { GrupoMiembro, Grupo, Notificacion, Publicacion, PublicacionHashtag, Usuario } from '../src/infrastructure/database/models';
import { realtime } from '../src/infrastructure/realtime/RealtimeGateway';
import { fileStorage } from '../src/infrastructure/storage/CloudinaryStorage';
import { guardadoRoutes } from '../src/modules/guardados/guardado.routes';
import { hashtagRoutes } from '../src/modules/hashtags/hashtag.routes';
import { publicacionRoutes } from '../src/modules/publicaciones/publicacion.routes';
import { programarPublicaciones, publicacionService } from '../src/modules/publicaciones/publicacion.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/publicaciones': publicacionRoutes, '/hashtags': hashtagRoutes, '/guardados': guardadoRoutes }));
beforeEach(async () => {
  await reiniciarBD();
  vi.spyOn(fileStorage, 'eliminar').mockResolvedValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const HORA = 3_600_000;
const enHoras = (h: number) => new Date(Date.now() + h * HORA).toISOString();

async function programar(u: UsuarioPrueba, contenido = 'Saldrá luego #lanzamiento', horas = 2) {
  const res = await api().post('/api/publicaciones').set(bearer(u)).send({ contenido, programada_para: enHoras(horas) });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body.data as { id: number; estado: string; programada_para: string };
}

const ids = (body: { data: { id: number }[] }) => body.data.map((p) => p.id);

/** Lleva la fecha de salida al pasado (como si ya hubiera llegado la hora). */
const vencer = (id: number) => Publicacion.update({ programada_para: new Date(Date.now() - 60_000) }, { where: { id } });

describe('programadas: crear y ocultar', () => {
  it('queda programada, sin hashtags ni contador, y no sale en ningún listado ni por id para otros', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const aviso = vi.spyOn(realtime, 'aTodos');
    const p = await programar(ana);

    expect(p.estado).toBe('programada');
    expect(new Date(p.programada_para).getTime()).toBeGreaterThan(Date.now());
    expect(aviso).not.toHaveBeenCalled();
    expect(await PublicacionHashtag.count()).toBe(0);
    expect((await Usuario.findByPk(ana.id))!.total_posts).toBe(0);

    for (const quien of [ana, beto]) {
      expect(ids((await api().get('/api/publicaciones').set(bearer(quien))).body)).toEqual([]);
      expect(ids((await api().get('/api/publicaciones/buscar?q=luego').set(bearer(quien))).body)).toEqual([]);
      expect(ids((await api().get(`/api/publicaciones/usuario/${ana.id}`).set(bearer(quien))).body)).toEqual([]);
      expect(ids((await api().get('/api/publicaciones?orden=populares').set(bearer(quien))).body)).toEqual([]);
    }
    expect(ids((await api().get('/api/publicaciones/mis-publicaciones').set(bearer(ana))).body)).toEqual([]);
    // El tema ni siquiera existe todavía (los hashtags se procesan al publicarse)
    const tema = await api().get('/api/hashtags/lanzamiento/publicaciones').set(bearer(beto));
    expect(tema.body.data ?? []).toEqual([]);

    // Por id: solo el autor
    expect((await api().get(`/api/publicaciones/${p.id}`).set(bearer(beto))).status).toBe(404);
    expect((await api().get(`/api/publicaciones/${p.id}`)).status).toBe(404);
    expect((await api().get(`/api/publicaciones/${p.id}`).set(bearer(ana))).body.data.estado).toBe('programada');
    // Ni se puede guardar
    expect((await api().post(`/api/guardados/${p.id}`).set(bearer(beto))).status).toBe(404);
    expect(await publicacionService.publicas([p.id], beto.id)).toEqual([]);
  });

  it('valida la fecha: futura y hasta 6 meses; borrador sin fecha', async () => {
    const ana = await crearUsuario('ana');
    const pasada = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'x', programada_para: enHoras(-1) });
    expect(pasada.status).toBe(400);
    expect(pasada.body.errores[0].campo).toBe('programada_para');
    const lejana = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'x', programada_para: enHoras(24 * 200) });
    expect(lejana.status).toBe(400);
    const ambas = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'x', borrador: true, programada_para: enHoras(2) });
    expect(ambas.status).toBe(400);

    const borrador = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'idea', borrador: 'true' });
    expect(borrador.status).toBe(201);
    expect(borrador.body.data).toMatchObject({ estado: 'borrador', programada_para: null });
  });
});

describe('programadas: gestionar', () => {
  it('lista mis programadas (la próxima primero) y mis borradores; solo las mías', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const tarde = await programar(ana, 'tarde', 5);
    const pronto = await programar(ana, 'pronto', 1);
    await programar(beto, 'de beto', 1);
    const borrador = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'idea', borrador: true });

    const res = await api().get('/api/publicaciones/programadas').set(bearer(ana));
    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual([pronto.id, tarde.id]);
    const borradores = await api().get('/api/publicaciones/programadas?estado=borrador').set(bearer(ana));
    expect(ids(borradores.body)).toEqual([borrador.body.data.id]);
    expect((await api().get('/api/publicaciones/programadas?estado=publicada').set(bearer(ana))).status).toBe(400);
    expect((await api().get('/api/publicaciones/programadas')).status).toBe(401);
  });

  it('reprogramar, cancelar (pasa a borrador), editar sin anunciar y publicar ya', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const p = await programar(ana);
    const nueva = enHoras(10);

    expect((await api().put(`/api/publicaciones/${p.id}/programacion`).set(bearer(beto)).send({ programada_para: nueva })).status).toBe(403);
    const re = await api().put(`/api/publicaciones/${p.id}/programacion`).set(bearer(ana)).send({ programada_para: nueva });
    expect(re.status).toBe(200);
    expect(re.body.data.programada_para).toBe(nueva);

    const aviso = vi.spyOn(realtime, 'aTodos');
    const editada = await api().put(`/api/publicaciones/${p.id}`).set(bearer(ana)).send({ contenido: 'Texto nuevo #otro' });
    expect(editada.status).toBe(200);
    expect(aviso).not.toHaveBeenCalled();
    expect(await PublicacionHashtag.count()).toBe(0);

    const cancelada = await api().post(`/api/publicaciones/${p.id}/cancelar-programacion`).set(bearer(ana));
    expect(cancelada.body.data).toMatchObject({ estado: 'borrador', programada_para: null });
    expect((await api().post(`/api/publicaciones/${p.id}/cancelar-programacion`).set(bearer(ana))).status).toBe(400);

    const publicada = await api().post(`/api/publicaciones/${p.id}/publicar`).set(bearer(ana));
    expect(publicada.status).toBe(200);
    expect(publicada.body.data.estado).toBe('publicada');
    expect(aviso).toHaveBeenCalledWith('new_post', expect.objectContaining({ id: p.id }));
    expect(await PublicacionHashtag.count()).toBe(1);
    expect((await Usuario.findByPk(ana.id))!.total_posts).toBe(1);
    expect(ids((await api().get('/api/publicaciones').set(bearer(beto))).body)).toEqual([p.id]);
    expect((await api().post(`/api/publicaciones/${p.id}/publicar`).set(bearer(ana))).status).toBe(400);
  });

  it('borrar una programada no descuenta publicaciones del autor ni avisa', async () => {
    const ana = await crearUsuario('ana');
    await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'ya publicada' });
    const p = await programar(ana);
    const aviso = vi.spyOn(realtime, 'aTodos');
    expect((await api().delete(`/api/publicaciones/${p.id}`).set(bearer(ana))).status).toBe(200);
    expect((await Usuario.findByPk(ana.id))!.total_posts).toBe(1);
    expect(aviso).not.toHaveBeenCalled();
  });
});

describe('programadas: publicación automática', () => {
  it('publica las que llegaron a su hora: fecha = ahora, hashtags, menciones, contador, aviso y notificación al autor', async () => {
    const [ana, beto] = [await crearUsuario('ana'), await crearUsuario('beto')];
    const lista = await programar(ana, 'Ya salió #lanzamiento hola @beto', 1);
    const futura = await programar(ana, 'todavía no', 3);
    await vencer(lista.id);
    const aviso = vi.spyOn(realtime, 'aTodos');

    const antes = Date.now();
    expect(await publicacionService.publicarProgramadas()).toBe(1);

    const p = (await Publicacion.findByPk(lista.id))!;
    expect(p.estado).toBe('publicada');
    expect(p.programada_para).toBeNull();
    expect(p.fecha_creacion.getTime()).toBeGreaterThanOrEqual(antes - 1000);
    expect((await Publicacion.findByPk(futura.id))!.estado).toBe('programada');
    expect(await PublicacionHashtag.count({ where: { publicacion_id: lista.id } })).toBe(1);
    expect((await Usuario.findByPk(ana.id))!.total_posts).toBe(1);
    expect(aviso).toHaveBeenCalledWith('new_post', expect.objectContaining({ id: lista.id, estado: 'publicada' }));

    const deAna = await Notificacion.findOne({ where: { usuario_id: ana.id, tipo: 'publicacion_programada' } });
    expect(deAna).toMatchObject({ publicacion_id: lista.id, entidad_tipo: 'publicacion', entidad_id: lista.id });
    expect(await Notificacion.count({ where: { usuario_id: beto.id, tipo: 'mencion' } })).toBe(1);

    // Ya en el feed de los demás y no se vuelve a publicar
    expect(ids((await api().get('/api/publicaciones').set(bearer(beto))).body)).toEqual([lista.id]);
    expect(await publicacionService.publicarProgramadas()).toBe(0);
  });

  it('si el autor ya no es miembro del grupo, queda como borrador', async () => {
    const ana = await crearUsuario('ana');
    const grupo = await Grupo.create({ nombre: 'Club', creador_id: ana.id });
    await GrupoMiembro.create({ grupo_id: grupo.id, usuario_id: ana.id, rol: 'admin', estado: 'activo' });
    const res = await api().post('/api/publicaciones').set(bearer(ana)).send({ contenido: 'al grupo', grupo_id: grupo.id, programada_para: enHoras(1) });
    expect(res.status).toBe(201);
    await GrupoMiembro.destroy({ where: { grupo_id: grupo.id } });
    await vencer(res.body.data.id);

    expect(await publicacionService.publicarProgramadas()).toBe(0);
    expect((await Publicacion.findByPk(res.body.data.id))!.estado).toBe('borrador');
  });

  it('programarPublicaciones revisa cada minuto', () => {
    vi.useFakeTimers();
    const publicar = vi.spyOn(publicacionService, 'publicarProgramadas').mockResolvedValue(0);
    const temporizador = programarPublicaciones();
    vi.advanceTimersByTime(59_000);
    expect(publicar).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(publicar).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(publicar).toHaveBeenCalledTimes(2);
    clearInterval(temporizador);
  });
});
