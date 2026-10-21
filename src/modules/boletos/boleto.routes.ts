import { Router } from 'express';
import { idParams } from '../../core/validation/common.schemas';
import { validate } from '../../core/validation/validate';
import { auth } from '../../middlewares/AuthGuard';
import { boletoController as c } from './boleto.controller';
import {
  actualizarTipoSchema,
  boletosEventoQuery,
  comprarSchema,
  configuracionSchema,
  crearTipoSchema,
  eventoParams,
  misBoletosQuery,
  staffParams,
  staffSchema,
  transferirSchema,
  validarSchema,
} from './boleto.schemas';

/** Se monta en /api/boletos. La sección del evento se lee sin sesión (eventos públicos); lo demás exige sesión. */
export const boletoRoutes = Router();

// Rutas fijas antes de /:id
boletoRoutes.get('/mios', auth.proteger, validate({ query: misBoletosQuery }), c.mios);
boletoRoutes.post('/comprar', auth.proteger, validate({ body: comprarSchema }), c.comprar);
boletoRoutes.post('/validar', auth.proteger, validate({ body: validarSchema }), c.validar);
boletoRoutes.get('/ordenes/:id', auth.proteger, validate({ params: idParams }), c.orden);

// Tipos de boleto
boletoRoutes.put('/tipos/:id', auth.proteger, validate({ params: idParams, body: actualizarTipoSchema }), c.actualizarTipo);
boletoRoutes.delete('/tipos/:id', auth.proteger, validate({ params: idParams }), c.eliminarTipo);

// Por evento
boletoRoutes.get('/eventos/:evento_id', auth.opcional, validate({ params: eventoParams }), c.resumen);
boletoRoutes.put('/eventos/:evento_id/configuracion', auth.proteger, validate({ params: eventoParams, body: configuracionSchema }), c.configurar);
boletoRoutes.post('/eventos/:evento_id/tipos', auth.proteger, validate({ params: eventoParams, body: crearTipoSchema }), c.crearTipo);
boletoRoutes.get('/eventos/:evento_id/estadisticas', auth.proteger, validate({ params: eventoParams }), c.estadisticas);
boletoRoutes.get('/eventos/:evento_id/boletos', auth.proteger, validate({ params: eventoParams, query: boletosEventoQuery }), c.boletosDeEvento);
boletoRoutes.get('/eventos/:evento_id/csv', auth.proteger, validate({ params: eventoParams }), c.csv);
boletoRoutes.post('/eventos/:evento_id/reembolsar', auth.proteger, validate({ params: eventoParams }), c.reembolsar);
boletoRoutes.get('/eventos/:evento_id/staff', auth.proteger, validate({ params: eventoParams }), c.staff);
boletoRoutes.post('/eventos/:evento_id/staff', auth.proteger, validate({ params: eventoParams, body: staffSchema }), c.agregarStaff);
boletoRoutes.delete('/eventos/:evento_id/staff/:usuario_id', auth.proteger, validate({ params: staffParams }), c.quitarStaff);

// Un boleto
boletoRoutes.get('/:id', auth.proteger, validate({ params: idParams }), c.detalle);
boletoRoutes.post('/:id/transferir', auth.proteger, validate({ params: idParams, body: transferirSchema }), c.transferir);
