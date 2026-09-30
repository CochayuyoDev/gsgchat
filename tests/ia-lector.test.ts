/**
 * Lo que la IA no entendió (tablero y correcciones), el tú / usted y el
 * examen diario del lector de respuestas.
 */

import { describe, expect, it } from 'vitest';
import { apuntarFrase, extraerCasos, leerFrases, leerRevisados, marcarRevisado, normalizarFrase, textoDeLeccion, type CasoNoEntendido } from '../src/ia/no-entendido.js';
import { avisoDeExamen, BANCO_EXAMEN, examinarLector, examenEnPalabras, UMBRAL_EXAMEN } from '../src/ia/examen-lector.js';
import { instruccionDeTono, pareceTuteo, tonoDeValor, tonoEfectivo } from '../src/ia/tono.js';
import { construirSistema } from '../src/ia/servicio.js';
import { createMemorySettingsRepo } from './fakes.js';
import type { EventoEntrega } from '../src/entregas/repo.js';

type EventoConEntrega = EventoEntrega & { referencia: string; phone: string; nombre: string | null };
const ev = (id: number, tipo: EventoEntrega['tipo'], detalle: string, payload: Record<string, unknown> | null = null, hace = 0): EventoConEntrega => ({
  id,
  entregaId: 1,
  tipo,
  detalle,
  payload,
  createdAt: new Date(Date.now() - hace),
  referencia: 'P-1001',
  phone: '51987000001',
  nombre: 'Ana Quispe',
});

describe('lo que la IA no entendió', () => {
  it('saca de la bitácora lo que no se entendió, de clientes y motorizados, y lo que la IA leyó', () => {
    const eventos = [
      ev(5, 'nota', 'contestó algo que no se entendió (pregunta la hora): "a que hora vienen"; se le pregunta otra vez'),
      ev(6, 'nota', 'contestó algo que no se entendió a la segunda visita: "ya veremos"; se le pregunta otra vez'),
      ev(7, 'nota', 'Kevin Aguilar contestó sin un tiempo claro: "ahorita voy"; se le pregunta otra vez'),
      ev(8, 'nota', 'Kevin Aguilar contestó varias veces sin un tiempo: "ya casi"'),
      ev(9, 'ia', 'la IA leyó la respuesta: si (confirma)', { texto: 'de una' }),
      ev(10, 'ia', 'la IA leyó al motorizado: 25 min', { texto: 'en un ratito, 25' }),
      ev(11, 'nota', 'entra en el lote del reparto "x" para pedirle la ubicación'),
      ev(12, 'confirmada', 'confirmó (reglas): "si"'),
      ev(13, 'nota', 'contestó algo que no se entendió: "muy viejo"; se le pregunta otra vez', null, 40 * 86_400_000),
    ];
    const casos = extraerCasos(eventos, new Date(Date.now() - 7 * 86_400_000));
    expect(casos.map((c) => c.id)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(casos[0]).toMatchObject({ quien: 'cliente', tema: 'confirmacion', texto: 'a que hora vienen', leidoPorIA: false, loQueHizo: 'se le preguntó otra vez' });
    expect(casos[1]).toMatchObject({ tema: 'segunda_visita', texto: 'ya veremos' });
    expect(casos[2]).toMatchObject({ quien: 'motorizado', tema: 'tiempo', texto: 'ahorita voy' });
    expect(casos[3]).toMatchObject({ quien: 'motorizado', loQueHizo: 'el pedido pasó a otro motorizado' });
    expect(casos[4]).toMatchObject({ quien: 'cliente', tema: 'confirmacion', texto: 'de una', leidoPorIA: true, loQueHizo: 'la IA lo leyó como «si (confirma)»' });
    expect(casos[5]).toMatchObject({ quien: 'motorizado', tema: 'tiempo', texto: 'en un ratito, 25', leidoPorIA: true });
  });

  it('las frases propias se guardan normalizadas, sin repetir y cambiando de lista si se corrige otra vez', async () => {
    const settings = createMemorySettingsRepo();
    expect(await leerFrases(settings)).toEqual({ si: [], no: [], duda: [], entregado: [], noEntregado: [], minutos: [] });
    await apuntarFrase(settings, '¡De una, pues!', 'si');
    await apuntarFrase(settings, 'de una pues', 'si');
    let f = await leerFrases(settings);
    expect(f.si).toEqual(['de una pues']);
    await apuntarFrase(settings, 'De una pues', 'no');
    f = await leerFrases(settings);
    expect(f.si).toEqual([]);
    expect(f.no).toEqual(['de una pues']);
    await apuntarFrase(settings, 'ahorita voy', 'minutos', 15);
    await apuntarFrase(settings, 'lo dejé abajo', 'entregado');
    await apuntarFrase(settings, 'nadie sale', 'no_entregado');
    await apuntarFrase(settings, 'mmm', 'ignorar');
    f = await leerFrases(settings);
    expect(f.minutos).toEqual([{ texto: 'ahorita voy', minutos: 15 }]);
    expect(f.entregado).toEqual(['lo deje abajo']);
    expect(f.noEntregado).toEqual(['nadie sale']);
    expect(normalizarFrase('¿Sí, mañana?')).toBe('si manana');
  });

  it('los revisados se recuerdan (hasta 500) y la lección se redacta en palabras', async () => {
    const settings = createMemorySettingsRepo();
    await marcarRevisado(settings, 5);
    await marcarRevisado(settings, 5);
    await marcarRevisado(settings, 9);
    expect(await leerRevisados(settings)).toEqual([5, 9]);
    const caso: Pick<CasoNoEntendido, 'quien' | 'texto' | 'tema'> = { quien: 'cliente', texto: 'de una', tema: 'confirmacion' };
    expect(textoDeLeccion(caso, 'si')).toContain('es un SÍ');
    expect(textoDeLeccion({ ...caso, quien: 'motorizado' }, 'minutos', 15)).toContain('15 minutos');
    expect(textoDeLeccion(caso, 'minutos', null)).toBeNull();
    expect(textoDeLeccion(caso, 'ignorar')).toBeNull();
  });
});

describe('tú o usted', () => {
  it('detecta el tuteo y el ustedeo por lo último que escribió el cliente', () => {
    expect(pareceTuteo(['hola, ¿me puedes decir a qué hora llega?'])).toBe(true);
    expect(pareceTuteo(['buenas, ¿podría decirme a qué hora llega? gracias, disculpe'])).toBe(false);
    expect(pareceTuteo(['ok'])).toBeNull();
    expect(pareceTuteo(['puedes?', 'disculpe, ¿puede?'])).toBe(false);
    expect(tonoEfectivo('auto', ['ok'])).toBe('usted');
    expect(tonoEfectivo('auto', ['mándame la ubicación'])).toBe('tu');
    expect(tonoEfectivo('tu', ['disculpe'])).toBe('tu');
    expect(tonoEfectivo('usted', ['dame'])).toBe('usted');
    expect(tonoDeValor('raro')).toBe('auto');
    expect(instruccionDeTono('tu')).toContain('TÚ');
    expect(instruccionDeTono('usted')).toContain('USTED');
  });

  it('el prompt del asistente lleva la línea del tratamiento', () => {
    const cfg = { activa: true, proveedor: 'puter' as const, modelo: 'x', baseUrl: '', nombreAsistente: 'Lucia', conocimiento: 'x', instrucciones: '', derivarSi: '', avisarDerivacion: true, memoria: 12, catalogoUrl: '', catalogoFormato: 'auto' as const };
    const conTu = construirSistema(cfg, { negocio: 'Z', horario: 'h', ahora: new Date(), tono: 'tu' });
    const conUsted = construirSistema(cfg, { negocio: 'Z', horario: 'h', ahora: new Date(), tono: 'usted' });
    const sin = construirSistema(cfg, { negocio: 'Z', horario: 'h', ahora: new Date() });
    expect(conTu).toContain('Trata al cliente de TÚ');
    expect(conUsted).toContain('Trata al cliente de USTED');
    expect(sin).not.toContain('Trata al cliente de');
  });
});

describe('el examen del lector de respuestas', () => {
  it('el banco entero se lee bien con las reglas de hoy', () => {
    const r = examinarLector({ ahora: new Date('2026-09-21T15:00:00-05:00'), timezone: 'America/Lima', origen: 'mano' });
    expect(r.total).toBe(BANCO_EXAMEN.length);
    expect(r.fallos, JSON.stringify(r.fallos)).toEqual([]);
    expect(r.porcentaje).toBe(100);
    expect(r.dia).toBe('2026-09-21');
    expect(examenEnPalabras({ ...r, avisado: false })).toContain('sin fallos');
    expect(examenEnPalabras(null)).toContain('Todavía');
  });

  it('el aviso al supervisor dice el porcentaje y los primeros fallos', () => {
    const texto = avisoDeExamen({ porcentaje: 80, aciertos: 8, total: 10, fallos: [{ tipo: 'confirmacion', texto: 'ya pues', esperaba: 'si', leyo: 'no_claro' }] });
    expect(texto).toContain('80 %');
    expect(texto).toContain('«ya pues»');
    expect(UMBRAL_EXAMEN).toBe(90);
  });
});
