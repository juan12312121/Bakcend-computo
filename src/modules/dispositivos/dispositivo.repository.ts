import { BaseRepository } from '../../core/domain/BaseRepository';
import { Dispositivo } from '../../infrastructure/database/models';

export class DispositivoRepository extends BaseRepository<Dispositivo> {
  protected readonly entidad = 'Dispositivo';

  constructor() {
    super(Dispositivo);
  }

  async tokensDe(usuarioId: number): Promise<string[]> {
    const dispositivos = await this.findAll({ usuario_id: usuarioId }, { attributes: ['token'] });
    return dispositivos.map((d) => d.token);
  }

  borrarTokens(tokens: readonly string[]): Promise<number> {
    return tokens.length ? this.delete({ token: [...tokens] }) : Promise.resolve(0);
  }
}

export const dispositivoRepository = new DispositivoRepository();
