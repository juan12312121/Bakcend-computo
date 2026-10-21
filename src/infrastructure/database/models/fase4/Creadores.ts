/**
 * Fase 4 — historias destacadas, publicaciones programadas y estadísticas para creadores.
 * Dueño: agente "creadores". Las columnas nuevas de `publicaciones` (estado, programada_para, edicion...) y de
 * `historias` (archivada, edicion...) viven en sus propios modelos; aquí van las tablas nuevas.
 *
 * Estadísticas: los eventos crudos (`estadisticas_eventos`) sirven para no duplicar (misma persona y publicación
 * en 30 min) y para el alcance (personas únicas); los totales se suman por día en dos tablas agregadas para que
 * los paneles no recorran eventos sueltos.
 */
import {
  DataTypes,
  Model,
  Op,
  type Attributes,
  type CreationAttributes,
  type CreationOptional,
  type DestroyOptions,
  type InferAttributes,
  type InferCreationAttributes,
  type InstanceDestroyOptions,
  type InstanceUpdateOptions,
  type ModelStatic,
  type NonAttribute,
  type Sequelize,
  type Transaction,
  type WhereOptions,
} from 'sequelize';
import { conFechaCreacion, conFechas } from '../modelOptions';
import { Historia } from '../Historias';
import { Publicacion } from '../Publicacion';
import { Seguidor } from '../Social';
import { Usuario } from '../Usuario';

const pk = () => ({ type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true });
const fk = () => ({ type: DataTypes.INTEGER, allowNull: false });
const contador = () => ({ type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 });

// ---------- Historias destacadas ----------

/** Colección del perfil con historias propias (no vencen). */
export class HistoriaDestacada extends Model<InferAttributes<HistoriaDestacada>, InferCreationAttributes<HistoriaDestacada>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare titulo: string;
  /** Portada subida aparte (imagen); si no hay, se usa la de `portada_historia_id` o la primera historia. */
  declare portada_url: CreationOptional<string | null>;
  declare portada_s3: CreationOptional<string | null>;
  /** Historia de la colección que sirve de portada. */
  declare portada_historia_id: CreationOptional<number | null>;
  /** Posición en el perfil (0 = primera). */
  declare orden: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;
  declare items?: NonAttribute<HistoriaDestacadaItem[]>;
  declare portadaHistoria?: NonAttribute<Historia | null>;

  static initModel(sequelize: Sequelize): typeof HistoriaDestacada {
    HistoriaDestacada.init(
      {
        id: pk(),
        usuario_id: fk(),
        titulo: { type: DataTypes.STRING(40), allowNull: false },
        portada_url: { type: DataTypes.STRING(500), allowNull: true },
        portada_s3: { type: DataTypes.STRING(300), allowNull: true },
        portada_historia_id: { type: DataTypes.INTEGER, allowNull: true },
        orden: contador(),
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      { ...conFechas(sequelize, 'historias_destacadas'), indexes: [{ fields: ['usuario_id', 'orden'] }] },
    );
    return HistoriaDestacada;
  }
}

/** Historia dentro de una destacada (en orden de reproducción). */
export class HistoriaDestacadaItem extends Model<InferAttributes<HistoriaDestacadaItem>, InferCreationAttributes<HistoriaDestacadaItem>> {
  declare id: CreationOptional<number>;
  declare destacada_id: number;
  declare historia_id: number;
  declare orden: CreationOptional<number>;
  declare fecha_creacion: CreationOptional<Date>;
  declare historia?: NonAttribute<Historia>;

  static initModel(sequelize: Sequelize): typeof HistoriaDestacadaItem {
    HistoriaDestacadaItem.init(
      { id: pk(), destacada_id: fk(), historia_id: fk(), orden: contador(), fecha_creacion: DataTypes.DATE },
      { ...conFechaCreacion(sequelize, 'historias_destacadas_items'), indexes: [{ unique: true, fields: ['destacada_id', 'historia_id'] }] },
    );
    return HistoriaDestacadaItem;
  }
}

// ---------- Estadísticas ----------

export const TIPOS_EVENTO_ESTADISTICA = ['impresion', 'visita_perfil', 'clic_enlace'] as const;
export type TipoEventoEstadistica = (typeof TIPOS_EVENTO_ESTADISTICA)[number];

/** Evento crudo: quién vio qué y cuándo (para no duplicar y para contar personas únicas). */
export class EventoEstadistica extends Model<InferAttributes<EventoEstadistica>, InferCreationAttributes<EventoEstadistica>> {
  declare id: CreationOptional<number>;
  declare tipo: TipoEventoEstadistica;
  /** Dueño de lo visto (autor de la publicación o dueño del perfil). */
  declare dueno_id: number;
  /** Quien lo vio. */
  declare usuario_id: number;
  declare publicacion_id: CreationOptional<number | null>;
  declare fecha_creacion: CreationOptional<Date>;

  static initModel(sequelize: Sequelize): typeof EventoEstadistica {
    EventoEstadistica.init(
      {
        id: pk(),
        tipo: { type: DataTypes.ENUM(...TIPOS_EVENTO_ESTADISTICA), allowNull: false },
        dueno_id: fk(),
        usuario_id: fk(),
        publicacion_id: { type: DataTypes.INTEGER, allowNull: true },
        fecha_creacion: DataTypes.DATE,
      },
      {
        ...conFechaCreacion(sequelize, 'estadisticas_eventos'),
        indexes: [
          { name: 'est_eventos_usuario_tipo_pub_fecha', fields: ['usuario_id', 'tipo', 'publicacion_id', 'fecha_creacion'] },
          { fields: ['dueno_id', 'tipo', 'fecha_creacion'] },
        ],
      },
    );
    return EventoEstadistica;
  }
}

export const CAMPOS_PUBLICACION_DIARIA = ['impresiones', 'alcance', 'reproducciones', 'clics_enlace'] as const;
export type CampoPublicacionDiaria = (typeof CAMPOS_PUBLICACION_DIARIA)[number];

/** Totales de una publicación en un día. */
export class EstadisticaPublicacionDiaria extends Model<
  InferAttributes<EstadisticaPublicacionDiaria>,
  InferCreationAttributes<EstadisticaPublicacionDiaria>
> {
  declare id: CreationOptional<number>;
  declare publicacion_id: number;
  /** Autor (para sumar todo lo de un creador sin unir tablas). */
  declare usuario_id: number;
  /** 'YYYY-MM-DD' en la hora local del servidor. */
  declare fecha: string;
  declare impresiones: CreationOptional<number>;
  /** Personas distintas que la vieron ese día. */
  declare alcance: CreationOptional<number>;
  declare reproducciones: CreationOptional<number>;
  declare clics_enlace: CreationOptional<number>;

  static initModel(sequelize: Sequelize): typeof EstadisticaPublicacionDiaria {
    EstadisticaPublicacionDiaria.init(
      {
        id: pk(),
        publicacion_id: fk(),
        usuario_id: fk(),
        fecha: { type: DataTypes.DATEONLY, allowNull: false },
        impresiones: contador(),
        alcance: contador(),
        reproducciones: contador(),
        clics_enlace: contador(),
      },
      {
        sequelize,
        tableName: 'estadisticas_publicaciones_diarias',
        timestamps: false,
        indexes: [{ unique: true, fields: ['publicacion_id', 'fecha'] }, { fields: ['usuario_id', 'fecha'] }],
      },
    );
    return EstadisticaPublicacionDiaria;
  }
}

export const CAMPOS_PERFIL_DIARIO = ['visitas_perfil', 'seguidores_ganados', 'seguidores_perdidos', 'reproducciones_historias'] as const;
export type CampoPerfilDiario = (typeof CAMPOS_PERFIL_DIARIO)[number];

/** Totales del perfil de un creador en un día. */
export class EstadisticaPerfilDiaria extends Model<InferAttributes<EstadisticaPerfilDiaria>, InferCreationAttributes<EstadisticaPerfilDiaria>> {
  declare id: CreationOptional<number>;
  declare usuario_id: number;
  declare fecha: string;
  declare visitas_perfil: CreationOptional<number>;
  declare seguidores_ganados: CreationOptional<number>;
  declare seguidores_perdidos: CreationOptional<number>;
  declare reproducciones_historias: CreationOptional<number>;

  static initModel(sequelize: Sequelize): typeof EstadisticaPerfilDiaria {
    EstadisticaPerfilDiaria.init(
      {
        id: pk(),
        usuario_id: fk(),
        fecha: { type: DataTypes.DATEONLY, allowNull: false },
        visitas_perfil: contador(),
        seguidores_ganados: contador(),
        seguidores_perdidos: contador(),
        reproducciones_historias: contador(),
      },
      {
        sequelize,
        tableName: 'estadisticas_perfiles_diarias',
        timestamps: false,
        indexes: [{ unique: true, fields: ['usuario_id', 'fecha'] }],
      },
    );
    return EstadisticaPerfilDiaria;
  }

  /**
   * Suma `delta` a un contador del día (crea la fila si no existe). Si llega una transacción, se escribe
   * dentro de ella; si no, por separado.
   */
  static sumar(usuarioId: number, campo: CampoPerfilDiario, delta: number, transaction?: Transaction): Promise<void> {
    return sumarAlDia(EstadisticaPerfilDiaria, { usuario_id: usuarioId, fecha: fechaDia(new Date()) }, campo, delta, transaction);
  }
}

/**
 * Suma `delta` a un contador de una fila diaria (la crea si no existe) sin abrir transacciones propias.
 * Si dos peticiones crean la misma fila a la vez, la segunda choca con el índice único y solo incrementa.
 */
export async function sumarAlDia<M extends Model>(
  modelo: ModelStatic<M>,
  clave: Record<string, string | number>,
  campo: string,
  delta: number,
  transaction?: Transaction,
): Promise<void> {
  const where = clave as WhereOptions<Attributes<M>>;
  const existente = await modelo.findOne({ where, transaction });
  if (existente) {
    await existente.increment(campo as keyof Attributes<M>, { by: delta, transaction });
    return;
  }
  try {
    await modelo.create({ ...clave, [campo]: delta } as unknown as CreationAttributes<M>, { transaction });
  } catch (error) {
    if ((error as Error).name !== 'SequelizeUniqueConstraintError') throw error;
    const creada = await modelo.findOne({ where, transaction });
    await creada?.increment(campo as keyof Attributes<M>, { by: delta, transaction });
  }
}

/** Día 'YYYY-MM-DD' en la hora local del servidor (la misma regla al guardar y al consultar). */
export function fechaDia(fecha: Date): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${fecha.getFullYear()}-${dos(fecha.getMonth() + 1)}-${dos(fecha.getDate())}`;
}

// ---------- Seguidores ganados / perdidos ----------

/**
 * Los seguidores se ganan y se pierden en el módulo de seguidores (que no es de este equipo): en lugar de tocarlo,
 * se escuchan los hooks del modelo `Seguidor` y se suma al día del perfil seguido. Si hay transacción, se anota
 * al confirmarse (si se revierte no cuenta). Una falla aquí nunca rompe la acción de seguir.
 */
function alConfirmar(transaction: Transaction | null | undefined, accion: () => Promise<void>): Promise<void> | void {
  const segura = () => accion().catch((error: Error) => console.warn('No se pudo registrar la estadística de seguidores:', error.message));
  if (transaction) transaction.afterCommit(segura);
  else return segura();
}

function registrarHooksSeguidores(): void {
  Seguidor.addHook('afterCreate', 'creadores:seguidor-nuevo', (relacion: Seguidor, opciones: { transaction?: Transaction | null }) => {
    if (relacion.estado !== 'aceptado') return;
    return alConfirmar(opciones.transaction, () => EstadisticaPerfilDiaria.sumar(relacion.siguiendo_id, 'seguidores_ganados', 1));
  });

  // Una solicitud pendiente que se acepta también es un seguidor ganado.
  Seguidor.addHook('afterUpdate', 'creadores:seguidor-aceptado', (relacion: Seguidor, opciones: InstanceUpdateOptions) => {
    if (!relacion.changed('estado') || relacion.estado !== 'aceptado') return;
    return alConfirmar(opciones.transaction, () => EstadisticaPerfilDiaria.sumar(relacion.siguiendo_id, 'seguidores_ganados', 1));
  });

  Seguidor.addHook('afterDestroy', 'creadores:seguidor-perdido', (relacion: Seguidor, opciones: InstanceDestroyOptions) => {
    if (relacion.estado !== 'aceptado') return;
    return alConfirmar(opciones.transaction, () => EstadisticaPerfilDiaria.sumar(relacion.siguiendo_id, 'seguidores_perdidos', 1));
  });

  // Borrados por condición (`Seguidor.destroy({ where })`): se leen antes las relaciones aceptadas que se van.
  Seguidor.addHook('beforeBulkDestroy', 'creadores:seguidores-perdidos', async (opciones: DestroyOptions<InferAttributes<Seguidor>>) => {
    if (!opciones.where) return;
    try {
      const filas = await Seguidor.findAll({
        where: { [Op.and]: [opciones.where, { estado: 'aceptado' }] },
        attributes: ['siguiendo_id'],
        transaction: opciones.transaction ?? null,
      });
      if (!filas.length) return;
      await alConfirmar(opciones.transaction, async () => {
        for (const fila of filas) await EstadisticaPerfilDiaria.sumar(fila.siguiendo_id, 'seguidores_perdidos', 1);
      });
    } catch (error) {
      console.warn('No se pudo registrar la estadística de seguidores:', (error as Error).message);
    }
  });
}

// ---------- Registro ----------

export function registrarModelosCreadores(sequelize: Sequelize): void {
  [HistoriaDestacada, HistoriaDestacadaItem, EventoEstadistica, EstadisticaPublicacionDiaria, EstadisticaPerfilDiaria].forEach((m) =>
    m.initModel(sequelize),
  );
  const cascada = { onDelete: 'CASCADE' as const };

  // Destacadas
  Usuario.hasMany(HistoriaDestacada, { foreignKey: 'usuario_id', as: 'destacadas', ...cascada });
  HistoriaDestacada.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
  HistoriaDestacada.belongsTo(Historia, { foreignKey: 'portada_historia_id', as: 'portadaHistoria', onDelete: 'SET NULL' });
  HistoriaDestacada.hasMany(HistoriaDestacadaItem, { foreignKey: 'destacada_id', as: 'items', ...cascada });
  HistoriaDestacadaItem.belongsTo(HistoriaDestacada, { foreignKey: 'destacada_id', as: 'destacada', ...cascada });
  HistoriaDestacadaItem.belongsTo(Historia, { foreignKey: 'historia_id', as: 'historia', ...cascada });
  Historia.hasMany(HistoriaDestacadaItem, { foreignKey: 'historia_id', as: 'enDestacadas', ...cascada });

  // Estadísticas
  EventoEstadistica.belongsTo(Usuario, { foreignKey: 'dueno_id', as: 'dueno', ...cascada });
  EventoEstadistica.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
  EventoEstadistica.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion', ...cascada });
  EstadisticaPublicacionDiaria.belongsTo(Publicacion, { foreignKey: 'publicacion_id', as: 'publicacion', ...cascada });
  EstadisticaPublicacionDiaria.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });
  EstadisticaPerfilDiaria.belongsTo(Usuario, { foreignKey: 'usuario_id', as: 'usuario', ...cascada });

  registrarHooksSeguidores();
}
