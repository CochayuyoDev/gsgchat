/**
 * Los modulos puros de salud del numero: riesgo, marcapasos, supresion,
 * variantes y la simulacion de escritura. Sin base de datos ni reloj real.
 */

import { describe, expect, it } from 'vitest';
import { evaluarRiesgo, factorDeRampa, nivelDe, type Senales } from '../src/salud/riesgo.js';
import {
  Marcapasos,
  decidirRitmo,
  enHorario,
  msHastaApertura,
  sortearPausa,
  type FotoRitmo,
} from '../src/salud/ritmo.js';
import { POLITICA_CLOUD, POLITICA_NO_OFICIAL, limiteDelTier, politicaDesdeConfig } from '../src/salud/politica.js';
import { codigoDeError, contactoSuprimido, reglaDeSupresion } from '../src/salud/supresion.js';
import { elegirPlantilla, elegirVariante, semilla } from '../src/salud/variantes.js';
import { duracionEscritura, escribirComoHumano, normal } from '../src/salud/humano.js';
import { loadConfig } from '../src/config.js';
import { approvedTemplate } from './fakes.js';

const NOW = new Date('2026-03-10T15:00:00Z'); // martes, 10:00 en Lima

function senales(overrides: Partial<Senales> = {}): Senales {
  return {
    ultimos: { enviados: 0, fallidos: 0, porCodigo: {} },
    dia: {
      enviados: 0,
      entregados: 0,
      enviadosMaduros: 0,
      entregadosMaduros: 0,
      bajas: 0,
      entrantes: 0,
      quejas: 0,
      porCodigo: {},
    },
    hora: { fallidos: 0, porCodigo: {}, desconexiones: 0 },
    reciente: { porCodigo: {} },
    calidad: 'GREEN',
    estado: 'CONNECTED',
    socket: { forbidden: false, loggedOut: false },
    ...overrides,
  };
}

const U = POLITICA_CLOUD.umbrales;
const PAUSA = 4 * 60 * 60 * 1000;

describe('riesgo: de las senales al nivel', () => {
  it('sin senales esta en verde y a velocidad normal', () => {
    const r = evaluarRiesgo(senales(), U, 'cloud', PAUSA);
    expect(r).toMatchObject({ puntos: 0, nivel: 'verde', factor: 1, sinMarketing: false, descansoMs: null });
  });

  it('Meta en rojo (flagged) es rojo aqui, con descanso', () => {
    const r = evaluarRiesgo(senales({ calidad: 'RED' }), U, 'cloud', PAUSA);
    expect(r.nivel).toBe('rojo');
    expect(r.factor).toBe(0);
    expect(r.descansoMs).toBe(PAUSA);
    expect(r.motivos[0]).toMatch(/ROJO/);
  });

  it('Meta en amarillo frena a la mitad y para el marketing', () => {
    const r = evaluarRiesgo(senales({ calidad: 'YELLOW' }), U, 'cloud', PAUSA);
    expect(r.nivel).toBe('amarillo');
    expect(r.factor).toBe(0.5);
    expect(r.sinMarketing).toBe(true);
  });

  it('un 131048 (restricciones de calidad) es rojo y descansa 24 h como minimo', () => {
    const r = evaluarRiesgo(senales({ hora: { fallidos: 1, porCodigo: { '131048': 1 }, desconexiones: 0 } }), U, 'cloud', PAUSA);
    expect(r.nivel).toBe('rojo');
    expect(r.descansoMs).toBe(24 * 60 * 60 * 1000);
  });

  it('cuenta restringida (131031) o 403 del socket: rojo sin fecha de vuelta', () => {
    const cuenta = evaluarRiesgo(senales({ hora: { fallidos: 1, porCodigo: { '131031': 1 }, desconexiones: 0 } }), U, 'cloud', PAUSA);
    expect(cuenta.nivel).toBe('rojo');
    expect(cuenta.descansoMs).toBeNull();

    const socket = evaluarRiesgo(senales({ socket: { forbidden: true, loggedOut: false } }), U, 'no_oficial', PAUSA);
    expect(socket.nivel).toBe('rojo');
    expect(socket.descansoMs).toBeNull();
  });

  it('con pocos envios los porcentajes no cuentan', () => {
    const r = evaluarRiesgo(senales({ ultimos: { enviados: 5, fallidos: 5, porCodigo: { '131026': 5 } } }), U, 'cloud', PAUSA);
    expect(r.nivel).toBe('verde');
  });

  it('20 % de fallos en los ultimos 50 es amarillo; 40 % es naranja', () => {
    const amarillo = evaluarRiesgo(senales({ ultimos: { enviados: 50, fallidos: 10, porCodigo: {} } }), U, 'cloud', PAUSA);
    expect(amarillo.nivel).toBe('amarillo');
    const naranja = evaluarRiesgo(senales({ ultimos: { enviados: 50, fallidos: 20, porCodigo: {} } }), U, 'cloud', PAUSA);
    expect(naranja.nivel).toBe('naranja');
    expect(naranja.factor).toBe(0.2);
    expect(naranja.sinMarketing).toBe(true);
  });

  it('una lista sucia (muchos sin WhatsApp) suma con los fallos y llega a naranja', () => {
    const r = evaluarRiesgo(
      senales({ ultimos: { enviados: 50, fallidos: 10, porCodigo: { '131026': 10 } } }),
      U,
      'cloud',
      PAUSA,
    );
    // 40 (fallos) + 30 (lista sucia) = 70
    expect(r.puntos).toBe(70);
    expect(r.nivel).toBe('naranja');
    expect(r.motivos.some((m) => /sin WhatsApp/.test(m))).toBe(true);
  });

  it('las bajas del dia pesan: 2 % amarillo, 5 % rojo junto con otras senales', () => {
    const base = { enviados: 100, entregados: 90, enviadosMaduros: 0, entregadosMaduros: 0, entrantes: 30, quejas: 0, porCodigo: {} };
    const pocas = evaluarRiesgo(senales({ dia: { ...base, bajas: 2 } }), U, 'cloud', PAUSA);
    expect(pocas.nivel).toBe('amarillo');
    const muchas = evaluarRiesgo(senales({ dia: { ...base, bajas: 6 } }), U, 'cloud', PAUSA);
    expect(muchas.puntos).toBe(60);
  });

  it('lo enviado hace mas de una hora que no consta entregado es senal de que algo no llega', () => {
    const r = evaluarRiesgo(
      senales({
        dia: { enviados: 60, entregados: 20, enviadosMaduros: 40, entregadosMaduros: 10, bajas: 0, entrantes: 5, quejas: 0, porCodigo: {} },
      }),
      U,
      'cloud',
      PAUSA,
    );
    expect(r.motivos.some((m) => /consta como entregado/.test(m))).toBe(true);
    expect(r.puntos).toBe(40);
  });

  it('en no oficial, muchos salientes por cada entrante parece un robot', () => {
    const dia = { enviados: 200, entregados: 190, enviadosMaduros: 0, entregadosMaduros: 0, bajas: 0, entrantes: 5, quejas: 0, porCodigo: {} };
    const bot = evaluarRiesgo(senales({ dia }), POLITICA_NO_OFICIAL.umbrales, 'no_oficial', PAUSA);
    expect(bot.motivos.some((m) => /robot/.test(m))).toBe(true);
    const meta = evaluarRiesgo(senales({ dia }), U, 'cloud', PAUSA);
    expect(meta.puntos).toBe(0);
  });

  it('los rechazos por velocidad de los ultimos 10 minutos frenan', () => {
    const r = evaluarRiesgo(senales({ reciente: { porCodigo: { '130429': 2 } } }), U, 'cloud', PAUSA);
    expect(r.puntos).toBe(20);
    expect(r.nivel).toBe('verde');
  });

  it('tres desconexiones en una hora y una cuenta saturada de marketing suman', () => {
    const r = evaluarRiesgo(
      senales({ hora: { fallidos: 8, porCodigo: { '131049': 6 }, desconexiones: 3 } }),
      U,
      'cloud',
      PAUSA,
    );
    expect(r.puntos).toBe(50);
    expect(r.nivel).toBe('amarillo');
  });

  it('los niveles cortan en 30, 60 y 85', () => {
    expect(nivelDe(29)).toBe('verde');
    expect(nivelDe(30)).toBe('amarillo');
    expect(nivelDe(60)).toBe('naranja');
    expect(nivelDe(85)).toBe('rojo');
  });

  it('la rampa vuelve en cinco tramos: 10, 25, 50, 75 y 100 %', () => {
    const inicio = new Date('2026-03-10T10:00:00Z');
    const dos = 2 * 60 * 60 * 1000;
    const en = (min: number) => new Date(inicio.getTime() + min * 60_000);
    expect(factorDeRampa(inicio, en(0), dos)).toBe(0.1);
    expect(factorDeRampa(inicio, en(30), dos)).toBe(0.25);
    expect(factorDeRampa(inicio, en(60), dos)).toBe(0.5);
    expect(factorDeRampa(inicio, en(90), dos)).toBe(0.75);
    expect(factorDeRampa(inicio, en(120), dos)).toBe(1);
  });
});

function foto(overrides: Partial<FotoRitmo> = {}): FotoRitmo {
  return {
    ahora: NOW,
    factor: 1,
    ultimoMinuto: 0,
    ultimaHora: 0,
    ultimoEnvioAt: null,
    pausaSorteadaMs: 3000,
    destinatariosUnicos24h: 0,
    limiteTier: null,
    nuevosContactosHoy: 0,
    esContactoNuevo: false,
    ...overrides,
  };
}

describe('marcapasos: cuando puede salir el siguiente', () => {
  it('con todo en orden deja pasar', () => {
    expect(decidirRitmo(foto(), POLITICA_CLOUD)).toEqual({ ok: true });
  });

  it('fuera del horario del negocio no sale nada y dice cuanto falta', () => {
    const madrugada = new Date('2026-03-10T08:00:00Z'); // 03:00 en Lima
    const d = decidirRitmo(foto({ ahora: madrugada }), POLITICA_CLOUD);
    expect(d.ok).toBe(false);
    if (!d.ok) {
      expect(d.codigo).toBe('fuera_de_horario');
      // Abre a las 9:00 de Lima = 14:00Z: seis horas.
      expect(d.esperaMs).toBe(6 * 60 * 60 * 1000);
    }
  });

  it('el domingo no se envia aunque sea mediodia', () => {
    const domingo = new Date('2026-03-08T17:00:00Z');
    expect(enHorario(domingo, POLITICA_CLOUD)).toBe(false);
    expect(msHastaApertura(domingo, POLITICA_CLOUD)).toBeGreaterThan(12 * 60 * 60 * 1000);
    expect(enHorario(domingo, { ...POLITICA_CLOUD, diasPermitidos: [0, 1, 2, 3, 4, 5, 6] })).toBe(true);
  });

  it('con el factor a cero esta parado', () => {
    const d = decidirRitmo(foto({ factor: 0 }), POLITICA_CLOUD);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.codigo).toBe('riesgo_parado');
  });

  it('se para al 90 % del tier de Meta, contando destinatarios unicos en 24 h', () => {
    const ok = decidirRitmo(foto({ limiteTier: 1000, destinatariosUnicos24h: 899 }), POLITICA_CLOUD);
    expect(ok.ok).toBe(true);
    const tope = decidirRitmo(foto({ limiteTier: 1000, destinatariosUnicos24h: 900 }), POLITICA_CLOUD);
    expect(tope.ok).toBe(false);
    if (!tope.ok) expect(tope.codigo).toBe('tier_24h');
    // Sin tier conocido (cliente no oficial) no aplica.
    expect(decidirRitmo(foto({ limiteTier: null, destinatariosUnicos24h: 5000 }), POLITICA_NO_OFICIAL).ok).toBe(true);
  });

  it('los cupos por minuto y por hora se escalan con el factor', () => {
    expect(decidirRitmo(foto({ ultimoMinuto: 19 }), POLITICA_CLOUD).ok).toBe(true);
    const minuto = decidirRitmo(foto({ ultimoMinuto: 20 }), POLITICA_CLOUD);
    expect(minuto.ok).toBe(false);
    if (!minuto.ok) expect(minuto.codigo).toBe('cupo_minuto');

    // En amarillo (0.5) el cupo del minuto es 10.
    const amarillo = decidirRitmo(foto({ ultimoMinuto: 10, factor: 0.5 }), POLITICA_CLOUD);
    expect(amarillo.ok).toBe(false);

    const hora = decidirRitmo(foto({ ultimaHora: 400 }), POLITICA_CLOUD);
    expect(hora.ok).toBe(false);
    if (!hora.ok) expect(hora.codigo).toBe('cupo_hora');
  });

  it('en no oficial hay cupo de contactos nuevos por dia; en cloud no', () => {
    const lleno = foto({ esContactoNuevo: true, nuevosContactosHoy: 80 });
    const d = decidirRitmo(lleno, POLITICA_NO_OFICIAL);
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.codigo).toBe('nuevos_contactos_dia');
    // Un contacto conocido no gasta ese cupo.
    expect(decidirRitmo(foto({ esContactoNuevo: false, nuevosContactosHoy: 80 }), POLITICA_NO_OFICIAL).ok).toBe(true);
    expect(decidirRitmo(lleno, POLITICA_CLOUD).ok).toBe(true);
  });

  it('respeta la pausa sorteada desde el ultimo envio, estirada por el factor', () => {
    const hace2s = new Date(NOW.getTime() - 2000);
    const pronto = decidirRitmo(foto({ ultimoEnvioAt: hace2s, pausaSorteadaMs: 3000 }), POLITICA_CLOUD);
    expect(pronto.ok).toBe(false);
    if (!pronto.ok) {
      expect(pronto.codigo).toBe('pausa_entre_envios');
      expect(pronto.esperaMs).toBe(1000);
    }
    const hace4s = new Date(NOW.getTime() - 4000);
    expect(decidirRitmo(foto({ ultimoEnvioAt: hace4s, pausaSorteadaMs: 3000 }), POLITICA_CLOUD).ok).toBe(true);
    // Con factor 0.5 la misma pausa dura el doble: 6 s.
    expect(decidirRitmo(foto({ ultimoEnvioAt: hace4s, pausaSorteadaMs: 3000, factor: 0.5 }), POLITICA_CLOUD).ok).toBe(false);
  });

  it('la pausa sorteada cae dentro del rango y se concentra en el centro', () => {
    const valores = Array.from({ length: 500 }, () => sortearPausa(15_000, 45_000));
    expect(Math.min(...valores)).toBeGreaterThanOrEqual(15_000);
    expect(Math.max(...valores)).toBeLessThanOrEqual(45_000);
    const media = valores.reduce((a, b) => a + b, 0) / valores.length;
    expect(media).toBeGreaterThan(25_000);
    expect(media).toBeLessThan(35_000);
    // Con azar fijo es determinista.
    expect(sortearPausa(1000, 3000, () => 0.5)).toBe(2000);
  });

  it('el marcapasos recuerda los envios del ultimo minuto y de la ultima hora', () => {
    const m = new Marcapasos(() => POLITICA_CLOUD, () => 0.5);
    const t0 = NOW;
    m.anotar(t0);
    m.anotar(new Date(t0.getTime() + 10_000));
    m.anotar(new Date(t0.getTime() + 50_000));
    const t1 = new Date(t0.getTime() + 65_000);
    expect(m.enUltimoMinuto(t1)).toBe(2);
    expect(m.enUltimaHora(t1)).toBe(3);
    expect(m.ultimoEnvioAt()?.getTime()).toBe(t0.getTime() + 50_000);
    // La pausa sorteada con azar 0.5 es el centro del rango.
    expect(m.pausaSorteadaMs()).toBe(4000);
    expect(m.proximoEnvioEn(new Date(t0.getTime() + 51_000), 1)).toBe(3000);
    expect(m.proximoEnvioEn(new Date(t0.getTime() + 51_000), 0.5)).toBe(7000);
    // Una hora despues ya no queda nada en la ventana.
    expect(m.enUltimaHora(new Date(t0.getTime() + 2 * 60 * 60 * 1000))).toBe(0);
  });

  it('sembrar el ultimo envio tras un reinicio no pisa uno mas reciente', () => {
    const m = new Marcapasos(() => POLITICA_CLOUD);
    m.sembrar(new Date('2026-03-10T14:00:00Z'));
    expect(m.ultimoEnvioAt()?.toISOString()).toBe('2026-03-10T14:00:00.000Z');
    m.anotar(new Date('2026-03-10T14:30:00Z'));
    m.sembrar(new Date('2026-03-10T14:10:00Z'));
    expect(m.ultimoEnvioAt()?.toISOString()).toBe('2026-03-10T14:30:00.000Z');
  });
});

describe('politica: perfiles y variables', () => {
  const base = {
    PUBLIC_BASE_URL: 'https://ejemplo.test',
    DATABASE_URL: 'postgres://x/y',
    ADMIN_TOKEN: 'admin-token-largo-1234',
    TRACKING_SECRET: 'x'.repeat(40),
  };

  it('el perfil sale del proveedor salvo que se fuerce', () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    expect(politicaDesdeConfig(config, 'cloud').perfil).toBe('cloud');
    expect(politicaDesdeConfig(config, 'no_oficial').perfil).toBe('no_oficial');
    const forzada = loadConfig({ ...base, RITMO_PERFIL: 'no_oficial' } as NodeJS.ProcessEnv);
    expect(politicaDesdeConfig(forzada, 'cloud').perfil).toBe('no_oficial');
  });

  it('el perfil no oficial es el lento: menos por minuto, warm-up desde 20 y escritura simulada', () => {
    const config = loadConfig(base as NodeJS.ProcessEnv);
    const p = politicaDesdeConfig(config, 'no_oficial');
    expect(p.maxPorMinuto).toBeLessThan(POLITICA_CLOUD.maxPorMinuto);
    expect(p.warmup.startPerDay).toBe(20);
    expect(p.humanizar).toBe(true);
    expect(p.nuevosContactosPorDia).toBeGreaterThan(0);
    expect(politicaDesdeConfig(config, 'cloud').warmup.startPerDay).toBe(50);
  });

  it('las variables del .env pisan al perfil, y un maximo menor que el minimo se corrige', () => {
    const config = loadConfig({
      ...base,
      RITMO_MAX_POR_MINUTO: '3',
      RITMO_PAUSA_MIN_SEG: '20',
      RITMO_PAUSA_MAX_SEG: '5',
      HORARIO_ENVIO_INICIO: '8',
      HORARIO_ENVIO_DIAS: '1,2,3,4,5',
      WARMUP_START_PER_DAY: '10',
      SALUD_MAX_BAJAS_PCT: '1',
      RUTAS_SUPERVISOR: '51999999999',
    } as NodeJS.ProcessEnv);
    const p = politicaDesdeConfig(config, 'cloud');
    expect(p.maxPorMinuto).toBe(3);
    expect(p.pausaMinMs).toBe(20_000);
    expect(p.pausaMaxMs).toBe(20_000);
    expect(p.horaInicio).toBe(8);
    expect(p.diasPermitidos).toEqual([1, 2, 3, 4, 5]);
    expect(p.warmup.startPerDay).toBe(10);
    expect(p.umbrales.maxBajasPct).toBe(1);
    expect(p.avisarA).toBe('51999999999');
  });

  it('traduce el nombre del tier a su limite', () => {
    expect(limiteDelTier('TIER_250')).toBe(250);
    expect(limiteDelTier('TIER_1K')).toBe(1000);
    expect(limiteDelTier('TIER_10K')).toBe(10_000);
    expect(limiteDelTier('TIER_100K')).toBe(100_000);
    expect(limiteDelTier('TIER_UNLIMITED')).toBe(Number.POSITIVE_INFINITY);
    expect(limiteDelTier('TIER_NOT_SET')).toBeNull();
    expect(limiteDelTier(null)).toBeNull();
  });
});

describe('supresion: que hacer con cada codigo', () => {
  it('reconoce el codigo de Meta como numero y dentro del texto', () => {
    expect(codigoDeError(131026, 'x')).toBe('131026');
    expect(codigoDeError(undefined, 'Meta respondio: (#131049) message not delivered')).toBe('131049');
    expect(codigoDeError(undefined, 'sin nada')).toBeNull();
  });

  it('reconoce los errores de texto del cliente no oficial', () => {
    expect(codigoDeError(undefined, 'jid item-not-found')).toBe('131026');
    expect(codigoDeError(undefined, 'rate-overlimit')).toBe('429');
    expect(codigoDeError(undefined, 'Forbidden')).toBe('403');
  });

  it('131026 aparta un mes del todo; 131049 un dia solo de marketing; 130429 solo frena', () => {
    const sinWa = reglaDeSupresion(131026, '')!;
    expect(sinWa.ambito).toBe('todo');
    expect(sinWa.duracionMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(sinWa.incidencia).toBe('sin_whatsapp');

    const saturado = reglaDeSupresion(131049, '')!;
    expect(saturado.ambito).toBe('marketing');
    expect(saturado.duracionMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);

    const velocidad = reglaDeSupresion(130429, '')!;
    expect(velocidad.duracionMs).toBe(0);
    expect(velocidad.global).toBe('lento');

    expect(reglaDeSupresion(131048, '')!.global).toBe('rojo');
    expect(reglaDeSupresion(undefined, 'cualquier cosa')).toBeNull();
  });

  it('un contacto apartado de marketing sigue recibiendo lo transaccional', () => {
    const hasta = new Date(NOW.getTime() + 60_000);
    const c = { suprimidoHasta: hasta, suprimidoAmbito: 'marketing' as const };
    expect(contactoSuprimido(c, 'MARKETING', NOW)).toBe(true);
    expect(contactoSuprimido(c, 'UTILITY', NOW)).toBe(false);
    expect(contactoSuprimido({ ...c, suprimidoAmbito: 'todo' }, 'UTILITY', NOW)).toBe(true);
    // Vencida, no cuenta.
    expect(contactoSuprimido({ suprimidoHasta: new Date(NOW.getTime() - 1), suprimidoAmbito: 'todo' }, 'UTILITY', NOW)).toBe(false);
  });
});

describe('variantes: no mandar siempre lo mismo', () => {
  it('la semilla es estable y reparte', () => {
    expect(semilla('51987654321:0')).toBe(semilla('51987654321:0'));
    expect(semilla('a')).not.toBe(semilla('b'));
    const opciones = ['a', 'b', 'c'];
    const elegidas = new Set(Array.from({ length: 60 }, (_, i) => elegirVariante(opciones, `tel${i}:0`)));
    expect(elegidas.size).toBe(3);
    expect(elegirVariante(opciones, 'x')).toBe(elegirVariante(opciones, 'x'));
  });

  it('elige la plantilla aprobada, no pausada, de mejor calidad y menos usada', () => {
    const a = approvedTemplate({ name: 'a', quality: 'GREEN' });
    const b = approvedTemplate({ name: 'b', quality: 'GREEN' });
    const criterios = { ahora: NOW, uso24h: { a: 10, b: 2 }, plantillaNuevaDias: 0, plantillaNuevaPorDia: 0 };
    expect(elegirPlantilla([a, b], criterios).plantilla?.name).toBe('b');

    const pausada = approvedTemplate({ name: 'b', quality: 'GREEN', pausadaHasta: new Date(NOW.getTime() + 60_000) });
    const eleccion = elegirPlantilla([a, pausada], criterios);
    expect(eleccion.plantilla?.name).toBe('a');
    expect(eleccion.descartes[0]).toMatchObject({ name: 'b' });

    const roja = approvedTemplate({ name: 'a', quality: 'RED' });
    expect(elegirPlantilla([roja, b], criterios).plantilla?.name).toBe('b');

    const amarilla = approvedTemplate({ name: 'a', quality: 'YELLOW' });
    const desconocida = approvedTemplate({ name: 'b', quality: null });
    expect(elegirPlantilla([amarilla, desconocida], { ...criterios, uso24h: {} }).plantilla?.name).toBe('b');

    const pendiente = approvedTemplate({ name: 'a', status: 'PENDING' });
    expect(elegirPlantilla([pendiente], criterios).plantilla).toBeNull();
  });

  it('una plantilla recien aprobada tiene cupo diario (pacing propio)', () => {
    const nueva = approvedTemplate({ name: 'nueva', quality: null, aprobadaAt: new Date(NOW.getTime() - 60 * 60 * 1000) });
    const vieja = approvedTemplate({ name: 'vieja', quality: 'GREEN', aprobadaAt: new Date('2025-01-01') });
    const criterios = { ahora: NOW, uso24h: { nueva: 100, vieja: 300 }, plantillaNuevaDias: 3, plantillaNuevaPorDia: 100 };
    const eleccion = elegirPlantilla([nueva, vieja], criterios);
    expect(eleccion.plantilla?.name).toBe('vieja');
    expect(eleccion.descartes[0]?.motivo).toMatch(/recien aprobada/);
    expect(elegirPlantilla([nueva, vieja], { ...criterios, uso24h: { nueva: 99, vieja: 300 } }).plantilla?.name).toBe('vieja');
  });
});

describe('escritura humana', () => {
  it('la duracion crece con el texto y respeta las cotas', () => {
    const azar = () => 0.5;
    const corto = duracionEscritura('Hola', { azar });
    const largo = duracionEscritura('x'.repeat(400), { azar });
    expect(corto).toBeGreaterThanOrEqual(1200);
    expect(corto).toBeLessThan(3000);
    expect(largo).toBe(9000);
    const medio = duracionEscritura('x'.repeat(15), { azar });
    expect(medio).toBeGreaterThan(corto);
    expect(medio).toBeLessThan(largo);
  });

  it('normal() da una campana centrada en cero', () => {
    let seed = 1;
    const azar = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const muestras = Array.from({ length: 2000 }, () => normal(azar));
    const media = muestras.reduce((a, b) => a + b, 0) / muestras.length;
    expect(Math.abs(media)).toBeLessThan(0.1);
  });

  it('avisa que escribe, espera, avisa que paro y entonces envia; un fallo del aviso no frena el envio', async () => {
    const pasos: string[] = [];
    const teclado = {
      escribiendo: async () => {
        pasos.push('composing');
      },
      parado: async () => {
        pasos.push('paused');
        throw new Error('el socket no quiso');
      },
    };
    const dormido: number[] = [];
    const r = await escribirComoHumano(teclado, 'hola que tal', async () => {
      pasos.push('enviado');
      return 42;
    }, { dormir: async (ms) => { dormido.push(ms); }, azar: () => 0.5 });
    expect(r).toBe(42);
    expect(pasos).toEqual(['composing', 'paused', 'enviado']);
    expect(dormido[0]).toBeGreaterThanOrEqual(1200);
  });
});
