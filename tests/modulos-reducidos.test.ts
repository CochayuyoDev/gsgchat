import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Script } from 'node:vm';
import { crearEscenarioEntregas, type EscenarioEntregas } from './escenario-entregas.js';
import { hashClave } from '../src/auth/usuarios.js';
import { ACCIONES } from '../src/ia/acciones.js';
import { MAPA_PANEL } from '../src/ia/acciones-general.js';
import { moduloRetirado } from '../src/modulos-retirados.js';
import { openApi } from '../src/api/v1/openapi.js';

let esc: EscenarioEntregas;
const cookies = new Map<string, string>();
beforeAll(async () => {
  esc = await crearEscenarioEntregas();
  for (const rol of ['superadmin', 'admin', 'operador'] as const) {
    await esc.repos.usuarios.crear({ usuario: `reducido-${rol}`, nombre: rol, rol, clave: hashClave('Clave-123-segura') });
    const r = await esc.app.inject({ method: 'POST', url: '/login', payload: { usuario: `reducido-${rol}`, clave: 'Clave-123-segura' } });
    expect(r.statusCode).toBe(200);
    cookies.set(rol, String(r.headers['set-cookie']).split(';')[0]!);
  }
});
afterAll(async () => esc?.cerrar());

describe('aplicación centrada en API y WhatsApp', () => {
  it.each(['superadmin', 'admin', 'operador'])('retira módulos y sus endpoints para %s', async (rol) => {
    for (const url of ['/procesos', '/procesos/editor', '/personas', '/respuestas', '/pagar', '/embed.js', '/embed/chat', '/conectores/1', '/tracking/abc', '/admin/campaigns', '/admin/grupos/previsualizar', '/admin/procesos', '/admin/membresia', '/admin/tiendas', '/admin/stoky', '/api/v1/procesos', '/api/v1/embed/token', '/api/v1/stoky/conexion', '/api/v1/conectores', '/api/plan/gsg']) {
      for (const method of ['GET', 'POST'] as const) {
        const r = await esc.app.inject({ method, url, headers: { cookie: cookies.get(rol)! }, ...(method === 'POST' ? { payload: {} } : {}) });
        expect(r.statusCode, `${method} ${url}`).toBe(404);
        expect(r.json()).toMatchObject({ ok: false, codigo: 'RUTA_NO_EXISTE' });
      }
    }
  });
  it('conserva pantallas y scripts válidos sin formularios de módulos retirados', async () => {
    for (const url of ['/panel', '/hoy', '/chat', '/mapa', '/setup', '/conexion-gsg', '/salud', '/automatizacion-gsg', '/cuentas', '/entrenamiento', '/manual']) {
      const r = await esc.app.inject({ url, headers: { cookie: cookies.get('superadmin')! } });
      expect(r.statusCode, url).toBe(200);
      expect(r.body).not.toMatch(/href="\/(?:procesos|personas|respuestas|pagar|panel#campanas|panel#grupos|panel#membresia)(?:"|\?)/);
      expect(r.body).not.toContain('id="tab-membresia"');
      expect(r.body).not.toContain('id="tab-campanas"');
      for (const m of r.body.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) expect(() => new Script(m[1]!)).not.toThrow();
    }
  });
  it('los enlaces de módulos fusionados llevan a la pantalla única', async () => {
    for (const [origen, destino] of [['/numeros', '/hoy'], ['/tiendas', '/cuentas'], ['/fiabilidad', '/salud'], ['/rutas', '/automatizacion-gsg'], ['/envio-automatico', '/automatizacion-gsg']]) {
      const r = await esc.app.inject({ url: origen!, headers: { cookie: cookies.get('admin')! } });
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toBe(destino);
    }
  });
  it('las pantallas nuevas exigen sesión', async () => {
    for (const url of ['/salud', '/cuentas', '/automatizacion-gsg']) {
      const r = await esc.app.inject({ url });
      expect(r.statusCode).toBe(302);
      expect(r.headers.location).toContain('/login');
    }
  });
  it('IA y OpenAPI no ofrecen funciones retiradas', () => {
    expect(ACCIONES.some((a) => /^(procesos|personas|respuestas|campanas|campana|grupos|tracking|stoky|catalogo|membresia|tiendas|lista)\./.test(a.nombre))).toBe(false);
    expect(MAPA_PANEL.some((s) => s.rutas.some((r) => moduloRetirado(r.ruta)))).toBe(false);
    const doc = openApi('http://localhost') as { paths: Record<string, unknown> };
    expect(Object.keys(doc.paths).some((p) => /^\/(procesos|stoky|embed|conectores)(\/|$)/.test(p))).toBe(false);
  });
  it('plantillas, roles y salud siguen operativos después de la reducción', async () => {
    const cookie = cookies.get('superadmin')!;
    const tpl = await esc.app.inject({ method: 'POST', url: '/admin/templates', headers: { cookie }, payload: { name: 'ubicacion_cliente_reducido', language: 'es', body: 'Hola {{1}}, comparte tu ubicación para tu pedido.', variables: ['cliente'], category: 'UTILITY' } });
    expect(tpl.statusCode).toBe(200);
    expect((await esc.app.inject({ url: '/admin/templates', headers: { cookie } })).json().some((t: { name: string }) => t.name === 'ubicacion_cliente_reducido')).toBe(true);
    expect((await esc.app.inject({ url: '/admin/health', headers: { cookie } })).statusCode).toBe(200);
    const sinPermiso = await esc.app.inject({ method: 'POST', url: '/admin/usuarios', headers: { cookie: cookies.get('operador')! }, payload: { usuario: 'intruso', nombre: 'Intruso', clave: 'Clave-123-segura' } });
    expect(sinPermiso.statusCode).toBe(403);
  });
});
