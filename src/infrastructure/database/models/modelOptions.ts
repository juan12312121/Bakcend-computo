import type { InitOptions, Model, Sequelize } from 'sequelize';

/** Tablas que solo guardan `fecha_creacion` (la mayoría). */
export function conFechaCreacion<M extends Model>(sequelize: Sequelize, tableName: string, campo = 'fecha_creacion'): InitOptions<M> {
  return { sequelize, tableName, timestamps: true, createdAt: campo, updatedAt: false };
}

/** Tablas con `fecha_creacion` y `fecha_actualizacion`. */
export function conFechas<M extends Model>(sequelize: Sequelize, tableName: string): InitOptions<M> {
  return { sequelize, tableName, timestamps: true, createdAt: 'fecha_creacion', updatedAt: 'fecha_actualizacion' };
}
