/**
 * El catalogo de etiquetas del negocio y lo que guarda cada lote de Chats:
 * la copia de los mensajes de cada chat y como le fue a cada uno.
 *
 * Primero lo que no necesita base (validar el catalogo, que la IA lo reciba y
 * que solo valgan sus codigos), luego el repo contra MySQL/MariaDB
 * (tests/mysql.ts) y al final las rutas de Chats con una sesion de verdad.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CATALOGO_POR_DEFECTO,
  CODIGO_OTRO,
  clasificarConIA,
  firmaCatalogo,
  instruccionesDeEtiqueta,
  leerEtiqueta,
  nombreDeEtiqueta,
  validarCatalogo,
  type Catalogo,
} from '../src/archive/clasificar.js';
import { crearChatEtiquetasRepo, type ChatEtiquetasRepo } from '../src/db/chat-etiquetas.js';
import type { Pool } from '../src/db/pool.js';
import type { MensajeIA } from '../src/ia/proveedores.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { crearEscenarioEntregas } from './escenario-entregas.js';
import { hashClave } from '../src/auth/usuarios.js';

const PROPIO: Catalogo = [
  { codigo: 'cambio_de_dia', nombre: 'Cambio de día', descripcion: 'El cliente pide que se lo entreguen otro día.' },
  { codigo: 'reclamo', nombre: 'Queja', descripcion: 'Reclama por demora o mal trato.' },
  { codigo: 'otro', nombre: 'Varios', descripcion: 'Ninguna de las anteriores.' },
];

describe('el catalogo', () => {
  it('el de fabrica son 17 etiquetas: las 16 pedidas, sin_novedad y otro', () => {
    expect(CATALOGO_POR_DEFECTO).toHaveLength(17);
    expect(CATALOGO_POR_DEFECTO.find((e) => e.codigo === 'sin_novedad')).toMatchObject({ nombre: 'Sin novedad' });
    expect(CATALOGO_POR_DEFECTO.map((e) => e.codigo)).toContain(CODIGO_OTRO);
    expect(validarCatalogo(CATALOGO_POR_DEFECTO).ok).toBe(true);
  });

  it('se valida antes de guardar: codigos limpios y sin repetir, textos, y otro siempre', () => {
    expect(validarCatalogo(PROPIO)).toEqual({ ok: true, catalogo: PROPIO });
    const limpio = validarCatalogo([{ codigo: ' cambio_de_dia ', nombre: ' Cambio ', descripcion: 'pide   otro día' }, { codigo: 'otro', nombre: 'Otro', descripcion: 'nada' }]);
    expect(limpio).toEqual({ ok: true, catalogo: [{ codigo: 'cambio_de_dia', nombre: 'Cambio', descripcion: 'pide otro día' }, { codigo: 'otro', nombre: 'Otro', descripcion: 'nada' }] });
    const mal = (items: Parameters<typeof validarCatalogo>[0]) => (validarCatalogo(items) as { error: string }).error;
    expect(mal([])).toMatch(/al menos una/);
    expect(mal([{ codigo: 'Cambio Día', nombre: 'x', descripcion: 'xxx' }])).toMatch(/no vale/);
    expect(mal([{ codigo: 'otro', nombre: 'x', descripcion: 'xxx' }, { codigo: 'otro', nombre: 'y', descripcion: 'yyy' }])).toMatch(/repetido/);
    expect(mal([{ codigo: 'otro', nombre: '', descripcion: 'xxx' }])).toMatch(/nombre/);
    expect(mal([{ codigo: 'otro', nombre: 'x', descripcion: 'x' }])).toMatch(/describe/);
    expect(mal([{ codigo: 'reclamo', nombre: 'x', descripcion: 'xxx' }])).toMatch(/Falta la etiqueta «otro»/);
    expect(mal(Array.from({ length: 41 }, (_, i) => ({ codigo: `e_${i}`, nombre: 'x', descripcion: 'xxx' })))).toMatch(/Como mucho 40/);
  });

  it('la IA recibe los codigos y descripciones del negocio, y solo valen esos', async () => {
    const texto = instruccionesDeEtiqueta(false, PROPIO).join('\n');
    expect(texto).toContain('- cambio_de_dia: El cliente pide que se lo entreguen otro día.');
    expect(texto).not.toContain('reagendar_entrega');
    // Las pistas de etiquetas que este negocio no tiene no aparecen.
    expect(texto).not.toContain('ubicaciones_multiples');
    expect(leerEtiqueta('cambio_de_dia', PROPIO)).toBe('cambio_de_dia');
    expect(leerEtiqueta('reagendar_entrega', PROPIO)).toBeNull();
    expect(nombreDeEtiqueta('otro', PROPIO)).toBe('Varios');
    // Un codigo que ya no esta en el catalogo se sigue viendo con su nombre de fabrica.
    expect(nombreDeEtiqueta('horario_fijo', PROPIO)).toBe('Horario fijo');

    const recibidos: MensajeIA[][] = [];
    const ia = (r: string) => ({ completar: async (m: MensajeIA[]) => (recibidos.push(m), r) });
    const chat = [{ direction: 'in' as const, kind: 'text' as const, body: 'mejor mañana' }];
    expect(await clasificarConIA(ia('{"etiqueta":"cambio_de_dia"}'), chat, null, 'GSG', { catalogo: PROPIO, conReglas: false })).toEqual({ estado: 'clasificada', etiqueta: 'cambio_de_dia', origen: 'ia' });
    expect(String(recibidos[0]![0]!.content)).toContain('cambio_de_dia');
    // Sin reglas: un codigo de fuera o una caida son error, aunque «mañana» se reconozca por palabras.
    expect(await clasificarConIA(ia('{"etiqueta":"reagendar_entrega"}'), chat, null, 'GSG', { catalogo: PROPIO, conReglas: false })).toMatchObject({ estado: 'sin_clasificar' });
    const caida = { completar: async () => { throw new Error('sin saldo'); } };
    expect(await clasificarConIA(caida, chat, null, 'GSG', { catalogo: PROPIO, conReglas: false })).toMatchObject({ estado: 'sin_clasificar', motivo: expect.stringMatching(/sin saldo/) });
    // Con reglas (Guardados), las reglas solo valen si el negocio tiene esa etiqueta.
    expect(await clasificarConIA(caida, chat, null, 'GSG', { catalogo: PROPIO })).toMatchObject({ estado: 'sin_clasificar' });
    expect(await clasificarConIA(caida, chat, null, 'GSG')).toMatchObject({ estado: 'clasificada', etiqueta: 'reagendar_entrega', origen: 'reglas' });
  });

  it('con sin_novedad en el catalogo, el flujo feliz va ahi y otro queda para lo ajeno a la entrega', () => {
    const conSN = instruccionesDeEtiqueta(false).join('\n');
    expect(conSN).toContain('- sin_novedad: sigue el flujo sin pedir nada más');
    expect(conSN).toMatch(/usa sin_novedad: es el caso de que todo va bien/);
    expect(conSN).toMatch(/otro es solo para lo que no tiene que ver con la entrega/);
    // Ya no se le dice que los agradecimientos van a otro.
    expect(conSN).not.toMatch(/agradecimientos, preguntas ajenas\) o no se entiende, usa otro/);
    // Un catalogo propio sin sin_novedad conserva la regla de siempre.
    const sinSN = instruccionesDeEtiqueta(false, PROPIO).join('\n');
    expect(sinSN).not.toContain('sin_novedad');
    expect(sinSN).toMatch(/agradecimientos, preguntas ajenas\) o no se entiende, usa otro/);
  });

  it('la firma cambia con un codigo o una descripcion, no con el nombre', () => {
    const f = firmaCatalogo(PROPIO);
    expect(firmaCatalogo(PROPIO.map((e) => ({ ...e, nombre: `${e.nombre}!` })))).toBe(f);
    expect(firmaCatalogo(PROPIO.map((e, i) => (i ? e : { ...e, descripcion: 'otra cosa' })))).not.toBe(f);
  });
});

// ------------------------------------------------------------ contra MySQL

describe('el repo: la copia del lote y el catalogo', () => {
  let b: BaseDePrueba;
  let pool: Pool;
  let repo: ChatEtiquetasRepo;
  beforeAll(async () => {
    b = await baseDePrueba();
    pool = b.pool;
    repo = crearChatEtiquetasRepo(pool);
  });
  afterAll(async () => {
    await b?.cerrar();
  });
  beforeEach(async () => {
    for (const t of ['chat_etiquetas_lote_chats', 'chat_etiquetas_catalogo', 'chat_etiquetas_lotes']) await pool.query(`delete from ${t}`);
  });

  it('guarda la copia de cada chat, la devuelve tal cual y marca el estado de cada uno', async () => {
    const lote = await repo.crearLote({ dia: '2026-10-27', tipo: 'completo' });
    const mensajes = [
      { id: 7, direction: 'out' as const, kind: 'text' as const, body: '¿Nos manda su ubicación?', createdAt: '2026-10-27T15:00:00.000Z' },
      { id: 8, direction: 'in' as const, kind: 'location' as const, body: null, createdAt: '2026-10-27T15:01:00.000Z' },
      { id: 9, direction: 'in' as const, kind: 'text' as const, body: 'mejor mañana 😊 «comillas» "dobles"', createdAt: '2026-10-27T15:02:00.000Z' },
    ];
    await repo.capturar(lote.id, '2026-10-27', [
      { phone: '51911000040', nombre: 'Rosa', huella: 'a'.repeat(64), mensajes },
      { phone: '51911000041', nombre: null, huella: 'b'.repeat(64), mensajes: null, estado: 'solo_envio' },
    ]);
    const sin = await repo.chatsDelLote(lote.id);
    expect(sin.map((c) => [c.phone, c.estado, c.totalMensajes, c.mensajes])).toEqual([
      ['51911000040', 'pendiente', 3, null],
      ['51911000041', 'solo_envio', 0, null],
    ]);
    const con = await repo.chatsDelLote(lote.id, true);
    expect(con[0]!.mensajes).toEqual(mensajes);

    await repo.marcarChatLote(lote.id, '51911000040', { estado: 'clasificada', etiqueta: 'reagendar_entrega' });
    await repo.marcarChatLote(lote.id, '51911000041', { estado: 'error', error: 'x'.repeat(900) });
    const uno = (await repo.chatDelLote(lote.id, '51911000040'))!;
    expect(uno).toMatchObject({ estado: 'clasificada', etiqueta: 'reagendar_entrega', nombre: 'Rosa', dia: '2026-10-27' });
    expect(uno.procesadoAt).toBeInstanceOf(Date);
    expect((await repo.chatDelLote(lote.id, '51911000041'))!.error).toHaveLength(500);
    expect(await repo.chatDelLote(lote.id, '51900000000')).toBeNull();

    // Pasada la retencion, la copia se vacia; el estado se queda.
    expect(await repo.vaciarCopiasAntes(new Date(Date.now() - 60_000))).toBe(0);
    expect(await repo.vaciarCopiasAntes(new Date(Date.now() + 60_000))).toBe(1);
    expect((await repo.chatDelLote(lote.id, '51911000040'))!).toMatchObject({ mensajes: null, estado: 'clasificada', totalMensajes: 3 });
  });

  it('muchos chats en un lote se guardan en tandas', async () => {
    const lote = await repo.crearLote({ dia: '2026-10-27', tipo: 'completo' });
    const chats = Array.from({ length: 120 }, (_, i) => ({ phone: `519110${String(i).padStart(5, '0')}`, nombre: `C${i}`, huella: 'c'.repeat(64), mensajes: [] }));
    await repo.capturar(lote.id, '2026-10-27', chats);
    expect(await repo.chatsDelLote(lote.id)).toHaveLength(120);
  });

  it('el catalogo: sin guardar es null, se guarda en su orden, se sustituye entero y se borra', async () => {
    expect(await repo.catalogo()).toBeNull();
    await repo.guardarCatalogo(PROPIO);
    expect(await repo.catalogo()).toEqual(PROPIO);
    await repo.guardarCatalogo([PROPIO[2]!, PROPIO[0]!]);
    expect(await repo.catalogo()).toEqual([PROPIO[2], PROPIO[0]]);
    await repo.borrarCatalogo();
    expect(await repo.catalogo()).toBeNull();
  });
});

// ------------------------------------------------------------- las rutas

describe('Chats: el catalogo y el detalle del lote por API', () => {
  it('se edita el catalogo, el lote lo usa y su detalle trae cada chat y la copia de sus mensajes', async () => {
    const e = await crearEscenarioEntregas({ agente: true, iaActiva: true });
    try {
      await e.repos.usuarios.crear({ usuario: 'adminetq', nombre: 'Admin', rol: 'admin', clave: hashClave('Clave-123-segura') });
      const login = await e.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'adminetq', clave: 'Clave-123-segura' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const pedir = (method: 'GET' | 'PUT' | 'DELETE' | 'POST', url: string, payload?: Record<string, unknown>) =>
        payload === undefined ? e.app.inject({ method, url, headers: { cookie } }) : e.app.inject({ method, url, headers: { cookie }, payload });

      // El de fabrica, hasta guardar uno.
      const fabrica = (await pedir('GET', '/admin/chat/etiquetas/catalogo')).json();
      expect(fabrica).toMatchObject({ propio: false, codigoOtro: 'otro', tope: 40 });
      expect(fabrica.items).toHaveLength(17);
      // Uno que no vale: 400 con el motivo, y no se guarda.
      const mal = await pedir('PUT', '/admin/chat/etiquetas/catalogo', { items: [{ codigo: 'reclamo', nombre: 'Queja', descripcion: 'reclama' }] });
      expect(mal.statusCode).toBe(400);
      expect(mal.json().error).toMatch(/otro/);
      expect((await pedir('GET', '/admin/chat/etiquetas/catalogo')).json().propio).toBe(false);
      // El del negocio.
      const ok = await pedir('PUT', '/admin/chat/etiquetas/catalogo', { items: PROPIO });
      expect(ok.statusCode).toBe(200);
      expect((await pedir('GET', '/admin/chat/etiquetas/catalogo')).json()).toMatchObject({ propio: true, items: PROPIO });

      // Un chat de hoy y un lote con ese catalogo.
      const c = await e.repos.contacts.upsertFromInbound('51987650077', 'Rosa');
      await e.repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: 'cat.sis', body: '¿Nos manda su ubicación?', status: 'sent', payload: { origen: 'sistema' }, createdAt: e.ahora() });
      await e.repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', wamid: 'cat.in', body: 'mejor mañana', createdAt: e.ahora() });
      e.ia.respuestas.push('{"etiqueta":"cambio_de_dia"}');
      let estado = (await pedir('POST', '/admin/chat/etiquetar', {})).json();
      for (let i = 0; i < 100 && estado.enCurso !== false; i++) {
        await new Promise((r) => setTimeout(r, 20));
        estado = (await pedir('GET', '/admin/chat/etiquetar')).json();
      }
      expect(estado).toMatchObject({ estado: 'completado_con_errores', clasificadas: 1, sinClasificar: 0 });
      // La IA recibio el catalogo del negocio.
      expect(e.ia.llamadas.at(-1)!.sistema).toContain('- cambio_de_dia: El cliente pide que se lo entreguen otro día.');

      // La bandeja: el nombre del catalogo del negocio y el estado del envio a GSG (sin GSG conectado: fallido).
      const item = (await pedir('GET', '/admin/chat/conversations')).json().items[0];
      expect(item.etiqueta).toMatchObject({ id: 'cambio_de_dia', nombre: 'Cambio de día', gsg: { estado: 'fallido' } });

      // El detalle del lote: cada chat con su estado de analisis y de envio.
      const detalle = (await pedir('GET', `/admin/chat/etiquetar/lotes/${estado.loteId}`)).json();
      expect(detalle.chats).toEqual([
        expect.objectContaining({ phone: '51987650077', nombre: 'Rosa', mensajes: 2, estado: 'clasificada', etiqueta: 'cambio_de_dia', nombreEtiqueta: 'Cambio de día', sync: expect.objectContaining({ estado: 'fallido' }) }),
      ]);
      // Y la copia de los mensajes que se le mandaron a la IA (tambien con el numero de 9 digitos).
      const copia = (await pedir('GET', `/admin/chat/etiquetar/lotes/${estado.loteId}/chats/987650077`)).json();
      expect(copia.chat.mensajes.map((m: { direction: string; body: string }) => [m.direction, m.body])).toEqual([['out', '¿Nos manda su ubicación?'], ['in', 'mejor mañana']]);
      expect((await pedir('GET', `/admin/chat/etiquetar/lotes/${estado.loteId}/chats/51900000000`)).statusCode).toBe(404);

      // Volver al de fabrica.
      expect((await pedir('DELETE', '/admin/chat/etiquetas/catalogo')).json()).toMatchObject({ ok: true, propio: false });
      expect((await pedir('GET', '/admin/chat/etiquetas/catalogo')).json().items).toHaveLength(17);
    } finally {
      await e.cerrar();
    }
  });

  it('la bandeja se filtra por etiqueta en el servidor y cuenta cuantos chats hay de cada una', async () => {
    const e = await crearEscenarioEntregas({ agente: true, iaActiva: true });
    try {
      await e.repos.usuarios.crear({ usuario: 'adminfiltro', nombre: 'Admin', rol: 'admin', clave: hashClave('Clave-123-segura') });
      const login = await e.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'adminfiltro', clave: 'Clave-123-segura' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const get = (url: string) => e.app.inject({ method: 'GET', url, headers: { cookie } });
      // Tres chats de hoy: dos los clasifica la IA y uno queda sin clasificar.
      for (const [i, [tel, texto]] of [['51987650081', 'mejor mañana'], ['51987650082', 'a las 3'], ['51987650083', 'zzz']].entries()) {
        const c = await e.repos.contacts.upsertFromInbound(tel!, `Cliente ${i}`);
        await e.repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: `f.sis.${i}`, body: '¿Nos manda su ubicación?', status: 'sent', payload: { origen: 'sistema' }, createdAt: e.ahora() });
        await e.repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', wamid: `f.in.${i}`, body: texto!, createdAt: e.ahora() });
      }
      // Antes de etiquetar: los tres estan sin etiquetar.
      expect((await get('/admin/chat/etiquetas/conteo')).json()).toMatchObject({ total: 3, sinEtiquetar: 3, sinClasificar: 0 });
      // La IA de prueba contesta por orden de llamada; las tres llamadas van una tras otra.
      e.ia.respuestas.push('{"etiqueta":"reagendar_entrega"}', '{"etiqueta":"reagendar_entrega"}', 'no sé');
      let estado = (await e.app.inject({ method: 'POST', url: '/admin/chat/etiquetar', headers: { cookie }, payload: {} })).json();
      for (let i = 0; i < 100 && estado.enCurso !== false; i++) {
        await new Promise((r) => setTimeout(r, 20));
        estado = (await get('/admin/chat/etiquetar')).json();
      }
      expect(estado).toMatchObject({ clasificadas: 2, sinClasificar: 1 });

      const conteo = (await get('/admin/chat/etiquetas/conteo')).json();
      expect(conteo).toMatchObject({ total: 3, sinEtiquetar: 0, sinClasificar: 1 });
      expect(conteo.etiquetas.find((x: { codigo: string }) => x.codigo === 'reagendar_entrega')).toMatchObject({ n: 2, nombre: 'Reagendar entrega' });
      // Las del catalogo sin chats tambien salen, con 0.
      expect(conteo.etiquetas.find((x: { codigo: string }) => x.codigo === 'reclamo')).toMatchObject({ n: 0 });
      // Sin GSG conectado, las dos etiquetadas no llegaron.
      expect(conteo.gsgFallido).toBe(2);

      const reagendar = (await get('/admin/chat/conversations?etiqueta=reagendar_entrega')).json();
      expect(reagendar).toMatchObject({ total: 2, hasMore: false });
      expect(reagendar.items.every((c: { etiqueta: { id: string } }) => c.etiqueta.id === 'reagendar_entrega')).toBe(true);
      // Paginado sobre lo filtrado, no sobre la pagina de la bandeja.
      const primera = (await get('/admin/chat/conversations?etiqueta=reagendar_entrega&limit=1')).json();
      expect(primera).toMatchObject({ total: 2, hasMore: true, siguienteOffset: 1 });
      expect(primera.items).toHaveLength(1);
      expect((await get('/admin/chat/conversations?etiqueta=reagendar_entrega&limit=1&offset=1')).json()).toMatchObject({ hasMore: false });
      expect((await get('/admin/chat/conversations?etiqueta=sin_clasificar')).json().items.map((c: { phone: string }) => c.phone)).toEqual(['51987650083']);
      expect((await get('/admin/chat/conversations?etiqueta=gsg_fallido')).json().total).toBe(2);
      expect((await get('/admin/chat/conversations?etiqueta=reclamo')).json()).toMatchObject({ total: 0, items: [] });
      expect((await get('/admin/chat/conversations?etiqueta=Mal%20Codigo')).statusCode).toBe(400);
      // Sin filtro, la bandeja de siempre.
      expect((await get('/admin/chat/conversations')).json().items).toHaveLength(3);
    } finally {
      await e.cerrar();
    }
  });

  it('la IA solo lee y etiqueta: con la clave guardada y el asistente APAGADO etiqueta, y no sale ningun mensaje', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.repos.usuarios.crear({ usuario: 'adminsolo', nombre: 'Admin', rol: 'admin', clave: hashClave('Clave-123-segura') });
      const login = await e.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'adminsolo', clave: 'Clave-123-segura' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      // La clave, sin activar el asistente: el bot no contesta con IA.
      const ia = await e.app.inject({ method: 'POST', url: '/admin/ia', headers: { cookie }, payload: { activa: false, proveedor: 'openai', servicio: 'openai', modelo: 'gpt-4o-mini', token: 'sk-prueba-solo-etiquetar' } });
      expect(ia.statusCode).toBe(200);
      expect(ia.json().estado).toMatchObject({ activa: false, tieneToken: true });

      const c = await e.repos.contacts.upsertFromInbound('51987650091', 'Rosa');
      await e.repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: 'solo.sis', body: '¿Nos manda su ubicación?', status: 'sent', payload: { origen: 'sistema' }, createdAt: e.ahora() });
      await e.repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', wamid: 'solo.in', body: 'mejor mañana', createdAt: e.ahora() });
      const salientesAntes = e.repos.messages._all.filter((m) => m.direction === 'out').length;
      const llamadasAntes = e.ia.llamadas.length;
      const waAntes = e.wa.sent.length;

      e.ia.respuestas.push('{"etiqueta":"reagendar_entrega"}');
      let estado = (await e.app.inject({ method: 'POST', url: '/admin/chat/etiquetar', headers: { cookie }, payload: {} })).json();
      for (let i = 0; i < 100 && estado.enCurso !== false; i++) {
        await new Promise((r) => setTimeout(r, 20));
        estado = (await e.app.inject({ method: 'GET', url: '/admin/chat/etiquetar', headers: { cookie } })).json();
      }
      expect(estado).toMatchObject({ clasificadas: 1, porIA: 1 });
      // A la IA solo se le pidio clasificar, una vez.
      const nuevas = e.ia.llamadas.slice(llamadasAntes);
      expect(nuevas).toHaveLength(1);
      expect(nuevas[0]!.sistema).toMatch(/^Clasificas conversaciones/);
      // Y al cliente no le salio nada.
      expect(e.repos.messages._all.filter((m) => m.direction === 'out').length).toBe(salientesAntes);
      expect(e.wa.sent.length).toBe(waAntes);
    } finally {
      await e.cerrar();
    }
  });

  it('etiquetar a mano por API y el embudo de chats del dia', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.repos.usuarios.crear({ usuario: 'adminmano', nombre: 'Ali', rol: 'operador', clave: hashClave('Clave-123-segura') });
      const login = await e.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'adminmano', clave: 'Clave-123-segura' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const pedir = (method: 'GET' | 'POST', url: string, payload?: Record<string, unknown>) =>
        payload === undefined ? e.app.inject({ method, url, headers: { cookie } }) : e.app.inject({ method, url, headers: { cookie }, payload });
      const ids: string[] = [];
      for (const [i, tel] of ['51987650101', '51987650102', '51987650103'].entries()) {
        const c = await e.repos.contacts.upsertFromInbound(tel, `Cliente ${i}`);
        ids.push(c.id);
        await e.repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: `m.sis.${i}`, body: '¿Nos manda su ubicación?', status: 'sent', payload: { origen: 'sistema' }, createdAt: e.ahora() });
        await e.repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', wamid: `m.in.${i}`, body: 'gracias', createdAt: e.ahora() });
      }
      // Un operador tambien puede etiquetar a mano.
      const r = await pedir('POST', `/admin/chat/${ids[0]}/etiqueta`, { etiqueta: 'sin_novedad' });
      expect(r.statusCode).toBe(200);
      expect(r.json().etiqueta).toMatchObject({ id: 'sin_novedad', nombre: 'Sin novedad', origen: 'manual' });
      await pedir('POST', `/admin/chat/${ids[1]}/etiqueta`, { etiqueta: 'reclamo' });
      // La bandeja la muestra como manual.
      const item = (await pedir('GET', '/admin/chat/conversations')).json().items.find((c: { contactId: string }) => c.contactId === ids[0]);
      expect(item.etiqueta).toMatchObject({ id: 'sin_novedad', origen: 'manual' });
      expect((await pedir('POST', `/admin/chat/${ids[0]}/etiqueta`, { etiqueta: 'inventada' })).statusCode).toBe(400);
      expect((await pedir('POST', `/admin/chat/${ids[0]}/etiqueta`, { etiqueta: 'Mal' })).statusCode).toBe(400);
      const grupo = await e.repos.contacts.upsertGrupo('120363400000000001@g.us', 'Grupo');
      expect((await pedir('POST', `/admin/chat/${grupo.id}/etiqueta`, { etiqueta: 'reclamo' })).statusCode).toBe(400);

      const embudo = (await pedir('GET', '/admin/chat/etiquetas/embudo')).json();
      expect(embudo).toMatchObject({ hoy: true, resumen: { chats: 3, etiquetados: 2, porIA: 0, manual: 2, sinEtiquetar: 1, sinClasificar: 0 } });
      expect(embudo.etapas.slice(0, 2).map((x: { codigo: string; manual: number }) => [x.codigo, x.manual]).sort()).toEqual([['reclamo', 1], ['sin_novedad', 1]]);
      expect(embudo.chats.find((c: { phone: string }) => c.phone === '51987650101')).toMatchObject({ contactId: ids[0], nombre: 'Cliente 0', origen: 'manual', nombreEtiqueta: 'Sin novedad' });
      expect(embudo.sinEtiquetar.map((c: { phone: string }) => c.phone)).toEqual(['51987650103']);
      // Quitarla.
      await pedir('POST', `/admin/chat/${ids[1]}/etiqueta`, { etiqueta: null });
      expect((await pedir('GET', '/admin/chat/etiquetas/embudo')).json().resumen).toMatchObject({ etiquetados: 1, sinEtiquetar: 2 });
      // Ayer: vacio; un dia mal escrito: 400.
      expect((await pedir('GET', '/admin/chat/etiquetas/embudo?dia=ayer')).json()).toMatchObject({ hoy: false, resumen: { etiquetados: 0 } });
      expect((await pedir('GET', '/admin/chat/etiquetas/embudo?dia=27-10-2026')).statusCode).toBe(400);
      // La pagina del embudo existe y lleva la pestaña.
      const pagina = await pedir('GET', '/embudo-chats');
      expect(pagina.statusCode).toBe(200);
      expect(pagina.body).toContain('Embudo de chats');
    } finally {
      await e.cerrar();
    }
  });

  it('solo un administrador cambia el catalogo', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.repos.usuarios.crear({ usuario: 'operadoretq2', nombre: 'Op', rol: 'operador', clave: hashClave('Clave-123-segura') });
      const login = await e.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'operadoretq2', clave: 'Clave-123-segura' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      expect((await e.app.inject({ method: 'GET', url: '/admin/chat/etiquetas/catalogo', headers: { cookie } })).statusCode).toBe(200);
      const r = await e.app.inject({ method: 'PUT', url: '/admin/chat/etiquetas/catalogo', headers: { cookie }, payload: { items: PROPIO } });
      expect(r.statusCode).toBe(403);
      expect((await e.app.inject({ method: 'DELETE', url: '/admin/chat/etiquetas/catalogo', headers: { cookie } })).statusCode).toBe(403);
    } finally {
      await e.cerrar();
    }
  });
});
