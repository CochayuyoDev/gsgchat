/**
 * La plataforma de tiendas: registro abierto, cada registro es una tienda
 * nueva, y NADA se cruza entre tiendas (datos, sesiones, WhatsApp, entorno).
 *
 * Se levanta el servidor de verdad (el de delante, con sus reglas de reparto)
 * sobre bases de verdad del servidor MySQL/MariaDB de pruebas (una por tienda,
 * con nombres gsgchat_prueba_plat_*) y se le habla por HTTP, como un
 * navegador: cookies, prefijos /tienda/<slug>/ y Referer incluidos.
 *
 * Las bases de las tiendas que se crean aqui vuelven al banco al terminar
 * (vaciadas): la siguiente ejecucion no paga otra vez el DDL. La PRIMERA vez
 * cada tienda crea sus tablas desde cero y tarda (minutos en un disco lento).
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { basesDeLaPlataforma, crearPlataforma, celularDe, type Plataforma } from '../src/plataforma/plataforma.js';
import { crearServidorPlataforma, partirPrefijo, type ServidorPlataforma } from '../src/plataforma/servidor.js';
import { entornoDeTienda, slugDe } from '../src/plataforma/entorno.js';
import { armarTienda } from '../src/plataforma/tienda.js';
import { bootstrapSecrets } from '../src/settings/crypto.js';
import { existeBase, rellenarBanco } from '../src/db/bases.js';
import { bancoDePrueba, devolverBasesDePrueba, URL_PRUEBAS, urlConBase } from './mysql.js';

/** Todas las bases de este fichero empiezan por aqui (directorios, tiendas y su banco). */
const PREFIJO = 'gsgchat_prueba_plat_';
const BANCO = bancoDePrueba(PREFIJO);
/** Una plataforma de prueba: su directorio en <PREFIJO><nombre>_plataforma y sus tiendas en <PREFIJO><nombre>_t_<id>. */
const baseDePlataforma = (nombre: string) => ({ url: urlConBase(`${PREFIJO}${nombre}`) });
const TIEMPO = 3_600_000;

// Lo que dejo a medias una ejecucion anterior vuelve al banco antes de empezar,
// y lo de esta, al terminar.
beforeAll(() => devolverBasesDePrueba(BANCO), 3_600_000);
afterAll(() => devolverBasesDePrueba(BANCO), 3_600_000);

/** Un navegador minimo: guarda las cookies que le ponen y las manda. */
class Navegador {
  cookies = new Map<string, string>();
  constructor(
    private base: string,
    private ip = '10.0.0.1',
  ) {}
  cabeceraCookie(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async pedir(ruta: string, init: RequestInit & { json?: unknown; referer?: string } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (this.cookies.size) headers.set('cookie', this.cabeceraCookie());
    headers.set('x-forwarded-for', this.ip);
    if (init.referer) headers.set('referer', init.referer);
    if (init.json !== undefined) headers.set('content-type', 'application/json');
    const res = await fetch(this.base + ruta, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body, redirect: 'manual' });
    for (const linea of res.headers.getSetCookie()) {
      const [par] = linea.split(';');
      const [k, ...v] = par!.split('=');
      const valor = v.join('=');
      if (/max-age=0/i.test(linea) || valor === '') this.cookies.delete(k!.trim());
      else this.cookies.set(k!.trim(), valor);
    }
    return res;
  }
}

const REGISTRO = (datos: Partial<Record<string, unknown>> = {}) => ({
  tienda: 'Bodega Doña Rosa',
  rubro: 'Comida',
  nombre: 'Rosa',
  celular: '987 654 321',
  usuario: 'rosa',
  clave: 'rosa-2026-segura',
  ...datos,
});

describe('plataforma de tiendas', () => {
  let raiz: string;
  let plataforma: Plataforma;
  let servidor: ServidorPlataforma;
  let base: string;
  const rosa = () => new Navegador(base, '10.0.0.1');
  let navRosa: Navegador;
  let navPedro: Navegador;

  beforeAll(async () => {
    // Las dos tiendas de este bloque se registran por HTTP, y fetch se rinde a
    // los 5 minutos sin respuesta: sus bases se dejan listas antes (si el banco
    // ya las tiene, esto no hace nada), y el registro solo se las queda.
    await rellenarBanco({ ...BANCO, reserva: 2 });
    raiz = mkdtempSync(path.join(tmpdir(), 'plataforma-'));
    plataforma = await crearPlataforma({
      raiz,
      publicBaseUrl: 'http://localhost:0',
      // Lo que tiene el .env de la tienda de siempre: NADA de esto puede
      // llegarle a una tienda nueva.
      proceso: {
        WHATSAPP_TOKEN: 'token-de-la-principal',
        WHATSAPP_PHONE_NUMBER_ID: 'PNID-principal',
        RUTAS_SUPERVISOR: '51912000001',
        SOLO_NUMEROS: '51912000002',
        GSG_URL: 'https://gsg.example/api',
        GSG_TOKEN: 'gsg-secreto',
        STOKY_URL: 'https://stoky.example',
        STOKY_TOKEN: 'stk_secreto',
        PLAN_URL: 'https://maestro.example/api/plan/x',
        TIMEZONE: 'America/Lima',
      },
      extraTiendas: { DEV_SIMULATE_INBOUND: 'true', RAFAGA_MS: '0' },
      base: baseDePlataforma('a'),
      banco: BANCO,
      principal: null,
      autoConectarLocal: false,
      sembrarPlantillasLocales: true,
      carpetaCopias: path.join(raiz, 'copias'),
      registrosPorHora: 50,
      log: () => undefined,
    });
    await plataforma.arrancar();
    servidor = await crearServidorPlataforma({ plataforma, segura: false });
    await servidor.escuchar(0, '127.0.0.1');
    base = `http://127.0.0.1:${(servidor.server.address() as AddressInfo).port}`;
  }, TIEMPO);

  afterAll(async () => {
    await servidor?.cerrar();
    await plataforma?.parar();
    rmSync(raiz, { recursive: true, force: true });
  });

  it('/login ofrece crear una tienda y ya no manda a pedirle la cuenta a nadie', async () => {
    const res = await rosa().pedir('/login');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="f-tienda"');
    expect(html).toContain('id="f-entrar"');
    expect(html).toContain('Crear mi tienda');
    expect(html).not.toContain('solo para la primera cuenta');
    expect(html).not.toContain('Pídele tu cuenta');
    // Plataforma vacia: se abre por "Crear mi tienda".
    expect(html).toContain('"vista":"tienda"');
  });

  it('registrarse crea una tienda nueva, deja la sesion abierta y lleva al panel', async () => {
    navRosa = rosa();
    const res = await navRosa.pedir('/registro', { method: 'POST', json: REGISTRO() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; next: string; tienda: { slug: string } };
    expect(body).toMatchObject({ ok: true, next: '/panel', tienda: { slug: 'bodega-dona-rosa' } });
    expect(navRosa.cookies.get('gsg_tienda')).toBe('bodega-dona-rosa');
    expect(navRosa.cookies.get('wa_sesion')).toBeTruthy();

    const panel = await navRosa.pedir('/panel');
    expect(panel.status).toBe(200);
    const yo = (await (await navRosa.pedir('/admin/yo')).json()) as Record<string, unknown>;
    // La primera tienda de una plataforma vacia es la de su dueño.
    expect(yo).toMatchObject({ usuario: 'rosa', nombre: 'Rosa', rol: 'admin', super: true, modo: 'completo' });

    // Sus datos principales quedaron en SU configuracion.
    const ajustes = (await (await navRosa.pedir('/admin/ajustes')).json()) as { guardado: { nombreNegocio: string; avisos: { supervisor: string } } };
    expect(ajustes.guardado.nombreNegocio).toBe('Bodega Doña Rosa');
    expect(ajustes.guardado.avisos.supervisor).toBe('51987654321');
    // Y su base propia en el servidor, y su carpeta propia con sus secretos.
    const t = await plataforma.directorio.porSlug('bodega-dona-rosa');
    expect(t?.rubro).toBe('Comida');
    expect(await existeBase(URL_PRUEBAS, `${PREFIJO}a_t_${t!.id}`)).toBe(true);
    expect((await plataforma.tiendaPorSlug('bodega-dona-rosa'))!.base).toBe(`${PREFIJO}a_t_${t!.id}`);
    expect(existsSync(path.join(raiz, t!.id, '.secrets.json'))).toBe(true);
  }, TIEMPO);

  it('la segunda tienda es otra tienda: su dueño es administrador de la suya y nada mas', async () => {
    navPedro = new Navegador(base, '10.0.0.2');
    const res = await navPedro.pedir('/registro', { method: 'POST', json: REGISTRO({ tienda: 'Pedro Tecno', rubro: 'Tecnología', nombre: 'Pedro', celular: null, usuario: 'pedro', clave: 'pedro-2026-segura' }) });
    expect(res.status).toBe(200);
    expect(navPedro.cookies.get('gsg_tienda')).toBe('pedro-tecno');
    const yo = (await (await navPedro.pedir('/admin/yo')).json()) as Record<string, unknown>;
    expect(yo).toMatchObject({ usuario: 'pedro', rol: 'admin', super: false });
    // No ve lo del superadministrador.
    expect((await navPedro.pedir('/admin/tiendas')).status).toBe(403);
    const ajustes = (await (await navPedro.pedir('/admin/ajustes')).json()) as { guardado: { nombreNegocio: string; avisos: { supervisor: string | null } } };
    expect(ajustes.guardado.nombreNegocio).toBe('Pedro Tecno');
    expect(ajustes.guardado.avisos.supervisor).toBeNull();
    // Cada una en su base.
    const tRosa = (await plataforma.tiendaPorSlug('bodega-dona-rosa'))!;
    const tPedro = (await plataforma.tiendaPorSlug('pedro-tecno'))!;
    expect(tRosa.base).not.toBe(tPedro.base);
  }, TIEMPO);

  it('los clientes y mensajes de una tienda no aparecen en otra', async () => {
    const entra = await navRosa.pedir('/admin/dev/inbound', { method: 'POST', json: { phone: '51911111111', name: 'Cliente de Rosa', text: 'hola, ¿tienen arroz?' } });
    expect(entra.status).toBe(200);
    const deRosa = (await (await navRosa.pedir('/admin/contacts?q=51911111111')).json()) as { items?: unknown[]; total?: number } | unknown[];
    const listaRosa = Array.isArray(deRosa) ? deRosa : (deRosa.items ?? []);
    expect(listaRosa.length).toBe(1);

    const dePedro = (await (await navPedro.pedir('/admin/contacts?q=51911111111')).json()) as { items?: unknown[] } | unknown[];
    const listaPedro = Array.isArray(dePedro) ? dePedro : (dePedro.items ?? []);
    expect(listaPedro.length).toBe(0);

    // Y en la base de cada una, directamente.
    const tRosa = await plataforma.tiendaPorSlug('bodega-dona-rosa');
    const tPedro = await plataforma.tiendaPorSlug('pedro-tecno');
    expect(await tRosa!.repos.contacts.getByPhone('51911111111')).toBeTruthy();
    expect(await tPedro!.repos.contacts.getByPhone('51911111111')).toBeNull();
  });

  it('cada tienda tiene su propia sesion de WhatsApp, su URL y NADA del .env de otra', async () => {
    const tRosa = (await plataforma.tiendaPorSlug('bodega-dona-rosa'))!;
    const tPedro = (await plataforma.tiendaPorSlug('pedro-tecno'))!;
    expect(tRosa.sesion).not.toBe(tPedro.sesion);
    expect(tRosa.config.PUBLIC_BASE_URL).toBe('http://localhost:0/tienda/bodega-dona-rosa');
    expect(tPedro.config.PUBLIC_BASE_URL).toBe('http://localhost:0/tienda/pedro-tecno');
    for (const t of [tRosa, tPedro]) {
      expect(t.config.WHATSAPP_TOKEN ?? '').toBe('');
      expect(t.config.WHATSAPP_PHONE_NUMBER_ID ?? '').toBe('');
      expect(t.config.RUTAS_SUPERVISOR ?? '').toBe('');
      expect(t.config.GSG_TOKEN ?? '').toBe('');
      expect(t.config.STOKY_TOKEN ?? '').toBe('');
      expect(t.config.PLAN_URL ?? '').toBe('');
      expect(t.config.soloNumeros).toEqual([]);
      expect(t.config.WHATSAPP_PROVIDER).toBe('local');
    }
    // Secretos distintos: lo que firma una tienda no lo acepta otra.
    expect(tRosa.config.TRACKING_SECRET).not.toBe(tPedro.config.TRACKING_SECRET);
    // El estado de la conexion es de cada una.
    const estadoRosa = (await (await navRosa.pedir('/admin/local/status')).json()) as { status: string };
    expect(estadoRosa.status).toBe('STOPPED');
  });

  it('una cookie de sesion de una tienda no abre otra aunque se cambie la cookie de tienda a mano', async () => {
    const tramposo = new Navegador(base, '10.0.0.9');
    tramposo.cookies.set('wa_sesion', navRosa.cookies.get('wa_sesion')!);
    tramposo.cookies.set('gsg_tienda', 'pedro-tecno');
    expect((await tramposo.pedir('/admin/contacts')).status).toBe(401);
    const panel = await tramposo.pedir('/panel');
    expect(panel.status).toBe(302);
    expect(panel.headers.get('location')).toContain('/login');
  });

  it('un usuario es de UNA tienda: no se repite al registrarse ni al crear cuentas del equipo', async () => {
    const otra = await new Navegador(base, '10.0.0.3').pedir('/registro', { method: 'POST', json: REGISTRO({ tienda: 'Otra Rosa', usuario: 'rosa' }) });
    expect(otra.status).toBe(400);
    expect(((await otra.json()) as { error: string }).error).toContain('Ese usuario ya lo usa otra cuenta');
    // No quedo ninguna tienda a medias.
    expect(await plataforma.directorio.porSlug('otra-rosa')).toBeNull();

    const disponible = (await (await rosa().pedir('/registro/disponible?usuario=pedro')).json()) as { libre: boolean };
    expect(disponible.libre).toBe(false);
    expect(((await (await rosa().pedir('/registro/disponible?usuario=nadie-aun')).json()) as { libre: boolean }).libre).toBe(true);

    // Rosa no puede crear en su equipo a "pedro": ya es de otra tienda.
    const choque = await navRosa.pedir('/admin/usuarios', { method: 'POST', json: { nombre: 'Pedro', usuario: 'pedro', clave: 'otra-clave-123', rol: 'operador' } });
    expect(choque.status).toBe(400);
    // Pero si a "lucia", que entra y cae en la tienda de Rosa.
    const lucia = await navRosa.pedir('/admin/usuarios', { method: 'POST', json: { nombre: 'Lucía', usuario: 'lucia', clave: 'lucia-2026-clave', rol: 'operador' } });
    expect(lucia.status).toBe(200);
    const navLucia = new Navegador(base, '10.0.0.4');
    const entra = await navLucia.pedir('/login', { method: 'POST', json: { usuario: 'lucia', clave: 'lucia-2026-clave' } });
    expect(entra.status).toBe(200);
    expect(navLucia.cookies.get('gsg_tienda')).toBe('bodega-dona-rosa');
    const yo = (await (await navLucia.pedir('/admin/yo')).json()) as Record<string, unknown>;
    expect(yo).toMatchObject({ usuario: 'lucia', rol: 'operador' });
    // Y ve el cliente de su tienda.
    expect(await (await navLucia.pedir('/admin/contacts?q=51911111111')).text()).toContain('51911111111');
  });

  it('entrar con un usuario que no existe o con la clave mala da el mismo mensaje, y cinco fallos frenan', async () => {
    const nav = new Navegador(base, '10.0.0.5');
    const nadie = await nav.pedir('/login', { method: 'POST', json: { usuario: 'fantasma', clave: 'lo-que-sea-1' } });
    const mala = await nav.pedir('/login', { method: 'POST', json: { usuario: 'pedro', clave: 'no-es-esta-1' } });
    expect(nadie.status).toBe(401);
    expect(mala.status).toBe(401);
    expect((await nadie.json()) as unknown).toEqual(await mala.json());
    expect(nav.cookies.has('gsg_tienda')).toBe(false);
    for (let i = 0; i < 4; i++) await nav.pedir('/login', { method: 'POST', json: { usuario: 'fantasma', clave: 'x-x-x-x-x' } });
    expect((await nav.pedir('/login', { method: 'POST', json: { usuario: 'fantasma', clave: 'x-x-x-x-x' } })).status).toBe(429);
  });

  it('las direcciones /tienda/<slug>/ van a esa tienda; una que no existe da una pantalla clara', async () => {
    const salud = await rosa().pedir('/tienda/pedro-tecno/health');
    expect(salud.status).toBe(200);
    expect(await salud.json()).toMatchObject({ ok: true, configured: true });
    const nada = await rosa().pedir('/tienda/no-existe/panel');
    expect(nada.status).toBe(404);
    expect(await nada.text()).toContain('Esta tienda no existe');
    // Entrar por el prefijo lleva a la entrada de la plataforma, sin bucles.
    const login = await rosa().pedir('/tienda/pedro-tecno/login');
    expect(login.status).toBe(200);
    expect(await login.text()).toContain('id="f-entrar"');
    // Una pagina publica de la tienda que pide con ruta absoluta: la lleva el Referer.
    const conReferer = await new Navegador(base).pedir('/health', { referer: `${base}/tienda/pedro-tecno/m/abc` });
    expect(await conReferer.json()).toMatchObject({ configured: true });
    // Sin tienda, sin principal: lo contesta la plataforma.
    expect(await (await new Navegador(base).pedir('/health')).json()).toMatchObject({ plataforma: true, tiendas: 2 });
  });

  it('ya no hay "primera cuenta" suelta, y salir cierra la sesion y olvida la tienda', async () => {
    const vieja = await rosa().pedir('/login/primera-cuenta', { method: 'POST', json: { nombre: 'X', usuario: 'x-x-x', clave: 'x-x-x-x-x-x' } });
    expect(vieja.status).toBe(410);
    const nav = new Navegador(base, '10.0.0.6');
    await nav.pedir('/login', { method: 'POST', json: { usuario: 'pedro', clave: 'pedro-2026-segura' } });
    expect(nav.cookies.get('gsg_tienda')).toBe('pedro-tecno');
    // Con sesion, /login y / llevan al panel.
    expect((await nav.pedir('/login')).headers.get('location')).toBe('/panel');
    expect((await nav.pedir('/')).headers.get('location')).toBe('/panel');
    await nav.pedir('/logout', { method: 'POST' });
    expect(nav.cookies.has('gsg_tienda')).toBe(false);
    expect(nav.cookies.has('wa_sesion')).toBe(false);
    // Un navegador pide HTML: la pantalla lleva a entrar.
    const panel = await nav.pedir('/panel', { headers: { accept: 'text/html' } });
    expect(panel.status).toBe(302);
    expect(panel.headers.get('location')).toBe('/login?next=%2Fpanel');
  });

  it('un formulario mal rellenado se explica sin crear nada', async () => {
    const nav = new Navegador(base, '10.0.0.7');
    const casos: Array<[Record<string, unknown>, string]> = [
      [REGISTRO({ tienda: '', usuario: 'uno-1' }), 'nombre de tu tienda'],
      [REGISTRO({ usuario: 'A B' }), 'El usuario lleva'],
      [REGISTRO({ usuario: 'dos-2', clave: 'corta' }), '8 caracteres'],
      [REGISTRO({ usuario: 'tres-3', celular: '12' }), 'celular'],
    ];
    const antes = await plataforma.cuantas();
    for (const [datos, texto] of casos) {
      const r = await nav.pedir('/registro', { method: 'POST', json: datos });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toContain(texto);
    }
    expect(await plataforma.cuantas()).toBe(antes);
  });
});

describe('plataforma: freno de registros y tienda principal', () => {
  it('frena a quien crea tiendas en bucle desde la misma conexion', async () => {
    const raiz = mkdtempSync(path.join(tmpdir(), 'plataforma-freno-'));
    const p = await crearPlataforma({ raiz, publicBaseUrl: 'http://localhost:0', proceso: {}, base: baseDePlataforma('freno'), banco: BANCO, principal: null, autoConectarLocal: false, sembrarPlantillasLocales: false, carpetaCopias: path.join(raiz, 'c'), registrosPorHora: 1, log: () => undefined });
    try {
      await p.arrancar();
      expect((await p.registrar(REGISTRO({ usuario: 'uno-1' }), '1.2.3.4')).status).toBe(200);
      const segunda = await p.registrar(REGISTRO({ tienda: 'Otra', usuario: 'dos-2' }), '1.2.3.4');
      expect(segunda.status).toBe(429);
      // Otra conexion si puede.
      expect((await p.registrar(REGISTRO({ tienda: 'Otra', usuario: 'dos-2' }), '5.6.7.8')).status).toBe(200);
    } finally {
      await p.parar();
      rmSync(raiz, { recursive: true, force: true });
    }
  }, TIEMPO);

  it('la instalacion de antes sigue como principal: sus cuentas entran, sus webhooks llegan y sus usuarios quedan apartados', async () => {
    const raiz = mkdtempSync(path.join(tmpdir(), 'plataforma-principal-'));
    const urlPrincipal = urlConBase(`${PREFIJO}principal`);
    const secretos = bootstrapSecrets(raiz);
    const envPrincipal = { PUBLIC_BASE_URL: 'http://localhost:0', DATABASE_URL: urlPrincipal, TRACKING_SECRET: secretos.trackingSecret, WHATSAPP_PROVIDER: 'local', BUSINESS_NAME: 'GSG' } as NodeJS.ProcessEnv;
    const principal = {
      env: envPrincipal,
      secretos,
      base: { url: urlPrincipal, banco: BANCO },
      authDir: path.join(raiz, 'wa-auth'),
      mediaDir: path.join(raiz, 'wa-media'),
      carpetaCopias: path.join(raiz, 'copias'),
      autoConectarLocal: false,
      sembrarPlantillasLocales: false,
      prefijoLog: '',
    };
    // La instalacion de antes, con su cuenta de siempre.
    const antes = await armarTienda({ ...principal, id: 'antes', slug: 'antes', primeraCuentaRol: 'superadmin' });
    const alta = await antes.app.inject({ method: 'POST', url: '/login/primera-cuenta', payload: { nombre: 'Ali', usuario: 'ali', clave: 'ali-2026-wa' } });
    expect(alta.statusCode).toBe(200);
    await antes.parar();

    const p = await crearPlataforma({ raiz: path.join(raiz, 'tiendas'), publicBaseUrl: 'http://localhost:0', proceso: {}, base: baseDePlataforma('conprincipal'), banco: BANCO, principal, autoConectarLocal: false, sembrarPlantillasLocales: false, carpetaCopias: path.join(raiz, 'c'), log: () => undefined });
    const s = await crearServidorPlataforma({ plataforma: p, segura: false });
    try {
      await p.arrancar();
      await s.escuchar(0, '127.0.0.1');
      const url = `http://127.0.0.1:${(s.server.address() as AddressInfo).port}`;
      // Lo que llega sin decir tienda (webhooks, integraciones) va a la principal.
      expect(await (await new Navegador(url).pedir('/health')).json()).toMatchObject({ ok: true, configured: true });
      const nav = new Navegador(url);
      expect((await nav.pedir('/login', { method: 'POST', json: { usuario: 'ali', clave: 'ali-2026-wa' } })).status).toBe(200);
      expect(nav.cookies.get('gsg_tienda')).toBe('principal');
      expect(await (await nav.pedir('/admin/yo')).json()).toMatchObject({ usuario: 'ali', super: true });
      // "ali" no se lo puede quedar una tienda nueva, y la nueva no es superadmin.
      expect((await p.registrar(REGISTRO({ usuario: 'ali' }), '9.9.9.9')).status).toBe(400);
      const nueva = await p.registrar(REGISTRO({ usuario: 'rosa' }), '9.9.9.9');
      expect(nueva.status).toBe(200);
      const tRosa = await p.tiendaPorSlug(nueva.tienda!.slug);
      expect((await tRosa!.repos.usuarios.listar())[0]).toMatchObject({ usuario: 'rosa', rol: 'admin' });
      // La principal sigue en su base de siempre; la nueva, en la suya.
      expect((await p.tiendaPrincipal())!.base).toBe(`${PREFIJO}principal`);
      expect(tRosa!.base).toBe(`${PREFIJO}conprincipal_t_${nueva.tienda!.id}`);
    } finally {
      await s.cerrar();
      await p.parar();
      rmSync(raiz, { recursive: true, force: true });
    }
  }, TIEMPO);

  it('una instalacion de antes sin cuentas no se usa como principal', async () => {
    const raiz = mkdtempSync(path.join(tmpdir(), 'plataforma-vacia-'));
    const secretos = bootstrapSecrets(raiz);
    const urlPrincipal = urlConBase(`${PREFIJO}vacia`);
    const p = await crearPlataforma({
      raiz: path.join(raiz, 'tiendas'),
      publicBaseUrl: 'http://localhost:0',
      proceso: {},
      base: baseDePlataforma('sinprincipal'),
      banco: BANCO,
      principal: {
        env: { PUBLIC_BASE_URL: 'http://localhost:0', DATABASE_URL: urlPrincipal, TRACKING_SECRET: secretos.trackingSecret } as NodeJS.ProcessEnv,
        secretos,
        base: { url: urlPrincipal },
        authDir: path.join(raiz, 'wa-auth'),
        mediaDir: path.join(raiz, 'wa-media'),
        carpetaCopias: path.join(raiz, 'copias'),
        autoConectarLocal: false,
        sembrarPlantillasLocales: false,
        prefijoLog: '',
      },
      autoConectarLocal: false,
      sembrarPlantillasLocales: false,
      carpetaCopias: path.join(raiz, 'c'),
      log: () => undefined,
    });
    try {
      await p.arrancar();
      expect(await p.tiendaPrincipal()).toBeNull();
      expect(await p.cuantas()).toBe(0);
      // La primera que se registra es la del dueño de la plataforma.
      const r = await p.registrar(REGISTRO(), '1.1.1.1');
      const t = await p.tiendaPorSlug(r.tienda!.slug);
      expect((await t!.repos.usuarios.listar())[0]).toMatchObject({ rol: 'superadmin' });
    } finally {
      await p.parar();
      rmSync(raiz, { recursive: true, force: true });
    }
  }, TIEMPO);
});

describe('plataforma: piezas sueltas', () => {
  it('slug, prefijo y celular', () => {
    expect(slugDe('Bodega Doña Rosa')).toBe('bodega-dona-rosa');
    expect(slugDe('  ¡¡Tienda!!  ')).toBe('tienda-tienda');
    expect(slugDe('login')).toBe('tienda-login');
    expect(slugDe('***')).toBe('tienda');
    expect(partirPrefijo('/tienda/pedro-tecno/admin/yo?x=1')).toEqual({ slug: 'pedro-tecno', resto: '/admin/yo?x=1' });
    expect(partirPrefijo('/tienda/pedro-tecno')).toEqual({ slug: 'pedro-tecno', resto: '/' });
    expect(partirPrefijo('/tienda/../etc')).toBeNull();
    expect(partirPrefijo('/t/abc')).toBeNull();
    expect(celularDe('987 654 321')).toBe('51987654321');
    expect(celularDe('+51 987-654-321')).toBe('51987654321');
    expect(celularDe('')).toBeNull();
    expect(celularDe('123')).toBe('mal');
  });

  it('una tienda nueva solo hereda del servidor lo que no es de nadie', () => {
    const env = entornoDeTienda(
      { WHATSAPP_TOKEN: 'x', GSG_TOKEN: 'y', SOLO_NUMEROS: '1', RUTAS_SUPERVISOR: '2', TIMEZONE: 'America/Lima', GRAPH_API_VERSION: 'v25.0' },
      { publicBaseUrl: 'https://a.b/tienda/c', databaseUrl: 'mysql://root@localhost:3306/gsgchat_t_abc', trackingSecret: 's'.repeat(40), archiveDir: 'r', nombre: 'C' },
    );
    expect(env.WHATSAPP_TOKEN).toBeUndefined();
    expect(env.GSG_TOKEN).toBeUndefined();
    expect(env.SOLO_NUMEROS).toBeUndefined();
    expect(env.RUTAS_SUPERVISOR).toBeUndefined();
    expect(env.TIMEZONE).toBe('America/Lima');
    expect(env.GRAPH_API_VERSION).toBe('v25.0');
    expect(env.PUBLIC_BASE_URL).toBe('https://a.b/tienda/c');
    expect(env.DATABASE_URL).toBe('mysql://root@localhost:3306/gsgchat_t_abc');
  });

  it('los nombres de las bases salen de la de la URL', () => {
    const n = basesDeLaPlataforma('mysql://root@127.0.0.1:3306/gsgchat');
    expect(n.directorio).toBe('gsgchat_plataforma');
    expect(n.tienda('a1b2c3d4e5f6')).toBe('gsgchat_t_a1b2c3d4e5f6');
    expect(n.prefijoBanco).toBe('gsgchat_');
    // Una base con mayusculas o guiones en la URL: los nombres nuevos salen limpios.
    expect(basesDeLaPlataforma('mariadb://u:c@h/Wa-Locator').directorio).toBe('wa_locator_plataforma');
    expect(() => basesDeLaPlataforma('mysql://root@127.0.0.1:3306/')).toThrow(/qué base usar/);
  });
});
