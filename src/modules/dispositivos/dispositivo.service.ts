import { BaseService } from '../../core/domain/BaseService';
import type { Dispositivo } from '../../infrastructure/database/models';
import { pushService, type AvisadorPush, type MensajePush, type PushService } from '../../infrastructure/push';
import { dispositivoRepository, type DispositivoRepository } from './dispositivo.repository';
import type { RegistrarDispositivoDto } from './dispositivo.schemas';

export class DispositivoService extends BaseService<Dispositivo, DispositivoRepository> implements AvisadorPush {
  constructor(
    repository: DispositivoRepository,
    private readonly push: PushService,
    private readonly registrarError: (mensaje: string, error: unknown) => void = console.error,
  ) {
    super(repository);
  }

  /**
   * Guarda el token del teléfono para el usuario. Si ya existía (aunque fuera de otra cuenta
   * que antes abrió sesión en ese teléfono), pasa a este usuario.
   */
  async registrar(usuarioId: number, { token, plataforma }: RegistrarDispositivoDto): Promise<Dispositivo> {
    const existente = await this.repository.findOne({ token });
    if (existente) return this.repository.update(existente, { usuario_id: usuarioId, plataforma, fecha_actualizacion: new Date() });
    return this.repository.create({ usuario_id: usuarioId, token, plataforma });
  }

  /** Al cerrar sesión en el teléfono. Solo borra el token si es del usuario (no revela si existe). */
  async quitar(usuarioId: number, token: string): Promise<void> {
    await this.repository.delete({ usuario_id: usuarioId, token });
  }

  /**
   * Avisa al usuario en todos sus dispositivos. Nunca falla: una push perdida no debe
   * romper la acción que la provocó (un like, un mensaje...). El envío a Firebase no se espera.
   */
  async avisar(usuarioId: number, mensaje: MensajePush): Promise<void> {
    try {
      const tokens = await this.repository.tokensDe(usuarioId);
      if (!tokens.length) return;
      void this.enviar(tokens, mensaje);
    } catch (error) {
      this.registrarError('[push] No se pudieron leer los dispositivos', error);
    }
  }

  /** Envía y borra los tokens que Firebase ya no reconoce. */
  async enviar(tokens: readonly string[], mensaje: MensajePush): Promise<void> {
    try {
      const { tokensInvalidos } = await this.push.enviar(tokens, mensaje);
      await this.repository.borrarTokens(tokensInvalidos);
    } catch (error) {
      this.registrarError('[push] Falló el envío', error);
    }
  }
}

export const dispositivoService = new DispositivoService(dispositivoRepository, pushService);
