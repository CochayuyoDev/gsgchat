/**
 * El cupo diario por numero contra MySQL/MariaDB de verdad: la reserva es atomica
 * (cien a la vez no pasan del tope), liberar devuelve el cupo una sola vez, una
 * clave repetida no cuenta dos veces y la migracion deja todo en su sitio.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createRepos, type Repos } from '../src/db/repos.js';
import { crearServicioLineas, ID_LINEA_PRINCIPAL } from '../src/whatsapp/lineas.js';
import { LimiteInvalido } from '../src/whatsapp/limite-diario.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

let b: BaseDePrueba;
let repos: Repos;
const OTRA = '00000000-0000-0000-0000-0000000000aa';
const DIA = '2026-11-04';

beforeAll(async () => {
  b = await baseDePrueba();
  repos = createRepos(b.pool);
});
afterAll(async () => {
  await b?.cerrar();
});
beforeEach(async () => {
  await b.vaciar();
  await b.pool.query(`insert into whatsapp_numbers (id, label, provider, is_primary, position) values (?, 'Principal', 'local', 1, 0), (?, 'wsp-ali', 'local', 0, 1)`, [ID_LINEA_PRINCIPAL, OTRA]);
});

const reservar = (clave: string, lineaId = OTRA, dia = DIA) => repos.usoLineas.reservar({ clave, lineaId, dia, motivo: 'asignacion_original' });
const usados = async (lineaId = OTRA, dia = DIA) => (await repos.usoLineas.usoDelDia(dia)).get(lineaId) ?? 0;

describe('reservar cupo', () => {
  it('sin limite (0) reserva siempre', async () => {
    for (let i = 0; i < 20; i++) expect((await reservar(`k${i}`)).ok).toBe(true);
    expect(await usados()).toBe(20);
  });

  it('con limite 5, cien reservas simultaneas dejan exactamente 5', async () => {
    await repos.usoLineas.fijarLimite(OTRA, 5);
    const r = await Promise.all(Array.from({ length: 100 }, (_, i) => reservar(`c${i}`)));
    expect(r.filter((x) => x.ok)).toHaveLength(5);
    expect(await usados()).toBe(5);
  });

  it('con limite 3 la cuarta no cabe y dice cuanto lleva', async () => {
    await repos.usoLineas.fijarLimite(OTRA, 3);
    for (let i = 0; i < 3; i++) await reservar(`d${i}`);
    expect(await reservar('d3')).toMatchObject({ ok: false, razon: 'sin_cupo', limite: 3, usados: 3 });
  });

  it('el mismo envio (misma clave) no cuenta dos veces', async () => {
    await repos.usoLineas.fijarLimite(OTRA, 2);
    const a = await reservar('igual');
    const c = await reservar('igual');
    expect(a).toMatchObject({ ok: true, repetida: false });
    expect(c).toMatchObject({ ok: true, repetida: true });
    expect(await usados()).toBe(1);
  });

  it('el contador es por dia: otro dia empieza en cero', async () => {
    await repos.usoLineas.fijarLimite(OTRA, 1);
    expect((await reservar('x1')).ok).toBe(true);
    expect((await reservar('x2')).ok).toBe(false);
    expect((await reservar('x3', OTRA, '2026-11-05')).ok).toBe(true);
  });
});

describe('cerrar la reserva', () => {
  it('liberar devuelve el cupo una sola vez', async () => {
    await repos.usoLineas.fijarLimite(OTRA, 1);
    await reservar('l1');
    expect(await repos.usoLineas.liberar('l1')).toBe(true);
    expect(await repos.usoLineas.liberar('l1')).toBe(false);
    expect(await usados()).toBe(0);
    expect((await reservar('l2')).ok).toBe(true);
  });

  it('una reserva aceptada ya no se libera', async () => {
    await reservar('a1');
    await repos.usoLineas.aceptar('a1', 'wamid.1');
    expect(await repos.usoLineas.liberar('a1')).toBe(false);
    expect(await usados()).toBe(1);
    expect(await repos.usoLineas.porClave('a1')).toMatchObject({ estado: 'aceptado', wamid: 'wamid.1' });
  });

  it('una reserva incierta se reconcilia con su entrega: si salio, pasa a aceptada', async () => {
    const c = await repos.contacts.upsertFromInbound('51912345678');
    const entrega = await repos.deliveries.create({ contactId: c.id, kind: 'freeform', category: 'UTILITY', whatsappNumberId: OTRA, lineaMotivo: 'asignacion_original' });
    await reservar('i1');
    await repos.usoLineas.anotarEntrega('i1', entrega);
    await repos.usoLineas.marcarIncierto('i1');
    expect(await repos.usoLineas.reconciliar('i1')).toMatchObject({ estado: 'incierto' });
    await repos.deliveries.markSent(entrega, 'wamid.real');
    expect(await repos.usoLineas.reconciliar('i1')).toMatchObject({ estado: 'aceptado', wamid: 'wamid.real' });
  });

  it('un envio sin numero disponible deja una sola anotacion aunque se reintente', async () => {
    await repos.usoLineas.anotarSinLinea('s1', 11);
    await repos.usoLineas.anotarSinLinea('s1', 11);
    expect(await repos.usoLineas.porClave('s1')).toMatchObject({ estado: 'sin_linea', deliveryId: 11 });
    // Cuando hay cupo, la misma clave reserva de verdad.
    expect(await reservar('s1')).toMatchObject({ ok: true, repetida: false });
  });
});

describe('el maximo de cada numero', () => {
  it('por defecto no hay limite y se guarda y valida en el servicio de lineas', async () => {
    const servicio = crearServicioLineas(b.pool, Buffer.alloc(32), 'prueba');
    expect((await servicio.obtener(OTRA))!.limiteDiario).toBe(0);
    expect(await servicio.fijarLimite(OTRA, '500')).toBe(500);
    expect((await servicio.obtener(OTRA))!.limiteDiario).toBe(500);
    expect(await repos.usoLineas.limite(OTRA)).toBe(500);
    expect(await servicio.fijarLimite(OTRA, '')).toBe(0);
    expect((await servicio.obtener(OTRA))!.limiteDiario).toBe(0);
    await expect(servicio.fijarLimite(OTRA, -3)).rejects.toThrow(LimiteInvalido);
    await expect(servicio.fijarLimite(OTRA, 'mil')).rejects.toThrow(LimiteInvalido);
    expect((await servicio.obtener(OTRA))!.limiteDiario).toBe(0);
  });
});
