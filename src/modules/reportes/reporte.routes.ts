import { Router } from 'express';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { reporteController as c } from './reporte.controller';
import { crearReporteSchema, listarQuery, publicacionBodySchema, publicacionParams } from './reporte.schemas';

export const reporteRoutes = Router();

reporteRoutes.use(auth.proteger);

const conPublicacion = validate({ body: publicacionBodySchema });
const paginado = validate({ query: listarQuery });

// Reportes (consultarlos revela quién denunció: solo administradores)
reporteRoutes.post('/crear', validate({ body: crearReporteSchema }), c.crear);
reporteRoutes.get('/publicacion/:publicacionId', auth.soloAdmin, validate({ params: publicacionParams }), c.dePublicacion);
reporteRoutes.get('/todos', auth.soloAdmin, paginado, c.todos);
reporteRoutes.get('/estadisticas', auth.soloAdmin, c.estadisticas);

// Publicaciones ajenas ocultas
reporteRoutes.post('/ocultar', conPublicacion, c.ocultar);
reporteRoutes.post('/mostrar', conPublicacion, c.mostrar);
reporteRoutes.get('/ocultas', paginado, c.ocultas);

// Publicaciones propias
reporteRoutes.post('/ocultar-propias', c.ocultarPropias);
reporteRoutes.post('/mostrar-propias', c.mostrarPropias);
reporteRoutes.get('/propias-ocultas', paginado, c.propiasOcultas);

// No me interesa
reporteRoutes.post('/no-interesa', conPublicacion, c.noInteresa);
reporteRoutes.post('/si-interesa', conPublicacion, c.siInteresa);
reporteRoutes.get('/no-interesan', paginado, c.noInteresan);
reporteRoutes.delete('/limpiar-no-interesa', c.limpiarNoInteresa);
