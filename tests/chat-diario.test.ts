import { afterEach, describe, expect, it, vi } from 'vitest';
import Fastify from 'fastify';
import { createFakeRepos, createMemorySettingsRepo, TEST_SETTINGS_KEY } from './fakes.js';
import { createSettingsService } from '../src/settings/service.js';
import { loadConfig } from '../src/config.js';
import { perteneceAlChatActual } from '../src/whatsapp/alcance-chat.js';
import { registrarLimpiezaChat } from '../src/whatsapp/limpieza-chat.js';
import { chatPage } from '../src/web/chat-page.js';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, PIN_LIMA } from './escenario-entregas.js';
import { hashClave } from '../src/auth/usuarios.js';
import { COOKIE_SESION, firmarSesion } from '../src/auth/sesion.js';
import { secretoDeSesion } from '../src/auth/routes.js';
import { alcanceChat } from '../src/web/alcance-chat.js';

const config = loadConfig({ PUBLIC_BASE_URL: 'http://localhost:3000', DATABASE_URL: 'mysql://x/y', TIMEZONE: 'America/Lima', TRACKING_SECRET: 'x'.repeat(40) });
afterEach(() => vi.useRealTimers());

describe('chat del día, iniciado únicamente por GSGchat', () => {
  it('una cookie antigua autenticada abre el chat sin cursor y conserva el límite de 24 horas', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const usuario = await e.repos.usuarios.crear({ usuario: 'operadorlegacy', nombre: 'Legacy', rol: 'admin', clave: hashClave('Clave-123-segura') });
      const token = firmarSesion(secretoDeSesion(config), { u: usuario.id, v: usuario.sesionVersion });
      const cookie = `${COOKIE_SESION}=${token}`;
      const contacto = await e.repos.contacts.upsertFromInbound('51987603332', 'Cliente');
      await e.repos.messages.add({ contactId: contacto.id, direction: 'out', kind: 'text', wamid: 'legacy.actual', body: 'pedido vigente', payload: { origen: 'sistema' } });
      await e.repos.messages.add({ contactId: contacto.id, direction: 'out', kind: 'text', wamid: 'legacy.antiguo', body: 'pedido antiguo', payload: { origen: 'sistema' } });
      e.repos.messages._all.find(m => m.wamid === 'legacy.antiguo')!.storedAt = new Date(Date.now() - 25 * 60 * 60 * 1000);
      const lista = await e.app.inject({ url: '/admin/chat/conversations', headers: { cookie } });
      expect(lista.statusCode).toBe(200);
      expect(lista.json().items).toHaveLength(1);
      const hilo = await e.app.inject({ url: `/admin/chat/${contacto.id}?limit=30`, headers: { cookie } });
      expect(hilo.statusCode).toBe(200);
      expect(hilo.json().messages.map((m: { body: string }) => m.body)).toEqual(['pedido vigente']);
      expect(() => alcanceChat(null)).toThrow(expect.objectContaining({ statusCode: 401 }));
    } finally { await e.cerrar(); }
  });

  it('con la vista diaria activa un pedido de GSG recibe el pin, lo confirma y lo reporta', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.settings.iniciarVistaChat!(new Date(e.ahora().getTime()-1000));
      await e.api.post('/api/v1/entregas', { ...OBLIGATORIOS_GSG, tracking: 'DIA-1', cliente: 'Cliente de prueba', telefono: '987604444' });
      await e.trabajar();
      const antes = e.mensajesA('987604444').length;
      await e.contesta('987604444', { pin: PIN_LIMA });
      expect((await e.entrega('DIA-1'))?.ubicacionEstado).toBe('recibida');
      expect(e.mensajesA('987604444')).toHaveLength(antes+1);
      expect(e.repos.decisiones._todas).toHaveLength(0);
      const antesPersonal = e.repos.messages._all.length;
      await e.contesta('987604555', { texto: 'hola, conversación personal' });
      expect(e.repos.messages._all).toHaveLength(antesPersonal);
      expect(await e.repos.contacts.getByPhone('51987604555')).toBeNull();
    } finally { await e.cerrar(); }
  });
  it('la próxima vinculación fija el corte y lo conserva al reiniciar sin cambiar a medianoche', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T18:00:00Z'));
    const repo = createMemorySettingsRepo();
    const settings = await createSettingsService(repo, config, TEST_SETTINGS_KEY);
    expect(settings.vistaChatDesde!()).toBeNull();
    await settings.iniciarVistaChat!();
    const reinicio = await createSettingsService(repo, config, TEST_SETTINGS_KEY);
    expect(reinicio.vistaChatDesde!()?.toISOString()).toBe('2026-10-14T18:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-15T04:59:59Z'));
    expect(reinicio.vistaChatDesde!()?.toISOString()).toBe('2026-10-14T18:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-15T05:00:00Z'));
    expect(reinicio.vistaChatDesde!()?.toISOString()).toBe('2026-10-14T18:00:00.000Z');
  });

  it('no muestra conversaciones viejas o personales y solo acepta respuestas de clientes a los que escribió el sistema', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-14T18:00:00Z'));
    const repos = createFakeRepos();
    const settings = await createSettingsService(createMemorySettingsRepo(), config, TEST_SETTINGS_KEY);
    await settings.iniciarVistaChat!();
    const desde = settings.vistaChatDesde!()!;
    const cliente = await repos.contacts.upsertFromInbound('51987603111');
    const personal = await repos.contacts.upsertFromInbound('51987603222');
    const antiguo = await repos.contacts.upsertFromInbound('51987603333');
    const add = (id: string, direction: 'in' | 'out', body: string, createdAt: Date, payload = {}) => repos.messages.add({ contactId: id, direction, body, kind: 'text', wamid: body, createdAt, payload });
    await add(antiguo.id, 'out', 'pedido de ayer', new Date('2026-10-13T18:00:00Z'));
    await add(cliente.id, 'in', 'texto anterior a conectar', new Date('2026-10-14T17:00:00Z'));
    await add(personal.id, 'out', 'desde el teléfono', desde, { origen: 'persona', autorNombre: 'Teléfono' });
    await add(cliente.id, 'out', 'solicitud del sistema', desde, { origen: 'sistema' });
    await add(cliente.id, 'in', 'su respuesta', desde);
    await add(cliente.id, 'in', 'historial importado', desde, { historial: true });
    const lista = await repos.messages.listConversations({ desde, limit: 100, offset: 0 });
    expect(lista.map(c => c.contactId)).toEqual([cliente.id]);
    expect((await repos.messages.listMessages(cliente.id, 80, undefined, desde)).map(m => m.body)).toEqual(['solicitud del sistema', 'su respuesta']);
    expect(await repos.messages.unreadTotal(desde)).toBe(1);
    const entrada = { from: cliente.phone, timestamp: String(desde.getTime() / 1000) };
    expect(await perteneceAlChatActual(repos, settings, entrada)).toBe(true);
    expect(await perteneceAlChatActual(repos, settings, { ...entrada, from: personal.phone })).toBe(false);
    expect(await perteneceAlChatActual(repos, settings, { ...entrada, from: '51987603999' })).toBe(false);
    expect(await perteneceAlChatActual(repos, settings, { ...entrada, historial: true })).toBe(false);
    expect(await perteneceAlChatActual(repos, settings, { ...entrada, viejo: true })).toBe(false);
  });

  it('un nuevo login conserva los chats que aún están dentro de las últimas 24 horas', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const c = await e.repos.contacts.upsertFromInbound('51987603331', 'Sesión');
      await e.repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: 'sesion.previo', body: 'anterior', status: 'sent', payload: { origen: 'sistema' } });
      await e.repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', wamid: 'sesion.previo.in', body: 'respuesta anterior' });
      await e.repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: 'sesion.antiguo', body: 'fuera de retención', status: 'sent', payload: { origen: 'sistema' } });
      const filaAntigua = e.repos.messages._all.find(m => m.wamid === 'sesion.antiguo');
      if (filaAntigua) filaAntigua.storedAt = new Date(Date.now() - 24 * 60 * 60 * 1000 - 1000);
      await e.repos.usuarios.crear({ usuario: 'operadoruno', nombre: 'Uno', rol: 'admin', clave: hashClave('Clave-123-segura') });
      const login1 = await e.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'operadoruno', clave: 'Clave-123-segura' } });
      const cookie1 = String(login1.headers['set-cookie']).split(';')[0]!;
      expect((await e.app.inject({ url: '/admin/chat/conversations', headers: { cookie: cookie1 } })).json().items).toHaveLength(1);
      await e.repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: 'sesion.despues1', body: 'nuevo uno', status: 'sent', payload: { origen: 'sistema' } });
      await e.repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', wamid: 'sesion.respuesta1', body: 'respuesta uno' });
      expect((await e.app.inject({ url: '/admin/chat/conversations', headers: { cookie: cookie1 } })).json().items).toHaveLength(1);
      await e.repos.usuarios.crear({ usuario: 'operadordos', nombre: 'Dos', rol: 'admin', clave: hashClave('Clave-123-segura') });
      const login2 = await e.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'operadordos', clave: 'Clave-123-segura' } });
      const cookie2 = String(login2.headers['set-cookie']).split(';')[0]!;
      expect((await e.app.inject({ url: '/admin/chat/conversations', headers: { cookie: cookie2 } })).json().items).toHaveLength(1);
      const hilo1 = await e.app.inject({ url: `/admin/chat/${c.id}?limit=30`, headers: { cookie: cookie1 } });
      expect(hilo1.json().messages.map((m: { body: string }) => m.body)).toEqual(['anterior', 'respuesta anterior', 'nuevo uno', 'respuesta uno']);
    } finally { await e.cerrar(); }
  });

  it('elimina por lotes los mensajes que cumplieron 24 horas y mantiene los pedidos', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T04:59:30Z'));
    const repos = createFakeRepos();
    const settings = await createSettingsService(createMemorySettingsRepo(), config, TEST_SETTINGS_KEY);
    await settings.iniciarVistaChat!(new Date('2026-10-14T05:00:00Z'));
    const c = await repos.contacts.upsertFromInbound('51987603111');
    await repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: 'dia14', body: 'pedido del sistema', createdAt: new Date('2026-10-15T04:00:00Z'), payload: { origen: 'sistema' } });
    repos.messages._all[0]!.storedAt = new Date(Date.now() - 24 * 60 * 60 * 1000 + 60_000);
    const borrar = vi.spyOn(repos.messages, 'limpiarAntes');
    const app = Fastify({ logger: false });
    registrarLimpiezaChat(app, repos);
    try {
      await app.ready();
      expect(repos.messages._all).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(4 * 60_000 + 30_000);
      expect(repos.messages._all).toHaveLength(1);
      // La interfaz/API ya ocultan el mensaje al vencer; la siguiente pasada
      // física corre a los cinco minutos cuando no hay lotes atrasados.
      expect(await repos.messages.listConversations({ alcance: { afterId: '0', retenidosDesde: new Date(Date.now() - 24 * 60 * 60 * 1000) }, limit: 100, offset: 0 })).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(repos.messages._all).toHaveLength(0);
      expect(await repos.messages.listConversations({ desde: settings.vistaChatDesde!(), limit: 100, offset: 0 })).toEqual([]);
      await repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: 'dia15', body: 'nuevo pedido', createdAt: new Date(), payload: { origen: 'sistema' } });
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(repos.messages._all.map(m => m.wamid)).toEqual(['dia15']);
      expect(await repos.contacts.getByPhone(c.phone)).toBeTruthy();
      expect(borrar).toHaveBeenCalledTimes(3);
    } finally { await app.close(); }
  });

  it('el chat no ofrece guardar conversaciones ni importar historiales del teléfono', () => {
    const html = chatPage({ proveedor: 'local', configured: true, nombreNegocio: 'Prueba' });
    expect(html).not.toContain('Guardar el chat y vaciarlo');
    expect(html).not.toContain('Guardar y vaciar');
    expect(html).not.toContain("accion: traerTodoElHistorial");
    expect(html).not.toContain("accion: sincronizarEsteChat");
    expect(html).not.toContain('/archive');
  });
});
