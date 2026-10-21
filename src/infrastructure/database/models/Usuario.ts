import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
  type Sequelize,
} from 'sequelize';

export type RolUsuario = 'usuario' | 'admin';

export class Usuario extends Model<InferAttributes<Usuario>, InferCreationAttributes<Usuario>> {
  declare id: CreationOptional<number>;
  declare nombre_usuario: string;
  declare email: string;
  declare nombre_completo: string;
  declare contrasena: string;
  declare rol: CreationOptional<RolUsuario>;
  declare foto_perfil_url: CreationOptional<string | null>;
  declare foto_perfil_s3: CreationOptional<string | null>;
  declare foto_portada_url: CreationOptional<string | null>;
  declare foto_portada_s3: CreationOptional<string | null>;
  declare biografia: CreationOptional<string | null>;
  declare ubicacion: CreationOptional<string | null>;
  declare carrera: CreationOptional<string | null>;
  declare total_seguidores: CreationOptional<number>;
  declare total_siguiendo: CreationOptional<number>;
  declare total_posts: CreationOptional<number>;
  declare mantener_sesion: CreationOptional<boolean>;
  /** Cuenta habilitada (false = cuenta eliminada/desactivada). */
  declare activo: CreationOptional<boolean>;
  declare suspendido: CreationOptional<boolean>;
  /** Presencia: si el usuario está conectado ahora (antes se mezclaba con `activo`). */
  declare en_linea: CreationOptional<boolean>;
  declare ultima_actividad: CreationOptional<Date | null>;
  declare intentos_fallidos: CreationOptional<number>;
  declare bloqueo_hasta: CreationOptional<Date | null>;
  /** Sube al cambiar o restablecer la contraseña: invalida los JWT emitidos antes. */
  declare token_version: CreationOptional<number>;
  /** Cuenta privada: para seguirla hay que pedir permiso y sus publicaciones solo las ven sus seguidores. */
  declare cuenta_privada: CreationOptional<boolean>;
  declare email_verificado: CreationOptional<boolean>;
  declare fecha_creacion: CreationOptional<Date>;
  declare fecha_actualizacion: CreationOptional<Date>;

  /** Nunca se expone la contraseña ni los ids internos de Cloudinary. */
  override toJSON(): object {
    const { contrasena: _c, foto_perfil_s3: _p, foto_portada_s3: _q, intentos_fallidos: _i, bloqueo_hasta: _b, token_version: _v, ...publico } =
      this.get({ plain: true });
    return publico;
  }

  /** Lo que ve otra persona al abrir el perfil: sin email, rol ni datos de la cuenta. */
  perfilPublico(): object {
    const { email: _e, rol: _r, mantener_sesion: _m, activo: _a, suspendido: _s, fecha_actualizacion: _f, ...publico } =
      this.toJSON() as Record<string, unknown>;
    return publico;
  }

  static initModel(sequelize: Sequelize): typeof Usuario {
    Usuario.init(
      {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
        nombre_usuario: { type: DataTypes.STRING(50), allowNull: false, unique: true },
        email: { type: DataTypes.STRING(100), allowNull: false, unique: true },
        nombre_completo: { type: DataTypes.STRING(150), allowNull: false },
        contrasena: { type: DataTypes.STRING(255), allowNull: false },
        rol: { type: DataTypes.ENUM('usuario', 'admin'), allowNull: false, defaultValue: 'usuario' },
        foto_perfil_url: { type: DataTypes.STRING(500), allowNull: true },
        foto_perfil_s3: { type: DataTypes.STRING(300), allowNull: true },
        foto_portada_url: { type: DataTypes.STRING(500), allowNull: true },
        foto_portada_s3: { type: DataTypes.STRING(300), allowNull: true },
        biografia: { type: DataTypes.TEXT, allowNull: true },
        ubicacion: { type: DataTypes.STRING(100), allowNull: true },
        carrera: { type: DataTypes.STRING(100), allowNull: true },
        total_seguidores: { type: DataTypes.INTEGER, defaultValue: 0 },
        total_siguiendo: { type: DataTypes.INTEGER, defaultValue: 0 },
        total_posts: { type: DataTypes.INTEGER, defaultValue: 0 },
        mantener_sesion: { type: DataTypes.BOOLEAN, defaultValue: false },
        activo: { type: DataTypes.BOOLEAN, defaultValue: true },
        suspendido: { type: DataTypes.BOOLEAN, defaultValue: false },
        en_linea: { type: DataTypes.BOOLEAN, defaultValue: false },
        ultima_actividad: { type: DataTypes.DATE, allowNull: true },
        intentos_fallidos: { type: DataTypes.INTEGER, defaultValue: 0 },
        bloqueo_hasta: { type: DataTypes.DATE, allowNull: true },
        token_version: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        cuenta_privada: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        email_verificado: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
        fecha_creacion: DataTypes.DATE,
        fecha_actualizacion: DataTypes.DATE,
      },
      {
        sequelize,
        tableName: 'usuarios',
        timestamps: true,
        createdAt: 'fecha_creacion',
        updatedAt: 'fecha_actualizacion',
      },
    );
    return Usuario;
  }
}
