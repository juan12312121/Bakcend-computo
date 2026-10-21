import { describe, expect, it } from 'vitest';
import { api } from './helpers';

describe('CORS', () => {
  it.each(['http://localhost:4200', 'http://localhost', 'capacitor://localhost'])('acepta %s (web y app nativa)', async (origen) => {
    const res = await api().options('/api/auth/login').set('Origin', origen).set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBe(origen);
  });

  it('no autoriza orígenes desconocidos', async () => {
    const res = await api().options('/api/auth/login').set('Origin', 'https://sitio-ajeno.com').set('Access-Control-Request-Method', 'POST');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });
});
