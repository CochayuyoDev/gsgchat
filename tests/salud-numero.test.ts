import { describe, expect, it } from 'vitest';
import { crearNumeroVigente, esIdentidadLocal, identidadDeNumero, telefonoDeIdentidad } from '../src/salud/numero.js';

describe('la salud se guarda por numero, no en una fila comun', () => {
  it('con la API de Meta, la clave es el id del numero', () => {
    expect(identidadDeNumero({ proveedor: 'cloud', phoneNumberId: '123456789' })).toBe('123456789');
    // Sin id configurado todavia: lo de siempre, para no perder la fila que ya existia.
    expect(identidadDeNumero({ proveedor: 'cloud', phoneNumberId: '' })).toBe('local');
  });

  it('con Baileys o WAHA, la clave lleva el telefono vinculado', () => {
    expect(identidadDeNumero({ proveedor: 'local', telefono: '51987654321' })).toBe('local:51987654321');
    expect(identidadDeNumero({ proveedor: 'waha', telefono: '+51 987 654 321' })).toBe('local:51987654321');
  });

  it('un numero nuevo NO hereda el castigo del anterior: son claves distintas', () => {
    const viejo = identidadDeNumero({ proveedor: 'local', telefono: '51987654321' });
    const nuevo = identidadDeNumero({ proveedor: 'local', telefono: '51912345678' });
    expect(nuevo).not.toBe(viejo);
    // Y volver al de antes recupera SU historial, no el del otro.
    expect(identidadDeNumero({ proveedor: 'local', telefono: '51987654321' })).toBe(viejo);
  });

  it('mientras no se sabe el telefono, la clave de siempre', () => {
    expect(identidadDeNumero({ proveedor: 'local', telefono: '' })).toBe('local');
    expect(identidadDeNumero({ proveedor: 'waha', telefono: null })).toBe('local');
  });

  it('se reconoce una clave local y se saca su telefono', () => {
    expect(esIdentidadLocal('local')).toBe(true);
    expect(esIdentidadLocal('local:51987654321')).toBe(true);
    expect(esIdentidadLocal('123456789')).toBe(false);
    expect(telefonoDeIdentidad('local:51987654321')).toBe('51987654321');
    expect(telefonoDeIdentidad('local')).toBe(null);
    expect(telefonoDeIdentidad('123456789')).toBe(null);
  });

  it('el telefono que anota el proveedor se guarda en digitos y se olvida al desvincular', () => {
    const vigente = crearNumeroVigente();
    expect(vigente.actual()).toBe('');
    vigente.anotar('+51 987 654 321');
    expect(vigente.actual()).toBe('51987654321');
    vigente.anotar('');
    expect(vigente.actual()).toBe('');
  });
});
