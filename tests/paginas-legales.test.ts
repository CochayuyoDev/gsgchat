/**
 * Las paginas que pide Meta: privacidad, terminos, eliminacion de datos y el
 * indice con lo que va en cada casilla. Se comprueba que digan lo que el
 * sistema hace, que no inventen datos del responsable y que escapen lo que
 * viene del entorno.
 */

import { describe, expect, it } from 'vitest';
import {
  datosLegalesDelEntorno,
  eliminacionPage,
  faltanDatosLegales,
  legalIndicePage,
  privacidadPage,
  terminosPage,
} from '../src/web/legal-pages.js';

const COMPLETO = {
  LEGAL_NOMBRE_COMERCIAL: 'GSGchat',
  LEGAL_RAZON_SOCIAL: 'Servicios Logísticos GSG S.A.C.',
  LEGAL_RUC: '20 123 456 789',
  LEGAL_DIRECCION: 'Av. Ejemplo 123, Lima',
  LEGAL_CORREO: 'privacidad@ejemplo.pe',
  LEGAL_TELEFONO: '+51 999 888 777',
} as NodeJS.ProcessEnv;

describe('paginas legales', () => {
  it('con todos los datos: responsable, RUC, contacto y la ley peruana', () => {
    const d = datosLegalesDelEntorno(COMPLETO);
    expect(d.ruc).toBe('20123456789');
    expect(faltanDatosLegales(d)).toEqual([]);
    const html = privacidadPage(d);
    expect(html).toContain('Servicios Logísticos GSG S.A.C.');
    expect(html).toContain('RUC 20123456789');
    expect(html).toContain('mailto:privacidad@ejemplo.pe');
    expect(html).toContain('Ley N.º 29733');
    expect(html).toContain('Autoridad Nacional de Protección de Datos Personales');
    // Lo que el sistema hace de verdad: el chat vive 72 h.
    expect(html).toContain('a las 72 horas');
    expect(html).toContain('<html lang="es-PE">');
  });

  it('sin datos del responsable no inventa nada ni deja huecos', () => {
    const d = datosLegalesDelEntorno({} as NodeJS.ProcessEnv, {});
    expect(faltanDatosLegales(d)).toEqual(['la razón social', 'el RUC', 'la dirección', 'el correo de contacto']);
    for (const html of [privacidadPage(d), terminosPage(d), eliminacionPage(d), legalIndicePage(d, 'https://x.test')]) {
      expect(html).not.toMatch(/undefined|null|RUC\s*[,.<]|mailto:"/);
      expect(html).toContain('por el mismo chat de WhatsApp');
    }
  });

  it('sin LEGAL_* en el entorno salen los datos públicos de GSG, y el entorno manda', () => {
    const d = datosLegalesDelEntorno({ LEGAL_RUC: '' } as NodeJS.ProcessEnv);
    expect(faltanDatosLegales(d)).toEqual([]);
    expect(d.ruc).toBe('20605545158');
    const html = privacidadPage(d);
    expect(html).toContain('GESTIÓN DE SERVICIOS GENERALES M &amp; A S.A.C.');
    expect(html).toContain('asuntos-legales@gsgcorppe.com');
    expect(datosLegalesDelEntorno({ LEGAL_CORREO: 'otro@ejemplo.pe' } as NodeJS.ProcessEnv).correo).toBe('otro@ejemplo.pe');
  });

  it('escapa lo que viene del entorno', () => {
    const d = datosLegalesDelEntorno({ LEGAL_RAZON_SOCIAL: '<script>alert(1)</script>' } as NodeJS.ProcessEnv);
    expect(privacidadPage(d)).not.toContain('<script>alert(1)</script>');
    expect(privacidadPage(d)).toContain('&lt;script&gt;');
  });

  it('el indice da las tres direcciones para la app de Meta', () => {
    const html = legalIndicePage(datosLegalesDelEntorno(COMPLETO), 'https://gsgchat.pe/');
    expect(html).toContain('https://gsgchat.pe/privacidad');
    expect(html).toContain('https://gsgchat.pe/terminos');
    expect(html).toContain('https://gsgchat.pe/eliminacion-de-datos');
    expect(html).toContain('privacidad@ejemplo.pe');
  });

  it('terminos y eliminacion: politicas de WhatsApp, baja y pasos para borrar', () => {
    const d = datosLegalesDelEntorno(COMPLETO);
    const t = terminosPage(d);
    expect(t).toContain('whatsapp.com/legal/business-policy');
    expect(t).toContain('BAJA');
    expect(t).toContain('República del Perú');
    const e = eliminacionPage(d);
    expect(e).toContain('Eliminar mis datos');
    expect(e).toContain('respondas <b>SÍ</b>');
  });
});
