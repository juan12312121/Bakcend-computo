import { BaseRepository } from '../../core/domain/BaseRepository';
import { Grupo, GrupoInvitacion, Usuario } from '../../infrastructure/database/models';
import { ATRIBUTOS_USUARIO_PUBLICO } from '../usuarios/usuario.repository';

export class GrupoInvitacionRepository extends BaseRepository<GrupoInvitacion> {
  protected readonly entidad = 'Invitación';

  constructor() {
    super(GrupoInvitacion);
  }

  /** Cada invitación viaja con el grupo (datos básicos) y quien invitó. */
  protected override opcionesPorDefecto() {
    return {
      include: [
        { model: Grupo, as: 'grupo', attributes: ['id', 'nombre', 'imagen_url', 'privacidad'] },
        { model: Usuario, as: 'remitente', attributes: [...ATRIBUTOS_USUARIO_PUBLICO] },
      ],
    };
  }

  pendientesDe(usuarioId: number): Promise<GrupoInvitacion[]> {
    return this.findAll({ invitado_id: usuarioId, estado: 'pendiente' }, { order: [['fecha_creacion', 'DESC'], ['id', 'DESC']] });
  }

  existePendiente(grupoId: number, invitadoId: number): Promise<boolean> {
    return this.exists({ grupo_id: grupoId, invitado_id: invitadoId, estado: 'pendiente' });
  }
}

export const grupoInvitacionRepository = new GrupoInvitacionRepository();
