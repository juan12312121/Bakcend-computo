import { DataTypes, type ModelStatic, type Model, type QueryInterface, type Sequelize } from 'sequelize';

/**
 * Lleva una base existente al esquema de los modelos sin perder datos:
 *  - crea las tablas que falten,
 *  - agrega las columnas que falten,
 *  - amplía los ENUM a los que les falten valores.
 * Se usa en lugar de sync({ alter: true }), que en MySQL duplica índices UNIQUE en cada ejecución.
 */
export class SchemaSync {
  private readonly qi: QueryInterface;

  constructor(private readonly sequelize: Sequelize) {
    this.qi = sequelize.getQueryInterface();
  }

  async ejecutar(): Promise<string[]> {
    const cambios: string[] = [];
    const existentes = new Set((await this.qi.showAllTables()).map((t) => String(t).toLowerCase()));

    for (const modelo of this.modelosEnOrden()) {
      const tabla = modelo.getTableName() as string;
      if (!existentes.has(tabla.toLowerCase())) {
        await modelo.sync();
        cambios.push(`tabla creada: ${tabla}`);
        continue;
      }
      cambios.push(...(await this.completarColumnas(modelo, tabla)));
    }
    return cambios;
  }

  private async completarColumnas(modelo: ModelStatic<Model>, tabla: string): Promise<string[]> {
    const cambios: string[] = [];
    const actuales = await this.qi.describeTable(tabla);

    for (const [nombre, atributo] of Object.entries(modelo.getAttributes())) {
      const columna = atributo.field ?? nombre;
      const actual = actuales[columna];

      if (!actual) {
        const { primaryKey: _pk, autoIncrement: _ai, unique: _u, references: _r, ...definicion } = atributo;
        await this.qi.addColumn(tabla, columna, definicion);
        cambios.push(`columna agregada: ${tabla}.${columna}`);
        continue;
      }

      // Solo aplica a motores con ENUM nativo (MySQL); SQLite los guarda como TEXT.
      if (atributo.type instanceof DataTypes.ENUM && actual.type.toUpperCase().startsWith('ENUM')) {
        // describeTable de MySQL devuelve el tipo en mayúsculas: ENUM('LIKE','COMMENT',...)
        const tipoActual = actual.type.toUpperCase();
        const faltan = (atributo.type as unknown as { values: string[] }).values.filter(
          (v) => !tipoActual.includes(`'${v.toUpperCase()}'`),
        );
        if (faltan.length) {
          const { primaryKey: _pk, autoIncrement: _ai, unique: _u, references: _r, ...definicion } = atributo;
          await this.qi.changeColumn(tabla, columna, definicion);
          cambios.push(`enum ampliado: ${tabla}.${columna} (+${faltan.join(', ')})`);
        }
      }
    }
    return cambios;
  }

  /** Padres antes que hijos, para que las llaves foráneas de tablas nuevas encuentren su tabla. */
  private modelosEnOrden(): ModelStatic<Model>[] {
    const modelos = Object.values(this.sequelize.models);
    const ordenados: ModelStatic<Model>[] = [];
    const visitados = new Set<string>();

    const visitar = (m: ModelStatic<Model>) => {
      if (visitados.has(m.name)) return;
      visitados.add(m.name);
      for (const asociacion of Object.values(m.associations)) {
        if (asociacion.associationType === 'BelongsTo' && asociacion.target !== m) visitar(asociacion.target);
      }
      ordenados.push(m);
    };
    modelos.forEach(visitar);
    return ordenados;
  }
}
