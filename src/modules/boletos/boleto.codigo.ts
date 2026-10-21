import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

/** Versión del formato del código (va al inicio para poder cambiarlo sin romper los anteriores). */
export const PREFIJO_CODIGO = 'TF1';
/** Solo para desarrollo: en producción hay que definir BOLETOS_SECRETO. */
export const SECRETO_DESARROLLO = 'trinoflow-boletos-solo-desarrollo-cambiame';

const BYTES_ALEATORIOS = 18;
const LARGO_FIRMA = 22;

export interface CodigoLeido {
  eventoId: number;
  token: string;
}

/**
 * Códigos de boleto `TF1.<eventoId>.<aleatorio>.<firma>`: 144 bits aleatorios (no se adivinan) + HMAC-SHA256
 * truncado (no se fabrican sin el secreto). La firma se revisa antes de tocar la base, así un código inventado
 * se rechaza al instante como "falso".
 */
export class FirmaBoletos {
  constructor(private readonly secreto: string) {
    if (secreto.length < 16) throw new Error('BOLETOS_SECRETO debe tener al menos 16 caracteres');
  }

  generar(eventoId: number): string {
    const token = randomBytes(BYTES_ALEATORIOS).toString('base64url');
    return `${PREFIJO_CODIGO}.${eventoId}.${token}.${this.firmar(eventoId, token)}`;
  }

  /** null si el formato o la firma no son válidos. */
  leer(codigo: string): CodigoLeido | null {
    const partes = codigo.trim().split('.');
    if (partes.length !== 4 || partes[0] !== PREFIJO_CODIGO) return null;
    const [, evento, token, firma] = partes;
    const eventoId = Number(evento);
    if (!/^\d{1,10}$/.test(evento) || !Number.isSafeInteger(eventoId) || eventoId <= 0 || !/^[\w-]{10,64}$/.test(token)) return null;

    const esperada = Buffer.from(this.firmar(eventoId, token));
    const recibida = Buffer.from(firma);
    if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) return null;
    return { eventoId, token };
  }

  private firmar(eventoId: number, token: string): string {
    return createHmac('sha256', this.secreto).update(`${PREFIJO_CODIGO}.${eventoId}.${token}`).digest('base64url').slice(0, LARGO_FIRMA);
  }
}

/** Secreto del entorno; sin él se usa el de desarrollo con un aviso (en producción el aviso es más fuerte). */
export function secretoDeBoletos(entorno: { BOLETOS_SECRETO?: string; NODE_ENV?: string } = process.env): string {
  const secreto = entorno.BOLETOS_SECRETO?.trim();
  if (secreto) return secreto;
  if (entorno.NODE_ENV === 'production') {
    console.warn('[boletos] ¡BOLETOS_SECRETO no está definido en producción! Los códigos de los boletos se firman con el secreto de desarrollo.');
  } else if (entorno.NODE_ENV !== 'test') {
    console.warn('[boletos] BOLETOS_SECRETO no está definido: se usa un secreto de desarrollo (defínelo antes de publicar).');
  }
  return SECRETO_DESARROLLO;
}

export const firmaBoletos = new FirmaBoletos(secretoDeBoletos());
