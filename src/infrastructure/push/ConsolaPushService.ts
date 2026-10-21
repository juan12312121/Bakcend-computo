import type { MensajePush, PushService, ResultadoPush } from './PushService';

/**
 * Sin Firebase configurado: no envía nada, solo deja constancia en la consola
 * (o en silencio, como en las pruebas).
 */
export class ConsolaPushService implements PushService {
  constructor(private readonly escribir: ((linea: string) => void) | null = console.info) {}

  async enviar(tokens: readonly string[], { titulo, cuerpo }: MensajePush): Promise<ResultadoPush> {
    this.escribir?.(`[push sin Firebase] ${tokens.length} dispositivo(s): ${titulo} — ${cuerpo}`);
    return { enviados: 0, tokensInvalidos: [] };
  }
}
