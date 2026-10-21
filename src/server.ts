import http from 'http';
import { crearApp } from './app';
import { env } from './config/env';
import { sequelize } from './infrastructure/database/models';
import { realtime, type PermisosDeSalas } from './infrastructure/realtime/RealtimeGateway';
import { programarRecordatoriosEntregas } from './modules/aula/asignaciones/asignacion.service';
import { programarExpiracionOrdenes } from './modules/boletos/orden.service';
import { manejadorCanales } from './modules/canales/canal.socket';
import { chatRepository } from './modules/chat/chat.repository';
import { programarLimpiezaMensajes } from './modules/chat/limpieza-mensajes';
import { sesionesDocumentos } from './modules/documentos-grupo/documento-almacen';
import { manejadorDocumentos } from './modules/documentos-grupo/documento-colaborativo.socket';
import { programarLimpiezaEstadisticas } from './modules/estadisticas/estadistica.service';
import { programarRecordatoriosEventos } from './modules/eventos/evento.service';
import { programarLimpieza } from './modules/historias/historia.service';
import { manejadorLlamadas } from './modules/llamadas/llamada.senalizacion';
import { llamadaService } from './modules/llamadas/llamada.service';
import { programarFinSuspensiones } from './modules/moderacion/suspension.service';
import { publicacionRepository } from './modules/publicaciones/publicacion.repository';
import { programarPublicaciones } from './modules/publicaciones/publicacion.service';
import { tableroRepository } from './modules/tableros/tablero.repository';
import { programarRecordatoriosTareas } from './modules/tableros/tarea.service';
import { manejadorTransmisiones } from './modules/transmisiones/transmision.senalizacion';
import { transmisionService } from './modules/transmisiones/transmision.service';

/** Quién puede escuchar las salas privadas de Socket.IO (lo deciden los módulos, no la infraestructura). */
const permisosDeSalas: PermisosDeSalas = {
  puedeEntrarAChat: (chatId, usuarioId) => chatRepository.esParticipante(chatId, usuarioId),
  puedeEntrarAGrupo: (grupoId, usuarioId) => publicacionRepository.puedeVerGrupo(grupoId, usuarioId),
  puedeEntrarATablero: (tableroId, usuarioId) => tableroRepository.puedeVer(tableroId, usuarioId),
};

/** Tareas que corren solas mientras el servidor está prendido (cada una usa `unref()`). */
function programarTareas(): void {
  programarLimpieza(); // historias: cada 30 min archiva las de más de 24 h
  programarRecordatoriosEventos(); // eventos que empiezan en la próxima hora (cada 10 min)
  programarRecordatoriosTareas(); // tareas que vencen en 24 h (cada 15 min)
  programarRecordatoriosEntregas(); // asignaciones que vencen en 24 h (cada 15 min)
  programarPublicaciones(); // publica las programadas (cada minuto)
  programarLimpiezaMensajes(); // borra mensajes temporales vencidos (cada 10 min)
  programarExpiracionOrdenes(); // libera el cupo de órdenes de boletos sin pagar (cada 5 min)
  programarFinSuspensiones(); // levanta suspensiones temporales vencidas (cada 5 min)
  programarLimpiezaEstadisticas(); // borra eventos crudos de estadísticas viejos (diario)
}

async function iniciar(): Promise<void> {
  await sequelize.authenticate();
  console.log(`✅ Conectado a ${env.DB_DIALECT} (${env.DB_NAME}@${env.DB_HOST}:${env.DB_PORT})`);
  // Llamadas y transmisiones que quedaron "sonando" o "en vivo" si el servidor se apagó de golpe.
  await llamadaService.cerrarHuerfanas();
  await transmisionService.cerrarHuerfanas();

  const server = http.createServer(crearApp());
  // Eventos propios de cada módulo por Socket.IO (validan sesión y permisos ellos mismos).
  realtime.usar(manejadorLlamadas).usar(manejadorTransmisiones).usar(manejadorCanales).usar(manejadorDocumentos);
  realtime.adjuntar(server, permisosDeSalas);
  programarTareas();

  server.listen(env.PORT, () => {
    console.log(`🚀 API TrinoFlow en ${env.API_URL} (${env.NODE_ENV})`);
  });

  const cerrar = async () => {
    server.close();
    // Guarda lo último que se escribió en los documentos abiertos antes de apagar.
    await sesionesDocumentos.cerrarTodas();
    await sequelize.close();
    process.exit(0);
  };
  process.on('SIGINT', cerrar);
  process.on('SIGTERM', cerrar);
}

iniciar().catch((error: Error) => {
  console.error('❌ No se pudo iniciar la API:', error.message);
  process.exit(1);
});
