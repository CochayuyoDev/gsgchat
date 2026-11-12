/**
 * El hilo de la pantalla embebida no se reconstruye en cada sondeo.
 *
 * No hay navegador en las pruebas: el script de la pagina (el mismo que se
 * sirve) se ejecuta en un contexto de `vm` con un DOM minimo que cuenta lo que
 * se crea, se mueve y se borra. Lo que se comprueba es lo que causaba el
 * parpadeo: que una foto, un video o un audio que ya estan en pantalla sigan
 * siendo el mismo elemento (no se recargan, no reinician la reproduccion), que
 * el scroll no salte, y que un envio con error se pueda reintentar sin
 * mandarlo dos veces.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { embedChatPage } from '../src/embed/page.js';

class Nodo {
  tag: string;
  children: Nodo[] = [];
  parentNode: Nodo | null = null;
  className = '';
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  onclick: (() => void) | null = null;
  src = '';
  value = '';
  disabled = false;
  placeholder = '';
  _html = '';
  _texto = '';
  scrollTop = 0;
  clientHeight = 300;
  /** Cuantas veces se vacio con innerHTML = '': el hilo entero reconstruido. */
  vaciados = 0;
  constructor(tag: string) { this.tag = tag; }
  get classList() {
    const yo = this;
    const lista = () => yo.className.split(/\s+/).filter(Boolean);
    return {
      add: (c: string) => { if (!lista().includes(c)) yo.className = [...lista(), c].join(' '); },
      remove: (c: string) => { yo.className = lista().filter((x) => x !== c).join(' '); },
      contains: (c: string) => lista().includes(c),
      toggle: (c: string, on?: boolean) => { const quiere = on ?? !lista().includes(c); if (quiere) this.classList.add(c); else this.classList.remove(c); },
    };
  }
  get scrollHeight() { return this.children.length * 100; }
  get firstChild(): Nodo | null { return this.children[0] ?? null; }
  get nextSibling(): Nodo | null { const i = this.parentNode ? this.parentNode.children.indexOf(this) : -1; return i >= 0 ? this.parentNode!.children[i + 1] ?? null : null; }
  get textContent() { return this._texto; }
  set textContent(v: string) { this._texto = v; }
  get innerHTML() { return this._html; }
  set innerHTML(v: string) {
    this._html = v;
    this.children.forEach((c) => (c.parentNode = null));
    this.children = [];
    if (v === '') this.vaciados++;
    // Lo justo para que querySelector encuentre lo que la pagina pinta como texto.
    for (const m of v.matchAll(/class="([^"]+)"/g)) {
      const hijo = new Nodo('div');
      hijo.className = m[1]!;
      hijo.parentNode = this;
      this.children.push(hijo);
    }
  }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
  getAttribute(k: string) { return k in this.attrs ? this.attrs[k]! : null; }
  removeAttribute(k: string) { delete this.attrs[k]; }
  appendChild(n: Nodo) { return this.insertBefore(n, null); }
  insertBefore(n: Nodo, ref: Nodo | null) {
    if (n.parentNode) n.parentNode.children.splice(n.parentNode.children.indexOf(n), 1);
    n.parentNode = this;
    const i = ref ? this.children.indexOf(ref) : -1;
    if (i < 0) this.children.push(n); else this.children.splice(i, 0, n);
    movimientos.push(n);
    return n;
  }
  remove() { if (this.parentNode) { this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; } }
  querySelector(sel: string): Nodo | null {
    const clase = sel.startsWith('.') ? sel.slice(1) : null;
    for (const h of this.children) {
      if (clase && h.className.split(/\s+/).includes(clase)) return h;
      const dentro = h.querySelector(sel);
      if (dentro) return dentro;
    }
    return null;
  }
  recorrer(f: (n: Nodo) => void) { this.children.forEach((c) => { f(c); c.recorrer(f); }); }
}

let movimientos: Nodo[] = [];
let creados: Nodo[] = [];
let ids: Record<string, Nodo>;
let ctx: any;
let hiloActual: any;
let peticiones: Array<{ url: string; method: string; headers: Record<string, string>; body: any }>;
/** Lo que contesta POST /api/v1/mensajes en cada llamada: una respuesta, o una excepcion de red. */
let respuestasEnvio: Array<{ status: number; json: any } | 'red'>;

const msg = (id: number, tipo: string, extra: Record<string, unknown> = {}): Record<string, any> => ({
  id, mensajeId: `wamid.${id}`, direccion: 'saliente', tipo, texto: null, estado: 'sent', fecha: '2026-10-30T15:00:00.000Z', autor: 'persona', archivo: null, ...extra,
});
const archivo = (tipo: string, mime: string, token: string) => ({ url: `http://x/archivos/${token}`, tipo, mimeType: mime, bytes: 10, nombre: null, segundos: null, voz: false, verUnaVez: false, caducaEn: '2026-11-07T00:00:00.000Z' });
const MENSAJES = () => [
  msg(1, 'image', { texto: 'su pedido', archivo: archivo('imagen', 'image/jpeg', 'aaa') }),
  msg(2, 'video', { archivo: archivo('video', 'video/mp4', 'bbb') }),
  msg(3, 'audio', { texto: '(audio)', archivo: archivo('audio', 'audio/ogg', 'ccc') }),
];

function contexto() {
  movimientos = []; creados = []; ids = {}; peticiones = [];
  const documento = {
    getElementById: (id: string) => (ids[id] ??= new Nodo('div')),
    createElement: (tag: string) => { const n = new Nodo(tag); creados.push(n); return n; },
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const fetchFalso = async (url: string, init: any) => {
    const cabeceras = init?.headers ?? {};
    peticiones.push({ url, method: init?.method ?? 'GET', headers: cabeceras, body: init?.body ? JSON.parse(init.body) : null });
    const respuesta = (status: number, json: any) => ({ status, ok: status >= 200 && status < 300, json: async () => json });
    if (url.startsWith('/api/v1/conversaciones/') && url.includes('/leido')) return respuesta(200, { ok: true });
    if (url.startsWith('/api/v1/conversaciones/')) return respuesta(200, hiloActual);
    if (url === '/api/v1/mensajes') {
      const r = respuestasEnvio.shift() ?? { status: 200, json: { ok: true, mensajeId: 'wamid.99' } };
      if (r === 'red') throw new TypeError('Failed to fetch');
      return respuesta(r.status, r.json);
    }
    return respuesta(200, {});
  };
  const ventana: any = { parent: null, addEventListener() {}, crypto: { randomUUID: (() => { let n = 0; return () => `uuid-${++n}`; })() } };
  ventana.parent = ventana;
  ctx = vm.createContext({
    document: documento, window: ventana, location: { search: '?token=emb_prueba' }, URLSearchParams, fetch: fetchFalso,
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, console, Date, JSON, Object, Array, Math, String, Number, TypeError, Error, Promise,
    crypto: ventana.crypto,
  });
  const html = embedChatPage({ nombreNegocio: 'La Tienda', telefono: '51987654321' });
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
  vm.runInContext(script, ctx);
}

const hiloCon = (mensajes: any[]) => ({ contacto: { telefono: '51987654321', nombre: 'Maria' }, ventanaAbierta: true, puedeEscribir: true, motivo: null, mensajes, hayMas: false });
const caja = () => ids['mensajes']!;
const medios = () => { const l: Nodo[] = []; caja().recorrer((n) => { if (['img', 'video', 'audio'].includes(n.tag)) l.push(n); }); return l; };
const abrir = (silencioso = true) => ctx.abrir('51987654321', silencioso);

beforeEach(async () => {
  respuestasEnvio = [];
  hiloActual = hiloCon(MENSAJES());
  contexto();
  await new Promise((r) => setTimeout(r, 0));
  await abrir(false);
});

describe('la pagina embebida muestra foto, video y audio', () => {
  it('foto como imagen ampliable, video y audio con controles', () => {
    const [img, video, audio] = medios();
    expect([img!.tag, video!.tag, audio!.tag]).toEqual(['img', 'video', 'audio']);
    expect(img!.src).toBe('http://x/archivos/aaa');
    expect(typeof img!.onclick).toBe('function');
    expect(video!.attrs).toBeDefined();
    expect((video as any).controls).toBe(true);
    expect((audio as any).controls).toBe(true);
    expect(img!.className).toBe('foto');
  });
});

describe('actualizar el chat no lo reconstruye', () => {
  it('un sondeo sin cambios no crea, no mueve ni borra nada', async () => {
    const antes = medios();
    const hijos = [...caja().children];
    const creadosAntes = creados.length;
    movimientos = [];
    await abrir();
    expect(medios()).toEqual(antes);
    medios().forEach((m, i) => expect(m).toBe(antes[i]));
    expect(caja().children).toEqual(hijos);
    expect(creados.length).toBe(creadosAntes);
    expect(movimientos).toHaveLength(0);
    expect(caja().vaciados).toBe(1);
  });

  it('el enlace firmado cambia pero el archivo es el mismo: el elemento se queda, con su src', async () => {
    const antes = medios();
    hiloActual = hiloCon(MENSAJES().map((m) => (m.archivo ? { ...m, archivo: { ...m.archivo, url: m.archivo.url + '-otro' } } : m)));
    movimientos = [];
    await abrir();
    medios().forEach((m, i) => { expect(m).toBe(antes[i]); expect(m.src).toBe(antes[i]!.src); });
    expect(movimientos).toHaveLength(0);
  });

  it('un mensaje nuevo se agrega al final y los medios que ya estaban siguen siendo los mismos', async () => {
    const antes = medios();
    hiloActual = hiloCon([...MENSAJES(), msg(4, 'text', { texto: 'gracias', direccion: 'entrante' })]);
    await abrir();
    medios().forEach((m, i) => expect(m).toBe(antes[i]));
    expect(caja().children[caja().children.length - 1]!.querySelector('.cuerpo')!.textContent).toBe('gracias');
  });

  it('cambia el estado (enviado a leido) sin tocar el elemento multimedia', async () => {
    const antes = medios();
    hiloActual = hiloCon(MENSAJES().map((m) => ({ ...m, estado: 'read' })));
    await abrir();
    medios().forEach((m, i) => expect(m).toBe(antes[i]));
    const meta = caja().children.find((c) => c.attrs['data-clave'] === 'm1')!.querySelector('.meta')!;
    expect(meta.innerHTML).toContain('leido');
  });

  it('si quien lee subio a ver algo, el scroll no se mueve; si esta al final, sigue al ultimo', async () => {
    caja().clientHeight = 100;
    caja().scrollTop = 40;
    hiloActual = hiloCon([...MENSAJES(), msg(4, 'text', { texto: 'uno', direccion: 'entrante' })]);
    await abrir();
    expect(caja().scrollTop).toBe(40);
    caja().scrollTop = caja().scrollHeight - caja().clientHeight;
    hiloActual = hiloCon([...MENSAJES(), msg(4, 'text', { texto: 'uno', direccion: 'entrante' }), msg(5, 'text', { texto: 'dos', direccion: 'entrante' })]);
    await abrir();
    expect(caja().scrollTop).toBe(caja().scrollHeight);
  });

  it('un mensaje que desaparece del servidor se quita; los demas no se tocan', async () => {
    const antes = medios();
    hiloActual = hiloCon(MENSAJES().slice(0, 2));
    await abrir();
    expect(medios()).toHaveLength(2);
    expect(medios()[0]).toBe(antes[0]);
  });
});

describe('enviar desde la pantalla: cargando, enviado o error con reintento', () => {
  it('mientras sale se ve "Enviando…" y al llegar del servidor se sustituye sin saltos', async () => {
    let soltar!: () => void;
    const lenta = new Promise<void>((r) => (soltar = r));
    const original = ctx.fetch;
    ctx.fetch = async (url: string, init: any) => { if (url === '/api/v1/mensajes') await lenta; return original(url, init); };
    const envio = ctx.enviar({ texto: 'hola' });
    await new Promise((r) => setTimeout(r, 0));
    const pendiente = caja().children.find((c) => c.className.includes('enviando'))!;
    expect(pendiente.innerHTML).toContain('Enviando');
    soltar();
    hiloActual = hiloCon([...MENSAJES(), msg(99, 'text', { texto: 'hola' })]);
    await envio;
    expect(caja().children.some((c) => c.className.includes('enviando'))).toBe(false);
    expect(caja().children.some((c) => c.attrs['data-clave'] === 'm99')).toBe(true);
  });

  it('si el servidor dice que no salio, queda el aviso con Reintentar, y el reintento lleva otra clave', async () => {
    respuestasEnvio = [{ status: 502, json: { ok: false, estado: 'error', error: 'Meta caido' } }, { status: 200, json: { ok: true, mensajeId: 'wamid.99' } }];
    await ctx.enviar({ texto: 'hola' });
    const fallido = caja().children.find((c) => c.className.includes('fallo-envio'))!;
    expect(fallido.innerHTML).toContain('Meta caido');
    expect(fallido.querySelector('.reintentar')).not.toBeNull();
    const [primera] = peticiones.filter((p) => p.url === '/api/v1/mensajes');
    hiloActual = hiloCon([...MENSAJES(), msg(99, 'text', { texto: 'hola' })]);
    fallido.querySelector('.reintentar')!.onclick!();
    await new Promise((r) => setTimeout(r, 5));
    const envios = peticiones.filter((p) => p.url === '/api/v1/mensajes');
    expect(envios).toHaveLength(2);
    expect(envios[1]!.headers['idempotency-key']).not.toBe(primera!.headers['idempotency-key']);
  });

  it('si se cayo la red (no se sabe si salio), el reintento lleva la MISMA clave: no se duplica', async () => {
    respuestasEnvio = ['red', { status: 200, json: { ok: true, mensajeId: 'wamid.99' } }];
    await ctx.enviar({ texto: 'hola' });
    const fallido = caja().children.find((c) => c.className.includes('fallo-envio'))!;
    fallido.querySelector('.reintentar')!.onclick!();
    await new Promise((r) => setTimeout(r, 5));
    const envios = peticiones.filter((p) => p.url === '/api/v1/mensajes');
    expect(envios).toHaveLength(2);
    expect(envios[0]!.headers['idempotency-key']).toBeTruthy();
    expect(envios[1]!.headers['idempotency-key']).toBe(envios[0]!.headers['idempotency-key']);
  });
});
