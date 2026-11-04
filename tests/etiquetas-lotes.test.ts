/**
 * Los lotes de «Etiquetar chats con IA» y el etiquetado a mano
 * (src/chat/etiquetar.ts): solo se lee lo que falta, lo puesto a mano no lo
 * pisa la IA, cada lote queda apuntado con su estado y su registro. GSG no
 * recibe nada aparte: lee la etiqueta como la nota del chat en
 * GET /api/v1/historial (ver tests/chat-gsg.test.ts).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MensajeIA } from '../src/ia/proveedores.js';
import { crearChatEtiquetasEnMemoria, crearChatEtiquetasRepo, type ChatEtiquetasRepo, type MensajeDelDia } from '../src/db/chat-etiquetas.js';
import { crearEtiquetador, etiquetarAMano, etiquetarDelDia, type EtiquetadoDeps } from '../src/chat/etiquetar.js';
import type { Pool } from '../src/db/pool.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

const AHORA = new Date('2026-10-27T20:00:00Z');
const DIA = '2026-10-27';
const ALCANCE = { afterId: '0', retenidosDesde: new Date('2026-10-20T00:00:00Z') };

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
        const u = String(m.find((x) => x.role === 'user')?.content ?? '');
        llamadas.push(u);
        return /dónde/.test(u) ? '{"etiqueta":"consultar_entrega"}' : /mañana/.test(u) ? '{"etiqueta":"reagendar_entrega"}' : /a las 3/.test(u) ? '{"etiqueta":"horario_fijo"}' : '{"etiqueta":"otro"}';
      },
    },
  };
}

function deps(repo: ChatEtiquetasRepo, ia: EtiquetadoDeps['ia']): EtiquetadoDeps {
  return { repo, ia, zonaHoraria: () => 'America/Lima', nombreNegocio: () => 'GSG', ahora: () => AHORA };
}

describe('etiquetar a mano', () => {
  let mensajes: MensajeDelDia[];
  let repo: ChatEtiquetasRepo;
  beforeEach(() => {
    mensajes = [msg('51911000002', 'in', 'mejor mañana', 1), msg('51911000003', 'in', 'tráigalo a las 3', 2)];
    repo = crearChatEtiquetasEnMemoria(() => mensajes);
  });

  it('queda como manual y la IA no la pisa, ni al volver a etiquetar todo', async () => {
    const d = deps(repo, () => iaDePrueba().ia);
    const fila = (await etiquetarAMano(d, { phone: '911000002', etiqueta: 'sin_novedad', quien: 'Ali' }))!;
    expect(fila).toMatchObject({ phone: '51911000002', etiqueta: 'sin_novedad', origen: 'manual' });
    expect((await repo.eventos({ phone: '51911000002', limite: 5 })).map((e) => e.codigo)).toEqual(['etiqueta_manual']);

    // El lote de la IA: la manual se queda; solo el otro chat va a la IA.
    const ia = iaDePrueba();
    const r = await etiquetarDelDia(deps(repo, () => ia.ia), ALCANCE);
    expect(ia.llamadas).toHaveLength(1);
    expect(r).toMatchObject({ reutilizadas: 1, clasificadas: 1 });
    const ia2 = iaDePrueba();
    await etiquetarDelDia(deps(repo, () => ia2.ia), ALCANCE, undefined, { releer: true });
    expect(ia2.llamadas).toHaveLength(1);
    expect((await repo.ultimas(['51911000002'])).get('51911000002')).toMatchObject({ etiqueta: 'sin_novedad', origen: 'manual' });

    // Cambiarla a mano: queda la nueva, y el registro dice cual habia antes.
    await etiquetarAMano(d, { phone: '51911000002', etiqueta: 'reclamo', quien: 'Ali' });
    expect((await repo.ultimas(['51911000002'])).get('51911000002')).toMatchObject({ etiqueta: 'reclamo', origen: 'manual' });
    expect((await repo.eventos({ phone: '51911000002', limite: 1 }))[0]!.detalle).toMatch(/antes «Sin novedad»/);
  });

  it('quitarla deja el chat sin etiquetar y la IA lo vuelve a leer; un codigo fuera del catalogo no vale', async () => {
    const d = deps(repo, () => iaDePrueba().ia);
    await etiquetarAMano(d, { phone: '51911000002', etiqueta: 'reclamo' });
    expect(await etiquetarAMano(d, { phone: '51911000002', etiqueta: null, quien: 'Ali' })).toBeNull();
    expect(await repo.delDia(DIA, ['51911000002'])).toEqual([]);
    const ia = iaDePrueba();
    await etiquetarDelDia(deps(repo, () => ia.ia), ALCANCE);
    expect(ia.llamadas).toHaveLength(2);
    await expect(etiquetarAMano(d, { phone: '51911000002', etiqueta: 'inventada' })).rejects.toThrow(/no está en el catálogo/);
  });
});

describe('el lote', () => {
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

  it('etiqueta cada chat y deja el lote completado con su registro', async () => {
    const r = await etiquetarDelDia(deps(repo, () => iaDePrueba().ia), ALCANCE, undefined, { iniciadoPor: 'Ali' });
    expect(r).toMatchObject({ estado: 'completado', tipo: 'completo', total: 3, clasificadas: 3, porIA: 3, sinClasificar: 0 });
    expect((await repo.delDia(DIA)).map((f) => [f.phone, f.etiqueta, f.origen])).toEqual([
      ['51911000002', 'reagendar_entrega', 'ia'],
      ['51911000003', 'horario_fijo', 'ia'],
      ['51911000004', 'otro', 'ia'],
    ]);
    const lote = (await repo.lote(r.loteId!))!;
    expect(lote).toMatchObject({ estado: 'completado', tipo: 'completo', clasificadas: 3, iniciadoPor: 'Ali' });
    expect(lote.terminoAt).not.toBeNull();
    const codigos = (await repo.eventos({ loteId: r.loteId!, limite: 50 })).map((e) => e.codigo);
    expect(codigos[0]).toBe('lote_fin');
    expect(codigos).toContain('lote_inicio');
  });

  it('sin cambios no se vuelve a llamar a la IA; un chat nuevo, solo ese', async () => {
    await etiquetarDelDia(deps(repo, () => iaDePrueba().ia), ALCANCE);
    const ia2 = iaDePrueba();
    expect(await etiquetarDelDia(deps(repo, () => ia2.ia), ALCANCE)).toMatchObject({ estado: 'completado', reutilizadas: 3, clasificadas: 0 });
    expect(ia2.llamadas).toHaveLength(0);
    // Luis escribe otra vez: ya estaba etiquetado; no se relee.
    mensajes.push(msg('51911000003', 'in', '¿dónde está el motorizado?', 9));
    mensajes.push(msg('51911000009', 'in', 'mejor mañana', 10));
    const ia3 = iaDePrueba();
    expect(await etiquetarDelDia(deps(repo, () => ia3.ia), ALCANCE)).toMatchObject({ reutilizadas: 3, clasificadas: 1 });
    expect(ia3.llamadas).toHaveLength(1);
    expect((await repo.ultimas(['51911000009'])).get('51911000009')).toMatchObject({ etiqueta: 'reagendar_entrega' });
  });

  it('la IA falla: queda sin clasificar, el lote con errores, y el siguiente lote lo vuelve a intentar', async () => {
    mensajes = [msg('51911000005', 'in', 'hola', 1)];
    const caida = { completar: async () => { throw new Error('sin saldo'); } };
    const r = await etiquetarDelDia(deps(repo, () => caida), ALCANCE);
    expect(r).toMatchObject({ estado: 'completado_con_errores', sinClasificar: 1 });
    expect((await repo.delDia(DIA))[0]).toMatchObject({ etiqueta: null });
    const [e] = await repo.eventos({ fase: 'analisis', limite: 5 });
    expect(e).toMatchObject({ codigo: 'ia_fallo', nivel: 'error', phone: '51911000005' });
    expect(e!.detalle).toMatch(/sin saldo/);
    const ia = iaDePrueba();
    expect(await etiquetarDelDia(deps(repo, () => ia.ia), ALCANCE)).toMatchObject({ estado: 'completado', clasificadas: 1 });
    expect(ia.llamadas).toHaveLength(1);
  });

  it('en segundo plano: un lote a la vez, el estado sobrevive al proceso y un lote colgado se cierra', async () => {
    const colgado = await repo.crearLote({ dia: DIA, tipo: 'completo' });
    const e = crearEtiquetador(deps(repo, () => iaDePrueba().ia));
    const primero = e.iniciar(ALCANCE);
    expect(primero.enCurso).toBe(true);
    // Pulsar otra vez mientras corre devuelve el mismo, no empieza otro.
    expect(e.iniciar(ALCANCE).enCurso).toBe(true);
    await e.esperar();
    expect(await e.estado()).toMatchObject({ enCurso: false, estado: 'completado', clasificadas: 3 });
    expect((await repo.lote(colgado.id))!).toMatchObject({ estado: 'fallido' });
    expect((await repo.lotes(10)).filter((l) => l.estado === 'completado')).toHaveLength(1);
    // Otro proceso (sin nada en memoria) lee el ultimo lote guardado.
    const otro = crearEtiquetador(deps(repo, () => null));
    expect(await otro.estado()).toMatchObject({ estado: 'completado', tipo: 'completo', clasificadas: 3, enCurso: false });
    expect(() => otro.iniciar(ALCANCE)).toThrow(/Asistente IA/);
  });
});

// ------------------------------------------------------- contra MySQL

describe('el repo de etiquetas contra la base', () => {
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

  it('guardar pisa la etiqueta de ese numero y dia; la ultima de cada numero es la mas reciente', async () => {
    const base = { phone: '51911000030', origen: 'ia' as const, mensajes: 2, motivo: null };
    await repo.guardar({ ...base, dia: '2026-10-26', etiqueta: 'consultar_entrega', huella: 'a'.repeat(64) });
    await repo.guardar({ ...base, dia: DIA, etiqueta: 'reclamo', huella: 'b'.repeat(64) });
    await repo.guardar({ ...base, dia: DIA, etiqueta: 'reagendar_entrega', huella: 'c'.repeat(64), origen: 'manual' });
    expect(await repo.delDia(DIA)).toHaveLength(1);
    expect((await repo.ultimas(['51911000030'])).get('51911000030')).toMatchObject({ dia: DIA, etiqueta: 'reagendar_entrega', origen: 'manual', huella: 'c'.repeat(64) });
    await repo.guardar({ ...base, dia: DIA, etiqueta: null, huella: 'd'.repeat(64), motivo: 'caída' });
    expect((await repo.delDia(DIA))[0]).toMatchObject({ etiqueta: null, motivo: 'caída' });
    await repo.quitar('51911000030', DIA);
    expect((await repo.ultimas(['51911000030'])).get('51911000030')).toMatchObject({ dia: '2026-10-26' });
  });

  it('lotes y eventos: se guardan, se filtran, y un lote colgado se cierra', async () => {
    const l = await repo.crearLote({ dia: DIA, tipo: 'completo', iniciadoPor: 'Ali' });
    expect(l).toMatchObject({ estado: 'en_curso', tipo: 'completo', dia: DIA, iniciadoPor: 'Ali', terminoAt: null });
    await repo.actualizarLote(l.id, { estado: 'completado_con_errores', clasificadas: 2, sinClasificar: 1, error: 'x'.repeat(900), terminoAt: new Date() });
    const leido = (await repo.lote(l.id))!;
    expect(leido).toMatchObject({ estado: 'completado_con_errores', clasificadas: 2, sinClasificar: 1 });
    expect(leido.error).toHaveLength(500);
    const otro = await repo.crearLote({ dia: DIA, tipo: 'completo' });
    expect(await repo.cerrarLotesColgados('reinicio')).toBe(1);
    expect((await repo.lote(otro.id))!).toMatchObject({ estado: 'fallido', error: 'reinicio' });
    expect((await repo.lotes(10)).length).toBe(2);

    await repo.registrar({ loteId: l.id, phone: '51911000030', fase: 'analisis', nivel: 'error', codigo: 'ia_fallo', detalle: 'sin saldo' });
    await repo.registrar({ loteId: l.id, phone: null, fase: 'lote', nivel: 'info', codigo: 'lote_fin', detalle: null });
    await repo.registrar({ loteId: otro.id, phone: null, fase: 'lote', nivel: 'info', codigo: 'lote_inicio', detalle: null });
    expect((await repo.eventos({ loteId: l.id, limite: 10 })).map((e) => e.codigo)).toEqual(['lote_fin', 'ia_fallo']);
    expect((await repo.eventos({ nivel: 'error', limite: 10 })).map((e) => e.phone)).toEqual(['51911000030']);
    expect(await repo.eventos({ phone: '51911000030', fase: 'analisis', limite: 10 })).toHaveLength(1);
    expect(await repo.eventos({ limite: 2 })).toHaveLength(2);
  });
});
