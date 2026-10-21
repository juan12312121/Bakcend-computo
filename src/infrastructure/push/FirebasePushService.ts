import { cert, initializeApp, type App, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging, type Messaging } from 'firebase-admin/messaging';
import type { MensajePush, PushService, ResultadoPush } from './PushService';

/** Firebase acepta hasta 500 tokens por envío. */
const TOKENS_POR_LOTE = 500;

/** Errores con los que Firebase dice que el token ya no sirve. */
const CODIGOS_TOKEN_INVALIDO = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

/** Color del ícono de la notificación en Android (naranja de la marca). */
const COLOR_MARCA = '#f97316';

/** Envía notificaciones con Firebase Cloud Messaging usando la cuenta de servicio del proyecto. */
export class FirebasePushService implements PushService {
  private readonly mensajeria: Messaging;

  constructor(cuentaDeServicio: ServiceAccount, nombreApp = 'trinoflow') {
    const app: App = initializeApp({ credential: cert(cuentaDeServicio) }, nombreApp);
    this.mensajeria = getMessaging(app);
  }

  async enviar(tokens: readonly string[], { titulo, cuerpo, datos = {} }: MensajePush): Promise<ResultadoPush> {
    const resultado: ResultadoPush = { enviados: 0, tokensInvalidos: [] };

    for (let i = 0; i < tokens.length; i += TOKENS_POR_LOTE) {
      const lote = tokens.slice(i, i + TOKENS_POR_LOTE);
      const respuesta = await this.mensajeria.sendEachForMulticast({
        tokens: lote,
        notification: { title: titulo, body: cuerpo },
        data: datos,
        android: { priority: 'high', notification: { color: COLOR_MARCA, sound: 'default' } },
      });

      resultado.enviados += respuesta.successCount;
      respuesta.responses.forEach((r, j) => {
        if (!r.success && r.error && CODIGOS_TOKEN_INVALIDO.has(r.error.code)) resultado.tokensInvalidos.push(lote[j]);
      });
    }
    return resultado;
  }
}
