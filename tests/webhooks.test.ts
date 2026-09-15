/**
 * Webhooks salientes: el bus, la cola y el reparto.
 *
 * Lo que se prueba es que otro sistema se ENTERE: un mensaje que se guarda
 * tiene que acabar como un POST firmado en su URL, con reintentos si esta
 * caido, y sin insistir para siempre contra una URL muerta.
 */

import { describe, expect, it } from 'vitest';
import { crearBus, NOMBRES_EVENTOS, type Eventos, type NombreEvento } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { firmar, generarSecretoWebhook, verificarFirma } from '../src/webhooks/firma.js';
import {
  APAGAR_TRAS_MS,
  cuerpoDeEntrega,
  despacharEntregas,
  encolarEventos,
  entregarUna,
  ESPERAS_MS,
  MAX_INTENTOS,
} from '../src/webhooks/despachador.js';
import { createFakeRepos } from './fakes.js';
import { createFakeWebhooks } from './fakes-webhooks.js';

/** Un servidor del otro lado, que contesta lo que se le diga y guarda lo que le llega. */
function servidorFalso(respuestas: Array<number | Error | 'timeout'>) {
  const recibido: Array<{ url: string; cabeceras: Record<string, string>; cuerpo: string }> = [];
  let i = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const r = respuestas[Math.min(i++, respuestas.length - 1)] ?? 200;
    recibido.push({
      url: String(url),
      cabeceras: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
      cuerpo: String(init?.body ?? ''),
    });
    if (r instanceof Error) throw r;
    if (r === 'timeout') {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });
    }
    return new Response(r >= 400 ? '{"error":"no"}' : 'ok', { status: r });
  }) as unknown as typeof fetch;
  return { fetchImpl, recibido };
}

describe('la firma', () => {
  it('firma con el secreto y la marca de tiempo, y se verifica en tiempo constante', () => {
    const secreto = generarSecretoWebhook();
    expect(secreto.startsWith('whsec_')).toBe(true);
    const cuerpo = '{"evento":"mensaje.recibido"}';
    const firma = firmar(secreto, cuerpo, 1_700_000_000);
    expect(firma).toMatch(/^t=1700000000,v1=[0-9a-f]{64}$/);
    expect(verificarFirma(secreto, cuerpo, firma, { ahoraSeg: 1_700_000_010 })).toBe(true);
    expect(verificarFirma(secreto, cuerpo + ' ', firma, { ahoraSeg: 1_700_000_010 })).toBe(false);
    expect(verificarFirma('otro', cuerpo, firma, { ahoraSeg: 1_700_000_010 })).toBe(false);
    expect(verificarFirma(secreto, cuerpo, undefined)).toBe(false);
    expect(verificarFirma(secreto, cuerpo, 'basura')).toBe(false);
  });

  it('una firma vieja no vale: la marca de tiempo va dentro de lo firmado', () => {
    const secreto = generarSecretoWebhook();
    const firma = firmar(secreto, '{}', 1_700_000_000);
    expect(verificarFirma(secreto, '{}', firma, { ahoraSeg: 1_700_000_000 + 10 * 60 })).toBe(false);
    expect(verificarFirma(secreto, '{}', firma, { ahoraSeg: 1_700_000_000 + 10 * 60, toleranciaSeg: 3600 })).toBe(true);
  });
});

describe('el bus y los repositorios observados', () => {
  function escucharTodo() {
    const bus = crearBus();
    const visto: Array<{ evento: NombreEvento; payload: unknown }> = [];
    bus.escucharTodo((evento, payload) => {
      visto.push({ evento, payload });
    });
    const repos = observarRepos(createFakeRepos(), bus);
    return { bus, visto, repos };
  }

  it('guardar un entrante anuncia mensaje.recibido con el contacto y la ventana', async () => {
    const { repos, visto } = escucharTodo();
    const c = await repos.contacts.upsertFromInbound('51987654321', 'Maria');
    await repos.contacts.touchInbound(c.phone, new Date());
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'wamid.1', kind: 'text', body: 'hola' });

    const recibido = visto.find((v) => v.evento === 'mensaje.recibido');
    expect(recibido).toBeTruthy();
    const p = recibido!.payload as Eventos['mensaje.recibido'];
    expect(p.contacto).toEqual({ id: c.id, telefono: '51987654321', nombre: 'Maria' });
    expect(p.mensaje).toMatchObject({ id: 'wamid.1', tipo: 'text', texto: 'hola' });
    expect(p.ventanaAbierta).toBe(true);
  });

  it('el mismo wamid dos veces (reentrega de WhatsApp Web) se anuncia una sola vez', async () => {
    const { repos, visto } = escucharTodo();
    const c = await repos.contacts.upsertFromInbound('51987654321');
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'wamid.rep', kind: 'text', body: 'a' });
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'wamid.rep', kind: 'text', body: 'a' });
    expect(visto.filter((v) => v.evento === 'mensaje.recibido')).toHaveLength(1);
  });

  it('un saliente anuncia mensaje.enviado, y su estado mensaje.estado', async () => {
    const { repos, visto } = escucharTodo();
    const c = await repos.contacts.upsertFromInbound('51987654321');
    await repos.messages.add({ contactId: c.id, direction: 'out', wamid: 'wamid.out', kind: 'text', body: 'gracias', status: 'sent' });
    await repos.messages.setStatusByWamid('wamid.out', 'delivered');
    expect(visto.map((v) => v.evento)).toEqual(['mensaje.enviado', 'mensaje.estado']);
    expect(visto[1]!.payload).toMatchObject({ mensajeId: 'wamid.out', estado: 'delivered' });
  });

  it('ubicacion, alta y baja tienen su evento', async () => {
    const { repos, visto } = escucharTodo();
    const c = await repos.contacts.upsertFromInbound('51987654321', 'Ana');
    await repos.locations.save(
      c.id,
      { ok: true, lat: -12.04, lng: -77.04, source: 'whatsapp_native', confidence: 'high', precisionMeters: 5, mapsUrl: 'x', warnings: [], needsConfirmation: false },
      'pin',
    );
    await repos.contacts.setOptIn(c.phone, 'pedido P-1');
    await repos.contacts.setOptOut(c.phone);
    expect(visto.map((v) => v.evento)).toEqual(['ubicacion.recibida', 'contacto.alta', 'contacto.baja']);
    expect(visto[0]!.payload).toMatchObject({ contacto: { telefono: '51987654321', nombre: 'Ana' }, ubicacion: { lat: -12.04, lng: -77.04, fuente: 'whatsapp_native' } });
    expect(visto[1]!.payload).toMatchObject({ origen: 'pedido P-1' });
  });

  it('el semaforo se anuncia solo cuando cambia de nivel', async () => {
    const { repos, visto } = escucharTodo();
    const patch = { riesgo: 10, nivel: 'verde' as const, factor: 1, motivos: [], pausadaHasta: null, rampaDesde: null, ultimaEvaluacion: new Date() };
    await repos.numberState.setRiesgo('PNID', patch);
    await repos.numberState.setRiesgo('PNID', { ...patch, riesgo: 12 });
    await repos.numberState.setRiesgo('PNID', { ...patch, riesgo: 45, nivel: 'amarillo', motivos: ['fallos'] });
    const niveles = visto.filter((v) => v.evento === 'salud.nivel');
    expect(niveles).toHaveLength(1);
    expect(niveles[0]!.payload).toMatchObject({ de: 'verde', a: 'amarillo', puntos: 45, motivos: ['fallos'] });
  });

  it('un oyente que revienta no tumba a quien emitio', async () => {
    const avisos: string[] = [];
    const bus = crearBus((m) => avisos.push(m));
    bus.escuchar('contacto.baja', () => {
      throw new Error('boom');
    });
    bus.escuchar('contacto.baja', async () => {
      throw new Error('boom async');
    });
    const repos = observarRepos(createFakeRepos(), bus);
    await repos.contacts.upsertFromInbound('51987654321');
    await expect(repos.contacts.setOptOut('51987654321')).resolves.toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(avisos).toHaveLength(2);
  });
});

describe('la cola: encolar por suscriptor', () => {
  it('cada evento deja una entrega por webhook activo que lo quiera', async () => {
    const bus = crearBus();
    const repo = createFakeWebhooks();
    const todo = await repo.crear({ url: 'https://a.test/wh', descripcion: 'todo', secreto: 's1', eventos: ['*'], creadoPor: null });
    const soloMensajes = await repo.crear({ url: 'https://b.test/wh', descripcion: 'mensajes', secreto: 's2', eventos: ['mensaje.recibido'], creadoPor: null });
    const apagado = await repo.crear({ url: 'https://c.test/wh', descripcion: 'apagado', secreto: 's3', eventos: ['*'], creadoPor: null });
    await repo.actualizar(apagado.id, { activo: false });
    encolarEventos(bus, repo);

    bus.emitir('contacto.baja', { contacto: { telefono: '1' }, fecha: 'f' });
    bus.emitir('mensaje.recibido', { contacto: { id: 'c', telefono: '1', nombre: null }, mensaje: { id: 'w', tipo: 'text', texto: 'x', datos: null, fecha: 'f' }, ventanaAbierta: true });
    await new Promise((r) => setTimeout(r, 0));

    const porWebhook = (id: string) => repo._entregas.filter((e) => e.webhookId === id).map((e) => e.evento);
    expect(porWebhook(todo.id)).toEqual(['contacto.baja', 'mensaje.recibido']);
    expect(porWebhook(soloMensajes.id)).toEqual(['mensaje.recibido']);
    expect(porWebhook(apagado.id)).toEqual([]);
  });
});

describe('el reparto', () => {
  const T0 = new Date('2026-09-15T10:00:00Z');

  async function conEntrega(respuestas: Array<number | Error | 'timeout'>, eventos = ['*']) {
    const repo = createFakeWebhooks();
    const w = await repo.crear({ url: 'https://stoky.test/webhooks/whatsapp', descripcion: 'Stoky', secreto: 'whsec_prueba', eventos, creadoPor: null });
    // El doble usa el reloj real al crear; aqui manda el de la prueba.
    repo._webhooks.find((x) => x.id === w.id)!.createdAt = T0;
    await repo.encolar(w.id, 'mensaje.recibido', { hola: 'mundo' }, T0);
    const servidor = servidorFalso(respuestas);
    let ahora = T0;
    const deps = { repo, fetchImpl: servidor.fetchImpl, ahora: () => ahora, timeoutMs: 50 };
    return { repo, w, servidor, deps, avanzar: (ms: number) => (ahora = new Date(ahora.getTime() + ms)) };
  }

  it('un 2xx cierra la entrega; el POST va firmado y con el cuerpo esperado', async () => {
    const { repo, w, servidor, deps } = await conEntrega([200]);
    const r = await despacharEntregas(deps);
    expect(r).toMatchObject({ intentadas: 1, enviadas: 1, reintentar: 0, fallidas: 0 });

    const e = (await repo.entregas(w.id, 10))[0]!;
    expect(e.estado).toBe('enviada');
    expect(e.intentos).toBe(1);
    expect(e.respuestaCodigo).toBe(200);

    const post = servidor.recibido[0]!;
    expect(post.url).toBe('https://stoky.test/webhooks/whatsapp');
    expect(post.cabeceras['x-evento']).toBe('mensaje.recibido');
    expect(post.cabeceras['content-type']).toBe('application/json');
    const cuerpo = JSON.parse(post.cuerpo) as Record<string, unknown>;
    expect(cuerpo).toMatchObject({ evento: 'mensaje.recibido', intento: 1, datos: { hola: 'mundo' } });
    expect(verificarFirma('whsec_prueba', post.cuerpo, post.cabeceras['x-firma'], { ahoraSeg: Math.floor(T0.getTime() / 1000) })).toBe(true);
    expect((await repo.obtener(w.id))!.ultimoOkAt).toEqual(T0);
  });

  it('un 5xx o una caida reintenta con espera creciente y a la sexta se da por perdida', async () => {
    const { repo, w, deps, avanzar } = await conEntrega([500, new Error('ECONNREFUSED'), 'timeout', 503, 502, 500]);
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      const r = await despacharEntregas(deps);
      expect(r.intentadas, `intento ${intento}`).toBe(1);
      const e = (await repo.entregas(w.id, 10))[0]!;
      expect(e.intentos).toBe(intento);
      if (intento < MAX_INTENTOS) {
        expect(e.estado).toBe('pendiente');
        const espera = ESPERAS_MS[intento - 1]!;
        expect(e.proximoIntentoAt.getTime() - deps.ahora().getTime()).toBe(espera);
        // Antes de que toque, no se intenta.
        avanzar(espera - 1);
        expect((await despacharEntregas(deps)).intentadas).toBe(0);
        avanzar(1);
      } else {
        expect(e.estado).toBe('fallida');
      }
    }
    expect((await repo.entregas(w.id, 10))[0]!.error).toBe('HTTP 500');
  });

  it('un 4xx es un no: no se insiste', async () => {
    const { repo, w, deps } = await conEntrega([401]);
    const r = await despacharEntregas(deps);
    expect(r.fallidas).toBe(1);
    const e = (await repo.entregas(w.id, 10))[0]!;
    expect(e.estado).toBe('fallida');
    expect(e.respuestaCodigo).toBe(401);
    expect(e.respuesta).toContain('no');
  });

  it('408 y 429 son "ahora no": se reintenta', async () => {
    const { repo, w, deps } = await conEntrega([429]);
    await despacharEntregas(deps);
    expect((await repo.entregas(w.id, 10))[0]!.estado).toBe('pendiente');
  });

  it('un dia entero sin una entrega buena apaga el webhook con su motivo, y reactivarlo lo limpia', async () => {
    const { repo, w, deps, avanzar } = await conEntrega([500]);
    // Muchas entregas fallando durante mas de 24 h.
    for (let i = 0; i < 6; i++) await repo.encolar(w.id, 'contacto.baja', { n: i }, T0);
    await despacharEntregas(deps);
    expect((await repo.obtener(w.id))!.activo).toBe(true);

    avanzar(APAGAR_TRAS_MS + 1);
    for (const e of repo._entregas) e.proximoIntentoAt = deps.ahora();
    const r = await despacharEntregas(deps);
    expect(r.apagados).toEqual([w.id]);
    const apagado = (await repo.obtener(w.id))!;
    expect(apagado.activo).toBe(false);
    expect(apagado.motivoPausa).toContain('sin una entrega buena');

    // Apagado, la cola no lo toca.
    expect((await despacharEntregas(deps)).intentadas).toBe(0);

    await repo.actualizar(w.id, { activo: true });
    const vuelto = (await repo.obtener(w.id))!;
    expect(vuelto.motivoPausa).toBeNull();
    expect(vuelto.fallosSeguidos).toBe(0);
  });

  it('reencolar devuelve las fallidas a pendiente', async () => {
    const { repo, w, deps } = await conEntrega([404]);
    await despacharEntregas(deps);
    expect(await repo.reencolarFallidas(w.id, deps.ahora())).toBe(1);
    expect((await repo.entregas(w.id, 10))[0]!.estado).toBe('pendiente');
  });

  it('entregarUna con timeout dice que no contesto a tiempo', async () => {
    const servidor = servidorFalso(['timeout']);
    const r = await entregarUna(
      { id: 'w', url: 'https://x.test', secreto: 's', descripcion: '', eventos: ['*'], activo: true, motivoPausa: null, creadoPor: null, createdAt: T0, ultimoOkAt: null, ultimoFalloAt: null, fallosSeguidos: 0 },
      { id: 1, evento: 'prueba.ping', payload: {}, createdAt: T0, intentos: 0 },
      { fetchImpl: servidor.fetchImpl, timeoutMs: 20 },
    );
    expect(r.ok).toBe(false);
    expect(r.reintentable).toBe(true);
    expect(r.error).toBe('sin respuesta a tiempo');
  });

  it('el cuerpo de la entrega lleva id, evento, fecha, intento y datos', () => {
    const cuerpo = JSON.parse(cuerpoDeEntrega({ id: 7, evento: 'salud.nivel', payload: { a: 'rojo' }, createdAt: T0, intentos: 2 })) as Record<string, unknown>;
    expect(cuerpo).toEqual({ id: '7', evento: 'salud.nivel', fecha: T0.toISOString(), intento: 3, datos: { a: 'rojo' } });
  });

  it('la lista de eventos publicada es la que emite el bus', () => {
    expect(NOMBRES_EVENTOS).toContain('mensaje.recibido');
    expect(new Set(NOMBRES_EVENTOS).size).toBe(NOMBRES_EVENTOS.length);
  });
});
