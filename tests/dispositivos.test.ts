import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dispositivo } from '../src/infrastructure/database/models';
import type { MensajePush, PushService } from '../src/infrastructure/push';
import { ConsolaPushService, crearPushService } from '../src/infrastructure/push';
import { sseHub } from '../src/infrastructure/realtime/SseHub';
import { chatRoutes } from '../src/modules/chat/chat.routes';
import { dispositivoRepository } from '../src/modules/dispositivos/dispositivo.repository';
import { dispositivoRoutes } from '../src/modules/dispositivos/dispositivo.routes';
import { DispositivoService, dispositivoService } from '../src/modules/dispositivos/dispositivo.service';
import { notificacionRepository } from '../src/modules/notificaciones/notificacion.repository';
import { NotificacionService } from '../src/modules/notificaciones/notificacion.service';
import { api, bearer, crearUsuario, reiniciarBD, usarModulos } from './helpers';

beforeAll(() => usarModulos({ '/dispositivos': dispositivoRoutes, '/chat': chatRoutes }));
beforeEach(reiniciarBD);

const TOKEN = 'token-de-prueba-fcm:APA91b_1234567890';
const OTRO_TOKEN = 'otro-token-de-prueba-fcm:APA91b_0987654321';

/** Push falsa: guarda lo que se "envió" y marca como inválidos los tokens indicados. */
function pushFalsa(invalidos: string[] = []) {
  const enviados: { tokens: readonly string[]; mensaje: MensajePush }[] = [];
  const push: PushService = {
    async enviar(tokens, mensaje) {
      enviados.push({ tokens, mensaje });
      return { enviados: tokens.length - invalidos.length, tokensInvalidos: invalidos };
    },
  };
  return { push, enviados };
}

/** Espera a que terminen los envíos que `avisar` dejó corriendo sin esperar. */
const terminarEnvios = () => new Promise((r) => setTimeout(r, 20));

describe('dispositivos (registro de tokens push)', () => {
  it('registra el token del teléfono y no lo duplica al volver a abrir sesión', async () => {
    const ana = await crearUsuario('ana');

    const res = await api().post('/api/dispositivos').set(bearer(ana)).send({ token: TOKEN, plataforma: 'android' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ plataforma: 'android' });

    await api().post('/api/dispositivos').set(bearer(ana)).send({ token: TOKEN });
    expect(await Dispositivo.count()).toBe(1);
  });

  it('si otra cuenta abre sesión en el mismo teléfono, el token pasa a esa cuenta', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await api().post('/api/dispositivos').set(bearer(ana)).send({ token: TOKEN });
    await api().post('/api/dispositivos').set(bearer(beto)).send({ token: TOKEN });

    expect(await dispositivoRepository.tokensDe(ana.id)).toEqual([]);
    expect(await dispositivoRepository.tokensDe(beto.id)).toEqual([TOKEN]);
  });

  it('valida el token y la plataforma, y pide sesión', async () => {
    const ana = await crearUsuario('ana');
    expect((await api().post('/api/dispositivos').send({ token: TOKEN })).status).toBe(401);

    const res = await api().post('/api/dispositivos').set(bearer(ana)).send({ token: 'corto', plataforma: 'nokia' });
    expect(res.status).toBe(400);
    expect(res.body.errores.map((e: { campo: string }) => e.campo).sort()).toEqual(['plataforma', 'token']);
  });

  it('al cerrar sesión quita su token, pero no el de otra persona', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await api().post('/api/dispositivos').set(bearer(ana)).send({ token: TOKEN });

    await api().delete(`/api/dispositivos/${encodeURIComponent(TOKEN)}`).set(bearer(beto));
    expect(await Dispositivo.count()).toBe(1);

    const res = await api().delete(`/api/dispositivos/${encodeURIComponent(TOKEN)}`).set(bearer(ana));
    expect(res.status).toBe(200);
    expect(await Dispositivo.count()).toBe(0);
  });
});

describe('envío de push', () => {
  it('avisa en todos los dispositivos del usuario y borra los que Firebase ya no reconoce', async () => {
    const ana = await crearUsuario('ana');
    await dispositivoService.registrar(ana.id, { token: TOKEN, plataforma: 'android' });
    await dispositivoService.registrar(ana.id, { token: OTRO_TOKEN, plataforma: 'android' });
    const { push, enviados } = pushFalsa([OTRO_TOKEN]);

    await new DispositivoService(dispositivoRepository, push).avisar(ana.id, { titulo: 'Hola', cuerpo: 'Prueba' });
    await terminarEnvios();

    expect(enviados).toHaveLength(1);
    expect([...enviados[0].tokens].sort()).toEqual([OTRO_TOKEN, TOKEN].sort());
    expect(await dispositivoRepository.tokensDe(ana.id)).toEqual([TOKEN]);
  });

  it('sin dispositivos no intenta enviar, y un error de Firebase no rompe nada', async () => {
    const ana = await crearUsuario('ana');
    const { push, enviados } = pushFalsa();
    await new DispositivoService(dispositivoRepository, push).avisar(ana.id, { titulo: 'x', cuerpo: 'y' });
    expect(enviados).toHaveLength(0);

    await dispositivoService.registrar(ana.id, { token: TOKEN, plataforma: 'android' });
    const errores = vi.fn();
    const rota: PushService = { enviar: () => Promise.reject(new Error('sin red')) };
    await expect(new DispositivoService(dispositivoRepository, rota, errores).avisar(ana.id, { titulo: 'x', cuerpo: 'y' })).resolves.toBeUndefined();
    await terminarEnvios();
    expect(errores).toHaveBeenCalledWith('[push] Falló el envío', expect.any(Error));
  });

  it('cada notificación nueva manda una push con el texto y los datos para abrirla', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    const avisos: { usuarioId: number; mensaje: MensajePush }[] = [];
    const servicio = new NotificacionService(notificacionRepository, sseHub, {
      avisar: async (usuarioId, mensaje) => void avisos.push({ usuarioId, mensaje }),
    });

    const creada = await servicio.notificar({ usuario_id: ana.id, de_usuario_id: beto.id, tipo: 'follow', mensaje: 'comenzó a seguirte' });
    await servicio.notificar({ usuario_id: ana.id, de_usuario_id: ana.id, tipo: 'follow' });

    expect(avisos).toEqual([
      {
        usuarioId: ana.id,
        mensaje: {
          titulo: 'TrinoFlow',
          cuerpo: 'Usuario beto comenzó a seguirte',
          datos: { tipo: 'follow', notificacion_id: String(creada!.id), de_usuario_id: String(beto.id), publicacion_id: '', entidad_tipo: '', entidad_id: '' },
        },
      },
    ]);
  });

  it('un mensaje de chat avisa al receptor con el nombre de quien escribe', async () => {
    const ana = await crearUsuario('ana');
    const beto = await crearUsuario('beto');
    await dispositivoService.registrar(beto.id, { token: TOKEN, plataforma: 'android' });
    const avisar = vi.spyOn(dispositivoService, 'avisar');

    const chat = await api().post('/api/chat/iniciar').set(bearer(ana)).send({ receptorId: beto.id });
    const chatId = chat.body.data.id;
    const enviado = await api().post('/api/chat/enviar').set(bearer(ana)).send({ chatId, texto: 'Hola Beto' });
    expect(enviado.status).toBe(201);

    expect(avisar).toHaveBeenCalledWith(beto.id, { titulo: 'Usuario ana', cuerpo: 'Hola Beto', datos: { tipo: 'mensaje', chat_id: String(chatId) } });
    avisar.mockRestore();
  });
});

describe('crearPushService', () => {
  it('sin cuenta de servicio (o si el archivo no existe) usa la consola', () => {
    const avisoOriginal = console.warn;
    console.warn = () => undefined;
    try {
      expect(crearPushService({ NODE_ENV: 'test', FIREBASE_SERVICE_ACCOUNT: undefined })).toBeInstanceOf(ConsolaPushService);
      expect(crearPushService({ NODE_ENV: 'test', FIREBASE_SERVICE_ACCOUNT: 'no-existe.json' })).toBeInstanceOf(ConsolaPushService);
    } finally {
      console.warn = avisoOriginal;
    }
  });
});
