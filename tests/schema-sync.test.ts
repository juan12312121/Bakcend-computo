import { describe, expect, it } from 'vitest';
import { sequelize } from '../src/infrastructure/database/models';
import { SchemaSync } from '../src/infrastructure/database/SchemaSync';

describe('SchemaSync', () => {
  it('crea tablas faltantes y agrega columnas nuevas sin borrar datos', async () => {
    await sequelize.drop();
    const qi = sequelize.getQueryInterface();
    // Tabla "vieja" de usuarios, sin las columnas nuevas (rol, en_linea, ...)
    await qi.createTable('usuarios', {
      id: { type: 'INTEGER', primaryKey: true, autoIncrement: true },
      nombre_usuario: { type: 'VARCHAR(50)', allowNull: false },
      email: { type: 'VARCHAR(100)', allowNull: false },
      nombre_completo: { type: 'VARCHAR(150)', allowNull: false },
      contrasena: { type: 'VARCHAR(255)', allowNull: false },
    });
    await qi.bulkInsert('usuarios', [{ nombre_usuario: 'viejo', email: 'v@t.com', nombre_completo: 'Viejo', contrasena: 'x' }]);

    const cambios = await new SchemaSync(sequelize).ejecutar();

    expect(cambios).toContain('columna agregada: usuarios.en_linea');
    expect(cambios).toContain('tabla creada: publicaciones');
    const columnas = await qi.describeTable('usuarios');
    expect(columnas).toHaveProperty('rol');
    const [filas] = await sequelize.query('SELECT nombre_usuario FROM usuarios');
    expect(filas).toEqual([{ nombre_usuario: 'viejo' }]);

    // Idempotente: la segunda vez no cambia nada
    expect(await new SchemaSync(sequelize).ejecutar()).toEqual([]);
  });
});
