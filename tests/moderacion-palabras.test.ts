import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BadRequestError } from '../src/core/errors';
import { PalabraProhibida, Usuario } from '../src/infrastructure/database/models';
import { FiltroPalabras, normalizar, type ReglaPalabra } from '../src/modules/moderacion/filtro-palabras';
import { moderacionRoutes } from '../src/modules/moderacion/moderacion.routes';
import { asegurarTextoPermitido, moderacionService } from '../src/modules/moderacion/moderacion.service';
import { palabrasService } from '../src/modules/moderacion/palabras.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

const TODOS = ['publicacion', 'comentario', 'mensaje', 'nombre'] as const;
const regla = (id: number, palabra: string, extra: Partial<ReglaPalabra> = {}): ReglaPalabra => ({
  id,
  palabra,
  coincidencia: 'exacta',
  accion: 'censurar',
  aplica_a: TODOS,
  ...extra,
});

describe('FiltroPalabras (sin base de datos)', () => {
  it('exacta respeta los límites de palabra; contiene coincide en cualquier parte', () => {
    const filtro = new FiltroPalabras([regla(1, 'mal'), regla(2, 'feo', { coincidencia: 'contiene' })]);
    expect(filtro.revisar('Qué maleta tan bonita', 'comentario')).toEqual({ permitido: true, texto: 'Qué maleta tan bonita', coincidencias: [] });
    const r = filtro.revisar('Eso está mal, superfeo', 'comentario');
    expect(r.permitido).toBe(true);
    expect(r.texto).toBe('Eso está ***, super***');
    expect(r.coincidencias.map((c) => c.fragmento)).toEqual(['mal', 'feo']);
  });

  it('ignora mayúsculas, acentos y espacios repetidos, y censura conservando el texto original', () => {
    const filtro = new FiltroPalabras([regla(1, 'Tonto'), regla(2, 'cállate ya')]);
    const r = filtro.revisar('¡TÓNTO! callate    YA por favor', 'mensaje');
    expect(r.texto).toBe('¡*****! *******    ** por favor');
    expect(r.coincidencias.map((c) => c.fragmento)).toEqual(['TÓNTO', 'callate    YA']);
  });

  it('bloquear impide el envío; en nombres cualquier coincidencia bloquea; respeta dónde aplica', () => {
    const filtro = new FiltroPalabras([
      regla(1, 'estafa', { accion: 'bloquear', aplica_a: ['publicacion'] }),
      regla(2, 'tonto'),
    ]);
    expect(filtro.revisar('Esto es una estafa', 'publicacion').permitido).toBe(false);
    expect(filtro.revisar('Esto es una estafa', 'mensaje')).toMatchObject({ permitido: true, coincidencias: [] });
    expect(filtro.revisar('tonto', 'comentario').permitido).toBe(true);
    expect(filtro.revisar('Grupo tonto', 'nombre').permitido).toBe(false);
  });

  it('cuenta una coincidencia por regla aunque aparezca varias veces, y soporta emojis', () => {
    const filtro = new FiltroPalabras([regla(1, 'feo')]);
    const r = filtro.revisar('😀 feo y feo 😀', 'comentario');
    expect(r.texto).toBe('😀 *** y *** 😀');
    expect(r.coincidencias).toHaveLength(1);
    expect(normalizar('  Árbol   Ñandú ')).toBe(' arbol nandu ');
  });
});

describe('palabras prohibidas: API y caché', () => {
  let admin: UsuarioPrueba;

  beforeAll(() => usarModulos({ '/moderacion': moderacionRoutes }));
  beforeEach(async () => {
    await reiniciarBD();
    palabrasService.invalidar();
    const u = await crearUsuario('root');
    await Usuario.update({ rol: 'admin' }, { where: { id: u.id } });
    const res = await api().post('/api/auth/login').send({ email: 'root', contrasena: 'secreto123' });
    admin = { ...u, token: res.body.data.token };
  });

  const crear = (body: object) => api().post('/api/moderacion/palabras').set(bearer(admin)).send(body);

  it('CRUD con duplicados (sin acentos ni mayúsculas) y filtros', async () => {
    const r = await crear({ palabra: ' Estafa ', accion: 'bloquear', aplica_a: ['publicacion', 'mensaje', 'mensaje'] });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ palabra: 'Estafa', coincidencia: 'exacta', accion: 'bloquear', aplica_a: ['publicacion', 'mensaje'], activa: true, creado_por: admin.id });
    expect((await crear({ palabra: 'ESTAFÁ' })).status).toBe(409);
    expect((await crear({ palabra: '' })).status).toBe(400);
    expect((await crear({ palabra: 'x', aplica_a: [] })).status).toBe(400);
    await crear({ palabra: 'tonto' });

    const lista = await api().get('/api/moderacion/palabras').set(bearer(admin));
    expect(lista.body.data.map((p: { palabra: string }) => p.palabra)).toEqual(['Estafa', 'tonto']);
    expect(lista.body.data[1].aplica_a).toEqual(TODOS);
    const filtrada = await api().get('/api/moderacion/palabras?accion=bloquear').set(bearer(admin));
    expect(filtrada.body.meta.total).toBe(1);

    const id = r.body.data.id;
    const editada = await api().patch(`/api/moderacion/palabras/${id}`).set(bearer(admin)).send({ coincidencia: 'contiene', activa: false });
    expect(editada.body.data).toMatchObject({ coincidencia: 'contiene', activa: false });
    expect((await api().patch(`/api/moderacion/palabras/${id}`).set(bearer(admin)).send({})).status).toBe(400);
    expect((await api().get('/api/moderacion/palabras?activa=false').set(bearer(admin))).body.meta.total).toBe(1);

    expect((await api().delete(`/api/moderacion/palabras/${id}`).set(bearer(admin))).status).toBe(200);
    expect((await api().delete(`/api/moderacion/palabras/${id}`).set(bearer(admin))).status).toBe(404);
    expect(await PalabraProhibida.count()).toBe(1);
  });

  it('probar un texto desde el panel', async () => {
    await crear({ palabra: 'tonto' });
    await crear({ palabra: 'estafa', accion: 'bloquear', coincidencia: 'contiene' });
    const res = await api().post('/api/moderacion/palabras/probar').set(bearer(admin)).send({ texto: 'Eres tonto, megaestafa', contexto: 'comentario' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ permitido: false, texto: 'Eres *****, mega******' });
    expect(res.body.data.coincidencias.map((c: { palabra: string }) => c.palabra)).toEqual(['tonto', 'estafa']);
  });

  it('revisarTexto usa caché en memoria y se refresca al cambiar la lista', async () => {
    expect((await moderacionService.revisarTexto('hola tonto', 'comentario')).texto).toBe('hola tonto');
    // Insertar directo en la base no se nota hasta invalidar (la caché vale unos minutos).
    await PalabraProhibida.create({ palabra: 'hola', aplica_a: [...TODOS] });
    expect((await moderacionService.revisarTexto('hola tonto', 'comentario')).texto).toBe('hola tonto');
    // Un cambio por la API sí refresca la caché al instante.
    await crear({ palabra: 'tonto' });
    expect((await moderacionService.revisarTexto('hola tonto', 'comentario')).texto).toBe('**** *****');
  });

  it('asegurarTextoPermitido devuelve el texto censurado o lanza BadRequestError con mensaje claro', async () => {
    await crear({ palabra: 'tonto' });
    await crear({ palabra: 'estafa', accion: 'bloquear' });
    await expect(asegurarTextoPermitido('qué tonto', 'comentario')).resolves.toBe('qué *****');
    await expect(asegurarTextoPermitido(null, 'comentario')).resolves.toBeNull();
    await expect(asegurarTextoPermitido('Es una Estafa', 'mensaje')).rejects.toThrow(BadRequestError);
    await expect(asegurarTextoPermitido('Es una Estafa', 'mensaje')).rejects.toThrow('El mensaje contiene palabras no permitidas («Estafa»)');
    await expect(asegurarTextoPermitido('Club tonto', 'nombre')).rejects.toThrow('El nombre contiene palabras no permitidas');
  });
});
