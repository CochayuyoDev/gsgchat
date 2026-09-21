import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { explicarErrorZod, instalarMensajesEnEspanol, nombreDeCampo } from '../src/util/mensajes-zod.js';
import { ajustesEntregasSchema } from '../src/entregas/textos.js';

describe('mensajes de validación en palabras', () => {
  instalarMensajesEnEspanol();

  it('el nombre del campo sale en palabras, nunca la clave del JSON', () => {
    expect(nombreDeCampo(['horario', 'inicio'])).toBe('la hora de inicio del horario');
    expect(nombreDeCampo(['margenMinutos'])).toBe('el margen en minutos que se suma al tiempo del motorizado');
    expect(nombreDeCampo(['telefono'])).toBe('el teléfono');
    expect(nombreDeCampo(['ritmo', 'pausaMinSeg'])).toBe('la pausa mínima entre mensajes (segundos)');
    // Lo que no está en el diccionario se deshace del camelCase y dice la fila si es una lista.
    expect(nombreDeCampo(['cosaRara'])).toBe('"cosa rara"');
    expect(nombreDeCampo(['pedidos', 2, 'otroCampo'])).toBe('"otro campo" (fila 3)');
    expect(nombreDeCampo([])).toBe('los datos');
  });

  it('un error de los ajustes de entregas se lee entero, con tildes y sin claves', () => {
    const r = ajustesEntregasSchema.deepPartial().safeParse({ margenMinutos: -5, cierreDelDia: { hora: 'mañana' } });
    expect(r.success).toBe(false);
    if (r.success) return;
    const texto = explicarErrorZod(r.error);
    expect(texto).toMatch(/^Revisa los datos: /);
    expect(texto).toContain('el margen en minutos');
    expect(texto).toContain('como mínimo');
    expect(texto).not.toContain('margenMinutos');
    expect(texto).not.toContain('cierreDelDia.hora');
    expect(texto).not.toMatch(/minimo|vacio|maximo|numero/);
  });

  it('un cuerpo con campos que faltan dice "falta este dato" con el nombre del campo', () => {
    const esquema = z.object({ telefono: z.string().min(6), nombre: z.string().min(1) });
    const r = esquema.safeParse({ telefono: '12' });
    expect(r.success).toBe(false);
    if (r.success) return;
    const texto = explicarErrorZod(r.error);
    expect(texto).toContain('el teléfono necesita al menos 6 caracteres');
    expect(texto).toContain('el nombre falta este dato');
  });
});
