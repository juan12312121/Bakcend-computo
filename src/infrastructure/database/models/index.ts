import { sequelize } from '../../../config/database';
import { Usuario } from './Usuario';
import { Publicacion } from './Publicacion';
import { Comentario, Compartido, Like, PublicacionNoInteresa, PublicacionOculta, Reporte } from './Interacciones';
import { Notificacion, Seguidor } from './Social';
import { Documento, Etiqueta, PublicacionSeccion, Seccion } from './Contenido';
import { Chat, Grupo, GrupoInvitacion, GrupoMiembro, LogSeguridad, MensajeChat } from './Comunidad';
import { Historia, HistoriaVista } from './Historias';
import { RestablecimientoContrasena } from './Restablecimientos';
import { Dispositivo } from './Dispositivos';
import {
  EtiquetaTablero,
  Sprint,
  Tablero,
  TableroColumna,
  TableroMiembro,
  Tarea,
  TareaActividad,
  TareaAsignado,
  TareaChecklist,
  TareaComentario,
  TareaEtiqueta,
} from './Tableros';
import { Evento, EventoAsistente } from './Eventos';
import { ComentarioLike, Encuesta, EncuestaOpcion, EncuestaVoto, Hashtag, PublicacionGuardada, PublicacionHashtag } from './Engagement';
import { Bloqueo, MensajeGrupo, VerificacionEmail } from './Privacidad';
import { registrarModelosLlamadas } from './fase4/Llamadas';
import { registrarModelosCanales } from './fase4/Canales';
import { registrarModelosDocumentos } from './fase4/Documentos';
import { registrarModelosAula } from './fase4/Aula';
import { registrarModelosBoletos } from './fase4/Boletos';
import { registrarModelosMarketplace } from './fase4/Marketplace';
import { registrarModelosCreadores } from './fase4/Creadores';
import { registrarModelosModeracion } from './fase4/Moderacion';

const modelos = [
  Usuario,
  Publicacion,
  Comentario,
  Like,
  Reporte,
  PublicacionOculta,
  PublicacionNoInteresa,
  Compartido,
  Seguidor,
  Notificacion,
  Seccion,
  PublicacionSeccion,
  Documento,
  Etiqueta,
  Grupo,
  GrupoMiembro,
  GrupoInvitacion,
  Chat,
  MensajeChat,
  LogSeguridad,
  Historia,
  HistoriaVista,
] as const;

modelos.forEach((modelo) => modelo.initModel(sequelize));

const cascada = { onDelete: 'CASCADE' as const };

// ---------- Usuario ↔ Publicación ----------
Usuario.hasMany(Publicacion, { foreignKey: 'usuario_id', as: 'publicaciones', ...cascada });
Publicacion.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'autor' });

// ---------- Interacciones ----------
Publicacion.hasMany(Comentario, { foreignKey: 'publicacion_id', as: 'comentarios', ...cascada });
Comentario.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion' });
Comentario.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'autor', ...cascada });

Publicacion.hasMany(Like, { foreignKey: 'publicacion_id', as: 'likes', ...cascada });
Like.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion' });
Like.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

Publicacion.hasMany(Reporte, { foreignKey: 'publicacion_id', as: 'reportes', ...cascada });
Reporte.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion' });
Reporte.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

PublicacionOculta.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion', ...cascada });
PublicacionOculta.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
PublicacionNoInteresa.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion', ...cascada });
PublicacionNoInteresa.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
Compartido.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion', ...cascada });
Compartido.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

// ---------- Social ----------
Seguidor.belongsTo(Usuario, { foreignKey: 'seguidor_id', as: 'usuarioSeguidor', ...cascada });
Seguidor.belongsTo(Usuario, { foreignKey: 'siguiendo_id', as: 'usuarioSeguido', ...cascada });

Notificacion.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'destinatario', ...cascada });
Notificacion.belongsTo(Usuario, { foreignKey: 'de_usuario_id', as: 'emisor', ...cascada });
Notificacion.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion', ...cascada });

// ---------- Contenido ----------
Usuario.hasMany(Seccion, { foreignKey: 'usuario_id', as: 'secciones', ...cascada });
Seccion.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
Seccion.belongsToMany(Publicacion, { through: PublicacionSeccion, foreignKey: 'seccion_id', otherKey: 'publicacion_id', as: 'publicaciones' });
Publicacion.belongsToMany(Seccion, { through: PublicacionSeccion, foreignKey: 'publicacion_id', otherKey: 'seccion_id', as: 'secciones' });

Publicacion.hasMany(Documento, { foreignKey: 'publicacion_id', as: 'documentos', onDelete: 'SET NULL' });
Documento.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion' });
Documento.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

// ---------- Grupos ----------
Grupo.belongsTo(Usuario, { foreignKey: 'creador_id', as: 'creador', ...cascada });
Grupo.hasMany(GrupoMiembro, { foreignKey: 'grupo_id', as: 'miembros', ...cascada });
GrupoMiembro.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo' });
GrupoMiembro.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
Grupo.hasMany(Publicacion, { foreignKey: 'grupo_id', as: 'publicaciones', ...cascada });
Publicacion.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo' });
GrupoInvitacion.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo', ...cascada });
GrupoInvitacion.belongsTo(Usuario, { foreignKey: 'remitente_id', as: 'remitente', ...cascada });
GrupoInvitacion.belongsTo(Usuario, { foreignKey: 'invitado_id', as: 'invitado', ...cascada });

// ---------- Chat ----------
Chat.belongsTo(Usuario, { foreignKey: 'usuario1_id', as: 'usuario1', ...cascada });
Chat.belongsTo(Usuario, { foreignKey: 'usuario2_id', as: 'usuario2', ...cascada });
Chat.hasMany(MensajeChat, { foreignKey: 'chat_id', as: 'mensajes', ...cascada });
MensajeChat.belongsTo(Chat, { foreignKey: 'chat_id', as: 'chat' });
MensajeChat.belongsTo(Usuario, { foreignKey: 'emisor_id', as: 'emisor', ...cascada });

LogSeguridad.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', constraints: false });

// ---------- [historias] (modelos y asociaciones del módulo de historias) ----------
Historia.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'autor', ...cascada });
Historia.hasMany(HistoriaVista, { foreignKey: 'historia_id', as: 'vistas', ...cascada });
HistoriaVista.belongsTo(Historia, { foreignKey: 'historia_id', as: 'historia' });
HistoriaVista.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

// ---------- [restablecimientos] (recuperar contraseña) ----------
RestablecimientoContrasena.initModel(sequelize);
Usuario.hasMany(RestablecimientoContrasena, { foreignKey: 'usuario_id', as: 'restablecimientos', ...cascada });
RestablecimientoContrasena.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
export * from './Restablecimientos';

// ---------- [dispositivos] (tokens para notificaciones push) ----------
Dispositivo.initModel(sequelize);
Usuario.hasMany(Dispositivo, { foreignKey: 'usuario_id', as: 'dispositivos', ...cascada });
Dispositivo.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario' });
export * from './Dispositivos';

// ---------- [fase 3] tableros, eventos, interacciones nuevas, privacidad y chat de grupo ----------
const modelosFase3 = [
  Tablero,
  TableroMiembro,
  TableroColumna,
  Sprint,
  Tarea,
  TareaAsignado,
  EtiquetaTablero,
  TareaEtiqueta,
  TareaComentario,
  TareaChecklist,
  TareaActividad,
  Evento,
  EventoAsistente,
  ComentarioLike,
  PublicacionGuardada,
  Encuesta,
  EncuestaOpcion,
  EncuestaVoto,
  Hashtag,
  PublicacionHashtag,
  Bloqueo,
  VerificacionEmail,
  MensajeGrupo,
] as const;
modelosFase3.forEach((modelo) => modelo.initModel(sequelize));

// Comentarios con respuestas
Comentario.hasMany(Comentario, { foreignKey: 'padre_id', as: 'respuestas', ...cascada });
Comentario.belongsTo(Comentario, { foreignKey: 'padre_id', as: 'padre' });
Comentario.hasMany(ComentarioLike, { foreignKey: 'comentario_id', as: 'likes', ...cascada });
ComentarioLike.belongsTo(Comentario, { foreignKey: 'comentario_id', as: 'comentario' });
ComentarioLike.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

// Guardados
PublicacionGuardada.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion', ...cascada });
PublicacionGuardada.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

// Encuestas
Publicacion.hasOne(Encuesta, { foreignKey: 'publicacion_id', as: 'encuesta', ...cascada });
Encuesta.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion' });
Encuesta.hasMany(EncuestaOpcion, { foreignKey: 'encuesta_id', as: 'opciones', ...cascada });
EncuestaOpcion.belongsTo(Encuesta, { foreignKey: 'encuesta_id', as: 'encuesta' });
Encuesta.hasMany(EncuestaVoto, { foreignKey: 'encuesta_id', as: 'votos', ...cascada });
EncuestaOpcion.hasMany(EncuestaVoto, { foreignKey: 'opcion_id', as: 'votos', ...cascada });
EncuestaVoto.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

// Hashtags
Publicacion.belongsToMany(Hashtag, { through: PublicacionHashtag, foreignKey: 'publicacion_id', otherKey: 'hashtag_id', as: 'hashtags' });
Hashtag.belongsToMany(Publicacion, { through: PublicacionHashtag, foreignKey: 'hashtag_id', otherKey: 'publicacion_id', as: 'publicaciones' });

// Privacidad
Bloqueo.belongsTo(Usuario, { foreignKey: 'bloqueador_id', as: 'bloqueador', ...cascada });
Bloqueo.belongsTo(Usuario, { foreignKey: 'bloqueado_id', as: 'bloqueado', ...cascada });
VerificacionEmail.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

// Chat de grupo
Grupo.hasMany(MensajeGrupo, { foreignKey: 'grupo_id', as: 'mensajes', ...cascada });
MensajeGrupo.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo' });
MensajeGrupo.belongsTo(Usuario, { foreignKey: 'emisor_id', as: 'emisor', ...cascada });

// Tableros
Tablero.belongsTo(Usuario, { foreignKey: 'creador_id', as: 'creador', ...cascada });
Tablero.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo', ...cascada });
Grupo.hasMany(Tablero, { foreignKey: 'grupo_id', as: 'tableros' });
Tablero.hasMany(TableroMiembro, { foreignKey: 'tablero_id', as: 'miembros', ...cascada });
TableroMiembro.belongsTo(Tablero, { foreignKey: 'tablero_id', as: 'tablero' });
TableroMiembro.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
Tablero.hasMany(TableroColumna, { foreignKey: 'tablero_id', as: 'columnas', ...cascada });
TableroColumna.belongsTo(Tablero, { foreignKey: 'tablero_id', as: 'tablero' });
Tablero.hasMany(Sprint, { foreignKey: 'tablero_id', as: 'sprints', ...cascada });
Sprint.belongsTo(Tablero, { foreignKey: 'tablero_id', as: 'tablero' });
Tablero.hasMany(EtiquetaTablero, { foreignKey: 'tablero_id', as: 'etiquetas', ...cascada });
Tablero.hasMany(Tarea, { foreignKey: 'tablero_id', as: 'tareas', ...cascada });
Tarea.belongsTo(Tablero, { foreignKey: 'tablero_id', as: 'tablero' });
TableroColumna.hasMany(Tarea, { foreignKey: 'columna_id', as: 'tareas', ...cascada });
Tarea.belongsTo(TableroColumna, { foreignKey: 'columna_id', as: 'columna' });
Sprint.hasMany(Tarea, { foreignKey: 'sprint_id', as: 'tareas', onDelete: 'SET NULL' });
Tarea.belongsTo(Sprint, { foreignKey: 'sprint_id', as: 'sprint' });
Tarea.belongsTo(Usuario, { foreignKey: 'creador_id', as: 'creador', ...cascada });
Tarea.belongsTo(Tarea, { foreignKey: 'epica_id', as: 'epica', onDelete: 'SET NULL' });
Tarea.belongsToMany(Usuario, { through: TareaAsignado, foreignKey: 'tarea_id', otherKey: 'usuario_id', as: 'asignados' });
Usuario.belongsToMany(Tarea, { through: TareaAsignado, foreignKey: 'usuario_id', otherKey: 'tarea_id', as: 'tareasAsignadas' });
Tarea.belongsToMany(EtiquetaTablero, { through: TareaEtiqueta, foreignKey: 'tarea_id', otherKey: 'etiqueta_id', as: 'etiquetas' });
EtiquetaTablero.belongsToMany(Tarea, { through: TareaEtiqueta, foreignKey: 'etiqueta_id', otherKey: 'tarea_id', as: 'tareas' });
Tarea.hasMany(TareaComentario, { foreignKey: 'tarea_id', as: 'comentarios', ...cascada });
TareaComentario.belongsTo(Tarea, { foreignKey: 'tarea_id', as: 'tarea' });
TareaComentario.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'autor', ...cascada });
Tarea.hasMany(TareaChecklist, { foreignKey: 'tarea_id', as: 'checklist', ...cascada });
Tablero.hasMany(TareaActividad, { foreignKey: 'tablero_id', as: 'actividad', ...cascada });
TareaActividad.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
TareaActividad.belongsTo(Tarea, { foreignKey: 'tarea_id', as: 'tarea', constraints: false });

// Eventos
Evento.belongsTo(Usuario, { foreignKey: 'creador_id', as: 'creador', ...cascada });
Evento.belongsTo(Grupo, { foreignKey: 'grupo_id', as: 'grupo', ...cascada });
Evento.hasMany(EventoAsistente, { foreignKey: 'evento_id', as: 'asistentes', ...cascada });
EventoAsistente.belongsTo(Evento, { foreignKey: 'evento_id', as: 'evento' });
EventoAsistente.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

export * from './Tableros';
export * from './Eventos';
export * from './Engagement';
export * from './Privacidad';


export {
  sequelize,
  Usuario,
  Publicacion,
  Comentario,
  Like,
  Reporte,
  PublicacionOculta,
  PublicacionNoInteresa,
  Compartido,
  Seguidor,
  Notificacion,
  Seccion,
  PublicacionSeccion,
  Documento,
  Etiqueta,
  Grupo,
  GrupoMiembro,
  GrupoInvitacion,
  Chat,
  MensajeChat,
  LogSeguridad,
  Historia,
  HistoriaVista,
};
export * from './Historias';
export * from './Publicacion';
export * from './Interacciones';
export * from './Social';
export * from './Contenido';
export * from './Comunidad';
export type { RolUsuario } from './Usuario';

// ---------- [fase 4] cada equipo registra sus modelos en models/fase4/<Area>.ts ----------
registrarModelosLlamadas(sequelize);
registrarModelosCanales(sequelize);
registrarModelosDocumentos(sequelize);
registrarModelosAula(sequelize);
registrarModelosBoletos(sequelize);
registrarModelosMarketplace(sequelize);
registrarModelosCreadores(sequelize);
registrarModelosModeracion(sequelize);
export * from './fase4/Llamadas';
export * from './fase4/Canales';
export * from './fase4/Documentos';
export * from './fase4/Aula';
export * from './fase4/Boletos';
export * from './fase4/Marketplace';
export * from './fase4/Creadores';
export * from './fase4/Moderacion';
