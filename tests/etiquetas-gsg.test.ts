/**
 * La sincronizacion de las etiquetas de Chats con GSG (src/chat/etiquetar.ts,
 * src/rutas/gsg.ts): por numero de WhatsApp, sin tracking; los lotes con su
 * estado; el reintento SOLO de los envios fallidos, sin volver a la IA; y el
 * registro de eventos para seguir el flujo.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MensajeIA } from '../src/ia/proveedores.js';
import { crearChatEtiquetasEnMemoria, crearChatEtiquetasRepo, type ChatEtiquetasRepo, type MensajeDelDia } from '../src/db/chat-etiquetas.js';
import { crearEtiquetador, etiquetaParaGsg, etiquetarDelDia, reintentarEnvios, type EtiquetadoDeps } from '../src/chat/etiquetar.js';
import { crearPuertoHttp, type EtiquetaParaGsg, type PuertoGsg, type ResultadoEnvio } from '../src/rutas/gsg.js';
import { crearConexionGsg } from '../src/rutas/conexion-gsg.js';
import type { Pool } from '../src/db/pool.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { createMemorySettingsRepo, TEST_SETTINGS_KEY } from './fakes.js';

const AHORA = new Date('2026-10-27T20:00:00Z');
const DIA = '2026-10-27';
const ALCANCE = { afterId: '0', retenidosDesde: new Date('2026-10-20T00:00:00Z') };
const BASE = 'https://gsg.ejemplo.pe/api/';
const CLAVE = 'clave-de-gsg-0123456789';

let siguienteId = 1;
const msg = (phone: string, direction: 'in' | 'out', body: string, minuto: number): MensajeDelDia => ({
  id: siguienteId++,
  contactId: `c-${phone}`,
  phone,
  name: null,
  direction,
  kind: 'text',
  body,
  createdAt: new Date(Date.UTC(2026, 9, 27, 15, minuto)),
});

/** IA de prueba: contesta por lo que dijo el cliente y cuenta las llamadas. */
function iaDePrueba() {
  const llamadas: string[] = [];
  return {
    llamadas,
    ia: {
      async completar(m: MensajeIA[]) {
        const u = String(m[m.length - 1]?.content ?? '');
        llamadas.push(u);
        return /dónde/.test(u) ? '{"etiqueta":"consultar_entrega"}' : /mañana/.test(u) ? '{"etiqueta":"reagendar_entrega"}' : /a las 3/.test(u) ? '{"etiqueta":"horario_fijo"}' : '{"etiqueta":"otro"}';
      },
    },
  };
}

/** Un GSG de mentira: responde lo que diga `responder` por numero y apunta lo recibido. */
function gsgDePrueba(responder: (e: EtiquetaParaGsg) => ResultadoEnvio = () => ({ ok: true, id: 'G-1' })) {
  const recibidas: EtiquetaParaGsg[] = [];
  const puerto: PuertoGsg = {
    conectado: () => true,
    descripcion: () => 'GSG de prueba',
    enviar: async () => ({ ok: true }),
    urlEtiquetas: () => `${BASE}v1/gsgchat/labels`,
    async enviarEtiqueta(e) {
      recibidas.push(e);
      return responder(e);
    },
  };
  return { puerto, recibidas };
}

function deps(repo: ChatEtiquetasRepo, ia: EtiquetadoDeps['ia'], gsg?: PuertoGsg | null): EtiquetadoDeps {
  return { repo, ia, gsg: () => gsg ?? null, zonaHoraria: () => 'America/Lima', nombreNegocio: () => 'GSG', ahora: () => AHORA };
}

// --------------------------------------------------------------- el puerto

interface Llamada {
  url: string;
  cabeceras: Headers;
  cuerpo: Record<string, unknown>;
}
function fetchFalso(respuestas: Array<{ status: number; body?: string } | Error> = []) {
  const llamadas: Llamada[] = [];
  const impl = (async (url: string | URL, init?: RequestInit) => {
    llamadas.push({ url: String(url), cabeceras: new Headers(init?.headers), cuerpo: JSON.parse(String(init?.body ?? '{}')) });
    const r = respuestas.shift() ?? { status: 200, body: '{"id":"GSG-77"}' };
    if (r instanceof Error) throw r;
    return new Response(r.body ?? '', { status: r.status });
  }) as typeof fetch;
  return { llamadas, impl };
}

const ETIQUETA: EtiquetaParaGsg = {
  telefono: '51987654321',
  telefonoNacional: '987654321',
  dia: DIA,
  etiqueta: 'reagendar_entrega',
  etiquetaNombre: 'Reagendar entrega',
  origen: 'ia',
  mensajes: 3,
  clasificadoEn: AHORA.toISOString(),
  eventoId: 'gsgchat-etiqueta-51987654321-2026-10-27-abcdef012345',
};

describe('el puerto manda la etiqueta por numero, sin tracking', () => {
  it('POST a la base + la ruta de etiquetas, con X-API-Key e Idempotency-Key', async () => {
    const f = fetchFalso();
    const puerto = crearPuertoHttp({ url: BASE, token: CLAVE, rutaEtiquetas: 'v1/gsgchat/labels', fetchImpl: f.impl });
    expect(puerto.urlEtiquetas!()).toBe('https://gsg.ejemplo.pe/api/v1/gsgchat/labels');
    expect(await puerto.enviarEtiqueta!(ETIQUETA)).toEqual({ ok: true, id: 'GSG-77' });
    const [l] = f.llamadas;
    expect(l!.url).toBe('https://gsg.ejemplo.pe/api/v1/gsgchat/labels');
    expect(l!.cabeceras.get('x-api-key')).toBe(CLAVE);
    expect(l!.cabeceras.get('idempotency-key')).toBe(ETIQUETA.eventoId);
    expect(l!.cuerpo).toEqual(ETIQUETA);
    expect(l!.cuerpo).not.toHaveProperty('tracking');
  });

  it('clasifica las respuestas: 5xx/429 reintentables, 4xx no, 401/403 clave, sin ruta = configuracion', async () => {
    const f = fetchFalso([{ status: 503 }, { status: 429 }, { status: 422, body: 'telefono raro' }, { status: 401 }, { status: 200, body: '{"ok":false,"error":"duplicado"}' }, new TypeError('fetch failed', { cause: { code: 'ECONNREFUSED' } })]);
    const puerto = crearPuertoHttp({ url: BASE, token: CLAVE, rutaEtiquetas: 'labels', fetchImpl: f.impl });
    expect(await puerto.enviarEtiqueta!(ETIQUETA)).toMatchObject({ ok: false, reintentable: true });
    expect(await puerto.enviarEtiqueta!(ETIQUETA)).toMatchObject({ ok: false, reintentable: true });
    const r422 = await puerto.enviarEtiqueta!(ETIQUETA);
    expect(r422).toMatchObject({ ok: false, reintentable: false });
    expect(r422.error).toMatch(/422.*telefono raro/);
    expect(await puerto.enviarEtiqueta!(ETIQUETA)).toMatchObject({ ok: false, autenticacion: 401 });
    expect((await puerto.enviarEtiqueta!(ETIQUETA)).error).toMatch(/rechazó la etiqueta: duplicado/);
    expect(await puerto.enviarEtiqueta!(ETIQUETA)).toMatchObject({ ok: false, reintentable: true });

    const sinRuta = crearPuertoHttp({ url: BASE, token: CLAVE, fetchImpl: f.impl });
    expect(sinRuta.urlEtiquetas!()).toBeNull();
    expect(await sinRuta.enviarEtiqueta!(ETIQUETA)).toMatchObject({ ok: false, configuracion: true });
    const sinClave = crearPuertoHttp({ url: BASE, token: '', rutaEtiquetas: 'labels', fetchImpl: f.impl });
    expect(await sinClave.enviarEtiqueta!(ETIQUETA)).toMatchObject({ ok: false, configuracion: true });
    // La clave nunca aparece en un error.
    const eco = fetchFalso([{ status: 400, body: `clave ${CLAVE} no vale` }]);
    const r = await crearPuertoHttp({ url: BASE, token: CLAVE, rutaEtiquetas: 'labels', fetchImpl: eco.impl }).enviarEtiqueta!(ETIQUETA);
    expect(r.error).not.toContain(CLAVE);
  });

  it('la ruta se guarda en Conexion, se valida y el puerto vigente la usa', async () => {
    const f = fetchFalso();
    const c = await crearConexionGsg({ settingsRepo: createMemorySettingsRepo(), settingsKeyBase64: TEST_SETTINGS_KEY, config: { GSG_URL: '', GSG_TOKEN: '', PUBLIC_BASE_URL: 'http://localhost:3000' }, fetchImpl: f.impl });
    expect(c.estado()).toMatchObject({ rutaEtiquetas: '', destinoEtiquetas: null });
    await expect(c.conectarReal({ url: BASE, apiKey: CLAVE, rutaEtiquetas: '../admin' })).rejects.toThrow(/etiquetas no vale/);
    const e = await c.conectarReal({ url: BASE, apiKey: CLAVE, rutaEtiquetas: '/v1/gsgchat/labels' });
    expect(e).toMatchObject({ rutaEtiquetas: 'v1/gsgchat/labels', destinoEtiquetas: 'https://gsg.ejemplo.pe/api/v1/gsgchat/labels' });
    expect(await c.puerto().enviarEtiqueta!(ETIQUETA)).toMatchObject({ ok: true });
    expect(f.llamadas.at(-1)!.url).toBe('https://gsg.ejemplo.pe/api/v1/gsgchat/labels');
    // Guardar sin tocar la ruta la conserva.
    expect((await c.conectarReal({ url: BASE })).rutaEtiquetas).toBe('v1/gsgchat/labels');
  });

  it('el eventoId cambia solo si cambia la conversacion', () => {
    const base = { phone: '51987654321', dia: DIA, etiqueta: 'reclamo', origen: 'ia' as const, mensajes: 2, motivo: null, updatedAt: AHORA, loteId: null, syncEstado: 'pendiente' as const, syncIntentos: 0, syncError: null, syncAt: null, syncHuella: null };
    const a = etiquetaParaGsg({ ...base, huella: 'a'.repeat(64) });
    expect(a).toMatchObject({ telefono: '51987654321', telefonoNacional: '987654321', etiqueta: 'reclamo', etiquetaNombre: 'Reclamo' });
    expect(etiquetaParaGsg({ ...base, huella: 'a'.repeat(64) }).eventoId).toBe(a.eventoId);
    expect(etiquetaParaGsg({ ...base, huella: 'b'.repeat(64) }).eventoId).not.toBe(a.eventoId);
  });
});

// ------------------------------------------------------------- los lotes

describe('el lote: analisis, envio a GSG y reintentos', () => {
  let mensajes: MensajeDelDia[];
  let repo: ChatEtiquetasRepo;
  beforeEach(() => {
    mensajes = [
      msg('51911000002', 'in', 'mejor mañana', 1),
      msg('51911000003', 'in', 'tráigalo a las 3', 2),
      msg('51911000004', 'out', '¿Nos manda su ubicación?', 3),
    ];
    repo = crearChatEtiquetasEnMemoria(() => mensajes);
  });

  it('manda cada etiqueta a GSG por numero y deja el lote completado con su registro', async () => {
    const { ia } = iaDePrueba();
    const g = gsgDePrueba();
    const r = await etiquetarDelDia(deps(repo, () => ia, g.puerto), ALCANCE, undefined, { iniciadoPor: 'Ali' });
    expect(r).toMatchObject({ estado: 'completado', tipo: 'completo', total: 3, clasificadas: 3, syncTotal: 3, syncEnviadas: 3, syncFallidas: 0 });
    expect(g.recibidas.map((e) => [e.telefono, e.etiqueta]).sort()).toEqual([
      ['51911000002', 'reagendar_entrega'],
      ['51911000003', 'horario_fijo'],
      ['51911000004', 'otro'],
    ]);
    expect((await repo.delDia(DIA)).every((f) => f.syncEstado === 'enviado' && f.syncIntentos === 1 && f.syncHuella === f.huella)).toBe(true);
    const lote = (await repo.lote(r.loteId!))!;
    expect(lote).toMatchObject({ estado: 'completado', tipo: 'completo', syncEnviadas: 3, iniciadoPor: 'Ali' });
    expect(lote.terminoAt).not.toBeNull();
    const codigos = (await repo.eventos({ loteId: r.loteId!, limite: 50 })).map((e) => e.codigo);
    expect(codigos).toContain('lote_inicio');
    expect(codigos.filter((c) => c === 'gsg_enviada')).toHaveLength(3);
    expect(codigos[0]).toBe('lote_fin');
  });

  it('sin cambios no se vuelve a llamar ni a la IA ni a GSG; si una cambia, solo esa', async () => {
    const g = gsgDePrueba();
    await etiquetarDelDia(deps(repo, () => iaDePrueba().ia, g.puerto), ALCANCE);
    const ia2 = iaDePrueba();
    const r2 = await etiquetarDelDia(deps(repo, () => ia2.ia, g.puerto), ALCANCE);
    expect(ia2.llamadas).toHaveLength(0);
    expect(g.recibidas).toHaveLength(3);
    expect(r2).toMatchObject({ estado: 'completado', reutilizadas: 3, syncTotal: 0 });

    mensajes.push(msg('51911000003', 'in', '¿dónde está el motorizado?', 9));
    const r3 = await etiquetarDelDia(deps(repo, () => iaDePrueba().ia, g.puerto), ALCANCE);
    expect(r3).toMatchObject({ syncTotal: 1, syncEnviadas: 1 });
    expect(g.recibidas.at(-1)).toMatchObject({ telefono: '51911000003', etiqueta: 'consultar_entrega' });
    // Conversacion nueva = eventoId nuevo: GSG no la toma por un duplicado.
    expect(g.recibidas.at(-1)!.eventoId).not.toBe(g.recibidas.find((e) => e.telefono === '51911000003')!.eventoId);
  });

  it('un envio que falla queda fallido; el reintento manda SOLO ese y sin volver a la IA', async () => {
    let caido = true;
    const g = gsgDePrueba((e) => (caido && e.telefono === '51911000003' ? { ok: false, error: 'Error 503: GSG tuvo un error en su servidor.', reintentable: true } : { ok: true }));
    const r = await etiquetarDelDia(deps(repo, () => iaDePrueba().ia, g.puerto), ALCANCE);
    expect(r).toMatchObject({ estado: 'completado_con_errores', syncEnviadas: 2, syncFallidas: 1 });
    const fallida = (await repo.delDia(DIA, ['51911000003']))[0]!;
    expect(fallida).toMatchObject({ syncEstado: 'fallido', syncIntentos: 1, etiqueta: 'horario_fijo' });
    expect(fallida.syncError).toMatch(/503/);
    expect((await repo.eventos({ loteId: r.loteId!, nivel: 'error', limite: 10 })).map((e) => [e.codigo, e.phone])).toEqual([['gsg_no_disponible', '51911000003']]);

    caido = false;
    const ia = iaDePrueba();
    const enviadasAntes = g.recibidas.length;
    const re = (await reintentarEnvios(deps(repo, () => ia.ia, g.puerto), undefined, { iniciadoPor: 'Ali' }))!;
    expect(ia.llamadas).toHaveLength(0);
    expect(g.recibidas.slice(enviadasAntes).map((e) => e.telefono)).toEqual(['51911000003']);
    expect(re).toMatchObject({ tipo: 'reintento', estado: 'completado', total: 1, syncEnviadas: 1, syncFallidas: 0 });
    expect((await repo.delDia(DIA, ['51911000003']))[0]).toMatchObject({ syncEstado: 'enviado', syncIntentos: 2, syncError: null });
    // La etiqueta mandada es la guardada, con el mismo eventoId (idempotente).
    expect(g.recibidas.at(-1)!.eventoId).toBe(g.recibidas.find((e) => e.telefono === '51911000003')!.eventoId);
    // Ya no queda nada fallido.
    expect(await reintentarEnvios(deps(repo, () => ia.ia, g.puerto))).toBeNull();
    expect((await repo.lotes(10)).map((l) => l.tipo)).toEqual(['reintento', 'completo']);
  });

  it('GSG rechaza la clave: no insiste con las demas, quedan fallidas sin contar intento', async () => {
    const g = gsgDePrueba(() => ({ ok: false, error: 'Error 401: la API Key de GSG no es correcta.', autenticacion: 401 }));
    const r = await etiquetarDelDia(deps(repo, () => iaDePrueba().ia, g.puerto), ALCANCE);
    expect(g.recibidas).toHaveLength(1);
    expect(r).toMatchObject({ estado: 'completado_con_errores', syncTotal: 3, syncEnviadas: 0, syncFallidas: 3 });
    const filas = await repo.delDia(DIA);
    expect(filas.filter((f) => f.syncIntentos === 1)).toHaveLength(1);
    expect(filas.filter((f) => f.syncIntentos === 0 && /No se intentó/.test(f.syncError ?? ''))).toHaveLength(2);
    expect((await repo.eventos({ nivel: 'error', limite: 10 })).map((e) => e.codigo)).toContain('gsg_clave');
  });

  it('sin la ruta de etiquetas o sin GSG: nada sale, todo queda fallido con el motivo y el reintento lo manda luego', async () => {
    const sinRuta = gsgDePrueba(() => ({ ok: false, error: 'Falta la «Ruta para etiquetas de chats» en Conexión con GSG: no hay a dónde mandarlas.', configuracion: true, reintentable: true }));
    const r = await etiquetarDelDia(deps(repo, () => iaDePrueba().ia, sinRuta.puerto), ALCANCE);
    expect(r).toMatchObject({ estado: 'completado_con_errores', syncFallidas: 3, syncEnviadas: 0 });
    expect(r.syncMotivo).toMatch(/Ruta para etiquetas/);
    expect((await repo.delDia(DIA)).every((f) => f.syncEstado === 'fallido' && f.syncIntentos === 0)).toBe(true);
    expect((await repo.eventos({ fase: 'sincronizacion', limite: 10 })).map((e) => e.codigo)).toEqual(['gsg_sin_configurar']);

    // Sin puerto: lo mismo, con su codigo.
    const r2 = (await reintentarEnvios(deps(repo, () => iaDePrueba().ia, null)))!;
    expect(r2).toMatchObject({ estado: 'completado_con_errores', syncFallidas: 3 });
    expect((await repo.eventos({ loteId: r2.loteId!, nivel: 'error', limite: 10 })).map((e) => e.codigo)).toEqual(['gsg_sin_conexion']);

    // Ya configurado: el reintento lo manda todo, sin IA.
    const bien = gsgDePrueba();
    const ia = iaDePrueba();
    const r3 = (await reintentarEnvios(deps(repo, () => ia.ia, bien.puerto)))!;
    expect(r3).toMatchObject({ estado: 'completado', syncEnviadas: 3 });
    expect(ia.llamadas).toHaveLength(0);
  });

  it('la IA falla: la conversacion no se manda (no hay etiqueta) y queda registrada', async () => {
    mensajes = [msg('51911000005', 'in', 'hola', 1)];
    const g = gsgDePrueba();
    const caida = { completar: async () => { throw new Error('sin saldo'); } };
    const r = await etiquetarDelDia(deps(repo, () => caida, g.puerto), ALCANCE);
    expect(r).toMatchObject({ estado: 'completado_con_errores', sinClasificar: 1, syncTotal: 0 });
    expect(g.recibidas).toHaveLength(0);
    expect((await repo.delDia(DIA))[0]).toMatchObject({ etiqueta: null, syncEstado: 'no_aplica' });
    const [e] = await repo.eventos({ fase: 'analisis', limite: 5 });
    expect(e).toMatchObject({ codigo: 'ia_fallo', nivel: 'error', phone: '51911000005' });
    expect(e!.detalle).toMatch(/sin saldo/);
  });

  it('en segundo plano: un lote a la vez, el estado sobrevive al proceso y un lote colgado se cierra', async () => {
    const colgado = await repo.crearLote({ dia: DIA, tipo: 'completo' });
    const g = gsgDePrueba();
    const e = crearEtiquetador(deps(repo, () => iaDePrueba().ia, g.puerto));
    expect(e.iniciar(ALCANCE).enCurso).toBe(true);
    expect(await e.reintentar()).toMatchObject({ enCurso: true, tipo: 'completo' });
    await e.esperar();
    expect(await e.estado()).toMatchObject({ enCurso: false, estado: 'completado', syncEnviadas: 3 });
    expect((await repo.lote(colgado.id))!).toMatchObject({ estado: 'fallido' });
    // Otro proceso (sin nada en memoria) lee el ultimo lote guardado.
    const otro = crearEtiquetador(deps(repo, () => null, g.puerto));
    expect(await otro.estado()).toMatchObject({ estado: 'completado', tipo: 'completo', syncEnviadas: 3, enCurso: false });
    expect(() => otro.iniciar(ALCANCE)).toThrow(/Asistente IA/);
    expect(await otro.reintentar()).toBeNull();
  });
});

// ------------------------------------------------------- contra MySQL

describe('el repo de sincronizacion contra la base', () => {
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
    for (const tabla of ['chat_etiquetas', 'chat_etiquetas_lotes', 'chat_etiquetas_eventos']) await pool.query(`delete from ${tabla}`);
  });

  it('el estado del envio sigue a la clasificacion: enviado se conserva solo si nada cambio', async () => {
    const base = { phone: '51911000030', dia: DIA, origen: 'ia' as const, mensajes: 2, motivo: null };
    await repo.guardar({ ...base, etiqueta: 'reclamo', huella: 'a'.repeat(64) });
    expect((await repo.porSincronizar(DIA, ['pendiente'])).map((f) => f.phone)).toEqual(['51911000030']);
    await repo.marcarSync('51911000030', DIA, { estado: 'fallido', error: 'Error 503' });
    expect((await repo.delDia(DIA))[0]).toMatchObject({ syncEstado: 'fallido', syncIntentos: 1, syncError: 'Error 503' });
    await repo.marcarSync('51911000030', DIA, { estado: 'enviado', huella: 'a'.repeat(64) });
    expect((await repo.delDia(DIA))[0]).toMatchObject({ syncEstado: 'enviado', syncIntentos: 2, syncError: null, syncHuella: 'a'.repeat(64) });

    // Misma etiqueta y huella: sigue enviado (no se manda otra vez).
    await repo.guardar({ ...base, etiqueta: 'reclamo', huella: 'a'.repeat(64) });
    expect((await repo.delDia(DIA))[0]).toMatchObject({ syncEstado: 'enviado', syncIntentos: 2 });
    // Cambia la conversacion: vuelve a pendiente, intentos a cero.
    await repo.guardar({ ...base, etiqueta: 'reclamo', huella: 'b'.repeat(64), loteId: null });
    expect((await repo.delDia(DIA))[0]).toMatchObject({ syncEstado: 'pendiente', syncIntentos: 0, syncError: null, huella: 'b'.repeat(64) });
    // Sin etiqueta: no aplica, y no sale en lo que hay que mandar.
    await repo.guardar({ ...base, etiqueta: null, huella: 'c'.repeat(64), motivo: 'caída' });
    expect((await repo.delDia(DIA))[0]!.syncEstado).toBe('no_aplica');
    expect(await repo.porSincronizar(DIA, ['pendiente', 'fallido', 'no_aplica'])).toEqual([]);
  });

  it('lotes y eventos: se guardan, se filtran, y un lote colgado se cierra', async () => {
    const l = await repo.crearLote({ dia: DIA, tipo: 'reintento', iniciadoPor: 'Ali' });
    expect(l).toMatchObject({ estado: 'en_curso', tipo: 'reintento', dia: DIA, iniciadoPor: 'Ali', terminoAt: null });
    await repo.actualizarLote(l.id, { estado: 'completado_con_errores', syncEnviadas: 2, syncFallidas: 1, error: 'x'.repeat(900), terminoAt: new Date() });
    const leido = (await repo.lote(l.id))!;
    expect(leido).toMatchObject({ estado: 'completado_con_errores', syncEnviadas: 2, syncFallidas: 1 });
    expect(leido.error).toHaveLength(500);
    const otro = await repo.crearLote({ dia: DIA, tipo: 'completo' });
    expect(await repo.cerrarLotesColgados('reinicio')).toBe(1);
    expect((await repo.lote(otro.id))!).toMatchObject({ estado: 'fallido', error: 'reinicio' });
    expect((await repo.lotes(10)).length).toBe(2);

    await repo.registrar({ loteId: l.id, phone: '51911000030', fase: 'sincronizacion', nivel: 'error', codigo: 'gsg_rechazo', detalle: 'Error 422' });
    await repo.registrar({ loteId: l.id, phone: null, fase: 'lote', nivel: 'info', codigo: 'lote_fin', detalle: null });
    await repo.registrar({ loteId: otro.id, phone: null, fase: 'lote', nivel: 'info', codigo: 'lote_inicio', detalle: null });
    expect((await repo.eventos({ loteId: l.id, limite: 10 })).map((e) => e.codigo)).toEqual(['lote_fin', 'gsg_rechazo']);
    expect((await repo.eventos({ nivel: 'error', limite: 10 })).map((e) => e.phone)).toEqual(['51911000030']);
    expect((await repo.eventos({ phone: '51911000030', fase: 'sincronizacion', limite: 10 }))).toHaveLength(1);
    expect((await repo.eventos({ limite: 2 }))).toHaveLength(2);
  });
});
