/**
 * Servidores ICE para WebRTC. STUN (públicos de Google) basta cuando los dos teléfonos pueden verse a través
 * de sus routers; detrás de NAT simétricas o redes móviles estrictas hace falta un TURN que retransmita el medio.
 * Variables opcionales (se leen aquí con process.env, no están en config/env.ts):
 *   TURN_URL      una o varias URLs separadas por coma (turn:turn.midominio.com:3478,turns:turn.midominio.com:5349)
 *   TURN_USUARIO  usuario del TURN
 *   TURN_CLAVE    contraseña del TURN
 */

export interface ServidorIce {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface ConfiguracionIce {
  ice_servers: ServidorIce[];
  /** true si hay TURN configurado (si no, algunas redes no podrán conectarse). */
  turn: boolean;
}

export const STUN_PUBLICOS = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] as const;

type Entorno = Partial<Record<'TURN_URL' | 'TURN_USUARIO' | 'TURN_CLAVE', string | undefined>>;

export function configuracionIce(): ConfiguracionIce;
export function configuracionIce(entorno: Entorno): ConfiguracionIce;
export function configuracionIce(entorno: Entorno = process.env): ConfiguracionIce {
  const servidores: ServidorIce[] = [{ urls: [...STUN_PUBLICOS] }];
  const urls = (entorno.TURN_URL ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter((u) => /^turns?:/i.test(u));
  if (!urls.length) return { ice_servers: servidores, turn: false };

  servidores.push({
    urls,
    ...(entorno.TURN_USUARIO ? { username: entorno.TURN_USUARIO } : {}),
    ...(entorno.TURN_CLAVE ? { credential: entorno.TURN_CLAVE } : {}),
  });
  return { ice_servers: servidores, turn: true };
}
