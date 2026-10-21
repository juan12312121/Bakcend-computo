import type { Request, Response } from 'express';
import { BaseController } from '../../core/http/BaseController';
import { validatedQuery } from '../../core/validation/validate';
import type { BoletosEventoQuery, MisBoletosQuery } from './boleto.schemas';
import { boletoService, type BoletoService } from './boleto.service';
import { ordenService, type OrdenService } from './orden.service';

export class BoletoController extends BaseController {
  constructor(
    private readonly service: BoletoService,
    private readonly ordenes: OrdenService,
  ) {
    super();
  }

  // ---------- Evento ----------

  resumen = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.resumenEvento(this.idParam(req, 'evento_id'), this.usuarioIdOpcional(req)), 'Boletos del evento');
  };

  configurar = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.configurar(this.idParam(req, 'evento_id'), this.usuarioId(req), req.body), 'Configuración de boletos guardada');
  };

  crearTipo = async (req: Request, res: Response) => {
    return this.created(res, await this.service.crearTipo(this.idParam(req, 'evento_id'), this.usuarioId(req), req.body), 'Tipo de boleto creado');
  };

  actualizarTipo = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.actualizarTipo(this.idParam(req), this.usuarioId(req), req.body), 'Tipo de boleto actualizado');
  };

  eliminarTipo = async (req: Request, res: Response) => {
    const resultado = await this.service.eliminarTipo(this.idParam(req), this.usuarioId(req));
    return this.message(res, resultado === 'eliminado' ? 'Tipo de boleto eliminado' : 'Ya tenía ventas: se dejó de vender (los boletos emitidos siguen valiendo)');
  };

  estadisticas = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.estadisticas(this.idParam(req, 'evento_id'), this.usuarioId(req)), 'Estadísticas de acceso');
  };

  boletosDeEvento = async (req: Request, res: Response) => {
    const page = await this.service.boletosDeEvento(this.idParam(req, 'evento_id'), this.usuarioId(req), validatedQuery<BoletosEventoQuery>(res));
    return this.paginated(res, page, 'Boletos del evento');
  };

  /** Única respuesta fuera del contrato JSON: el archivo CSV. */
  csv = async (req: Request, res: Response) => {
    const archivo = await this.service.csv(this.idParam(req, 'evento_id'), this.usuarioId(req));
    res.attachment(archivo.nombre);
    res.set('Content-Type', 'text/csv; charset=utf-8');
    return res.send(archivo.contenido);
  };

  reembolsar = async (req: Request, res: Response) => {
    const resumen = await this.ordenes.reembolsarPorOrganizador(this.idParam(req, 'evento_id'), this.usuarioId(req));
    return this.ok(res, resumen, resumen.errores ? `${resumen.errores} reembolsos fallaron, intenta de nuevo` : 'Reembolsos procesados');
  };

  // ---------- Staff ----------

  staff = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.staffDe(this.idParam(req, 'evento_id'), this.usuarioId(req)), 'Staff del evento');
  };

  agregarStaff = async (req: Request, res: Response) => {
    const staff = await this.service.agregarStaff(this.idParam(req, 'evento_id'), this.usuarioId(req), req.body.usuario_id);
    return this.created(res, staff, 'Ahora puede escanear boletos');
  };

  quitarStaff = async (req: Request, res: Response) => {
    const staff = await this.service.quitarStaff(this.idParam(req, 'evento_id'), this.usuarioId(req), this.idParam(req, 'usuario_id'));
    return this.ok(res, staff, 'Ya no puede escanear boletos');
  };

  // ---------- Compra ----------

  comprar = async (req: Request, res: Response) => {
    const resultado = await this.ordenes.comprar(this.usuarioId(req), req.body);
    return this.created(res, resultado, resultado.url_pago ? 'Orden creada: continúa con el pago' : resultado.boletos.length === 1 ? '¡Ya tienes tu boleto!' : '¡Ya tienes tus boletos!');
  };

  orden = async (req: Request, res: Response) => {
    return this.ok(res, await this.ordenes.consultar(this.idParam(req), this.usuarioId(req)), 'Estado de la orden');
  };

  // ---------- Mis boletos ----------

  mios = async (req: Request, res: Response) => {
    return this.paginated(res, await this.service.mios(this.usuarioId(req), validatedQuery<MisBoletosQuery>(res)), 'Tus boletos');
  };

  detalle = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.detalle(this.idParam(req), this.usuarioId(req)), 'Boleto obtenido');
  };

  transferir = async (req: Request, res: Response) => {
    return this.ok(res, await this.service.transferir(this.idParam(req), this.usuarioId(req), req.body.usuario_id), 'Boleto transferido');
  };

  // ---------- Puerta ----------

  validar = async (req: Request, res: Response) => {
    const resultado = await this.service.validar(this.usuarioId(req), req.body);
    return this.ok(res, resultado, resultado.mensaje);
  };
}

export const boletoController = new BoletoController(boletoService, ordenService);
