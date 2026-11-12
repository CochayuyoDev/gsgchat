import { describe, expect, it } from 'vitest';
import { chatPage } from '../src/web/chat-page.js';
import { crearEscenarioEntregas } from './escenario-entregas.js';
import { hashClave } from '../src/auth/usuarios.js';
import { COOKIE_SESION, firmarSesion } from '../src/auth/sesion.js';
import { secretoDeSesion } from '../src/auth/routes.js';
import { loadConfig } from '../src/config.js';

// Cada mensaje saliente lleva una nota chica con quien lo mando: bot, IA, usuario de GSGchat (con su rol) o usuario de GSG.

const config = loadConfig({ PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'mysql://x/y', TIMEZONE: 'America/Lima', TRACKING_SECRET: 'x'.repeat(40) });

/** La funcion `quienMando` tal como la lleva la pagina, para probarla sin navegador. */
function quienMandoDeLaPagina(): (m: unknown) => string {
  const html = chatPage({ proveedor: 'local', configured: true, nombreNegocio: 'Prueba' });
  const ini = html.indexOf('function quienMando');
  const fin = html.indexOf('/**', ini);
  const esc = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return new Function('esc', `${html.slice(ini, fin)}; return quienMando;`)(esc) as (m: unknown) => string;
}

const texto = (html: string) => html.replace(/<[^>]+>/g, '');

describe('quien mando cada mensaje', () => {
  const quien = quienMandoDeLaPagina();

  it('los entrantes no llevan nota', () => {
    expect(quien({ direction: 'in', payload: {} })).toBe('');
  });

  it('lo automatico es del Bot, tambien un texto fijo del asistente', () => {
    expect(texto(quien({ direction: 'out', payload: { origen: 'sistema' } }))).toBe('Bot');
    expect(texto(quien({ direction: 'out', payload: { origen: 'ia', textoFijo: true } }))).toBe('Bot');
    expect(texto(quien({ direction: 'out', payload: null }))).toBe('Bot');
  });

  it('lo que escribe el asistente es de la IA', () => {
    expect(texto(quien({ direction: 'out', payload: { origen: 'ia' } }))).toBe('IA');
  });

  it('una persona de GSGchat sale con su nombre y su rol', () => {
    expect(texto(quien({ direction: 'out', payload: { origen: 'persona', autorNombre: 'Ali', autorRol: 'admin' } }))).toBe('Ali · administrador');
    expect(texto(quien({ direction: 'out', payload: { origen: 'persona', autorNombre: 'Rosa', autorRol: 'operador' } }))).toBe('Rosa · operador');
    expect(texto(quien({ direction: 'out', payload: { origen: 'persona', autorNombre: 'Ali' } }))).toBe('Ali');
    expect(texto(quien({ direction: 'out', payload: { origen: 'persona', autorNombre: 'Teléfono' } }))).toBe('Teléfono');
  });

  it('un usuario de GSG sale como GSG con su nombre; el rol queda en el detalle', () => {
    const html = quien({ direction: 'out', payload: { origen: 'persona', autorNombre: 'Mario', emisor: { tipo: 'gsg', usuarioId: 'm1', rol: 'motorizado' } } });
    expect(texto(html)).toBe('GSG · Mario');
    expect(html).toContain('title="Usuario de GSG (motorizado)"');
  });

  it('el nombre no puede meter HTML en la pagina', () => {
    expect(quien({ direction: 'out', payload: { origen: 'persona', autorNombre: '<img src=x onerror=1>' } })).not.toContain('<img');
  });
});

describe('el rol de quien escribe desde el chat se guarda en el hilo', () => {
  it('un administrador y un operador quedan firmados con su rol', async () => {
    const e = await crearEscenarioEntregas();
    try {
      // El cliente escribe: se abre la ventana de 24 h y se puede contestar.
      await e.contesta('987603555', { texto: 'hola' });
      const contacto = (await e.repos.contacts.getByPhone('51987603555'))!;
      const envia = async (rol: 'admin' | 'operador', usuario: string, nombre: string) => {
        const u = await e.repos.usuarios.crear({ usuario, nombre, rol, clave: hashClave('Clave-123-segura') });
        const cookie = `${COOKIE_SESION}=${firmarSesion(secretoDeSesion(config), { u: u.id, v: u.sesionVersion })}`;
        const r = await e.app.inject({ method: 'POST', url: '/admin/chat/send', headers: { cookie, 'content-type': 'application/json' }, payload: JSON.stringify({ contactId: contacto.id, text: `de ${nombre}` }) });
        expect(r.statusCode).toBeLessThan(300);
      };
      await envia('admin', 'adminrol', 'Ali Admin');
      await envia('operador', 'operrol', 'Rosa Oper');
      const salientes = e.repos.messages._all.filter((m) => m.direction === 'out');
      const de = (t: string) => salientes.find((m) => m.body === t)?.payload as Record<string, unknown> | undefined;
      expect(de('de Ali Admin')).toMatchObject({ origen: 'persona', autorNombre: 'Ali', autorRol: 'admin' });
      expect(de('de Rosa Oper')).toMatchObject({ origen: 'persona', autorNombre: 'Rosa', autorRol: 'operador' });
    } finally {
      await e.cerrar();
    }
  });
});

describe('la nota de quien mando es interna: no sale a GSG', () => {
  it('ni el webhook mensaje.enviado ni el historial llevan el rol', async () => {
    const { crearBus } = await import('../src/eventos/bus.js');
    const { observarRepos } = await import('../src/eventos/observar.js');
    const { generarClaveApi, hashClaveApi, prefijoDeClave } = await import('../src/auth/claves-api.js');
    const { OBLIGATORIOS_GSG } = await import('./escenario-entregas.js');
    const e = await crearEscenarioEntregas({ confirmarLista: true });
    try {
      const lectura = generarClaveApi();
      await e.repos.claves.crear({ nombre: 'GSG lee', hash: hashClaveApi(lectura), prefijo: prefijoDeClave(lectura), creadaPor: null, permisos: ['entregas:gestionar', 'conversaciones:leer'] });
      const r = await e.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: { 'x-api-key': lectura, 'content-type': 'application/json' }, payload: JSON.stringify({ ...OBLIGATORIOS_GSG, tracking: 'ROL-1', telefono: '987650077', cliente: 'Ana' }) });
      expect(r.statusCode).toBe(201);
      await e.contesta('987650077', { texto: 'hola' });
      const c = (await e.repos.contacts.getByPhone('51987650077'))!;

      const bus = crearBus();
      const vistos: Array<{ nombre: string; payload: any }> = [];
      bus.escucharTodo((nombre, payload) => { vistos.push({ nombre, payload }); });
      await observarRepos(e.repos, bus).messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: 'wamid.rol.1', body: 'te ayudo', payload: { origen: 'persona', autorNombre: 'Ali', autorRol: 'admin' } });
      const enviado = vistos.find((x) => x.nombre === 'mensaje.enviado')!.payload;
      expect(enviado.mensaje.autorNombre).toBe('Ali');
      expect(JSON.stringify(enviado)).not.toContain('autorRol');

      const historial = (await e.app.inject({ method: 'GET', url: '/api/v1/historial?tracking=ROL-1', headers: { 'x-api-key': lectura } })).json().mensajes as any[];
      const suyo = historial.find((m) => m.texto === 'te ayudo');
      expect(suyo).toBeTruthy();
      expect(suyo.autorNombre).toBe('Ali');
      expect(JSON.stringify(historial)).not.toContain('autorRol');
      // Dentro de GSGchat si se guarda: el chat lo muestra como nota.
      expect(e.repos.messages._all.find((m) => m.wamid === 'wamid.rol.1')?.payload).toMatchObject({ autorRol: 'admin' });
    } finally {
      await e.cerrar();
    }
  });
});
