/**
 * Simulacion: un numero con maximo de 10 mensajes por dia y otro sin limite.
 *
 * Todo es real salvo los clientes de WhatsApp (dos dobles que cuentan lo que
 * reciben): el sender, la reserva de cupo, la base MySQL, el servicio de lineas y
 * la asignacion del cliente. La seleccion de alternativos se arma igual que en
 * src/plataforma/tienda.ts.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRepos, type Repos } from '../src/db/repos.js';
import { createSender, type LineaDeEnvio } from '../src/outbound/sender.js';
import { diaLima } from '../src/whatsapp/limite-diario.js';
import { crearServicioLineas, ID_LINEA_PRINCIPAL } from '../src/whatsapp/lineas.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { createFakeWhatsApp } from './fakes.js';

let b: BaseDePrueba;
let repos: Repos;
const SEGUNDA = '00000000-0000-0000-0000-0000000000bb';

beforeAll(async () => {
  b = await baseDePrueba();
  repos = createRepos(b.pool);
});
afterAll(async () => {
  await b?.cerrar();
});
beforeEach(async () => {
  await b.vaciar();
  await b.pool.query(`insert into whatsapp_numbers (id, label, phone, provider, is_primary, position) values (?, 'Numero 1', '51911111111', 'local', 1, 0), (?, 'Numero 2', '51922222222', 'local', 0, 1)`, [ID_LINEA_PRINCIPAL, SEGUNDA]);
});

function montar() {
  let ahora = new Date('2026-11-06T15:00:00Z'); // 10:00 en Lima
  const conectada: Record<string, boolean> = { [ID_LINEA_PRINCIPAL]: true, [SEGUNDA]: true };
  const clientes = {
    [ID_LINEA_PRINCIPAL]: Object.assign(createFakeWhatsApp(), { conectado: () => conectada[ID_LINEA_PRINCIPAL]! }),
    [SEGUNDA]: Object.assign(createFakeWhatsApp(), { conectado: () => conectada[SEGUNDA]! }),
  };
  // Meta da un id de mensaje unico a cada envio: el segundo doble lleva su propio prefijo para no chocar con el primero.
  const textoOriginal = clientes[SEGUNDA].sendText;
  clientes[SEGUNDA].sendText = async (...args: Parameters<typeof textoOriginal>) => {
    const r = await textoOriginal(...args);
    return { ...r, wamid: `N2-${r.wamid}` };
  };
  const servicio = crearServicioLineas(b.pool, Buffer.alloc(32), 'simulacion');
  const armar = async (id: string): Promise<LineaDeEnvio | null> => {
    const l = await servicio.obtener(id);
    if (!l || !l.habilitada) return null;
    return { id: l.id, etiqueta: l.etiqueta, numero: l.telefono, cliente: clientes[l.id as keyof typeof clientes], identidad: l.principal ? 'PNID' : `linea:${l.id}`, ventanaAplica: false };
  };
  const sender = createSender({
    repos,
    wa: clientes[ID_LINEA_PRINCIPAL],
    phoneNumberId: 'PNID',
    warmup: { startPerDay: 100000, growth: 1.5, hardCap: 100000 },
    maxMarketingPerContact7d: 2,
    sendsPerSecond: 100000,
    maxConcurrentSends: 50,
    now: () => ahora,
    resolverLinea: (id) => armar(id ?? ID_LINEA_PRINCIPAL),
    elegirLinea: async (excluir) => armar(excluir === ID_LINEA_PRINCIPAL ? SEGUNDA : ID_LINEA_PRINCIPAL),
    // Igual que tienda.ts: habilitadas y conectadas, por posicion e id.
    alternativas: async (excluir) => {
      const vivas = (await servicio.listar()).filter((l) => l.habilitada && conectada[l.id] && l.id !== excluir).sort((x, y) => x.posicion - y.posicion || (x.id < y.id ? -1 : 1));
      return (await Promise.all(vivas.map((l) => armar(l.id)))).filter((l): l is LineaDeEnvio => l !== null);
    },
  });
  return { sender, servicio, clientes, conectada, pasarA: (iso: string) => { ahora = new Date(iso); }, ahora: () => ahora };
}

const texto = (phone: string, extra: Record<string, unknown> = {}) => ({ phone, kind: 'freeform' as const, category: 'UTILITY' as const, text: 'hola', manual: true, ...extra });
const usadosEn = async (id: string, dia: string) => Number((await b.pool.query<{ usados: number }>('select usados from whatsapp_number_uso where linea_id = ? and dia = ?', [id, dia])).rows[0]?.usados ?? 0);
const asignada = async (phone: string) => (await b.pool.query<{ whatsapp_number_id: string | null }>('select whatsapp_number_id from contacts where phone = ?', [phone])).rows[0]?.whatsapp_number_id;

describe('simulacion: numero 1 con maximo de 10 al dia, numero 2 sin limite', () => {
  it('los mensajes 1 a 10 salen por el numero 1 y del 11 en adelante por el numero 2', async () => {
    const m = montar();
    await m.servicio.fijarLimite(ID_LINEA_PRINCIPAL, 10);
    const c = await repos.contacts.upsertFromInbound('51900000001');
    await repos.lineasContacto.fijarSiNoTiene(c.id, ID_LINEA_PRINCIPAL, m.ahora());

    const salida: string[] = [];
    for (let i = 1; i <= 14; i++) {
      const r = await m.sender.send(texto('51900000001', { claveEnvio: `msg-${i}` }));
      if (!r.ok) console.log('FALLO #' + i + ': ' + JSON.stringify(r));
      expect(r.ok, `mensaje ${i}`).toBe(true);
      salida.push(`#${i} -> ${(r as { whatsappNumberId: string }).whatsappNumberId === ID_LINEA_PRINCIPAL ? 'Numero 1' : 'Numero 2'}`);
    }
    console.log('SECUENCIA:\n' + salida.join('\n'));

    expect(m.clientes[ID_LINEA_PRINCIPAL].sent).toHaveLength(10);
    expect(m.clientes[SEGUNDA].sent).toHaveLength(4);
    expect(salida.slice(0, 10).every((s) => s.endsWith('Numero 1'))).toBe(true);
    expect(salida.slice(10).every((s) => s.endsWith('Numero 2'))).toBe(true);

    const dia = diaLima(m.ahora());
    expect(await usadosEn(ID_LINEA_PRINCIPAL, dia)).toBe(10);
    expect(await usadosEn(SEGUNDA, dia)).toBe(4);

    // La asignacion del cliente no se movio y cada entrega dice por que salio por donde salio.
    expect(await asignada('51900000001')).toBe(ID_LINEA_PRINCIPAL);
    const { rows } = await b.pool.query<{ whatsapp_number_id: string; linea_motivo: string; n: number }>(
      'select whatsapp_number_id, linea_motivo, count(*) as n from deliveries group by whatsapp_number_id, linea_motivo order by whatsapp_number_id',
    );
    console.log('ENTREGAS (numero, motivo, cantidad):', JSON.stringify(rows.map((r) => [r.whatsapp_number_id === ID_LINEA_PRINCIPAL ? 'Numero 1' : 'Numero 2', r.linea_motivo, Number(r.n)])));
    expect(rows.map((r) => [r.whatsapp_number_id, r.linea_motivo, Number(r.n)])).toEqual([
      [ID_LINEA_PRINCIPAL, 'asignacion_original', 10],
      [SEGUNDA, 'limite_alcanzado', 4],
    ]);
  });

  it('el consumo lo comparten todos los clientes del numero 1 y los envios simultaneos no pasan de 10', async () => {
    const m = montar();
    await m.servicio.fijarLimite(ID_LINEA_PRINCIPAL, 10);
    const telefonos = Array.from({ length: 5 }, (_, i) => `5190000010${i}`);
    for (const t of telefonos) {
      const c = await repos.contacts.upsertFromInbound(t);
      await repos.lineasContacto.fijarSiNoTiene(c.id, ID_LINEA_PRINCIPAL, m.ahora());
    }
    // 30 mensajes a la vez, repartidos entre 5 clientes asignados al numero 1.
    const r = await Promise.all(Array.from({ length: 30 }, (_, i) => m.sender.send(texto(telefonos[i % 5]!, { claveEnvio: `par-${i}` }))));
    expect(r.every((x) => x.ok)).toBe(true);
    console.log(`SIMULTANEOS: numero 1 = ${m.clientes[ID_LINEA_PRINCIPAL].sent.length}, numero 2 = ${m.clientes[SEGUNDA].sent.length}`);
    expect(m.clientes[ID_LINEA_PRINCIPAL].sent).toHaveLength(10);
    expect(m.clientes[SEGUNDA].sent).toHaveLength(20);
    expect(await usadosEn(ID_LINEA_PRINCIPAL, diaLima(m.ahora()))).toBe(10);
  });

  it('a medianoche de Lima el contador vuelve a cero y el numero 1 es otra vez el primero', async () => {
    const m = montar();
    await m.servicio.fijarLimite(ID_LINEA_PRINCIPAL, 10);
    const c = await repos.contacts.upsertFromInbound('51900000002');
    await repos.lineasContacto.fijarSiNoTiene(c.id, ID_LINEA_PRINCIPAL, m.ahora());
    m.pasarA('2026-11-07T04:50:00Z'); // 23:50 del 6 en Lima
    for (let i = 1; i <= 11; i++) await m.sender.send(texto('51900000002', { claveEnvio: `noche-${i}` }));
    expect(m.clientes[ID_LINEA_PRINCIPAL].sent).toHaveLength(10);
    expect(m.clientes[SEGUNDA].sent).toHaveLength(1);
    m.pasarA('2026-11-07T05:01:00Z'); // 00:01 del 7 en Lima
    const r = await m.sender.send(texto('51900000002', { claveEnvio: 'noche-12' }));
    expect(r).toMatchObject({ ok: true, whatsappNumberId: ID_LINEA_PRINCIPAL });
    expect(await usadosEn(ID_LINEA_PRINCIPAL, '2026-11-06')).toBe(10);
    expect(await usadosEn(ID_LINEA_PRINCIPAL, '2026-11-07')).toBe(1);
  });

  it('si el numero 2 se desconecta tras llegar a 10, no sale nada y queda bloqueado con su motivo', async () => {
    const m = montar();
    await m.servicio.fijarLimite(ID_LINEA_PRINCIPAL, 10);
    const c = await repos.contacts.upsertFromInbound('51900000003');
    await repos.lineasContacto.fijarSiNoTiene(c.id, ID_LINEA_PRINCIPAL, m.ahora());
    for (let i = 1; i <= 10; i++) await m.sender.send(texto('51900000003', { claveEnvio: `lleno-${i}` }));
    m.conectada[SEGUNDA] = false;
    const r = await m.sender.send(texto('51900000003', { claveEnvio: 'lleno-11' }));
    console.log('SIN NUMEROS:', JSON.stringify(r));
    expect(r).toMatchObject({ ok: false, blocked: true, code: 'sin_lineas_disponibles', reason: 'No hay números vinculados habilitados con cupo disponible' });
    const { rows } = await b.pool.query<{ status: string; error_title: string }>(`select status, error_title from deliveries where id = ?`, [(r as { deliveryId: number }).deliveryId]);
    expect(rows[0]!.status).toBe('blocked_by_gate');
    expect(m.clientes[ID_LINEA_PRINCIPAL].sent).toHaveLength(10);
    expect(m.clientes[SEGUNDA].sent).toHaveLength(0);
    // Vuelve el numero 2: el mismo mensaje sale por el.
    m.conectada[SEGUNDA] = true;
    expect(await m.sender.send(texto('51900000003', { claveEnvio: 'lleno-11' }))).toMatchObject({ ok: true, whatsappNumberId: SEGUNDA });
  });
});
