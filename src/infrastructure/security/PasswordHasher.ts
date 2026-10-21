import bcrypt from 'bcryptjs';

export class PasswordHasher {
  constructor(private readonly rondas = 10) {}

  encriptar(texto: string): Promise<string> {
    return bcrypt.hash(texto, this.rondas);
  }

  comparar(texto: string, hash: string): Promise<boolean> {
    return bcrypt.compare(texto, hash);
  }
}

export const passwordHasher = new PasswordHasher();
