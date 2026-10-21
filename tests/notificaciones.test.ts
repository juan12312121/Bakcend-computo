import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { Router } from 'express';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { crearApp } from '../src/app';
import { Notificacion, Usuario } from '../src/infrastructure/database/models';
import { sseHub } from '../src/infrastructure/realtime/SseHub';
import { notificacionRoutes } from '../src/modules/notificaciones/notificacion.routes';
import { notificacionService } from '../src/modules/notificaciones/notificacion.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos, type UsuarioPrueba } from './helpers';

beforeAll(() => usarModulos({ '/notificaciones': notificacionRoutes }));
beforeEach(reiniciarBD);

const avisar = (para: UsuarioPrueba, de: UsuarioPrueba) =>
  notificacionService.notificar({ usuario_id: para.id, de_usuario_id: de.id, tipo: 'follow', mensaje: 'comenzó a seguirte' });

async function loginAdmin(nombre: string): Promise<UsuarioPrueba> {
  const u = await crearUsuario(nombre);
  await Usuario.update({ rol: 'admin' }, { where: { id: u.id } });
  const res = await api().post('/api/auth/login').send({ email: nombre, contrasena: 'secreto123' });
  return { ...u, token: res.body.data.token };
}

describe('notificaciones', () => {
  it('lista paginado solo las mías, con el emisor', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await avisar(ana, beto);
    await avisar(ana, beto);
    await avisar(beto, ana);

    const res = await api().get('/api/notificaciones?limit=1').set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.meta).toEqual({ total: 2, limit: 1, offset: 0, hayMas: true });
    expect(res.body.data[0]).toMatchObject({ usuario_id: ana.id, tipo: 'follow', leida: false, emisor: { id: beto.id, nombre_usuario: 'beto' } });
    expect(res.body.data[0].emisor.email).toBeUndefined();
  });

  it('contador, leer una, no-leídas y leer-todas', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const primera = await avisar(ana, beto);
    await avisar(ana, beto);
    await avisar(ana, beto);

    expect((await api().get('/api/notificaciones/contador').set(bearer(ana))).body.data).toEqual({ total: 3 });

    const leida = await api().put(`/api/notificaciones/${primera!.id}/leer`).set(bearer(ana));
    expect(leida.status).toBe(200);
    expect(leida.body.data.leida).toBe(true);

    const pendientes = await api().get('/api/notificaciones/no-leidas').set(bearer(ana));
    expect(pendientes.body.meta.total).toBe(2);

    const todas = await api().put('/api/notificaciones/leer-todas').set(bearer(ana));
    expect(todas.body.data).toEqual({ actualizadas: 2 });
    expect((await api().get('/api/notificaciones/contador').set(bearer(ana))).body.data).toEqual({ total: 0 });
  });

  it('marcar o borrar una ajena → 404; borrar la mía → 200', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const deAna = await avisar(ana, beto);

    expect((await api().put(`/api/notificaciones/${deAna!.id}/leer`).set(bearer(beto))).status).toBe(404);
    expect((await api().delete(`/api/notificaciones/${deAna!.id}`).set(bearer(beto))).status).toBe(404);
    expect(await Notificacion.count()).toBe(1);

    const borrar = await api().delete(`/api/notificaciones/${deAna!.id}`).set(bearer(ana));
    expect(borrar.status).toBe(200);
    expect(await Notificacion.count()).toBe(0);

    expect((await api().delete('/api/notificaciones/abc').set(bearer(ana))).status).toBe(400);
  });

  it('limpiar-antiguas borra solo mis leídas viejas (no choca con DELETE /:id)', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const vieja = await avisar(ana, beto);
    const viejaSinLeer = await avisar(ana, beto);
    const deBeto = await avisar(beto, ana);
    await avisar(ana, beto); // reciente
    const hace40 = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await Notificacion.update({ leida: true }, { where: { id: [vieja!.id, deBeto!.id] } });
    await Notificacion.update({ fecha_creacion: hace40 }, { where: { id: [vieja!.id, viejaSinLeer!.id, deBeto!.id] } });

    const res = await api().delete('/api/notificaciones/limpiar-antiguas').set(bearer(ana));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ eliminadas: 1 });
    expect(await Notificacion.count()).toBe(3);

    expect((await api().delete('/api/notificaciones/limpiar-antiguas?dias=0').set(bearer(ana))).status).toBe(400);
  });

  it('sse/stats solo para admin', async () => {
    const ana = await crearUsuario('ana');
    expect((await api().get('/api/notificaciones/sse/stats').set(bearer(ana))).status).toBe(403);

    const admin = await loginAdmin('root');
    const res = await api().get('/api/notificaciones/sse/stats').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ usuariosConectados: 0, conexionesTotales: 0 });
  });
});

describe('notificaciones: stream SSE', () => {
  it('sin token → 401; token de otro usuario → 403', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');

    const sinToken = await api().get(`/api/notificaciones/stream/${ana.id}`);
    expect(sinToken.status).toBe(401);

    const ajeno = await api().get(`/api/notificaciones/stream/${ana.id}?token=${beto.token}`);
    expect(ajeno.status).toBe(403);

    const invalido = await api().get(`/api/notificaciones/stream/${ana.id}?token=basura`);
    expect(invalido.status).toBe(401);
  });

  it('conecta, recibe eventos y se limpia al cerrar', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');

    const rutas = Router();
    rutas.use('/notificaciones', notificacionRoutes);
    const server = crearApp(rutas).listen(0);
    const { port } = server.address() as AddressInfo;

    try {
      const recibido = await new Promise<string>((resolve, reject) => {
        const req = http.get(`http://127.0.0.1:${port}/api/notificaciones/stream/${ana.id}?token=${ana.token}`, (res) => {
          expect(res.statusCode).toBe(200);
          expect(res.headers['content-type']).toContain('text/event-stream');
          let texto = '';
          let avisado = false;
          res.on('data', async (chunk: Buffer) => {
            texto += chunk.toString();
            if (texto.includes('event: conectado') && !avisado) {
              avisado = true;
              expect(sseHub.estadisticas().conexionesTotales).toBe(1);
              await avisar(ana, beto);
            }
            if (texto.includes('actualizar_contador')) {
              req.destroy();
              resolve(texto);
            }
          });
        });
        req.on('error', (e) => (e.message.includes('aborted') || e.message.includes('socket hang up') ? undefined : reject(e)));
      });

      expect(recibido).toContain('event: nueva_notificacion');
      expect(recibido).toContain('"total":1');

      // El servidor detecta el cierre y libera la conexión
      for (let i = 0; i < 50 && sseHub.estadisticas().conexionesTotales > 0; i++) await new Promise((r) => setTimeout(r, 20));
      expect(sseHub.estadisticas()).toEqual({ usuariosConectados: 0, conexionesTotales: 0 });
    } finally {
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
    }
  });
});
