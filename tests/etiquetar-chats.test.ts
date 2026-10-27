/**
 * «Etiquetar los chats de hoy» (src/chat/etiquetar.ts): el lote que agrupa los
 * mensajes del dia por numero normalizado, reutiliza la etiqueta cuando la
 * conversacion no cambio y solo llama a la IA para lo nuevo.
 *
 * Tres partes: el lote con el repo en memoria (rapido, cuenta llamadas a la
 * IA), el repo contra MySQL/MariaDB de verdad (tests/mysql.ts) y las rutas de
 * Chats con una sesion de verdad.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MensajeIA } from '../src/ia/proveedores.js';
import { crearChatEtiquetasEnMemoria, crearChatEtiquetasRepo, type ChatEtiquetasRepo, type MensajeDelDia } from '../src/db/chat-etiquetas.js';
import { agruparPorNumero, crearEtiquetador, etiquetarDelDia, huellaDe, numeroNormalizado, sePuedeReutilizar, type EtiquetadoDeps } from '../src/chat/etiquetar.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import type { Pool } from '../src/db/pool.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { crearEscenarioEntregas } from './escenario-entregas.js';
import { hashClave } from '../src/auth/usuarios.js';

/** 27/10/2026 15:00 en Lima. */
const AHORA = new Date('2026-10-27T20:00:00Z');
const ALCANCE = { afterId: '0', retenidosDesde: new Date('2026-10-20T00:00:00Z') };

let siguienteId = 1;
function msg(phone: string, direction: 'in' | 'out', body: string | null, minuto: number, extra: Partial<MensajeDelDia> = {}): MensajeDelDia {
  return {
    id: siguienteId++,
    contactId: `c-${phone}`,
    phone,
    name: null,
    direction,
    kind: 'text',
    body,
    // 10:00 de Lima + minutos
    createdAt: new Date(Date.UTC(2026, 9, 27, 15, minuto)),
    ...extra,
  };
}

/** Una IA de prueba: contesta segun lo que dijo el cliente y cuenta las llamadas. */
function iaDePrueba(contestar: (usuario: string) => string | Error = () => '{"etiqueta":"otro"}') {
  const llamadas: string[] = [];
  return {
    llamadas,
    ia: {
      async completar(m: MensajeIA[]) {
        const usuario = String(m[m.length - 1]?.content ?? '');
        llamadas.push(usuario);
        const r = contestar(usuario);
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}

const porTexto = (usuario: string) =>
  // Lo mas reciente primero, como se le pide al modelo.
  /dónde/.test(usuario) ? '{"etiqueta":"consultar_entrega"}' : /mañana/.test(usuario) ? '{"etiqueta":"reagendar_entrega"}' : /a las 3/.test(usuario) ? '{"etiqueta":"horario_fijo"}' : '{"etiqueta":"otro"}';

function deps(repo: ChatEtiquetasRepo, ia: EtiquetadoDeps['ia']): EtiquetadoDeps {
  return { repo, ia, zonaHoraria: () => 'America/Lima', nombreNegocio: () => 'GSG', ahora: () => AHORA };
}

describe('agrupar por numero normalizado', () => {
  it('el mismo celular escrito de tres formas es un solo numero', () => {
    expect(numeroNormalizado('987654321')).toBe('51987654321');
    expect(numeroNormalizado('+51 987 654 321')).toBe('51987654321');
    expect(numeroNormalizado('51987654321')).toBe('51987654321');
    // Lo que no es un celular peruano se queda con sus digitos.
    expect(numeroNormalizado('+52 1 55 1234 5678')).toBe('5215512345678');
  });

  it('junta los contactos del mismo numero y ordena por hora', () => {
    const conv = agruparPorNumero([
      msg('51987654321', 'in', 'segundo', 5, { contactId: 'a' }),
      msg('987654321', 'in', 'primero', 1, { contactId: 'b', name: 'Rosa' }),
      msg('51911222333', 'in', 'otro cliente', 2),
    ]);
    expect(conv).toHaveLength(2);
    const rosa = conv.find((c) => c.phone === '51987654321')!;
    expect(rosa.contactIds.sort()).toEqual(['a', 'b']);
    expect(rosa.nombre).toBe('Rosa');
    expect(rosa.mensajes.map((m) => m.body)).toEqual(['primero', 'segundo']);
  });

  it('la huella cambia con un mensaje nuevo o editado, no con nada mas', () => {
    const a = [msg('1', 'in', 'hola', 1), msg('1', 'out', 'buenas', 2)];
    const h = huellaDe(a);
    expect(huellaDe(a.map((m) => ({ ...m })))).toBe(h);
    expect(huellaDe([...a, msg('1', 'in', 'mejor mañana', 3)])).not.toBe(h);
    expect(huellaDe([a[0]!, { ...a[1]!, body: 'buenas tardes' }])).not.toBe(h);
  });

  it('solo se reutiliza lo definitivo', () => {
    const base = { phone: '1', dia: '2026-10-27', origen: 'ia' as const, mensajes: 2, updatedAt: new Date(), loteId: null, syncEstado: 'pendiente' as const, syncIntentos: 0, syncError: null, syncAt: null, syncHuella: null };
    expect(sePuedeReutilizar({ ...base, huella: 'x', etiqueta: 'otro', motivo: null }, 'x')).toBe(true);
    expect(sePuedeReutilizar({ ...base, huella: 'x', etiqueta: 'otro', motivo: null }, 'y')).toBe(false);
    expect(sePuedeReutilizar({ ...base, huella: 'x', etiqueta: null, motivo: 'caída' }, 'x')).toBe(false);
    expect(sePuedeReutilizar({ ...base, huella: 'x', etiqueta: 'reclamo', origen: 'reglas', motivo: 'la IA falló: puesta por las reglas' }, 'x')).toBe(false);
    expect(sePuedeReutilizar(undefined, 'x')).toBe(false);
  });
});

describe('el lote del dia', () => {
  let mensajes: MensajeDelDia[];
  let repo: ChatEtiquetasRepo;
  beforeEach(() => {
    mensajes = [
      // Ayer: no entra.
      { ...msg('51911000001', 'in', 'mejor mañana', 0), createdAt: new Date('2026-10-26T20:00:00Z') },
      // Rosa, en dos contactos con el numero escrito distinto.
      msg('51911000002', 'out', '¿Nos manda su ubicación?', 1, { contactId: 'r1' }),
      msg('911000002', 'in', 'mejor mañana', 2, { contactId: 'r2', name: 'Rosa' }),
      // Luis pide hora.
      msg('51911000003', 'in', 'tráigalo a las 3', 3),
      // Ana no contesto: no hace falta IA.
      msg('51911000004', 'out', '¿Nos manda su ubicación?', 4),
    ];
    repo = crearChatEtiquetasEnMemoria(() => mensajes);
  });

  it('clasifica cada numero una vez y guarda una sola etiqueta por conversacion', async () => {
    const { ia, llamadas } = iaDePrueba(porTexto);
    const r = await etiquetarDelDia(deps(repo, () => ia), ALCANCE);
    expect(r).toMatchObject({ enCurso: false, dia: '2026-10-27', total: 3, hechas: 3, clasificadas: 3, porIA: 3, reutilizadas: 0, sinClasificar: 0 });
    // Una llamada por numero: Rosa (dos contactos), Luis y Ana (que no escribio: la IA tambien la mira).
    expect(llamadas).toHaveLength(3);
    expect(llamadas.find((u) => u.includes('mejor mañana'))).toContain('¿Nos manda su ubicación?');
    const hoy = new Map((await repo.delDia('2026-10-27', ['51911000002', '51911000003', '51911000004'])).map((e) => [e.phone, e]));
    expect(hoy.get('51911000002')).toMatchObject({ etiqueta: 'reagendar_entrega', origen: 'ia', mensajes: 2, motivo: null });
    expect(hoy.get('51911000003')).toMatchObject({ etiqueta: 'horario_fijo', origen: 'ia' });
    expect(hoy.get('51911000004')).toMatchObject({ etiqueta: 'otro', origen: 'ia', motivo: null });
    // Lo de ayer no se toco.
    expect(await repo.delDia('2026-10-27', ['51911000001'])).toEqual([]);
  });

  it('si los mensajes no cambiaron, se reutiliza sin llamar a la IA; si cambian, solo se repite esa', async () => {
    const primera = iaDePrueba(porTexto);
    await etiquetarDelDia(deps(repo, () => primera.ia), ALCANCE);
    const segunda = iaDePrueba(porTexto);
    const r2 = await etiquetarDelDia(deps(repo, () => segunda.ia), ALCANCE);
    expect(segunda.llamadas).toHaveLength(0);
    expect(r2).toMatchObject({ total: 3, reutilizadas: 3, clasificadas: 0 });

    // Luis escribe otra vez: ya tenia etiqueta, asi que NO se vuelve a leer (solo se lee lo que falta).
    mensajes.push(msg('51911000003', 'in', '¿dónde está el motorizado?', 9));
    const tercera = iaDePrueba(porTexto);
    const r3 = await etiquetarDelDia(deps(repo, () => tercera.ia), ALCANCE);
    expect(tercera.llamadas).toHaveLength(0);
    expect(r3).toMatchObject({ reutilizadas: 3, clasificadas: 0 });
    expect((await repo.ultimas(['51911000003'])).get('51911000003')!.etiqueta).toBe('horario_fijo');

    // Un chat nuevo: solo ese va a la IA.
    mensajes.push(msg('51911000006', 'in', 'mejor mañana', 10));
    const cuarta = iaDePrueba(porTexto);
    const r4 = await etiquetarDelDia(deps(repo, () => cuarta.ia), ALCANCE);
    expect(cuarta.llamadas).toHaveLength(1);
    expect(r4).toMatchObject({ total: 4, reutilizadas: 3, clasificadas: 1 });
  });

  it('un fallo de la IA es un error, no "otro" ni una etiqueta de reglas, y se reintenta aunque nada cambie', async () => {
    mensajes.push(msg('51911000005', 'in', 'hola', 6));
    const caida = iaDePrueba(() => new Error('sin saldo'));
    const r = await etiquetarDelDia(deps(repo, () => caida.ia), ALCANCE);
    // Aunque «mañana» o «a las 3» se reconocerian por palabras, aqui no se adivina: todo es error.
    expect(r).toMatchObject({ total: 4, clasificadas: 0, porIA: 0, sinClasificar: 4, syncTotal: 0 });
    const filas = new Map((await repo.delDia('2026-10-27')).map((e) => [e.phone, e]));
    expect(filas.get('51911000002')).toMatchObject({ etiqueta: null, syncEstado: 'no_aplica' });
    expect(filas.get('51911000002')!.motivo).toMatch(/sin saldo/);
    // Cada chat del lote dice que fallo y por que.
    const chats = await repo.chatsDelLote(r.loteId!);
    expect(chats.every((c) => c.estado === 'error' && /sin saldo/.test(c.error ?? ''))).toBe(true);
    expect((await repo.eventos({ loteId: r.loteId!, nivel: 'error', limite: 10 })).filter((e) => e.codigo === 'ia_fallo')).toHaveLength(4);

    // Vuelve la IA: todo lo que fallo se repite.
    const vuelve = iaDePrueba(porTexto);
    const r2 = await etiquetarDelDia(deps(repo, () => vuelve.ia), ALCANCE);
    expect(vuelve.llamadas).toHaveLength(4);
    expect(r2).toMatchObject({ reutilizadas: 0, clasificadas: 4, porIA: 4, sinClasificar: 0 });
    expect((await repo.ultimas(['51911000005'])).get('51911000005')!.etiqueta).toBe('otro');
  });

  it('una respuesta invalida (etiqueta inventada o varias) es un error, no se guarda', async () => {
    const mala = iaDePrueba((u) => (u.includes('mañana') ? '{"etiqueta":"entrega_recibida"}' : u.includes('a las 3') ? '{"etiquetas":["horario_fijo","reclamo"]}' : '{"etiqueta":"otro"}'));
    const r = await etiquetarDelDia(deps(repo, () => mala.ia), ALCANCE);
    const filas = new Map((await repo.delDia('2026-10-27')).map((e) => [e.phone, e]));
    expect(filas.get('51911000002')).toMatchObject({ etiqueta: null });
    expect(filas.get('51911000002')!.motivo).toMatch(/no está en el catálogo/);
    expect(filas.get('51911000003')).toMatchObject({ etiqueta: null });
    expect(filas.get('51911000003')!.motivo).toMatch(/más de una/);
    expect(filas.get('51911000004')).toMatchObject({ etiqueta: 'otro' });
    expect(r).toMatchObject({ clasificadas: 1, sinClasificar: 2 });
  });

  it('el lote guarda la copia de los mensajes de cada chat y procesa esa copia', async () => {
    const { ia, llamadas } = iaDePrueba(porTexto);
    const r = await etiquetarDelDia(deps(repo, () => ia), ALCANCE);
    const chats = await repo.chatsDelLote(r.loteId!, true);
    expect(chats.map((c) => [c.phone, c.estado, c.etiqueta])).toEqual([
      ['51911000002', 'clasificada', 'reagendar_entrega'],
      ['51911000003', 'clasificada', 'horario_fijo'],
      ['51911000004', 'clasificada', 'otro'],
    ]);
    // Rosa: sus dos mensajes (de sus dos contactos), en orden, tal cual.
    const rosa = chats[0]!;
    expect(rosa).toMatchObject({ totalMensajes: 2, nombre: 'Rosa' });
    expect(rosa.mensajes!.map((m) => [m.direction, m.body])).toEqual([['out', '¿Nos manda su ubicación?'], ['in', 'mejor mañana']]);
    expect(typeof rosa.mensajes![0]!.createdAt).toBe('string');
    // Lo de ayer no entra en la copia.
    expect(chats.some((c) => c.phone === '51911000001')).toBe(false);
    // Lo que vio la IA es la copia.
    expect(llamadas.find((u) => u.includes('mejor mañana'))).toContain('¿Nos manda su ubicación?');

    // Un segundo lote sin cambios: sus chats quedan como reutilizados, con su etiqueta.
    const r2 = await etiquetarDelDia(deps(repo, () => ia), ALCANCE);
    expect((await repo.chatsDelLote(r2.loteId!)).map((c) => c.estado)).toEqual(['reutilizada', 'reutilizada', 'reutilizada']);
  });

  it('el catalogo del negocio manda: la IA lo recibe, solo valen sus codigos y cambiarlo vuelve a clasificar', async () => {
    await repo.guardarCatalogo([
      { codigo: 'cambio_de_dia', nombre: 'Cambio de día', descripcion: 'pide otro día de entrega' },
      { codigo: 'otro', nombre: 'Varios', descripcion: 'ninguna corresponde' },
    ]);
    const ia = iaDePrueba((u) => (u.includes('mañana') ? '{"etiqueta":"cambio_de_dia"}' : u.includes('a las 3') ? '{"etiqueta":"horario_fijo"}' : '{"etiqueta":"otro"}'));
    const r = await etiquetarDelDia(deps(repo, () => ia.ia), ALCANCE);
    const filas = new Map((await repo.delDia('2026-10-27')).map((e) => [e.phone, e]));
    expect(filas.get('51911000002')!.etiqueta).toBe('cambio_de_dia');
    // horario_fijo es del catalogo de fabrica, no del de este negocio: error.
    expect(filas.get('51911000003')).toMatchObject({ etiqueta: null });
    expect(r).toMatchObject({ clasificadas: 2, sinClasificar: 1 });

    // Cambiar solo la descripcion no relee nada: lo ya etiquetado se queda.
    await repo.guardarCatalogo([
      { codigo: 'cambio_de_dia', nombre: 'Cambio de día', descripcion: 'pide entregar otro día' },
      { codigo: 'otro', nombre: 'Varios', descripcion: 'ninguna corresponde' },
    ]);
    const ia2 = iaDePrueba(() => '{"etiqueta":"otro"}');
    const r2 = await etiquetarDelDia(deps(repo, () => ia2.ia), ALCANCE);
    // Solo el que quedo sin clasificar vuelve a la IA.
    expect(r2).toMatchObject({ reutilizadas: 2, clasificadas: 1 });
    expect(ia2.llamadas).toHaveLength(1);

    // Quitar un codigo del catalogo: los chats con esa etiqueta ya no valen y se releen.
    await repo.guardarCatalogo([
      { codigo: 'reprogramar', nombre: 'Reprogramar', descripcion: 'pide otro día' },
      { codigo: 'otro', nombre: 'Varios', descripcion: 'ninguna corresponde' },
    ]);
    const ia3 = iaDePrueba(() => '{"etiqueta":"reprogramar"}');
    const r3 = await etiquetarDelDia(deps(repo, () => ia3.ia), ALCANCE);
    expect(ia3.llamadas).toHaveLength(1);
    expect(r3).toMatchObject({ reutilizadas: 2, clasificadas: 1 });
    expect((await repo.ultimas(['51911000002'])).get('51911000002')!.etiqueta).toBe('reprogramar');
  });

  it('sin IA no se empieza', async () => {
    await expect(etiquetarDelDia(deps(repo, () => null), ALCANCE)).rejects.toThrow(/Asistente IA/);
    const e = crearEtiquetador(deps(repo, () => null));
    expect(() => e.iniciar(ALCANCE)).toThrow(/Asistente IA/);
  });

  it('«volver a etiquetar todo» relee tambien los ya etiquetados; el boton normal no', async () => {
    const primera = iaDePrueba(porTexto);
    await etiquetarDelDia(deps(repo, () => primera.ia), ALCANCE);
    expect(primera.llamadas).toHaveLength(3);
    const normal = iaDePrueba(() => '{"etiqueta":"sin_novedad"}');
    expect(await etiquetarDelDia(deps(repo, () => normal.ia), ALCANCE)).toMatchObject({ reutilizadas: 3, clasificadas: 0 });
    expect(normal.llamadas).toHaveLength(0);
    const todo = iaDePrueba(() => '{"etiqueta":"sin_novedad"}');
    const r = await etiquetarDelDia(deps(repo, () => todo.ia), ALCANCE, undefined, { releer: true });
    expect(todo.llamadas).toHaveLength(3);
    expect(r).toMatchObject({ reutilizadas: 0, clasificadas: 3 });
    expect((await repo.delDia('2026-10-27')).every((f) => f.etiqueta === 'sin_novedad')).toBe(true);
    expect((await repo.eventos({ loteId: r.loteId!, fase: 'lote', limite: 5 })).some((e) => /Volver a etiquetar todo/.test(e.detalle ?? ''))).toBe(true);
  });

  it('en segundo plano: pulsar dos veces no lanza dos lotes', async () => {
    let soltar: () => void = () => undefined;
    const espera = new Promise<void>((r) => (soltar = r));
    const lenta = iaDePrueba(porTexto);
    const ia = { completar: async (m: MensajeIA[]) => (await espera, lenta.ia.completar(m)) };
    const e = crearEtiquetador(deps(repo, () => ia));
    expect(e.iniciar(ALCANCE).enCurso).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    const otra = e.iniciar(ALCANCE);
    expect(otra).toMatchObject({ enCurso: true, total: 3 });
    soltar();
    const fin = await e.esperar();
    expect(fin).toMatchObject({ enCurso: false, clasificadas: 3 });
    expect(lenta.llamadas).toHaveLength(3);
    expect(await e.estado()).toMatchObject({ enCurso: false, hechas: 3 });
  });
});

// ----------------------------------------------------------- contra MySQL

describe('el repo contra la base', () => {
  let b: BaseDePrueba;
  let pool: Pool;
  let repos: Repos;
  let repo: ChatEtiquetasRepo;

  beforeAll(async () => {
    b = await baseDePrueba();
    pool = b.pool;
    repos = createRepos(pool);
    repo = crearChatEtiquetasRepo(pool);
  });
  afterAll(async () => {
    await b?.cerrar();
  });
  beforeEach(async () => {
    for (const tabla of ['chat_etiquetas', 'messages', 'contacts']) await pool.query(`delete from ${tabla}`);
  });

  it('lee los mensajes del dia de los chats que se ven en la bandeja, sin grupos ni lo de antes', async () => {
    const hoy = new Date('2026-10-27T15:00:00Z');
    const iniciado = await repos.contacts.upsertFromInbound('51911000010', 'Rosa');
    await repos.messages.add({ contactId: iniciado.id, direction: 'out', wamid: 'w-sis', kind: 'text', body: '¿Nos manda su ubicación?', status: 'sent', createdAt: hoy });
    await repos.messages.add({ contactId: iniciado.id, direction: 'in', wamid: 'w-in', kind: 'text', body: 'mejor mañana', createdAt: new Date(hoy.getTime() + 60_000) });
    await repos.messages.add({ contactId: iniciado.id, direction: 'in', wamid: 'w-ayer', kind: 'text', body: 'de ayer', createdAt: new Date('2026-10-26T15:00:00Z') });
    await repos.messages.add({ contactId: iniciado.id, direction: 'in', wamid: 'w-hist', kind: 'text', body: 'del historial', payload: { historial: true }, createdAt: new Date(hoy.getTime() + 120_000) });
    // Escribio solo, sin que el sistema le escribiera: no esta en la bandeja.
    const suelto = await repos.contacts.upsertFromInbound('51911000011', 'Suelto');
    await repos.messages.add({ contactId: suelto.id, direction: 'in', wamid: 'w-suelto', kind: 'text', body: 'hola', createdAt: hoy });

    const leidos = await repo.mensajesDelDia(new Date('2026-10-27T05:00:00Z'), { afterId: '0', retenidosDesde: new Date(Date.now() - 72 * 3600_000) }, 100);
    expect(leidos.map((m) => m.body)).toEqual(['¿Nos manda su ubicación?', 'mejor mañana']);
    expect(leidos[0]).toMatchObject({ phone: '51911000010', name: 'Rosa', direction: 'out' });
  });

  it('guarda una fila por numero y dia, la pisa al reclasificar y devuelve la mas reciente', async () => {
    const base = { phone: '51911000020', origen: 'ia' as const, huella: 'a'.repeat(64), mensajes: 3, motivo: null };
    await repo.guardar({ ...base, dia: '2026-10-26', etiqueta: 'reclamo' });
    await repo.guardar({ ...base, dia: '2026-10-27', etiqueta: 'horario_fijo' });
    await repo.guardar({ ...base, dia: '2026-10-27', etiqueta: null, motivo: 'x'.repeat(400), huella: 'b'.repeat(64) });
    const hoy = await repo.delDia('2026-10-27', ['51911000020', '51900000000']);
    expect(hoy).toHaveLength(1);
    expect(hoy[0]).toMatchObject({ etiqueta: null, huella: 'b'.repeat(64), dia: '2026-10-27' });
    expect(hoy[0]!.motivo).toHaveLength(255);
    const ultimas = await repo.ultimas(['51911000020']);
    expect(ultimas.get('51911000020')!.dia).toBe('2026-10-27');
    expect(await repo.ultimas([])).toEqual(new Map());
  });
});

// ---------------------------------------------------------- las rutas

describe('Chats: el boton, la bandeja y la cabecera', () => {
  it('etiqueta los chats de hoy y la etiqueta sale junto al nombre en la lista y en el hilo', async () => {
    const e = await crearEscenarioEntregas({ agente: true, iaActiva: true });
    try {
      await e.repos.usuarios.crear({ usuario: 'operadoretq', nombre: 'Op', rol: 'admin', clave: hashClave('Clave-123-segura') });
      const login = await e.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'operadoretq', clave: 'Clave-123-segura' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const c = await e.repos.contacts.upsertFromInbound('51987650001', 'Rosa');
      await e.repos.messages.add({ contactId: c.id, direction: 'out', kind: 'text', wamid: 'etq.sis', body: '¿Nos manda su ubicación?', status: 'sent', payload: { origen: 'sistema' }, createdAt: e.ahora() });
      await e.repos.messages.add({ contactId: c.id, direction: 'in', kind: 'text', wamid: 'etq.in', body: 'mejor mañana', createdAt: e.ahora() });

      // Antes de etiquetar no hay nada junto al nombre.
      const antes = (await e.app.inject({ url: '/admin/chat/conversations', headers: { cookie } })).json();
      expect(antes.items[0].etiqueta).toBeNull();

      e.ia.respuestas.push('{"etiqueta":"reagendar_entrega"}');
      const inicio = await e.app.inject({ method: 'POST', url: '/admin/chat/etiquetar', headers: { cookie }, payload: {} });
      expect(inicio.statusCode).toBe(202);
      let estado = inicio.json();
      for (let i = 0; i < 100 && estado.enCurso; i++) {
        await new Promise((r) => setTimeout(r, 20));
        estado = (await e.app.inject({ url: '/admin/chat/etiquetar', headers: { cookie } })).json();
      }
      expect(estado).toMatchObject({ enCurso: false, total: 1, clasificadas: 1, porIA: 1, hayIA: true });
      expect(e.ia.llamadas.at(-1)!.sistema).toContain('UNA sola etiqueta');

      const lista = (await e.app.inject({ url: '/admin/chat/conversations', headers: { cookie } })).json();
      expect(lista.items[0].etiqueta).toMatchObject({ id: 'reagendar_entrega', nombre: 'Reagendar entrega', hoy: true });
      const hilo = (await e.app.inject({ url: `/admin/chat/${c.id}?limit=30`, headers: { cookie } })).json();
      expect(hilo.etiqueta).toMatchObject({ id: 'reagendar_entrega', nombre: 'Reagendar entrega' });

      // Otra vez sin cambios: no se le pregunta a la IA.
      const llamadas = e.ia.llamadas.length;
      estado = (await e.app.inject({ method: 'POST', url: '/admin/chat/etiquetar', headers: { cookie }, payload: {} })).json();
      for (let i = 0; i < 100 && estado.enCurso; i++) {
        await new Promise((r) => setTimeout(r, 20));
        estado = (await e.app.inject({ url: '/admin/chat/etiquetar', headers: { cookie } })).json();
      }
      expect(estado).toMatchObject({ enCurso: false, reutilizadas: 1, clasificadas: 0 });
      expect(e.ia.llamadas.length).toBe(llamadas);
    } finally {
      await e.cerrar();
    }
  });

  it('sin IA conectada el boton explica donde conectarla', async () => {
    const e = await crearEscenarioEntregas({ agente: true });
    try {
      await e.repos.usuarios.crear({ usuario: 'operadorsinia', nombre: 'Op', rol: 'admin', clave: hashClave('Clave-123-segura') });
      const login = await e.app.inject({ method: 'POST', url: '/login', payload: { usuario: 'operadorsinia', clave: 'Clave-123-segura' } });
      const cookie = String(login.headers['set-cookie']).split(';')[0]!;
      const r = await e.app.inject({ method: 'POST', url: '/admin/chat/etiquetar', headers: { cookie }, payload: {} });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ ir: '/panel#ia' });
      expect(r.json().error).toMatch(/Asistente IA/);
    } finally {
      await e.cerrar();
    }
  });
});
