/** Notificación push lista para enviar. `datos` viaja oculto a la app (para saber a dónde navegar al tocarla). */
export interface MensajePush {
  titulo: string;
  cuerpo: string;
  datos?: Record<string, string>;
}

export interface ResultadoPush {
  enviados: number;
  /** Tokens que el proveedor ya no reconoce (app desinstalada, sesión cerrada): se deben borrar. */
  tokensInvalidos: string[];
}

/**
 * Puerto de salida para notificaciones push. Los servicios dependen de esta interfaz,
 * así en pruebas (o sin Firebase configurado) se cambia por otra implementación.
 */
export interface PushService {
  enviar(tokens: readonly string[], mensaje: MensajePush): Promise<ResultadoPush>;
}

/** Lo que usan los módulos de negocio: avisar a un usuario en todos sus dispositivos. */
export interface AvisadorPush {
  avisar(usuarioId: number, mensaje: MensajePush): Promise<void>;
}
