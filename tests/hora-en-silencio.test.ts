/**
 * Caso real del 28/09 (GSG-IA-001, tienda principal, «Solo lo de GSG», silencio
 * tras UBI encendido, margen 60 min):
 *
 *   9:31     el cliente manda el pin → «✅ Ubicación registrada»
 *   9:35:16  el motorizado responde «30» → la bitácora decía «avisado al
 *            cliente: 🛵 … alrededor de las 11:05», pero el mensaje NO salió
 *            (lo frenó el silencio tras UBI)
 *   9:38:07  el cliente pregunta «cuanto tiempos e tarda el pedido … 1 mes
 *            espreando?» y nadie le contesta.
 *
 * Lo que pide el dueño: esa pregunta (y solo esa) se contesta aunque haya
 * silencio, con la hora ya calculada; antes de que el motorizado dé tiempo, el
 * horario de entrega; sin repetirse; y la bitácora dice la verdad.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';
import { HORA_PEDIDA_MAX_POR_DIA } from '../src/entregas/servicio.js';
import { TEXTOS_POR_DEFECTO, DESCRIPCION_TEXTOS, VARIABLES_TEXTOS } from '../src/entregas/textos.js';

/** Las 09:00 de Lima del último día que ya empezó (el reloj falso arranca desde new Date()). */
function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** «11:05 AM» en Lima, calculado aparte del sistema. */
const horaLima = (d: Date): string =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'America/Lima', hour: 'numeric', minute: '2-digit', hour12: true }).format(d).replace(/\s+/g, ' ');

const enPalabras = (min: number): string => {
  const h = Math.floor(min / 60);
  const r = min % 60;
  return h === 0 ? `${r} min` : r === 0 ? `${h} h` : `${h} h ${r} min`;
};

async function armar(): Promise<EscenarioEntregas> {
  const e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true, margenMinutos: 60 });
  await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' } });
  e.simulador.cargarDePrueba();
  await e.api.post('/admin/motorizados/de-prueba');
  await e.gsgManda();
  await e.trabajar();
  return e;
}

describe('los textos nuevos se editan desde la pantalla y no tienen género', () => {
  it('están en textos.ts con su descripción y sus variables (chips)', () => {
    for (const k of ['horaEnSilencio', 'horaEnSilencioPasada', 'horaEnSilencioSinTiempo'] as const) {
      expect(TEXTOS_POR_DEFECTO[k], k).toBeTruthy();
      expect(DESCRIPCION_TEXTOS[k], k).toBeTruthy();
      expect(VARIABLES_TEXTOS[k].length, k).toBeGreaterThan(2);
      expect(TEXTOS_POR_DEFECTO[k], k).not.toMatch(/\batent[oa]\b|\blist[oa]\b|\bpendiente[s]?\b|\bseñor[a]?\b/i);
    }
    expect(VARIABLES_TEXTOS.horaEnSilencio).toContain('{enCuanto}');
  });
});

describe('la hora cuando el cliente la pide, con el silencio tras UBI', () => {
  let e: EscenarioEntregas;
  const TEL = '987000001';
  let moto = '';
  let entregaId = 0;
  const nuevos = (desde: number) => e.textosA(TEL).slice(desde);
  const pregunta = async (texto: string): Promise<string[]> => {
    const a = e.textosA(TEL).length;
    await e.contesta(TEL, { texto });
    return nuevos(a);
  };
  const bitacora = async () => (await e.entregas.entrega(entregaId))!.eventos.map((ev) => `${ev.tipo}: ${ev.detalle ?? ''}`);

  beforeAll(async () => {
    e = await armar();
    expect(e.entregas.reglaGsgActiva()).toBe(true);
    // 9:0x: manda su pin → UBI REGISTRADA y desde ahí, silencio.
    await e.contesta(TEL, { pin: PIN_LIMA });
    await e.trabajar();
    const fila = (await e.entrega('P-1001'))!;
    entregaId = fila.id;
    moto = fila.motorizado!.phone;
    expect(await e.entregas.clienteEnSilencio(conPais(TEL))).toBe(true);
  });
  afterAll(() => e?.cerrar());

  it('antes de que el motorizado dé su tiempo: el horario de entrega y que el motorizado le llamará', async () => {
    const r = await pregunta('¿a qué hora llega mi pedido?');
    expect(r).toEqual([expect.stringMatching(/^Hola \S+, su pedido P-1001 se entrega hoy entre las 2:00 PM y las 8:00 PM\. El motorizado le llamará antes de llegar a su dirección\.$/)]);
    expect(r[0]).not.toContain('no se reciben consultas');
  });

  it('el motorizado dice «30»: al cliente NO le sale nada y la bitácora lo dice tal cual (no «avisado al cliente»)', async () => {
    const a = e.mensajesA(TEL).length;
    await e.contesta(moto, { texto: '30' });
    await e.trabajar();
    expect(e.mensajesA(TEL)).toHaveLength(a);
    const fila = (await e.entrega('P-1001'))!;
    expect(fila.llegaAproxAt).not.toBeNull();
    const eventos = await bitacora();
    expect(eventos.some((x) => x.includes('avisado al cliente'))).toBe(false);
    expect(eventos.some((x) => /^nota: no se le escribe al cliente la hora \(silencio tras ubicación registrada\); se le dirá si lo pregunta: llega hacia las \d{2}:\d{2}$/.test(x))).toBe(true);
    // La ficha tampoco dice que se le avisó.
    expect(fila.situacion).toContain('Al cliente NO se le escribió');
    expect(fila.situacion).not.toContain('se le avisó que llega');
  });

  it('pregunta como el cliente real: la hora que ya se calculó (minutos + 60 de margen), en hora de Lima y cuánto falta', async () => {
    e.avanzar(3);
    const fila = (await e.entrega('P-1001'))!;
    const llega = new Date(fila.llegaAproxAt!);
    const faltan = Math.ceil((llega.getTime() - e.ahora().getTime()) / 60_000);
    expect(faltan).toBeGreaterThan(80);
    const r = await pregunta('cuanto tiempos e tarda el pedido 1 mes espreando?');
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/^Hola \S+, su pedido P-1001 llega aproximadamente a las /);
    expect(r[0]).toContain(`a las ${horaLima(llega)} (en aprox. ${enPalabras(faltan)}).`);
    expect(r[0]).toContain('El motorizado le llamará minutos antes de llegar.');
    // Sigue en silencio: no se gastó el cierre ni cambió el motivo.
    expect((await e.repos.contacts.getByPhone(conPais(TEL)))?.iaCerradaMotivo).toBe('ubicación registrada');
  });

  it('varias preguntas seguidas (ráfaga) o la misma dentro de 10 min: UNA sola respuesta', async () => {
    expect(await pregunta('y mi pedido?')).toEqual([]);
    expect(await pregunta('a que hora llega')).toEqual([]);
    e.avanzarSegundos(20);
    expect(await pregunta('cuanto falta para que llegue mi pedido')).toEqual([]);
    e.avanzar(5);
    expect(await pregunta('ya viene mi pedido?')).toEqual([]);
    expect((await bitacora()).filter((x) => x.includes('no se le repite'))).not.toHaveLength(0);
  });

  it('pasados 10 min se le contesta otra vez, con lo que falta recalculado', async () => {
    e.avanzar(6);
    const llega = new Date((await e.entrega('P-1001'))!.llegaAproxAt!);
    const faltan = Math.ceil((llega.getTime() - e.ahora().getTime()) / 60_000);
    const r = await pregunta('a que hora llega?');
    expect(r).toHaveLength(1);
    expect(r[0]).toContain(`(en aprox. ${enPalabras(faltan)})`);
  });

  it('pasada la hora: un texto honesto («debería estar por llegar; el motorizado le llamará»)', async () => {
    const llega = new Date((await e.entrega('P-1001'))!.llegaAproxAt!);
    e.avanzar(Math.ceil((llega.getTime() - e.ahora().getTime()) / 60_000) + 2);
    const r = await pregunta('y mi pedido? a que hora llega');
    expect(r).toEqual([expect.stringMatching(new RegExp(`^Hola \\S+, su pedido P-1001 debería estar por llegar \\(lo calculamos para las ${horaLima(llega)}\\)\\. El motorizado le llamará al llegar a su dirección\\.$`))]);
  });

  it(`como mucho ${HORA_PEDIDA_MAX_POR_DIA} respuestas por pedido al día`, async () => {
    e.avanzar(11);
    expect(await pregunta('a que hora llega mi pedido')).toEqual([]);
    expect((await bitacora()).some((x) => x.includes(`ya se le dio ${HORA_PEDIDA_MAX_POR_DIA} veces hoy`))).toBe(true);
  });
});

describe('varios pedidos del día: se usa el correcto', () => {
  let e: EscenarioEntregas;
  const TEL = '999111801';
  beforeAll(async () => {
    e = await armar();
    for (const ref of ['P-VARIOS-1', 'P-VARIOS-2']) expect((await e.entregas.crearAMano({ referencia: ref, telefono: TEL, nombre: 'Luz Varios', faltaUbicacion: true, faltaConfirmacion: false }, 'prueba')).ok).toBe(true);
    await e.trabajar();
    await e.contesta(TEL, { pin: PIN_LIMA });
    await e.trabajar();
    // Cada uno con su hora (como si dos motorizados hubieran contestado).
    const uno = (await e.entrega('P-VARIOS-1'))!;
    const dos = (await e.entrega('P-VARIOS-2'))!;
    const en = e.ahora().getTime();
    await e.repos.entregas.actualizar(uno.id, { estado: 'avisada', motorizadoEstado: 'respondio', minutosMotorizado: 60, minutosAviso: 120, llegaAproxAt: new Date(en + 120 * 60_000), avisoEnviadoAt: e.ahora() });
    await e.repos.entregas.actualizar(dos.id, { estado: 'avisada', motorizadoEstado: 'respondio', minutosMotorizado: 10, minutosAviso: 70, llegaAproxAt: new Date(en + 70 * 60_000), avisoEnviadoAt: e.ahora() });
    expect(await e.entregas.clienteEnSilencio(conPais(TEL))).toBe(true);
  });
  afterAll(() => e?.cerrar());

  it('sin nombrar ninguno: no se asume cuál (silencio y queda anotado); nombrando uno: ese', async () => {
    let a = e.textosA(TEL).length;
    await e.contesta(TEL, { texto: 'a que hora llega mi pedido?' });
    expect(e.textosA(TEL).slice(a)).toEqual([]);
    const c = (await e.repos.contacts.getByPhone(conPais(TEL)))!;
    const [d] = await e.repos.decisiones.listarPorContacto(c.id, 1);
    expect(d).toMatchObject({ intencion: 'estado_pedido' });
    expect(d!.respuesta).toContain('varios pedidos');
    a = e.textosA(TEL).length;
    await e.contesta(TEL, { texto: 'y a que hora llega el P-VARIOS-1?' });
    expect(e.textosA(TEL).slice(a)).toEqual([expect.stringContaining('su pedido P-VARIOS-1 llega aproximadamente')]);
  });
});
