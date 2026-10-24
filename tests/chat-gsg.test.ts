import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';
import { crearBus } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { generarClaveApi, hashClaveApi, prefijoDeClave } from '../src/auth/claves-api.js';

// El chat de GSG, en /api/v1/chat:
//  - GET: el motorizado abre el chat de un tracking; GSG manda SOLO el tracking y GSGchat responde con el historial
//    del WhatsApp que GSG ya dio en POST /api/v1/entregas.
//  - POST: un usuario de GSG escribe; GSGchat lo manda por WhatsApp a ese numero, lo apunta con quien lo escribio y calla al bot.
let e: EscenarioEntregas;
let clave: string; // conversaciones:leer
let escritor: string; // mensajes:enviar
let sinPermiso: string; // solo entregas

const consultar = (params: Record<string, string | number>, key: string | null = clave) => {
  const q = new URLSearchParams(Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])));
  return e.app.inject({ method: 'GET', url: `/api/v1/chat?${q.toString()}`, headers: key ? { 'x-api-key': key } : {} });
};
const escribir = (cuerpo: unknown, key: string | null = escritor) =>
  e.app.inject({ method: 'POST', url: '/api/v1/chat', headers: { ...(key ? { 'x-api-key': key } : {}), 'content-type': 'application/json' }, payload: JSON.stringify(cuerpo) });
const alta = (tracking: string, telefono: string) =>
  e.app.inject({ method: 'POST', url: '/api/v1/entregas', headers: { 'x-api-key': clave, 'content-type': 'application/json' },
    payload: JSON.stringify({ ...OBLIGATORIOS_GSG, tracking, cliente: `Cliente ${tracking}`, telefono }) });

beforeAll(async () => {
  e = await crearEscenarioEntregas({ confirmarLista: true });
  clave = generarClaveApi();
  escritor = generarClaveApi();
  sinPermiso = generarClaveApi();
  await e.repos.claves.crear({ nombre: 'GSG lee', hash: hashClaveApi(clave), prefijo: prefijoDeClave(clave), creadaPor: null, permisos: ['entregas:gestionar', 'conversaciones:leer'] });
  await e.repos.claves.crear({ nombre: 'GSG escribe', hash: hashClaveApi(escritor), prefijo: prefijoDeClave(escritor), creadaPor: null, permisos: ['conversaciones:leer', 'mensajes:enviar'] });
  await e.repos.claves.crear({ nombre: 'Solo pedidos', hash: hashClaveApi(sinPermiso), prefijo: prefijoDeClave(sinPermiso), creadaPor: null, permisos: ['entregas:gestionar'] });
  expect((await alta('Chat-1', '987654321')).statusCode).toBe(201);
  expect((await alta('CHAT-2', '987654322')).statusCode).toBe(201);
  // Dos trackings del mismo cliente: comparten el chat de su WhatsApp.
  expect((await alta('CHAT-3A', '987654323')).statusCode).toBe(201);
  expect((await alta('CHAT-3B', '987654323')).statusCode).toBe(201);
  // El cliente del primer pedido escribe: ese chat tiene un mensaje entrante.
  await e.contesta('987654321', { texto: 'Hola, ya estoy en casa' });
});
afterAll(async () => { await e.cerrar(); });

describe('GET /api/v1/chat?tracking=… (el historial)', () => {
  it('devuelve el chat del WhatsApp que GSG dio para ese tracking, con los mensajes', async () => {
    const r = await consultar({ tracking: 'Chat-1' });
    expect(r.statusCode).toBe(200);
    const cuerpo = r.json();
    expect(cuerpo).toMatchObject({ tracking: ['Chat-1'], contacto: { telefono: '51987654321' }, hayMas: false });
    for (const sobra of ['entrega', 'ventanaAbierta', 'puedeEscribir', 'motivo']) expect(cuerpo).not.toHaveProperty(sobra);
    expect(cuerpo.mensajes.some((m: any) => m.texto === 'Hola, ya estoy en casa' && m.direccion === 'entrante')).toBe(true);
  });

  it('cada tracking abre solo su chat', async () => {
    const r = await consultar({ tracking: 'CHAT-2' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ contacto: { telefono: '51987654322' } });
    expect(JSON.stringify(r.json())).not.toContain('Hola, ya estoy en casa');
  });

  it('no distingue mayusculas ni espacios en el tracking, como la API de pedidos', async () => {
    for (const tracking of ['chat-1', 'CHAT-1', '  Chat-1  ']) {
      const r = await consultar({ tracking });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ contacto: { telefono: '51987654321' } });
    }
  });

  it('dos trackings del mismo cliente muestran el mismo chat', async () => {
    const a = await consultar({ tracking: 'CHAT-3A' });
    const b = await consultar({ tracking: 'CHAT-3B' });
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(200);
    expect(a.json().contacto.id).toBe(b.json().contacto.id);
    // El tracking pedido va primero; el otro del mismo WhatsApp tambien aparece.
    expect(a.json().tracking).toEqual(['CHAT-3A', 'CHAT-3B']);
    expect(b.json().tracking).toEqual(['CHAT-3B', 'CHAT-3A']);
  });

  it('si llega un telefono, se ignora: manda el que GSG dio con el tracking', async () => {
    const r = await consultar({ tracking: 'Chat-1', telefono: '987654322' });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ contacto: { telefono: '51987654321' } });
  });

  it('limite y antesDe pagina los mensajes', async () => {
    const r = await consultar({ tracking: 'Chat-1', limite: 1 });
    expect(r.statusCode).toBe(200);
    expect(r.json().mensajes.length).toBeLessThanOrEqual(1);
    expect((await consultar({ tracking: 'Chat-1', limite: 500 })).statusCode).toBe(400);
  });

  it('errores: sin tracking 400; tracking inexistente 404; sin clave 401; sin permiso 403', async () => {
    expect((await consultar({})).statusCode).toBe(400);
    expect((await consultar({ tracking: '   ' })).statusCode).toBe(400);
    const sinPedido = await consultar({ tracking: 'NO-EXISTE' });
    expect(sinPedido.statusCode).toBe(404);
    expect(sinPedido.json()).toEqual({ error: 'no hay ningun pedido con ese tracking' });
    expect((await consultar({ tracking: 'Chat-1' }, null)).statusCode).toBe(401);
    expect((await consultar({ tracking: 'Chat-1' }, sinPermiso)).statusCode).toBe(403);
  });
});

describe('POST /api/v1/chat (un usuario de GSG escribe)', () => {
  const mensaje = (extra: Record<string, unknown> = {}) => ({ tracking: 'chat-2', texto: 'Hola, soy tu motorizado, llego en 10 minutos', idExterno: 'gsg-msg-1', usuario: { id: 77, nombre: 'Juan', rol: 'motorizado' }, ...extra });

  it('sale por WhatsApp al numero del pedido, queda firmado por el usuario de GSG y el bot se calla', async () => {
    const r = await escribir(mensaje());
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, estado: 'enviado', duplicado: false });
    expect(e.textosA('51987654322')).toContain('Hola, soy tu motorizado, llego en 10 minutos');
    // El chat que se abre despues lo muestra como saliente de una persona, con el usuario y el rol de GSG.
    const chat = await consultar({ tracking: 'CHAT-2' }, escritor);
    const enviado = chat.json().mensajes.find((m: any) => m.texto === 'Hola, soy tu motorizado, llego en 10 minutos');
    expect(enviado).toMatchObject({ direccion: 'saliente', autor: 'persona', autorNombre: 'Juan', emisor: { tipo: 'gsg', usuarioId: '77', rol: 'motorizado', tracking: 'CHAT-2', idExterno: 'gsg-msg-1' } });
    // El bot se calla en ese chat.
    expect((await e.repos.contacts.getByPhone('51987654322'))?.botPausadoAt).toBeTruthy();
  });

  it('con el mismo idExterno un reintento no se manda dos veces', async () => {
    const repetido = await escribir(mensaje());
    expect(repetido.statusCode).toBe(200);
    expect(repetido.json()).toMatchObject({ ok: true, estado: 'enviado', duplicado: true });
    expect(e.textosA('51987654322').filter((t) => t === 'Hola, soy tu motorizado, llego en 10 minutos')).toHaveLength(1);
  });

  it('el mismo idExterno con otro tracking es un conflicto (409) y no se manda', async () => {
    const r = await escribir(mensaje({ tracking: 'CHAT-3A' }));
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ codigo: 'ID_EXTERNO_REPETIDO' });
    expect(e.textosA('51987654323')).not.toContain('Hola, soy tu motorizado, llego en 10 minutos');
  });

  it('el telefono no se manda: va al del pedido aunque lo intenten', async () => {
    const r = await escribir(mensaje({ tracking: 'CHAT-3A', texto: 'Mensaje para el pedido 3A', idExterno: 'gsg-msg-2', telefono: '987654322' }));
    expect(r.statusCode).toBe(200);
    expect(e.textosA('51987654323')).toContain('Mensaje para el pedido 3A');
    expect(e.textosA('51987654322')).not.toContain('Mensaje para el pedido 3A');
  });

  it('el id del usuario puede venir como texto o como numero, y el nombre y el rol son opcionales', async () => {
    const r = await escribir(mensaje({ texto: 'Sin nombre ni rol', idExterno: 'gsg-msg-3', usuario: { id: 'u-9' } }));
    expect(r.statusCode).toBe(200);
    const enviado = (await consultar({ tracking: 'CHAT-2' }, escritor)).json().mensajes.find((m: any) => m.texto === 'Sin nombre ni rol');
    expect(enviado).toMatchObject({ autor: 'persona', autorNombre: null, emisor: { usuarioId: 'u-9', rol: null } });
  });

  it('errores: tracking inexistente 404; faltan datos 400; sin clave 401; sin mensajes:enviar 403', async () => {
    expect((await escribir(mensaje({ tracking: 'NO-EXISTE', idExterno: 'x-1' }))).statusCode).toBe(404);
    expect((await escribir(mensaje({ texto: '   ', idExterno: 'x-2' }))).statusCode).toBe(400);
    expect((await escribir({ tracking: 'CHAT-2', texto: 'hola', usuario: { id: 1 } })).statusCode).toBe(400); // sin idExterno
    expect((await escribir({ tracking: 'CHAT-2', texto: 'hola', idExterno: 'x-3' })).statusCode).toBe(400); // sin usuario
    expect((await escribir({ tracking: 'CHAT-2', texto: 'hola', idExterno: 'x-4', usuario: {} })).statusCode).toBe(400); // usuario sin id
    expect((await escribir(mensaje({ idExterno: 'x-5' }), null)).statusCode).toBe(401);
    expect((await escribir(mensaje({ idExterno: 'x-6' }), clave)).statusCode).toBe(403);
    // Nada de lo anterior salio.
    expect(e.textosA('51987654322').filter((t) => t === 'hola')).toHaveLength(0);
  });
});

describe('el flujo del diagrama: /api/v1/messages, webhook con chatId y /api/v1/send-message', () => {
  it('GET /api/v1/messages?chat_id= devuelve el mismo historial que /api/v1/chat?tracking=', async () => {
    const r = await e.app.inject({ method: 'GET', url: '/api/v1/messages?chat_id=Chat-1', headers: { 'x-api-key': clave } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual((await consultar({ tracking: 'Chat-1' })).json());
    expect((await e.app.inject({ method: 'GET', url: '/api/v1/messages', headers: { 'x-api-key': clave } })).statusCode).toBe(400);
    expect((await e.app.inject({ method: 'GET', url: '/api/v1/messages?chat_id=NO-EXISTE', headers: { 'x-api-key': clave } })).statusCode).toBe(404);
    expect((await e.app.inject({ method: 'GET', url: '/api/v1/messages?chat_id=Chat-1' })).statusCode).toBe(401);
    expect((await e.app.inject({ method: 'GET', url: '/api/v1/messages?chat_id=Chat-1', headers: { 'x-api-key': sinPermiso } })).statusCode).toBe(403);
  });

  it('un mensaje del cliente sale en el webhook mensaje.recibido con el chatId (tracking) y los trackings', async () => {
    // Los repos observados, como en produccion (ver src/plataforma/tienda.ts): cada mensaje guardado se anuncia.
    const bus = crearBus();
    const vistos: any[] = [];
    bus.escucharTodo((nombre, payload) => { vistos.push({ nombre, payload }); });
    const repos = observarRepos(e.repos, bus);
    const c3 = (await e.repos.contacts.getByPhone('51987654323'))!;
    await repos.messages.add({ contactId: c3.id, direction: 'in', wamid: 'wamid.diagrama-1', kind: 'text', body: 'Estoy afuera', payload: null, createdAt: new Date() });
    const mio = vistos.find((x) => x.nombre === 'mensaje.recibido')?.payload;
    expect(mio).toBeTruthy();
    expect(mio.chatId).toBe('CHAT-3B');
    expect(mio.trackings).toEqual(['CHAT-3A', 'CHAT-3B']);
    // Con ese chatId GSG pide el historial y ve el mensaje.
    const r = await e.app.inject({ method: 'GET', url: `/api/v1/messages?chat_id=${mio.chatId}`, headers: { 'x-api-key': clave } });
    expect(r.json().mensajes.some((m: any) => m.texto === 'Estoy afuera')).toBe(true);
  });

  it('POST /api/v1/send-message con chat_id manda por WhatsApp, y el saliente tambien trae el chatId', async () => {
    const r = await e.app.inject({
      method: 'POST', url: '/api/v1/send-message', headers: { 'x-api-key': escritor, 'content-type': 'application/json' },
      payload: JSON.stringify({ chat_id: 'CHAT-3A', texto: 'Ya te veo', idExterno: 'diag-1', usuario: { id: 5, nombre: 'Ana', rol: 'operador' } }),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ ok: true, estado: 'enviado', duplicado: false });
    expect(e.textosA('51987654323')).toContain('Ya te veo');
    // El saliente, anunciado por los repos observados, trae el mismo chatId.
    const bus = crearBus();
    const vistos: any[] = [];
    bus.escucharTodo((nombre, payload) => { vistos.push({ nombre, payload }); });
    const c3 = (await e.repos.contacts.getByPhone('51987654323'))!;
    await observarRepos(e.repos, bus).messages.add({ contactId: c3.id, direction: 'out', wamid: 'wamid.diagrama-3', kind: 'text', body: 'Ya te veo', payload: { origen: 'persona' }, createdAt: new Date() });
    expect(vistos.find((x) => x.nombre === 'mensaje.enviado')?.payload).toMatchObject({ chatId: 'CHAT-3B', trackings: ['CHAT-3A', 'CHAT-3B'] });
    // El reintento no duplica; sin clave o sin permiso, nada sale.
    const otra = await e.app.inject({ method: 'POST', url: '/api/v1/send-message', headers: { 'x-api-key': escritor, 'content-type': 'application/json' }, payload: JSON.stringify({ chat_id: 'CHAT-3A', texto: 'Ya te veo', idExterno: 'diag-1', usuario: { id: 5 } }) });
    expect(otra.json()).toMatchObject({ duplicado: true });
    expect(e.textosA('51987654323').filter((t) => t === 'Ya te veo')).toHaveLength(1);
    expect((await e.app.inject({ method: 'POST', url: '/api/v1/send-message', headers: { 'x-api-key': clave, 'content-type': 'application/json' }, payload: JSON.stringify({ chat_id: 'CHAT-3A', texto: 'x', idExterno: 'diag-2', usuario: { id: 1 } }) })).statusCode).toBe(403);
    expect((await e.app.inject({ method: 'POST', url: '/api/v1/send-message', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ chat_id: 'CHAT-3A', texto: 'x', idExterno: 'diag-3', usuario: { id: 1 } }) })).statusCode).toBe(401);
  });
});
