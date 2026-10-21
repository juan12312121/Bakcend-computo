import { describe, expect, it } from 'vitest';
import { opcionesSsl } from '../src/config/database';

describe('Conexión cifrada a MySQL (DB_SSL)', () => {
  it('sin DB_SSL no usa TLS (MySQL local)', () => {
    expect(opcionesSsl({ DB_SSL: false, DB_SSL_CA: 'x' })).toBeUndefined();
  });

  it('con DB_SSL y sin certificado cifra sin verificar', () => {
    expect(opcionesSsl({ DB_SSL: true, DB_SSL_CA: undefined })).toEqual({ rejectUnauthorized: false });
  });

  it('con certificado verifica el servidor y acepta saltos de línea escritos como \\n', () => {
    const ssl = opcionesSsl({ DB_SSL: true, DB_SSL_CA: '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----\\n' });
    expect(ssl).toEqual({ ca: '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----', rejectUnauthorized: true });
  });
});
