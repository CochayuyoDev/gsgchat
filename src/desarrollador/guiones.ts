/**
 * Conversaciones completas de prueba: un cliente de prueba y su motorizado de
 * prueba hablan con el sistema de principio a fin, solos, y en cada paso se
 * comprueba que el sistema hizo y contesto lo que tenia que hacer.
 *
 * Es lo que se veria en el WhatsApp de un cliente de verdad (pregunta en
 * cuanto llega, por donde va, reclama que no llega...), pero todo con los
 * numeros reservados: nada sale al WhatsApp real (ver numeros.ts).
 *
 * Cada paso entra por la MISMA ruta que el chat simulado de la pestaña
 * (/admin/desarrollador/vivo/escribir), asi que la conversacion y su traza se
 * ven luego en esa pestaña como si se hubieran escrito a mano.
 */

import type { FastifyInstance } from 'fastify';
import type { DepsDesarrollador } from './seccion.js';
import { generarPrueba } from './generar.js';
import { esMotorizadoDePrueba, PREFIJO_REFERENCIA_PRUEBA } from './numeros.js';

const sinTildes = (t: string): string => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();

type Quien = 'cliente' | 'motorizado';

interface Espera {
  /** El pedido debe quedar en uno de estos estados. */
  estado?: string[];
  /** Lo ultimo que se le dijo a ese numero (cliente o motorizado) debe decir esto. */
  respuesta?: RegExp;
  /** Lo mismo, escrito por una persona: se compara sin tildes ni mayusculas. */
  contiene?: string;
  /** En palabras, para la pantalla. */
  que: string;
}

type Paso =
  | { tipo: 'escribe'; quien: Quien; dice: { tipo: 'texto' | 'pin' | 'enlace' | 'foto' | 'audio' | 'boton'; texto?: string; boton?: { id: string; title: string } }; espera?: Espera; pausaMs?: number }
  | { tipo: 'esperar_motorizado'; espera?: Espera }
  /** minutos fijos, o 'pasada_la_hora': lo justo para que la hora de llegada quede 45 min atras. */
  | { tipo: 'adelantar'; minutos: number | 'pasada_la_hora'; que: string };

export interface Guion {
  id: string;
  titulo: string;
  resumen: string;
  /** Como llega el pedido: sin pin (falta ubicacion) o con pin (falta confirmar). */
  inicio: 'sin_pin' | 'con_pin';
  pasos: Paso[];
}

const cli = (texto: string, espera?: Espera): Paso => ({ tipo: 'escribe', quien: 'cliente', dice: { tipo: 'texto', texto }, espera });
const mot = (texto: string, espera?: Espera): Paso => ({ tipo: 'escribe', quien: 'motorizado', dice: { tipo: 'texto', texto }, espera });

/** Estados en los que el pedido ya esta con un motorizado o por salir. */
const CON_MOTORIZADO = ['lista', 'esperando_motorizado', 'avisada'];

export const GUIONES: Guion[] = [
  {
    id: 'curioso',
    titulo: 'Pregunta en cuánto llega y por dónde va',
    resumen: 'Pregunta por su pedido antes de dar la ubicación, la manda, confirma, y mientras el motorizado va en camino pregunta en cuánto llega y por dónde va. Termina entregado.',
    inicio: 'sin_pin',
    pasos: [
      cli('Hola, ¿cuándo llega mi pedido?', { respuesta: /ubicaci/i, que: 'le pide la ubicación' }),
      { tipo: 'escribe', quien: 'cliente', dice: { tipo: 'pin' }, espera: { estado: ['esperando_confirmacion'], respuesta: /Ubicación registrada/, que: 'registra la ubicación y pregunta si lo recibe hoy' } },
      cli('Sí, lo recibo hoy', { estado: CON_MOTORIZADO, respuesta: /confirmado/i, que: 'lo da por confirmado' }),
      { tipo: 'esperar_motorizado', espera: { estado: ['esperando_motorizado'], que: 'el pedido le llega a un motorizado de prueba' } },
      cli('¿En cuánto llega mi pedido?', { respuesta: /motorizado/i, que: 'dice que ya está con un motorizado y que le avisará la hora' }),
      mot('40', { estado: ['avisada'], que: 'el motorizado da su tiempo y al cliente se le avisa la hora' }),
      cli('¿Por dónde va el motorizado?', { respuesta: /va en camino[\s\S]*alrededor de las/i, que: 'dice que va en camino y a qué hora llega' }),
      mot('Estoy cerca, llego en 5', { estado: ['avisada'], que: 'el motorizado avisa que está cerca' }),
      cli('¿Dónde está el motorizado?', { respuesta: /está cerca/i, que: 'dice que ya está cerca' }),
      mot('Entregado', { estado: ['entregada'], que: 'el motorizado lo entrega' }),
      cli('¿Ya entregaron mi pedido?', { estado: ['entregada'], respuesta: /entregado/i, que: 'confirma que figura entregado' }),
    ],
  },
  {
    id: 'impaciente',
    titulo: 'Pasa la hora y no llega',
    resumen: 'Confirma, el motorizado da 20 minutos, el cliente pregunta la hora; pasa una hora y reclama que no llega: el pedido queda para una persona.',
    inicio: 'con_pin',
    pasos: [
      cli('Sí, lo recibo hoy', { estado: CON_MOTORIZADO, que: 'lo da por confirmado' }),
      { tipo: 'esperar_motorizado', espera: { estado: ['esperando_motorizado'], que: 'el pedido le llega a un motorizado de prueba' } },
      mot('20', { estado: ['avisada'], que: 'el motorizado da su tiempo' }),
      cli('¿A qué hora llega?', { respuesta: /alrededor de las/i, que: 'le dice la hora de llegada' }),
      // Al tiempo del motorizado se le suma el margen (1 h por defecto): se adelanta lo justo para que la hora prometida quede atras.
      { tipo: 'adelantar', minutos: 'pasada_la_hora', que: 'pasa la hora que se le prometió, y 45 minutos más (solo para este pedido)' },
      cli('Ya pasó la hora y no llega nada', { estado: ['incidencia'], respuesta: /demora/i, que: 'pide disculpas y lo pasa a una persona' }),
    ],
  },
  {
    id: 'no_estaba',
    titulo: 'No estaba en casa: vuelven hoy',
    resumen: 'El motorizado llega y no hay nadie; al cliente se le pregunta si vuelven hoy, dice que sí, y el mismo motorizado vuelve y lo entrega.',
    inicio: 'con_pin',
    pasos: [
      cli('Sí, lo recibo hoy', { estado: CON_MOTORIZADO, que: 'lo da por confirmado' }),
      { tipo: 'esperar_motorizado', espera: { estado: ['esperando_motorizado'], que: 'el pedido le llega a un motorizado de prueba' } },
      mot('30', { estado: ['avisada'], que: 'el motorizado da su tiempo' }),
      mot('No estaba nadie, no abrieron', { estado: ['incidencia'], que: 'queda como «no se pudo entregar» y al cliente se le pregunta si vuelven hoy' }),
      cli('Sí, vuelvan hoy por favor, ya estoy en casa', { estado: [...CON_MOTORIZADO], que: 'se le vuelve a mandar al motorizado' }),
      { tipo: 'esperar_motorizado', espera: { estado: ['esperando_motorizado', 'avisada'], que: 'el motorizado lo tiene otra vez' } },
      mot('15', { estado: ['avisada'], que: 'da su tiempo para la segunda visita' }),
      mot('Entregado', { estado: ['entregada'], que: 'lo entrega' }),
    ],
  },
  {
    id: 'manana',
    titulo: 'Lo cambia para mañana',
    resumen: 'Tiene la ubicación dada, pero cuando se le pregunta si lo recibe hoy dice que mejor mañana.',
    inicio: 'con_pin',
    pasos: [cli('Hoy no puedo, mejor mañana', { estado: ['cancelada', 'terminada', 'incidencia'], que: 'no sale hoy: queda apartado y GSG se entera' })],
  },
  {
    id: 'cancela',
    titulo: 'Ya no lo quiere',
    resumen: 'Cuando se le pregunta si lo recibe hoy, dice que ya no lo quiere.',
    inicio: 'con_pin',
    pasos: [cli('Ya no lo quiero, cancélenlo', { estado: ['cancelada', 'terminada', 'incidencia'], que: 'no sale: queda cancelado o para una persona, y GSG se entera' })],
  },
];

export interface ResultadoPaso {
  n: number;
  quien: Quien | 'sistema';
  dijo: string;
  esperado: string;
  ok: boolean;
  estado: string | null;
  /** Lo ultimo que el sistema le dijo a ese numero. */
  respuesta: string | null;
  motivo?: string;
}

export interface ResultadoGuion {
  guion: string;
  titulo: string;
  telefono: string | null;
  referencia: string | null;
  ok: boolean;
  pasos: ResultadoPaso[];
  error?: string;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface ContextoGuion {
  app: FastifyInstance;
  deps: DepsDesarrollador;
  /** La cookie de quien lo lanza: los pasos entran con su identidad. */
  cookie: string;
  quien: string | null;
}

/** Corre un guion con un cliente de prueba NUEVO. */
export async function correrGuion(ctx: ContextoGuion, guion: Guion): Promise<ResultadoGuion> {
  const { app, deps } = ctx;
  const db = deps.repos.desarrollador;
  const res: ResultadoGuion = { guion: guion.id, titulo: guion.titulo, telefono: null, referencia: null, ok: false, pasos: [] };
  if (!db || !deps.entregas) return { ...res, error: 'Hace falta la base de la tienda y las entregas del día.' };

  // Que haya al menos un motorizado de prueba activo: el pedido de prueba solo va a uno de prueba.
  const motos = (await deps.entregas.motorizados()).filter((m) => esMotorizadoDePrueba(m.phone) && m.estado === 'activo');
  await generarPrueba(app, deps, { faltaConfirmar: guion.inicio === 'con_pin' ? 1 : 0, faltaUbicacion: guion.inicio === 'sin_pin' ? 1 : 0, motorizados: motos.length ? 0 : 1 }, ctx.quien);
  const [nuevo] = (await db.query<{ id: number; phone: string; referencia: string }>(`select id, phone, referencia from entregas where referencia like $1 order by id desc limit 1`, [`${PREFIJO_REFERENCIA_PRUEBA}%`])).rows;
  if (!nuevo) return { ...res, error: 'No se pudo crear el cliente de prueba.' };
  res.telefono = nuevo.phone;
  res.referencia = nuevo.referencia;

  const entrega = async () => deps.repos.entregas.entrega(nuevo.id);
  const ultimaA = async (telefono: string): Promise<{ id: number; body: string } | null> => {
    const [m] = (await db.query<{ id: number; body: string | null }>(
      `select m.id, m.body from messages m join contacts c on c.id = m.contact_id where c.phone = $1 and m.direction = 'out' order by m.created_at desc, m.id desc limit 1`,
      [telefono],
    )).rows;
    return m ? { id: Number(m.id), body: m.body ?? '' } : null;
  };
  const telefonoDelMotorizado = async (): Promise<string | null> => {
    const e = await entrega();
    if (!e?.motorizadoId) return null;
    return (await deps.repos.entregas.motorizado(e.motorizadoId))?.phone ?? null;
  };
  const escribir = async (telefono: string, dice: Extract<Paso, { tipo: 'escribe' }>['dice']) => {
    const r = await app.inject({
      method: 'POST',
      url: '/admin/desarrollador/vivo/escribir',
      headers: { cookie: ctx.cookie, 'content-type': 'application/json' },
      payload: JSON.stringify({ telefono, ...dice }),
    });
    if (r.statusCode >= 400) throw new Error(`no se pudo escribir como ${telefono}: ${r.body.slice(0, 200)}`);
  };

  /** Espera (hasta `ms`) a que se cumpla lo esperado; el motor trabaja cada pocos segundos. */
  const comprobar = async (espera: Espera | undefined, telefono: string, antes: number | null, ms: number): Promise<{ ok: boolean; estado: string | null; respuesta: string | null; motivo?: string }> => {
    const hasta = Date.now() + ms;
    let estado: string | null = null;
    let respuesta: string | null = null;
    for (;;) {
      estado = (await entrega())?.estado ?? null;
      const ult = await ultimaA(telefono);
      respuesta = ult && (antes === null || ult.id !== antes) ? ult.body : null;
      const estadoOk = !espera?.estado || (estado !== null && espera.estado.includes(estado));
      const respuestaOk =
        (!espera?.respuesta || (respuesta !== null && espera.respuesta.test(respuesta))) &&
        (!espera?.contiene || (respuesta !== null && sinTildes(respuesta).includes(sinTildes(espera.contiene))));
      // Sin nada que comprobar: se le dan unos segundos para contestar, y vale igual si calla.
      const sinComprobar = !espera?.estado && !espera?.respuesta && !espera?.contiene;
      if (sinComprobar && (respuesta !== null || Date.now() > hasta - (ms - 8_000))) return { ok: true, estado, respuesta };
      if (!sinComprobar && estadoOk && respuestaOk) return { ok: true, estado, respuesta };
      if (Date.now() > hasta) {
        const e = await entrega();
        const llega = e?.llegaAproxAt ? ` (la llegada prevista era ${e.llegaAproxAt.toISOString().slice(11, 16)} UTC)` : '';
        const motivo = (!estadoOk ? `el pedido quedó «${estado ?? 'sin pedido'}» y se esperaba ${espera!.estado!.map((x) => `«${x}»`).join(' o ')}` : `la respuesta no dice lo esperado`) + llega;
        return { ok: false, estado, respuesta, motivo };
      }
      await dormir(400);
    }
  };

  let n = 0;
  for (const paso of guion.pasos) {
    n++;
    try {
      if (paso.tipo === 'adelantar') {
        const antes = (await entrega())?.llegaAproxAt ?? null;
        const minutos = paso.minutos === 'pasada_la_hora' ? (antes ? Math.max(1, Math.ceil((antes.getTime() - Date.now()) / 60_000) + 45) : 60) : paso.minutos;
        const r = await db.query(
          `update entregas set llega_aprox_at = llega_aprox_at - make_interval(mins => $2::int),
                               aviso_enviado_at = aviso_enviado_at - make_interval(mins => $2::int)
            where id = $1`,
          [nuevo.id, minutos],
        );
        const despues = (await entrega())?.llegaAproxAt ?? null;
        const movido = Boolean(antes && despues && antes.getTime() - despues.getTime() >= minutos * 60_000 - 1000);
        res.pasos.push({
          n,
          quien: 'sistema',
          dijo: `⏩ ${paso.que} (${minutos} min)`,
          esperado: 'que el pedido «envejezca» ese tiempo',
          ok: movido,
          estado: (await entrega())?.estado ?? null,
          respuesta: null,
          motivo: movido ? undefined : `la hora de llegada no se movió (filas: ${r.rowCount}; antes ${antes?.toISOString() ?? 'sin hora'}, después ${despues?.toISOString() ?? 'sin hora'})`,
        });
        if (!movido) break;
        continue;
      }
      if (paso.tipo === 'esperar_motorizado') {
        const hasta = Date.now() + 60_000;
        let tel: string | null = null;
        while (!tel && Date.now() < hasta) {
          tel = await telefonoDelMotorizado();
          if (!tel) await dormir(500);
        }
        const c = tel ? await comprobar(paso.espera, tel, null, 20_000) : { ok: false, estado: (await entrega())?.estado ?? null, respuesta: null, motivo: 'en un minuto no se le mandó a ningún motorizado de prueba' };
        res.pasos.push({ n, quien: 'sistema', dijo: '⏳ Se espera a que un motorizado reciba el pedido', esperado: paso.espera?.que ?? '', ok: c.ok, estado: c.estado, respuesta: c.respuesta, motivo: c.motivo });
        if (!c.ok) break;
        continue;
      }
      // El motorizado solo puede escribir cuando ya tiene el pedido: se le espera un minuto.
      let telefono = paso.quien === 'cliente' ? nuevo.phone : await telefonoDelMotorizado();
      for (const hasta = Date.now() + 60_000; !telefono && paso.quien === 'motorizado' && Date.now() < hasta; ) {
        await dormir(500);
        telefono = await telefonoDelMotorizado();
      }
      if (!telefono) {
        res.pasos.push({ n, quien: paso.quien, dijo: paso.dice.texto ?? paso.dice.tipo, esperado: paso.espera?.que ?? '', ok: false, estado: (await entrega())?.estado ?? null, respuesta: null, motivo: 'en un minuto el pedido no llegó a ningún motorizado (¿el cliente ya dio la ubicación y confirmó?)' });
        break;
      }
      const antes = (await ultimaA(telefono))?.id ?? null;
      await escribir(telefono, paso.dice);
      const c = await comprobar(paso.espera, telefono, antes, 30_000);
      const dijo = paso.dice.tipo === 'pin' ? '📍 (manda su ubicación)' : paso.dice.tipo === 'enlace' ? '🔗 (manda un enlace de Maps)' : paso.dice.tipo === 'foto' ? '📷 (manda una foto)' : paso.dice.tipo === 'audio' ? `🎤 (audio: «${paso.dice.texto ?? ''}»)` : paso.dice.texto ?? '';
      res.pasos.push({ n, quien: paso.quien, dijo, esperado: paso.espera?.que ?? '(sin comprobación)', ok: c.ok, estado: c.estado, respuesta: c.respuesta, motivo: c.motivo });
      if (!c.ok) break;
      if (paso.pausaMs) await dormir(paso.pausaMs);
    } catch (error) {
      res.pasos.push({ n, quien: 'sistema', dijo: 'fallo', esperado: '', ok: false, estado: null, respuesta: null, motivo: error instanceof Error ? error.message : String(error) });
      break;
    }
  }
  res.ok = res.pasos.length === guion.pasos.length && res.pasos.every((p) => p.ok);
  return res;
}
