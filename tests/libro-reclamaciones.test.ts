/**
 * Libro de Reclamaciones: el formulario valida lo que pide la norma, cada hoja
 * sale con su codigo correlativo, la constancia lleva los datos del proveedor
 * y el superadministrador la responde.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { codigoDe, crearLibroReclamaciones, reclamoSchema, venceEl, type LibroReclamaciones } from '../src/plataforma/reclamos.js';
import { hojaReclamo, libroReclamacionesPage, reclamosRecibidosPage } from '../src/web/libro-reclamaciones-page.js';
import { datosLegalesDelEntorno } from '../src/web/legal-pages.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

const BUENO = {
  tipo: 'reclamo', nombre: 'Ana Torres Ríos', documentoTipo: 'DNI', documentoNumero: '45678912', domicilio: 'Av. Universitaria 123, Los Olivos',
  telefono: '987 654 321', correo: 'Ana@Correo.pe', menorDeEdad: false, bienTipo: 'servicio', monto: '25.00',
  bienDescripcion: 'Envío del pedido 12345', detalle: 'El paquete llegó abierto y faltaba un producto.', pedido: 'Que me devuelvan el costo del envío.', acepta: true,
};

describe('el formulario y la hoja', () => {
  it('valida lo obligatorio y pide el apoderado si es menor', () => {
    expect(reclamoSchema.safeParse(BUENO).success).toBe(true);
    expect(reclamoSchema.safeParse({ ...BUENO, acepta: false }).success).toBe(false);
    expect(reclamoSchema.safeParse({ ...BUENO, correo: 'no-es-correo' }).success).toBe(false);
    expect(reclamoSchema.safeParse({ ...BUENO, detalle: 'corto' }).success).toBe(false);
    const menor = reclamoSchema.safeParse({ ...BUENO, menorDeEdad: true, apoderado: '' });
    expect(menor.success).toBe(false);
    expect(menor.error?.issues[0]?.path[0]).toBe('apoderado');
    expect(reclamoSchema.safeParse({ ...BUENO, menorDeEdad: true, apoderado: 'Luis Torres' }).success).toBe(true);
  });

  it('el código es correlativo por año y el plazo es de 15 días hábiles', () => {
    expect(codigoDe(7, new Date('2026-11-10T12:00:00Z'))).toBe('LR-2026-000007');
    // Martes 10/11/2026 + 15 días hábiles = martes 01/12/2026.
    expect(venceEl(new Date('2026-11-10T12:00:00Z')).toISOString().slice(0, 10)).toBe('2026-12-01');
  });

  it('la página lleva los datos de GSG, las definiciones y el aviso del INDECOPI', () => {
    const html = libroReclamacionesPage(datosLegalesDelEntorno({} as NodeJS.ProcessEnv));
    expect(html).toContain('RUC 20605545158');
    expect(html).toContain('GESTIÓN DE SERVICIOS GENERALES M &amp; A S.A.C.');
    expect(html).toContain('15 días hábiles');
    expect(html).toContain('INDECOPI');
    expect(html).toMatch(/<b>Reclamo:<\/b>.*<b>Queja:<\/b>/s);
    expect(html).not.toMatch(/undefined|\$\{/);
    expect(reclamosRecibidosPage(datosLegalesDelEntorno({} as NodeJS.ProcessEnv))).toContain('/admin/reclamos');
  });
});

describe('guardar y responder (MySQL)', () => {
  let b: BaseDePrueba;
  let libro: LibroReclamaciones;

  beforeAll(async () => {
    b = await baseDePrueba();
    libro = await crearLibroReclamaciones(b.pool);
  }, 300_000);

  afterAll(async () => {
    await b?.cerrar();
  });

  it('registra con código, escapa en la hoja y queda pendiente hasta responder', async () => {
    const r1 = await libro.registrar(reclamoSchema.parse(BUENO), '127.0.0.1');
    const r2 = await libro.registrar(reclamoSchema.parse({ ...BUENO, tipo: 'queja', nombre: '<script>x</script> Pérez' }), null);
    expect(r1.codigo).toMatch(/^LR-\d{4}-\d{6}$/);
    expect(r2.id).toBe(r1.id + 1);
    expect(r1.correo).toBe('ana@correo.pe');
    expect(await libro.pendientes()).toBe(2);

    const hoja = hojaReclamo(r2, datosLegalesDelEntorno({} as NodeJS.ProcessEnv));
    expect(hoja).not.toContain('<script>x</script>');
    expect(hoja).toContain('Queja');
    expect(hoja).toContain('RUC 20605545158');

    const respondido = await libro.responder(r1.codigo, 'Te devolvimos el costo del envío.', 'superadministrador');
    expect(respondido?.estado).toBe('respondido');
    expect(respondido?.respondidoAt).toBeInstanceOf(Date);
    expect(await libro.pendientes()).toBe(1);
    // Primero los pendientes.
    expect((await libro.listar())[0]!.codigo).toBe(r2.codigo);
    expect(await libro.responder('LR-0000-000000', 'nada', 'x')).toBeNull();
    // Crear el libro otra vez no rompe ni borra.
    const otra = await crearLibroReclamaciones(b.pool);
    expect((await otra.listar()).length).toBe(2);
  });
});
