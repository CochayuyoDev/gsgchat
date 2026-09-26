/**
 * El flujo de GSG de punta a punta, SIN estados que se contradigan (regla del
 * dueño, 25/09). Es la matriz de pruebas del flujo que debe cumplirse siempre:
 *
 *  1. GSG manda la lista o una persona crea un «Pedido a mano».
 *  2. El sistema escribe PRIMERO: pide la ubicación (o SÍ/NO a «falta confirmar»).
 *  3. Sin el pin: «¿por qué?» → la explicación; la hora → la hora; otra cosa →
 *     hasta 3 insistencias y el cierre UNA vez (y a una persona); si no contesta
 *     nada, los recordatorios del reparto (los configurados) y a una persona.
 *  4. El pin → UBI REGISTRADA. Desde ahí NUNCA más se le pide la ubicación; el
 *     pedido va a un motorizado (sin motorizado NO es «necesita a alguien»); tras
 *     el agradecimiento, la hora si la pregunta y el cierre UNA vez ante otra cosa.
 *  5. El motorizado responde: al cliente no se le escribe; GSG se entera.
 *  6. Si una persona le escribe, lo que «necesitaba a alguien» queda atendido.
 *  7. La IA solo clasifica; lo que sale son textos fijos.
 *  +  El cierre antes del pin con motorizados activos: se le ASIGNA un
 *     motorizado sin ubicación antes del cierre (el número del cierre es el
 *     suyo) → «Esperando ubicación · con motorizado», no «necesita»; al
 *     motorizado le llega el texto fijo sin pin; sin recordatorios; su pin
 *     tardío sigue con el mismo. Sin motorizados: soporte y se asigna al haber uno.
 *  +  «No soy yo» (antes o después del pin, o en «falta confirmar»): el texto
 *     fijo UNA vez, «Necesita a alguien» con ese motivo, GSG se entera, y no se
 *     le vuelve a escribir.
 *  +  El pin tiene que tener sentido: lejos del distrito del pedido NO se
 *     registra a ciegas; se le pregunta UNA vez (SÍ/NO): SÍ → UBI REGISTRADA,
 *     NO → que mande la correcta, otra cosa dos veces → cuenta como SÍ.
 *  +  La dirección escrita no gasta insistencias: ubicada en su distrito →
 *     UBI REGISTRADA (aproximada); dudosa o sin red → anotada y se pide el pin.
 *  +  «Hay que mirar» en Hoy (y la campana): motorizado sin minutos (se
 *     reasigna solo si hay otro), sin ubicación a las 12:00, en camino tarde.
 *
 * En cada paso se comprueba que la entrega, la solicitud del reparto, la lista
 * de envío automático, «Números del día» (`etapaDe`), Hoy (`pasoDe` de la
 * pantalla) y lo que recibió el cliente cuadren entre sí.
 */

import { describe, expect, it } from 'vitest';
import { etapaDe } from '../src/entregas/numeros.js';
import { entregasPage } from '../src/web/entregas-page.js';
import { INSISTENCIAS_UBICACION, leerCategoria, CATEGORIAS_REGLA, CATEGORIAS_CONFIRMAR, promptClasificadorConfirmarGsg, promptClasificadorReglaGsg, clasificarReglaGsg } from '../src/ia/agente-operativo.js';
import { pareceNoSoyYo, TEXTO_NO_SOY_YO } from '../src/rutas/inbound.js';
import { OPCIONES_POR_DEFECTO } from '../src/rutas/motor.js';
import { ajustesPorDefecto } from '../src/rutas/ajustes.js';
import { crearServicioEnvioAutomatico } from '../src/envio-automatico/servicio.js';
import { crearMotorLista } from '../src/envio-automatico/motor.js';
import { PLANES } from '../src/rutas/telefono.js';
import { ErrorIA, type MensajeIA } from '../src/ia/proveedores.js';
import type { FilaEntrega } from '../src/entregas/servicio.js';
import { telefonoEnPalabras } from '../src/entregas/textos.js';
import { crearEscenarioEntregas, PAUSA_SEGUNDOS, PIN_LIMA, conPais, type EscenarioEntregas } from './escenario-entregas.js';
import type { Geocodificador, ResultadoGeo } from '../src/entregas/geocodificar.js';
import { TEXTOS_POR_DEFECTO } from '../src/entregas/textos.js';
import { FUENTE_DIRECCION_ESCRITA } from '../src/entregas/servicio.js';

/** Las 09:00 de Lima del último día que ya empezó. */
function hoyALas9(): Date {
  const d = new Date();
  d.setUTCHours(14, 0, 0, 0);
  if (d.getTime() > Date.now()) d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

/** Un número como sale en los textos al cliente («+51 987 654 321»). */
const numeroEnPalabras = (phone: string): string => telefonoEnPalabras(phone);
const REGISTRADA = /^✅ Ubicación registrada correctamente/;
const CIERRE = /^Por este canal no se reciben consultas/;
const HORA_SIN_PIN = /nos falta su ubicación/;
const EXPLICACION = 'Es necesaria para calcular la ruta exacta de entrega y coordinar con el motorizado.';
/** Cada cuánto recuerda el reparto en estas pruebas (en vez de 3 h). */
const ESPERA_MIN = 30;
const VIVAS = ['pendiente', 'enviado', 'respondio'];

// ---------------------------------------------------------------------------
// «Hoy» decide su chip con una función de la pantalla (JS del navegador): se
// usa LA MISMA, sacada de la página, para que la prueba no tenga su copia.
// ---------------------------------------------------------------------------
const pasoDeHoy: (f: FilaEntrega) => { clave: string; texto: string } = (() => {
  const html = entregasPage({ disponible: true, configured: true, demo: false, nombreNegocio: 'GSG' });
  const funcion = (nombre: string): string => {
    const i = html.indexOf(`function ${nombre}(`);
    if (i < 0) throw new Error(`la pantalla ya no tiene ${nombre}()`);
    let j = html.indexOf('{', i);
    let nivel = 0;
    for (; j < html.length; j++) {
      if (html[j] === '{') nivel++;
      else if (html[j] === '}' && --nivel === 0) break;
    }
    return html.slice(i, j + 1);
  };
  const fuente = ['esperaSegunda', 'laLlevaUnMotorizado', 'atendidaSinLiberar', 'pasoDe'].map(funcion).join('\n');
  return new Function(`${fuente}\nreturn pasoDe;`)() as (f: FilaEntrega) => { clave: string; texto: string };
})();

interface Foto {
  filas: FilaEntrega[];
  etapas: string[];
  pasos: string[];
  solicitudes: Awaited<ReturnType<EscenarioEntregas['repos']['rutas']['listarSolicitudes']>>;
  lista: Awaited<ReturnType<EscenarioEntregas['repos']['envioAutomatico']['porTelefono']>>;
}

async function foto(e: EscenarioEntregas, tel: string): Promise<Foto> {
  const phone = conPais(tel);
  const filas = (await e.entregas.resumen()).entregas.filter((f) => f.phone === phone);
  const solicitudes = (await e.repos.rutas.listarSolicitudes({ q: phone, limit: 50, offset: 0 })).filter((s) => s.phone === phone);
  const lista = await e.repos.envioAutomatico.porTelefono(phone);
  return { filas, etapas: filas.map((f) => etapaDe(f)), pasos: filas.map((f) => pasoDeHoy(f).clave), solicitudes, lista };
}

const pinDelCliente = (f: FilaEntrega): boolean => f.ubicacionEstado === 'recibida' && Boolean(f.ubicacionFuente) && f.ubicacionFuente !== 'gsg';

/**
 * Lo que tiene que cuadrar SIEMPRE, se mire por donde se mire:
 *  - «Necesita a alguien» en Números del día ⇔ en Hoy, y siempre con su motivo;
 *  - con el pin del cliente: ninguna solicitud del reparto viva, nada en la
 *    lista de envío automático pidiéndole la ubicación, y ni Números ni Hoy
 *    diciendo que falta la ubicación.
 */
async function coherente(e: EscenarioEntregas, tel: string, cuando: string): Promise<Foto> {
  const f = await foto(e, tel);
  for (const fila of f.filas) {
    const etapa = etapaDe(fila);
    const paso = pasoDeHoy(fila).clave;
    const donde = `${cuando} · ${fila.referencia} (estado ${fila.estado}, Números «${etapa}», Hoy «${paso}»)`;
    expect(etapa === 'necesita', `${donde}: «necesita a alguien» distinto en Números y en Hoy`).toBe(paso === 'alguien');
    if (etapa === 'necesita') expect((fila.incidenciaDetalle ?? '').trim(), `${donde}: «necesita a alguien» sin motivo`).not.toBe('');
    if (pinDelCliente(fila)) {
      expect(['falta_pedir', 'falta_ubicacion'], `${donde}: con su pin, Números dice que falta la ubicación`).not.toContain(etapa);
      expect(pasoDeHoy(fila).texto, `${donde}: con su pin, Hoy dice que espera la ubicación`).not.toBe('Esperando ubicación');
    }
  }
  if (f.filas.some(pinDelCliente)) {
    const vivas = f.solicitudes.filter((s) => VIVAS.includes(s.estado));
    expect(vivas.map((s) => `${s.referencia}:${s.estado}`), `${cuando}: con su pin, el reparto todavía se la pide`).toEqual([]);
    if (f.lista) expect(f.lista.que, `${cuando}: con su pin, la lista de envío automático se la sigue pidiendo`).not.toBe('ubicacion');
  }
  return f;
}

async function armar(opts: { motorizados?: boolean; ia?: boolean; geocodificador?: Geocodificador | null } = {}): Promise<EscenarioEntregas> {
  const e = await crearEscenarioEntregas({ arranque: hoyALas9(), agente: true, geocodificador: opts.geocodificador ?? null });
  await e.entregas.guardarAjustes({ soporte: { whatsapp: '987654321', llamadas: '' } });
  // Los recordatorios cada 30 min (3 mensajes como mucho), con el horario y la pausa del escenario.
  const base = ajustesPorDefecto({ ...OPCIONES_POR_DEFECTO, pausaMinSegundos: PAUSA_SEGUNDOS, pausaMaxSegundos: PAUSA_SEGUNDOS, horaInicio: 0, horaFin: 24 });
  await e.repos.rutas.ajustes.set({ esperaRespuestaMinutos: ESPERA_MIN, maxIntentos: 3 }, base);
  if (opts.motorizados !== false) await e.api.post('/admin/motorizados/de-prueba');
  expect(e.entregas.reglaGsgActiva()).toBe(true);
  return e;
}

/** Un «Pedido a mano» que falta la ubicación; el sistema escribe primero. */
async function pedidoAMano(e: EscenarioEntregas, tel: string, referencia: string, nombre = 'Cliente'): Promise<void> {
  const r = await e.entregas.crearAMano({ referencia, telefono: tel, nombre, faltaUbicacion: true, faltaConfirmacion: false }, 'prueba');
  expect(r.ok, `crear ${referencia}`).toBe(true);
  await e.trabajar();
}

/** Lo que salió hacia ese número desde `desde` (índice de mensajesA). */
const desde = (e: EscenarioEntregas, tel: string, i: number) => e.mensajesA(tel).slice(i).map((m) => ({ kind: String(m.kind), body: String(m.body ?? '') }));
const pideUbicacion = (m: { kind: string; body: string }) => m.kind === 'location_request';

/** Pasa el tiempo (en pasos de la espera del reparto) con los motores trabajando. */
async function pasan(e: EscenarioEntregas, minutos: number): Promise<void> {
  for (let hecho = 0; hecho < minutos; hecho += ESPERA_MIN + 1) {
    e.avanzar(ESPERA_MIN + 1);
    await e.trabajar();
  }
}

async function motorizadoDe(e: EscenarioEntregas, tel: string): Promise<string> {
  const f = (await foto(e, tel)).filas.find((x) => x.motorizado);
  expect(f?.motorizado, `${tel} tiene motorizado`).toBeTruthy();
  return f!.motorizado!.phone;
}

// ===========================================================================
// A) La ubicación registrada tiene UNA sola verdad
// ===========================================================================

describe('A. la ubicación registrada: una sola verdad, venga por donde venga', () => {
  it('caso real «ya mi amol»: la entrega ya tenía la ubicación y la solicitud seguía en «enviado» → el motor NO manda el recordatorio y la cierra; «yo no he pedido eso» → texto fijo, a una persona y silencio', async () => {
    const e = await armar();
    try {
      const tel = '912426667';
      await pedidoAMano(e, tel, 'ya mi amol', 'ya mi amol');
      expect(desde(e, tel, 0).filter(pideUbicacion)).toHaveLength(1);
      // Los datos tal como estaban en producción: ubicación registrada en
      // entregas (avisada), la solicitud del reparto abierta con 2 intentos.
      const fila = (await foto(e, tel)).filas[0]!;
      await e.repos.entregas.actualizar(fila.id, { ubicacionEstado: 'recibida', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng, ubicacionFuente: 'pin de whatsapp', ubicacionAt: e.ahora(), estado: 'avisada', motorizadoEstado: 'respondio', avisoEnviadoAt: e.ahora() });
      const s = (await foto(e, tel)).solicitudes[0]!;
      await e.repos.rutas.actualizarSolicitud(s.id, { estado: 'enviado', intentos: 2, proximoIntentoAt: null });
      const antes = e.mensajesA(tel).length;
      await pasan(e, 120);
      expect(desde(e, tel, antes).filter(pideUbicacion), 'el recordatorio «Le escribimos otra vez… nos falta su ubicación»').toEqual([]);
      const tras = await coherente(e, tel, 'tras la red de seguridad del reparto');
      expect(tras.solicitudes[0]!.estado).toBe('resuelto');

      await e.contesta(tel, { texto: 'yo no he pedido eso disculpa' });
      expect(desde(e, tel, antes)).toEqual([{ kind: 'text', body: TEXTO_NO_SOY_YO }]);
      const f = await coherente(e, tel, 'tras «no soy yo»');
      expect(f.etapas).toEqual(['necesita']);
      expect(f.filas[0]!.incidencia).toBe('no_soy_yo');
      expect(f.filas[0]!.incidenciaDetalle).toContain('yo no he pedido eso');
      // Y no se le vuelve a escribir: ni aunque escriba, ni aunque pasen horas.
      const n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'hola?' });
      await e.contesta(tel, { texto: 'no soy yo' });
      await pasan(e, 120);
      expect(e.mensajesA(tel)).toHaveLength(n);
      await coherente(e, tel, 'horas después del «no soy yo»');
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('la ubicación que llega a las entregas sin pasar por el reparto (sincronización/revisión) cierra YA la solicitud abierta: ningún recordatorio', async () => {
    const e = await armar();
    try {
      const tel = '987710002';
      await pedidoAMano(e, tel, 'A-2');
      const contacto = (await e.repos.contacts.getByPhone(conPais(tel)))!;
      const r = await e.entregas.alUbicacion(contacto, { lat: PIN_LIMA.lat, lng: PIN_LIMA.lng, fuente: 'reparto', yaReportada: false });
      expect(r.atendida).toBe(true);
      const f = await coherente(e, tel, 'justo después');
      expect(f.solicitudes.map((s) => s.estado)).toEqual(['resuelto']);
      const antes = e.mensajesA(tel).length;
      await pasan(e, 150);
      expect(desde(e, tel, antes).filter(pideUbicacion)).toEqual([]);
      await coherente(e, tel, 'pasadas las horas');
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('la ubicación puesta a mano desde el panel: la solicitud y la lista de envío automático la dan por resuelta; el pedido va a un motorizado', async () => {
    const e = await armar();
    try {
      const tel = '987710003';
      await pedidoAMano(e, tel, 'A-3');
      // Además estaba en la lista de envío automático (la puso el asistente).
      await e.repos.envioAutomatico.agregar({ phone: conPais(tel), que: 'ubicacion', hasta: 'ubicacion', origen: 'ia', nombre: 'Cliente' });
      const fila = (await foto(e, tel)).filas[0]!;
      await e.entregas.ponerUbicacion(fila.id, PIN_LIMA.lat, PIN_LIMA.lng, 'Rosa');
      const f = await coherente(e, tel, 'tras ponerla a mano');
      expect(f.lista).toBeNull();
      expect(f.solicitudes.map((s) => s.estado)).toEqual(['resuelto']);
      const antes = e.mensajesA(tel).length;
      await pasan(e, 100);
      expect(desde(e, tel, antes).filter(pideUbicacion)).toEqual([]);
      expect((await foto(e, tel)).filas[0]!.motorizado).toBeTruthy();
      await coherente(e, tel, 'con motorizado');
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('pin ANTES de cualquier recordatorio: UBI REGISTRADA, a un motorizado y nunca más se le pide; GSG recibe la ubicación', async () => {
    const e = await armar();
    try {
      const tel = '987710004';
      await pedidoAMano(e, tel, 'A-4');
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { pin: PIN_LIMA });
      const nuevos = desde(e, tel, antes);
      expect(nuevos).toHaveLength(1);
      expect(nuevos[0]!.body).toMatch(REGISTRADA);
      expect(nuevos[0]!.body).toContain('¡Muchas gracias!');
      await e.trabajar();
      const f = await coherente(e, tel, 'tras el pin');
      expect(f.filas[0]!.motorizado).toBeTruthy();
      expect(f.etapas).toEqual(['contactados']);
      expect(f.pasos).toEqual(['motorizado']);
      const n = e.mensajesA(tel).length;
      await pasan(e, 150);
      expect(e.mensajesA(tel)).toHaveLength(n);
      await e.despacharAGsg();
      expect(e.simulador.recibido.some((r) => r.tipo === 'ubicacion' && r.cuerpo.referencia === 'A-4')).toBe(true);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('pin DURANTE los recordatorios (tras el primero) y DESPUÉS de todos (ya pasado a una persona): se registra, deja de «necesitar a alguien» y no hay más recordatorios', async () => {
    const e = await armar();
    try {
      const durante = '987710005';
      const tarde = '987710006';
      await pedidoAMano(e, durante, 'A-5');
      await pedidoAMano(e, tarde, 'A-6');
      await pasan(e, ESPERA_MIN);
      expect(desde(e, durante, 0).filter(pideUbicacion)).toHaveLength(2);
      await e.contesta(durante, { pin: PIN_LIMA });
      await e.trabajar();
      await coherente(e, durante, 'pin tras un recordatorio');

      // El otro no contesta nada: los recordatorios configurados (3 mensajes) y a una persona.
      await pasan(e, ESPERA_MIN * 4);
      expect(desde(e, tarde, 0).filter(pideUbicacion)).toHaveLength(3);
      let f = await coherente(e, tarde, 'sin contestar tras los recordatorios');
      expect(f.etapas).toEqual(['necesita']);
      expect(f.pasos).toEqual(['alguien']);
      const antes = e.mensajesA(tarde).length;
      await e.contesta(tarde, { pin: PIN_LIMA });
      expect(desde(e, tarde, antes).map((m) => m.body)).toEqual([expect.stringMatching(REGISTRADA)]);
      await e.trabajar();
      f = await coherente(e, tarde, 'pin después de pasar a una persona');
      expect(f.etapas).not.toContain('necesita');
      expect(f.filas[0]!.motorizado).toBeTruthy();
      const n1 = e.mensajesA(durante).length;
      const n2 = e.mensajesA(tarde).length;
      await pasan(e, 120);
      expect(e.mensajesA(durante)).toHaveLength(n1);
      expect(e.mensajesA(tarde)).toHaveLength(n2);
    } finally {
      await e.cerrar();
    }
  }, 90_000);

  it('pin con el bot en pausa (una persona tenía el chat): se registra y se contesta; un enlace de mapa vale igual', async () => {
    const e = await armar();
    try {
      const tel = '987710007';
      const enlace = '987710008';
      await pedidoAMano(e, tel, 'A-7');
      await pedidoAMano(e, enlace, 'A-8');
      const c = (await e.repos.contacts.getByPhone(conPais(tel)))!;
      await e.repos.contacts.pausarBot(c.id, true, e.ahora());
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { pin: PIN_LIMA });
      expect(desde(e, tel, antes).map((m) => m.body)).toEqual([expect.stringMatching(REGISTRADA)]);
      await e.contesta(enlace, { enlace: `https://maps.google.com/?q=${PIN_LIMA.lat},${PIN_LIMA.lng}` });
      await e.trabajar();
      for (const t of [tel, enlace]) {
        const f = await coherente(e, t, 'tras el pin');
        expect(f.filas[0]!.ubicacionEstado).toBe('recibida');
      }
      const n = e.mensajesA(tel).length + e.mensajesA(enlace).length;
      await pasan(e, 120);
      expect(e.mensajesA(tel).length + e.mensajesA(enlace).length).toBe(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('dos pedidos del mismo número (lista de GSG): un solo pedido de ubicación, un pin vale para los dos y ninguno se queda pidiéndola', async () => {
    const e = await armar();
    try {
      const tel = '987710009';
      e.simulador.cargar([
        { referencia: 'G-9A', telefono: tel, nombre: 'Doble', faltaUbicacion: true, faltaConfirmacion: false },
        { referencia: 'G-9B', telefono: tel, nombre: 'Doble', faltaUbicacion: true, faltaConfirmacion: false },
      ]);
      await e.api.post('/admin/entregas/sincronizar');
      await e.trabajar();
      expect(desde(e, tel, 0).filter(pideUbicacion)).toHaveLength(1);
      let f = await coherente(e, tel, 'antes del pin');
      expect(f.etapas).not.toContain('necesita');
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      f = await coherente(e, tel, 'tras el pin');
      expect(f.filas.map((x) => x.ubicacionEstado)).toEqual(['recibida', 'recibida']);
      expect(new Set(f.filas.map((x) => x.motorizado?.phone)).size).toBe(1);
      const n = e.mensajesA(tel).length;
      await pasan(e, 120);
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('otro pedido del mismo número DESPUÉS del pin (a mano o de GSG): no se le vuelve a pedir la ubicación, vale la de hoy y va a un motorizado', async () => {
    const e = await armar();
    try {
      const tel = '987710010';
      await pedidoAMano(e, tel, 'A-10');
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const antes = e.mensajesA(tel).length;
      await pedidoAMano(e, tel, 'A-10-bis');
      e.simulador.cargar([{ referencia: 'G-10', telefono: tel, nombre: 'Cliente', faltaUbicacion: true, faltaConfirmacion: false }]);
      await e.api.post('/admin/entregas/sincronizar');
      await e.trabajar();
      await pasan(e, 90);
      expect(desde(e, tel, antes).filter(pideUbicacion), 'no se le vuelve a pedir').toEqual([]);
      const f = await coherente(e, tel, 'con los tres pedidos');
      expect(f.filas.map((x) => x.ubicacionEstado)).toEqual(['recibida', 'recibida', 'recibida']);
      expect(f.filas.every((x) => x.motorizado)).toBe(true);
      await e.despacharAGsg();
      expect(e.simulador.recibido.some((r) => r.tipo === 'ubicacion' && r.cuerpo.referencia === 'G-10')).toBe(true);
      // Los pedidos nuevos no le pidieron nada: tras el agradecimiento, otra consulta = el cierre UNA vez.
      const n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'cuánto cuesta el envío' });
      await e.contesta(tel, { texto: 'hola?' });
      expect(desde(e, tel, n).map((m) => m.body)).toEqual([expect.stringMatching(CIERRE)]);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('red de seguridad del envío automático: si ya tiene la ubicación de hoy, no le escribe y lo saca de la lista', async () => {
    const e = await armar();
    try {
      const tel = '987710011';
      await pedidoAMano(e, tel, 'A-11');
      await e.contesta(tel, { pin: PIN_LIMA });
      // Alguien lo vuelve a poner en la lista después (el asistente, la API…).
      await e.repos.envioAutomatico.agregar({ phone: conPais(tel), que: 'ubicacion', hasta: 'ubicacion', origen: 'api' });
      const lista = crearServicioEnvioAutomatico({ repos: e.repos, opcionesReparto: { ...OPCIONES_POR_DEFECTO, horaInicio: 0, horaFin: 24 }, plan: PLANES.peru!, ahora: e.ahora });
      const motor = crearMotorLista({ repos: e.repos, lista, sender: { send: async () => { throw new Error('no debía mandar nada'); } }, opciones: { ...OPCIONES_POR_DEFECTO, horaInicio: 0, horaFin: 24 }, usarPlantilla: () => false, ahora: e.ahora, azar: () => 0 });
      const r = await motor.tick();
      expect(r.accion).toBe('salida');
      expect(await e.repos.envioAutomatico.porTelefono(conPais(tel))).toBeNull();
      await coherente(e, tel, 'tras el motor de la lista');
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});

// ===========================================================================
// B) «No soy yo»
// ===========================================================================

describe('B. «no soy yo»: texto fijo una vez, a una persona, GSG se entera y silencio', () => {
  it('las reglas lo reconocen (y no confunden «¿quién eres?» ni «no soy bueno con el celular»)', () => {
    for (const t of ['yo no he pedido eso disculpa', 'No soy yo', 'número equivocado', 'no conozco esa tienda', 'se equivocaron de número', 'Yo no pedí nada', 'no he hecho ningún pedido', 'ese pedido no es mío', 'no tengo ningún pedido']) expect(pareceNoSoyYo(t), t).toBe(true);
    for (const t of ['¿quién eres?', '¿quiénes son?', 'no soy bueno con el celular, cómo la mando', 'no sé cómo mandar la ubicación', 'hola', 'a qué hora llega', 'no estoy en casa']) expect(pareceNoSoyYo(t), t).toBe(false);
    expect(clasificarReglaGsg('¿quién eres?')).toBe('por_que');
  });

  it('la IA lo clasifica como NO_SOY_YO (con ejemplos en los dos prompts) y se lee estricto', () => {
    expect(promptClasificadorReglaGsg()).toContain('NO_SOY_YO');
    expect(promptClasificadorReglaGsg()).toContain('«yo no he pedido eso disculpa» → NO_SOY_YO');
    expect(promptClasificadorConfirmarGsg()).toContain('«número equivocado» → NO_SOY_YO');
    expect(leerCategoria('NO_SOY_YO', CATEGORIAS_REGLA)).toBe('no_soy_yo');
    expect(leerCategoria('No soy yo', CATEGORIAS_REGLA)).toBe('no_soy_yo');
    expect(leerCategoria('NO SOY YO', CATEGORIAS_CONFIRMAR)).toBe('no_soy_yo');
    expect(leerCategoria('NO', CATEGORIAS_CONFIRMAR)).toBe('no');
  });

  it('antes del pin: texto fijo, «Necesita a alguien» con el motivo, la solicitud apartada (sin recordatorios), GSG lo recibe como no confirmado y nunca más se le escribe', async () => {
    const e = await armar();
    try {
      const tel = '987720001';
      e.simulador.cargar([{ referencia: 'G-NS1', telefono: tel, nombre: 'Equivocado', faltaUbicacion: true, faltaConfirmacion: false }]);
      await e.api.post('/admin/entregas/sincronizar');
      await e.trabajar();
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'No soy yo, número equivocado' });
      expect(desde(e, tel, antes)).toEqual([{ kind: 'text', body: TEXTO_NO_SOY_YO }]);
      const f = await coherente(e, tel, 'tras «no soy yo»');
      expect(f.etapas).toEqual(['necesita']);
      expect(f.pasos).toEqual(['alguien']);
      expect(f.solicitudes.filter((s) => VIVAS.includes(s.estado))).toEqual([]);
      expect(f.solicitudes[0]!.incidencia).toBe('numero_equivocado');
      await e.despacharAGsg();
      const aGsg = e.simulador.recibido.find((r) => r.tipo === 'confirmacion' && r.cuerpo.referencia === 'G-NS1');
      expect(aGsg?.cuerpo).toMatchObject({ confirmada: false, motivo: 'numero_equivocado' });
      // GSG no lo cancela solo (lo ve una persona): sigue en «necesita a alguien».
      await e.api.post('/admin/entregas/sincronizar');
      expect((await coherente(e, tel, 'tras sincronizar')).etapas).toEqual(['necesita']);
      const n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'ok' });
      await e.contesta(tel, { adjunto: 'sticker' });
      await pasan(e, 150);
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('dijo «no soy yo» tras no contestar a los recordatorios y después manda un pin: la ubicación queda en la entrega (una sola verdad) y lo sigue viendo una persona', async () => {
    const e = await armar();
    try {
      const tel = '987720006';
      await pedidoAMano(e, tel, 'NS-6');
      await pasan(e, ESPERA_MIN * 4);
      expect((await coherente(e, tel, 'sin contestar')).filas[0]!.incidencia).toBe('sin_respuesta');
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'se equivocaron de número' });
      expect(desde(e, tel, antes).map((m) => m.body)).toEqual([TEXTO_NO_SOY_YO]);
      let f = await coherente(e, tel, 'tras «no soy yo»');
      expect(f.filas[0]!.incidencia).toBe('no_soy_yo');
      await e.contesta(tel, { pin: PIN_LIMA });
      f = await coherente(e, tel, 'tras el pin');
      expect(f.filas[0]!.ubicacionEstado).toBe('recibida');
      expect(f.etapas).toEqual(['necesita']);
      expect(f.solicitudes.filter((s) => VIVAS.includes(s.estado))).toEqual([]);
      const n = e.mensajesA(tel).length;
      await pasan(e, 90);
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('«no soy yo» NO se libera solo: una persona le escribe → «Ya contactado» sin motorizado; solo «Volver a intentar» lo manda a un motorizado', async () => {
    const e = await armar();
    try {
      const tel = '987720007';
      await pedidoAMano(e, tel, 'NS-7');
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      await e.contesta(tel, { texto: 'yo no he pedido eso' });
      expect((await coherente(e, tel, 'tras «no soy yo»')).etapas).toEqual(['necesita']);
      const r = await e.api.post('/admin/chat/send', { phone: conPais(tel), text: 'Hola, soy Rosa de GSG. ¿Nos confirmas si es tu pedido?' });
      expect(r.status).toBe(200);
      await pasan(e, 60);
      let f = await coherente(e, tel, 'tras escribirle una persona');
      expect(f.etapas).toEqual(['contactados']);
      expect(f.pasos).toEqual(['esperando']);
      expect(pasoDeHoy(f.filas[0]!).texto).toBe('Ya contactado');
      expect(f.filas[0]!.motorizado).toBeNull();
      expect(f.filas[0]!.estado).toBe('incidencia');
      await e.entregas.reintentar(f.filas[0]!.id, 'Rosa');
      await pasan(e, 10);
      f = await coherente(e, tel, 'liberado a mano');
      expect(f.filas[0]!.motorizado).toBeTruthy();
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('después del pin y con motorizado: texto fijo, el motorizado sabe que no lo lleve, «Necesita a alguien» y silencio', async () => {
    const e = await armar();
    try {
      const tel = '987720002';
      await pedidoAMano(e, tel, 'NS-2');
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const moto = await motorizadoDe(e, tel);
      await e.contesta(moto, { texto: '40' });
      expect((await foto(e, tel)).filas[0]!.estado).toBe('avisada');
      const antes = e.mensajesA(tel).length;
      const antesMoto = e.mensajesA(moto).length;
      await e.contesta(tel, { texto: 'yo no he pedido eso' });
      expect(desde(e, tel, antes)).toEqual([{ kind: 'text', body: TEXTO_NO_SOY_YO }]);
      expect(desde(e, moto, antesMoto).map((m) => m.body)).toEqual([expect.stringContaining('el cliente dice que no hizo este pedido')]);
      const f = await coherente(e, tel, 'tras «no soy yo» con motorizado');
      expect(f.etapas).toEqual(['necesita']);
      expect(f.filas[0]!.motorizado).toBeNull();
      const n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'a qué hora llega?' });
      await pasan(e, 90);
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('en «falta confirmar» (GSG ya tiene la dirección): «no conozco esa tienda» → texto fijo y a una persona (no un NO de cancelar)', async () => {
    const e = await armar();
    try {
      const tel = '987720003';
      e.simulador.cargar([{ referencia: 'G-NS3', telefono: tel, nombre: 'Confirma', direccion: 'Jr. X 1', distrito: 'Miraflores', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng, faltaUbicacion: false, faltaConfirmacion: true }]);
      await e.api.post('/admin/entregas/sincronizar');
      await e.trabajar();
      expect(e.botonesA(tel).length).toBeGreaterThan(0);
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'no conozco esa tienda' });
      expect(desde(e, tel, antes)).toEqual([{ kind: 'text', body: TEXTO_NO_SOY_YO }]);
      const f = await coherente(e, tel, 'tras «no soy yo» en falta confirmar');
      expect(f.filas[0]!.estado).toBe('incidencia');
      expect(f.filas[0]!.incidencia).toBe('no_soy_yo');
      const n = e.mensajesA(tel).length;
      await pasan(e, 150);
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('la IA manda (NO_SOY_YO con un texto que las reglas no ven) y, sin saldo, las reglas lo reconocen igual', async () => {
    const e = await armar();
    try {
      const modelo: { responde: string | Error } = { responde: 'OTRA' };
      e.ia.completar = async (_m: MensajeIA[]) => {
        if (modelo.responde instanceof Error) throw modelo.responde;
        return modelo.responde;
      };
      await e.asistente!.guardar({ activa: true, proveedor: 'openai', servicio: 'openai', modelo: 'gpt-4o-mini', token: 'sk-prueba' });
      const conIA = '987720004';
      const sinSaldo = '987720005';
      await pedidoAMano(e, conIA, 'NS-4');
      await pedidoAMano(e, sinSaldo, 'NS-5');
      const texto = 'oe ni idea de ese paquete, yo nunca encargué algo así';
      expect(pareceNoSoyYo(texto)).toBe(false);
      modelo.responde = 'NO_SOY_YO';
      let antes = e.mensajesA(conIA).length;
      await e.contesta(conIA, { texto });
      expect(desde(e, conIA, antes).map((m) => m.body)).toEqual([TEXTO_NO_SOY_YO]);
      expect((await coherente(e, conIA, 'IA: NO_SOY_YO')).etapas).toEqual(['necesita']);

      modelo.responde = new ErrorIA('la API respondio 429', 'openai', 'You exceeded your current quota', 'sin_saldo');
      antes = e.mensajesA(sinSaldo).length;
      await e.contesta(sinSaldo, { texto: '¿a qué hora llega?' });
      expect(desde(e, sinSaldo, antes).map((m) => m.body)).toEqual([expect.stringMatching(HORA_SIN_PIN)]);
      await e.contesta(sinSaldo, { texto: 'se equivocaron de número' });
      expect(desde(e, sinSaldo, antes).map((m) => m.body).slice(1)).toEqual([TEXTO_NO_SOY_YO]);
      expect((await coherente(e, sinSaldo, 'sin saldo: reglas')).etapas).toEqual(['necesita']);
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});

// ===========================================================================
// C) Consultas antes y después del pin
// ===========================================================================

describe('C. lo que pregunta el cliente, antes y después del pin', () => {
  it('la hora antes del pin → la hora (sin cierre); «¿por qué?» → la explicación; después del pin la hora con motorizado; otra consulta → el cierre UNA vez y silencio; nunca más la ubicación', async () => {
    const e = await armar();
    try {
      const tel = '987730001';
      await pedidoAMano(e, tel, 'C-1');
      let antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: '¿a qué hora llega mi pedido?' });
      await e.contesta(tel, { texto: '¿por qué me piden la ubicación?' });
      const dos = desde(e, tel, antes);
      expect(dos[0]!.body).toMatch(HORA_SIN_PIN);
      expect(dos[1]!.body).toContain(EXPLICACION);
      expect(dos).toHaveLength(2);
      await coherente(e, tel, 'preguntas antes del pin');

      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const moto = await motorizadoDe(e, tel);
      antes = e.mensajesA(tel).length;
      // El motorizado responde los minutos: al cliente no se le escribe; GSG se entera.
      await e.contesta(moto, { texto: '40' });
      expect(desde(e, tel, antes)).toEqual([]);
      await e.despacharAGsg();
      expect(e.simulador.recibido.some((r) => r.tipo === 'entrega' && r.cuerpo.referencia === 'C-1')).toBe(true);
      await e.contesta(tel, { texto: '¿a qué hora llega?' });
      const hora = desde(e, tel, antes);
      expect(hora).toHaveLength(1);
      expect(hora[0]!.body).not.toMatch(CIERRE);
      expect(hora[0]!.body).toMatch(/\d{1,2}:\d{2}/);
      await e.contesta(tel, { texto: 'cuánto me cobran por el envío' });
      expect(desde(e, tel, antes).slice(1).map((m) => m.body)).toEqual([expect.stringMatching(CIERRE)]);
      const n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'hola??' });
      await e.contesta(moto, { texto: 'cerca' });
      await e.contesta(moto, { texto: 'entregado' });
      await pasan(e, 90);
      expect(e.mensajesA(tel)).toHaveLength(n);
      const f = await coherente(e, tel, 'entregado');
      expect(f.filas[0]!.estado).toBe('entregada');
      expect(f.etapas).toEqual(['contactados']);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('otra cosa antes del pin: 3 insistencias y el cierre UNA vez CON el número de un motorizado asignado sin ubicación → «Esperando ubicación · con motorizado» (no «necesita»), sin recordatorios; la hora; su pin tardío → UBI REGISTRADA, el mismo motorizado y un aviso corto; un segundo cierre nunca', async () => {
    const e = await armar();
    try {
      const tel = '987730002';
      await pedidoAMano(e, tel, 'C-2');
      const antes = e.mensajesA(tel).length;
      for (const t of ['hola', 'ok', 'buenas', 'qué tal']) await e.contesta(tel, { texto: t });
      const salio = desde(e, tel, antes).map((m) => m.body);
      expect(salio.slice(0, 3)).toEqual(INSISTENCIAS_UBICACION);
      expect(salio[3]).toMatch(CIERRE);
      expect(salio).toHaveLength(4);
      // El número del cierre es el del motorizado que lo lleva (no el de soporte).
      let f = await coherente(e, tel, 'tras el cierre');
      const moto = f.filas[0]!.motorizado!;
      expect(moto, 'el cierre asignó un motorizado').toBeTruthy();
      expect(salio[3]).toContain(numeroEnPalabras(moto.phone));
      expect(salio[3]).not.toContain(numeroEnPalabras('987654321'));
      expect(f.etapas).toEqual(['falta_ubicacion']);
      expect(f.pasos).toEqual(['motorizado']);
      expect(pasoDeHoy(f.filas[0]!).texto).toBe(`Esperando ubicación · con motorizado ${moto.nombre}`);
      expect(f.filas[0]!.requiereHumano).toBe(false);
      expect(f.filas[0]!.incidencia).toBeNull();
      expect(f.solicitudes.filter((s) => VIVAS.includes(s.estado) || s.requiereHumano || s.incidencia === 'respondio_sin_ubicacion')).toEqual([]);
      // Al motorizado: el texto fijo SIN ubicación, nunca un pin.
      const alMoto = desde(e, moto.phone, 0);
      expect(alMoto.filter((m) => m.kind === 'location')).toEqual([]);
      expect(alMoto.map((m) => m.body)).toContainEqual(expect.stringMatching(/^🛵 Nuevo pedido SIN ubicación: C-2\nCliente: Cliente · \+51 987 730 002\nDirección:.*\nNo mandó su ubicación: coordina con el cliente por teléfono\.\n¿En cuántos minutos lo entregas\?/));

      // La hora antes de que el motorizado dé sus minutos: ya está con un motorizado.
      let n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: '¿a qué hora llega mi pedido?' });
      expect(desde(e, tel, n).map((m) => m.body)).toEqual([expect.stringMatching(/ya está con un motorizado/)]);
      // Otra cosa: silencio (un segundo cierre nunca).
      n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'hola?' });
      expect(e.mensajesA(tel)).toHaveLength(n);

      // El motorizado da 30: al cliente no se le escribe; GSG se entera con la hora.
      await e.contesta(moto.phone, { texto: '30' });
      expect(e.mensajesA(tel)).toHaveLength(n);
      f = await coherente(e, tel, 'el motorizado dio 30');
      expect(f.filas[0]!.estado).toBe('avisada');
      expect(f.pasos).toEqual(['motorizado']);
      expect(f.etapas).toEqual(['falta_ubicacion']);
      await e.despacharAGsg();
      expect(e.simulador.recibido.some((r) => r.tipo === 'entrega' && r.cuerpo.referencia === 'C-2')).toBe(true);
      // Si pregunta la hora: la estimada.
      await e.contesta(tel, { texto: '¿a qué hora llega?' });
      const hora = desde(e, tel, n).map((m) => m.body);
      expect(hora).toHaveLength(1);
      expect(hora[0]).toMatch(/\d{1,2}:\d{2}/);
      expect(hora[0]).not.toMatch(CIERRE);

      // Nada de recordatorios de la ubicación, pasen las horas que pasen.
      n = e.mensajesA(tel).length;
      await pasan(e, 180);
      expect(e.mensajesA(tel)).toHaveLength(n);
      f = await coherente(e, tel, 'horas después');
      expect(f.lista).toBeNull();
      expect(f.etapas).toEqual(['falta_ubicacion']);

      // Su pin tardío: UBI REGISTRADA, el MISMO motorizado y un aviso corto (sin coordenadas).
      const nMoto = e.mensajesA(moto.phone).length;
      await e.contesta(tel, { pin: PIN_LIMA });
      expect(desde(e, tel, n).map((m) => m.body)).toEqual([expect.stringMatching(REGISTRADA)]);
      await e.trabajar();
      const alMotoDespues = desde(e, moto.phone, nMoto);
      expect(alMotoDespues).toEqual([{ kind: 'text', body: 'C-2: el cliente ya mandó su ubicación, GSG la tiene.' }]);
      f = await coherente(e, tel, 'pin tardío');
      expect(f.filas[0]!.motorizado!.phone).toBe(moto.phone);
      expect(f.filas[0]!.estado).toBe('avisada');
      expect(f.etapas).toEqual(['contactados']);
      expect(pasoDeHoy(f.filas[0]!).texto).toBe('Con motorizado');
      // Después: la hora sí; otra consulta ya no recibe un segundo cierre; un pin repetido tampoco.
      const m = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: '¿a qué hora llega?' });
      await e.contesta(tel, { texto: 'cuánto cuesta el envío' });
      await e.contesta(tel, { pin: PIN_LIMA });
      const tras = desde(e, tel, m).map((x) => x.body);
      expect(tras).toHaveLength(1);
      expect(tras[0]).not.toMatch(CIERRE);
      await e.contesta(moto.phone, { texto: 'entregado' });
      f = await coherente(e, tel, 'entregado');
      expect(f.filas[0]!.estado).toBe('entregada');
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('«falta confirmar»: SÍ → confirmado, a un motorizado y silencio; la hora después → la hora; otra cosa → el cierre UNA vez', async () => {
    const e = await armar();
    try {
      const tel = '987730004';
      e.simulador.cargar([{ referencia: 'G-C4', telefono: tel, nombre: 'Confirma', direccion: 'Jr. X 1', distrito: 'Miraflores', lat: PIN_LIMA.lat, lng: PIN_LIMA.lng, faltaUbicacion: false, faltaConfirmacion: true }]);
      await e.api.post('/admin/entregas/sincronizar');
      await e.trabajar();
      let f = await coherente(e, tel, 'se le preguntó SÍ/NO');
      expect(f.etapas).toEqual(['falta_confirmar']);
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'sí, lo recibo hoy' });
      expect(desde(e, tel, antes).map((m) => m.body)).toEqual([expect.stringMatching(/queda confirmado/)]);
      await e.trabajar();
      f = await coherente(e, tel, 'confirmado');
      expect(f.filas[0]!.motorizado).toBeTruthy();
      expect(f.etapas).toEqual(['contactados']);
      await e.contesta(tel, { texto: '¿a qué hora llega?' });
      await e.contesta(tel, { texto: 'quiero cambiar el producto' });
      await e.contesta(tel, { texto: 'hola??' });
      const salio = desde(e, tel, antes).slice(1).map((m) => m.body);
      expect(salio).toHaveLength(2);
      expect(salio[0]).not.toMatch(CIERRE);
      expect(salio[1]).toMatch(CIERRE);
      await pasan(e, 90);
      expect(desde(e, tel, antes)).toHaveLength(3);
      await e.despacharAGsg();
      expect(e.simulador.recibido.some((r) => r.tipo === 'confirmacion' && r.cuerpo.referencia === 'G-C4' && r.cuerpo.confirmada === true)).toBe(true);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('una persona le escribe: lo que «necesitaba a alguien» queda atendido en Números y en Hoy, y no vuelve solo a «necesita»', async () => {
    const e = await armar();
    try {
      const tel = '987730003';
      await pedidoAMano(e, tel, 'C-3');
      await pasan(e, ESPERA_MIN * 4);
      let f = await coherente(e, tel, 'sin contestar');
      expect(f.etapas).toEqual(['necesita']);
      const r = await e.api.post('/admin/chat/send', { phone: conPais(tel), text: 'Hola, soy Rosa de GSG. ¿Nos pasas tu ubicación?' });
      expect(r.status).toBe(200);
      f = await coherente(e, tel, 'tras escribirle una persona');
      expect(f.etapas).toEqual(['contactados']);
      expect(f.pasos).not.toContain('alguien');
      const n = e.mensajesA(tel).length;
      await pasan(e, 120);
      f = await coherente(e, tel, 'horas después');
      expect(f.etapas).toEqual(['contactados']);
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});

// ===========================================================================
// D) Motorizados
// ===========================================================================

describe('D. el motorizado', () => {
  it('sin motorizado NO es «necesita a alguien»; cuando llega uno se le asigna solo; «no puedo» pasa a otro; al cliente no se le escribe nada', async () => {
    const e = await armar({ motorizados: false });
    try {
      const tel = '987740001';
      await pedidoAMano(e, tel, 'D-1');
      await e.contesta(tel, { pin: PIN_LIMA });
      await pasan(e, 60);
      let f = await coherente(e, tel, 'sin motorizados');
      expect(f.filas[0]!.estado).toBe('lista');
      expect(f.etapas).toEqual(['contactados']);
      expect(f.pasos).toEqual(['registrada']);
      const n = e.mensajesA(tel).length;
      await e.api.post('/admin/motorizados', { telefono: '999000011', nombre: 'Uno' });
      await e.api.post('/admin/motorizados', { telefono: '999000012', nombre: 'Dos' });
      await pasan(e, 10);
      const primero = await motorizadoDe(e, tel);
      await e.contesta(primero, { texto: 'no puedo' });
      await pasan(e, 10);
      const segundo = await motorizadoDe(e, tel);
      expect(segundo).not.toBe(primero);
      await e.contesta(segundo, { texto: 'media hora' });
      f = await coherente(e, tel, 'con el segundo motorizado');
      expect(f.filas[0]!.estado).toBe('avisada');
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});

// ===========================================================================
// F) Sin ubicación, con motorizado (pedido del dueño, 25/09)
// ===========================================================================

describe('F. «Esperando ubicación · con motorizado»', () => {
  it('sin motorizados activos: el cierre lleva soporte y «Necesita a alguien»; cuando aparece uno se le asigna solo (sin pin); su pin antes de los minutos → el mismo motorizado sigue esperándolos', async () => {
    const e = await armar({ motorizados: false });
    try {
      const tel = '987760001';
      await pedidoAMano(e, tel, 'F-1');
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'cuánto cuesta el envío' });
      // (una consulta ajena: primero las insistencias, luego el cierre)
      for (const t of ['ok', 'ya', 'hola']) await e.contesta(tel, { texto: t });
      const salio = desde(e, tel, antes).map((m) => m.body);
      expect(salio).toHaveLength(4);
      expect(salio[3]).toMatch(CIERRE);
      expect(salio[3]).toContain(numeroEnPalabras('987654321'));
      let f = await coherente(e, tel, 'cierre sin motorizados');
      expect(f.etapas).toEqual(['necesita']);
      expect(f.pasos).toEqual(['alguien']);
      expect(f.filas[0]!.motorizado).toBeFalsy();

      // Llega un motorizado: se le asigna solo, sin pin, y deja de «necesitar a alguien».
      await e.api.post('/admin/motorizados', { telefono: '999000021', nombre: 'Uno', zona: 'Los Olivos' });
      await pasan(e, 10);
      f = await coherente(e, tel, 'apareció un motorizado');
      expect(f.filas[0]!.motorizado?.phone).toBe(conPais('999000021'));
      expect(f.etapas).toEqual(['falta_ubicacion']);
      expect(f.pasos).toEqual(['motorizado']);
      const alMoto = desde(e, '999000021', 0);
      expect(alMoto.filter((m) => m.kind === 'location')).toEqual([]);
      expect(alMoto.map((m) => m.body)).toContainEqual(expect.stringMatching(/^🛵 Nuevo pedido SIN ubicación: F-1\n/));

      // Su pin antes de que el motorizado dé sus minutos: el mismo, que sigue esperándolos.
      const nMoto = e.mensajesA('999000021').length;
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      expect(desde(e, '999000021', nMoto)).toEqual([{ kind: 'text', body: 'F-1: el cliente ya mandó su ubicación, GSG la tiene.' }]);
      f = await coherente(e, tel, 'pin antes de los minutos');
      expect(f.filas[0]!.estado).toBe('esperando_motorizado');
      expect(f.filas[0]!.motorizado?.phone).toBe(conPais('999000021'));
      await e.contesta('999000021', { texto: '25' });
      f = await coherente(e, tel, 'el motorizado dio 25');
      expect(f.filas[0]!.estado).toBe('avisada');
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('la asignación a mano (ficha «Ver» de Hoy): con el motorizado elegido, la marca de urgente, errores en palabras, «no puedo» pasa a otro sin pin y ningún recordatorio de la ubicación', async () => {
    const e = await armar();
    try {
      const tel = '987760002';
      const r0 = await e.entregas.crearAMano({ referencia: 'F-2', telefono: tel, nombre: 'Rosa Pérez', direccion: 'Jr. Las Flores 45, Los Olivos', faltaUbicacion: true, faltaConfirmacion: false }, 'prueba');
      expect(r0.ok).toBe(true);
      if (r0.ok) await e.entregas.marcarPrioridad(r0.entrega.id, true, 'prueba');
      await e.trabajar();
      let f = await coherente(e, tel, 'se le pidió la ubicación');
      const fila = f.filas[0]!;
      expect(fila.acciones).toContain('sin_ubicacion');
      expect(f.etapas).toEqual(['falta_ubicacion']);

      // Errores en palabras.
      const noExiste = await e.api.post<{ error: string }>('/admin/entregas/999999/sin-ubicacion', {});
      expect(noExiste.status).toBe(404);
      expect(noExiste.body.error).toMatch(/ya no existe/);
      const motos = (await e.api.get<{ motorizados: Array<{ id: number; phone: string; nombre: string }> }>('/admin/motorizados')).body.motorizados;
      const elegido = motos.find((m) => m.phone === conPais('999000003'))!;
      const r = await e.api.post<{ ok: boolean; motorizado: { nombre: string } }>(`/admin/entregas/${fila.id}/sin-ubicacion`, { motorizadoId: elegido.id });
      expect(r.status).toBe(200);
      expect(r.body.motorizado.nombre).toBe(elegido.nombre);
      const otra = await e.api.post<{ error: string }>(`/admin/entregas/${fila.id}/sin-ubicacion`, {});
      expect(otra.status).toBe(400);
      expect(otra.body.error).toMatch(/ya lo lleva/);

      f = await coherente(e, tel, 'asignado a mano');
      expect(f.filas[0]!.motorizado?.phone).toBe(conPais('999000003'));
      expect(f.filas[0]!.acciones).not.toContain('sin_ubicacion');
      expect(f.pasos).toEqual(['motorizado']);
      expect(pasoDeHoy(f.filas[0]!).texto).toBe(`Esperando ubicación · con motorizado ${elegido.nombre}`);
      expect(f.solicitudes.filter((s) => VIVAS.includes(s.estado))).toEqual([]);
      const alMoto = desde(e, '999000003', 0);
      expect(alMoto.filter((m) => m.kind === 'location')).toEqual([]);
      expect(alMoto.map((m) => m.body)).toContainEqual(expect.stringMatching(/^🛵 🔴 URGENTE · Nuevo pedido SIN ubicación: F-2\nCliente: Rosa Pérez · \+51 987 760 002\nDirección: Jr\. Las Flores 45, Los Olivos/));

      // «No puedo»: pasa a otro, también sin pin; el de su zona (la dirección escrita dice Los Olivos).
      await e.contesta('999000003', { texto: 'no puedo' });
      await pasan(e, 10);
      f = await coherente(e, tel, 'tras «no puedo»');
      expect(f.filas[0]!.motorizado?.phone).toBe(conPais('999000007'));
      expect(desde(e, '999000007', 0).filter((m) => m.kind === 'location')).toEqual([]);
      expect(desde(e, '999000007', 0).map((m) => m.body)).toContainEqual(expect.stringMatching(/Nuevo pedido SIN ubicación: F-2/));

      // Ningún recordatorio de la ubicación (reparto ni envío automático).
      const n = e.mensajesA(tel).length;
      await pasan(e, ESPERA_MIN * 6);
      expect(desde(e, tel, n).filter(pideUbicacion)).toEqual([]);
      expect(e.mensajesA(tel)).toHaveLength(n);
      f = await coherente(e, tel, 'horas después');
      expect(f.etapas).toEqual(['falta_ubicacion']);
      expect(f.lista).toBeNull();

      // Con la ubicación ya puesta, el botón no vale: se dice qué usar.
      await e.entregas.ponerUbicacion(fila.id, PIN_LIMA.lat, PIN_LIMA.lng, 'prueba');
      const conPin = await e.api.post<{ error: string }>(`/admin/entregas/${fila.id}/sin-ubicacion`, {});
      expect(conPin.status).toBe(400);
      expect(conPin.body.error).toMatch(/ya tiene su ubicación/);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('el texto al motorizado se edita en los textos de entregas (motorizadoSinUbicacion)', async () => {
    const e = await armar();
    try {
      const prev = await e.api.post<{ texto: string }>('/admin/entregas/previsualizar', { clave: 'motorizadoSinUbicacion', texto: 'Sin pin: {pedido} · {telefonoCliente}' });
      expect(prev.status).toBe(200);
      expect(prev.body.texto).toMatch(/^Sin pin: .+ · \+51 \d{3} \d{3} \d{3}$/);
      await e.entregas.guardarAjustes({ textos: { motorizadoSinUbicacion: 'Sin pin: {pedido} ({telefonoCliente})' } } as never);
      const tel = '987760003';
      await pedidoAMano(e, tel, 'F-3');
      const fila = (await foto(e, tel)).filas[0]!;
      const r = await e.api.post<{ ok: boolean }>(`/admin/entregas/${fila.id}/sin-ubicacion`, {});
      expect(r.status).toBe(200);
      const moto = await motorizadoDe(e, tel);
      expect(desde(e, moto, 0).map((m) => m.body)).toContainEqual('Sin pin: F-3 (+51 987 760 003)');
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});

// ===========================================================================
// E) El día: cancelación de GSG y cierre
// ===========================================================================

describe('E. cancelaciones y cierre del día', () => {
  it('GSG cancela un pedido que esperaba la ubicación: se cancela aquí, el reparto deja de pedírsela y el cliente no recibe nada más', async () => {
    const e = await armar();
    try {
      const tel = '987750001';
      e.simulador.cargar([{ referencia: 'G-C1', telefono: tel, nombre: 'Cancelado', faltaUbicacion: true, faltaConfirmacion: false }]);
      await e.api.post('/admin/entregas/sincronizar');
      await e.trabajar();
      expect(e.simulador.cancelar('G-C1', 'el cliente llamó')).toBe(true);
      await e.api.post('/admin/entregas/sincronizar');
      const f = await coherente(e, tel, 'cancelado por GSG');
      expect(f.filas[0]!.estado).toBe('cancelada');
      expect(f.etapas).toEqual(['cancelada']);
      expect(f.pasos).toEqual(['cancelado']);
      expect(f.solicitudes.filter((s) => VIVAS.includes(s.estado))).toEqual([]);
      const n = e.mensajesA(tel).length;
      await pasan(e, 150);
      await e.contesta(tel, { texto: 'hola' });
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('GSG cancela un pedido que ya tenía motorizado, y una persona cancela otro desde el panel: el motorizado se entera, el cliente no recibe nada y todo queda «cancelado» en todas partes', async () => {
    const e = await armar();
    try {
      const tel = '987750004';
      const panel = '987750005';
      e.simulador.cargar([{ referencia: 'G-C5', telefono: tel, nombre: 'Con moto', faltaUbicacion: true, faltaConfirmacion: true }]);
      await e.api.post('/admin/entregas/sincronizar');
      await e.trabajar();
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const moto = await motorizadoDe(e, tel);
      const n = e.mensajesA(tel).length;
      const nMoto = e.mensajesA(moto).length;
      expect(e.simulador.cancelar('G-C5', 'el cliente llamó')).toBe(true);
      await e.api.post('/admin/entregas/sincronizar');
      expect(e.mensajesA(moto).length).toBeGreaterThan(nMoto);
      let f = await coherente(e, tel, 'cancelado con motorizado');
      expect([f.etapas, f.pasos]).toEqual([['cancelada'], ['cancelado']]);
      expect(e.mensajesA(tel)).toHaveLength(n);

      await pedidoAMano(e, panel, 'E-5');
      await e.entregas.cancelar((await foto(e, panel)).filas[0]!.id, 'lo pidió GSG por teléfono', 'Rosa');
      f = await coherente(e, panel, 'cancelado desde el panel');
      expect(f.solicitudes.filter((s) => VIVAS.includes(s.estado))).toEqual([]);
      const m = e.mensajesA(panel).length;
      await pasan(e, 120);
      expect(e.mensajesA(panel)).toHaveLength(m);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('el cierre del día: lo que quedó sin ubicación pasa a una persona con motivo y el reparto deja de escribirle; lo avisado se da por entregado', async () => {
    const e = await armar();
    try {
      const sinPin = '987750002';
      const avisado = '987750003';
      await pedidoAMano(e, sinPin, 'E-2');
      await pedidoAMano(e, avisado, 'E-3');
      await e.contesta(avisado, { pin: PIN_LIMA });
      await e.trabajar();
      await e.contesta(await motorizadoDe(e, avisado), { texto: '30' });
      const diaAyer = e.entregas.hoy();
      // Hasta pasada la medianoche (el cierre es a las 00:00).
      e.avanzar(15 * 60 + 10);
      await e.trabajar();
      expect(e.entregas.hoy()).not.toBe(diaAyer);
      const e2 = (await e.repos.entregas.porDiaYReferencia(diaAyer, 'E-2'))!;
      const e3 = (await e.repos.entregas.porDiaYReferencia(diaAyer, 'E-3'))!;
      expect([e2.estado, e2.incidencia]).toEqual(['incidencia', 'dia_cerrado']);
      expect(e2.incidenciaDetalle).toBeTruthy();
      expect(e3.estado).toBe('entregada');
      const solicitudes = (await e.repos.rutas.listarSolicitudes({ q: conPais(sinPin), limit: 10, offset: 0 })).filter((s) => VIVAS.includes(s.estado));
      expect(solicitudes, 'el reparto sigue pidiendo la ubicación de un pedido de ayer').toEqual([]);
      const n = e.mensajesA(sinPin).length;
      await pasan(e, 120);
      expect(e.mensajesA(sinPin)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 90_000);
});

// ===========================================================================
// G) El pin tiene que tener sentido (pedido del dueño, 25/09)
// ===========================================================================

/** Un punto dentro de San Juan de Lurigancho (el pin «bueno» de esos pedidos). */
const PIN_SJL = { lat: -11.985, lng: -77.005 };
const PIN_LEJOS_SJL = rellenarPinLejos('San Juan de Lurigancho');
function rellenarPinLejos(distrito: string): string {
  return TEXTOS_POR_DEFECTO.pinLejos.replace('{distrito}', distrito);
}

/** Un «Pedido a mano» con su distrito (el sistema escribe primero). */
async function pedidoEn(e: EscenarioEntregas, tel: string, referencia: string, distrito: string | undefined, direccion?: string): Promise<number> {
  const r = await e.entregas.crearAMano({ referencia, telefono: tel, nombre: 'Cliente', ...(distrito ? { distrito } : {}), ...(direccion ? { direccion } : {}), faltaUbicacion: true, faltaConfirmacion: false }, 'prueba');
  expect(r.ok, `crear ${referencia}`).toBe(true);
  await e.trabajar();
  return r.ok ? r.entrega.id : 0;
}

describe('G. el pin tiene que tener sentido: lejos de su distrito se le pregunta UNA vez', () => {
  it('pin lejos → la pregunta con botones SÍ/NO (no se registra, el reparto no le recuerda nada) → SÍ → UBI REGISTRADA, a un motorizado y silencio', async () => {
    const e = await armar();
    try {
      const tel = '987780001';
      const id = await pedidoEn(e, tel, 'G-1', 'San Juan de Lurigancho');
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { pin: PIN_LIMA });
      const pregunta = desde(e, tel, antes);
      expect(pregunta).toEqual([{ kind: 'buttons', body: PIN_LEJOS_SJL }]);
      expect(e.botonesA(tel).at(-1)!.buttons.map((b) => b.id)).toEqual([`entrega:pinsi:${id}`, `entrega:pinno:${id}`]);
      let f = await coherente(e, tel, 'pin lejos, esperando SÍ/NO');
      expect(f.filas[0]!.ubicacionEstado).toBe('pendiente');
      expect(f.filas[0]!.pinPropuestoAt).toBeTruthy();
      expect(f.filas[0]!.situacion).toMatch(/lejos de San Juan de Lurigancho/);
      expect(f.pasos).toEqual(['esperando']);
      // Mientras decide, el reparto no le recuerda la ubicación.
      let n = e.mensajesA(tel).length;
      await pasan(e, ESPERA_MIN * 3);
      expect(desde(e, tel, n).filter(pideUbicacion)).toEqual([]);
      // SÍ (el botón): UBI REGISTRADA con ESE pin.
      n = e.mensajesA(tel).length;
      await e.contesta(tel, { boton: { id: `entrega:pinsi:${id}`, title: 'Sí, es ahí' } });
      expect(desde(e, tel, n).map((m) => m.body)).toEqual([expect.stringMatching(REGISTRADA)]);
      await e.trabajar();
      f = await coherente(e, tel, 'dijo SÍ');
      expect(f.filas[0]!.ubicacionEstado).toBe('recibida');
      expect([f.filas[0]!.lat, f.filas[0]!.lng]).toEqual([PIN_LIMA.lat, PIN_LIMA.lng]);
      expect(f.filas[0]!.pinPropuestoAt).toBeNull();
      expect(f.filas[0]!.motorizado).toBeTruthy();
      await e.despacharAGsg();
      expect(e.simulador.recibido.some((r) => r.tipo === 'ubicacion' && r.cuerpo.referencia === 'G-1')).toBe(true);
      // Y después, silencio (salvo la hora).
      n = e.mensajesA(tel).length;
      await pasan(e, 90);
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('pin lejos → NO → «envíanos la ubicación correcta» → el pin corregido (en su distrito) → UBI REGISTRADA sin volver a preguntar', async () => {
    const e = await armar();
    try {
      const tel = '987780002';
      await pedidoEn(e, tel, 'G-2', 'SJL');
      await e.contesta(tel, { pin: PIN_LIMA });
      let n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'no es ahí, me equivoqué' });
      expect(desde(e, tel, n)).toEqual([{ kind: 'location_request', body: TEXTOS_POR_DEFECTO.pinLejosNo }]);
      let f = await coherente(e, tel, 'dijo NO');
      expect(f.filas[0]!.ubicacionEstado).toBe('pendiente');
      expect(f.filas[0]!.pinPropuestoAt).toBeNull();
      n = e.mensajesA(tel).length;
      await e.contesta(tel, { pin: PIN_SJL });
      expect(desde(e, tel, n).map((m) => m.body)).toEqual([expect.stringMatching(REGISTRADA)]);
      await e.trabajar();
      f = await coherente(e, tel, 'pin corregido');
      expect([f.filas[0]!.lat, f.filas[0]!.lng]).toEqual([PIN_SJL.lat, PIN_SJL.lng]);
      expect(f.filas[0]!.motorizado).toBeTruthy();
      // GSG recibe SOLO el pin bueno.
      await e.despacharAGsg();
      const aGsg = e.simulador.recibido.filter((r) => r.tipo === 'ubicacion' && r.cuerpo.referencia === 'G-2');
      expect(aGsg.map((r) => [r.cuerpo.lat, r.cuerpo.lng])).toEqual([[PIN_SJL.lat, PIN_SJL.lng]]);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('otra cosa → se le pregunta otra vez (una) → otra cosa por segunda vez pasa a una persona sin registrar el pin; el mismo pin mandado de nuevo sí vale', async () => {
    const e = await armar();
    try {
      const tel = '987780003';
      const otro = '987780004';
      await pedidoEn(e, tel, 'G-3', 'San Juan de Lurigancho');
      await pedidoEn(e, otro, 'G-4', 'San Juan de Lurigancho');
      await e.contesta(tel, { pin: PIN_LIMA });
      let n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'hola' });
      // La repregunta no sale idéntica: se nota que no se le entendió.
      expect(desde(e, tel, n)).toEqual([{ kind: 'buttons', body: `Perdona, no te entendí. ${PIN_LEJOS_SJL}` }]);
      n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'hola otra vez' });
      // Otra cosa por segunda vez: una salida clara, «¿todo correcto o
      // empezar de nuevo?» (regla del dueño, 26/09).
      expect(desde(e, tel, n).map((m) => m.body)).toEqual([expect.stringMatching(/todo correcto.*empezar de nuevo/i)]);
      n = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'no sé' });
      // Y si tampoco: el pin NO se da por bueno; lo decide una persona y al
      // cliente no se le repite nada.
      expect(desde(e, tel, n)).toEqual([]);
      expect((await e.entrega('G-3'))?.ubicacionEstado).toBe('pendiente');
      expect((await e.entrega('G-3'))?.requiereHumano).toBe(true);
      // El otro manda el mismo pin lejano dos veces: la segunda vale.
      await e.contesta(otro, { pin: PIN_LIMA });
      n = e.mensajesA(otro).length;
      // Lo reenvía DESPUÉS de leer «¿es ahí?» (WhatsApp pone la hora al
      // segundo): es su respuesta, no una copia del primero.
      await new Promise((r) => setTimeout(r, 1100));
      await e.contesta(otro, { pin: PIN_LIMA });
      expect(desde(e, otro, n).map((m) => m.body)).toEqual([expect.stringMatching(REGISTRADA)]);
      await coherente(e, otro, 'el mismo pin otra vez');
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('sin distrito (o un distrito que no se conoce) el pin se acepta como siempre; cerca de su distrito, también; la IA clasifica el SÍ si hay clave', async () => {
    const e = await armar();
    try {
      const sinDistrito = '987780005';
      const cerca = '987780006';
      const conIA = '987780007';
      await pedidoEn(e, sinDistrito, 'G-5', undefined);
      await pedidoEn(e, cerca, 'G-6', 'Surquillo');
      await pedidoEn(e, conIA, 'G-7', 'Ventanilla');
      for (const t of [sinDistrito, cerca]) {
        const n = e.mensajesA(t).length;
        await e.contesta(t, { pin: PIN_LIMA });
        expect(desde(e, t, n).map((m) => m.body)).toEqual([expect.stringMatching(REGISTRADA)]);
      }
      // Con la IA: «ahí mero causa» (las reglas no lo entienden) → SI.
      const modelo = { responde: 'SI' };
      e.ia.completar = async () => modelo.responde;
      await e.asistente!.guardar({ activa: true, proveedor: 'openai', servicio: 'openai', modelo: 'gpt-4o-mini', token: 'sk-prueba' });
      await e.contesta(conIA, { pin: PIN_LIMA });
      expect(e.botonesA(conIA).at(-1)!.body).toBe(rellenarPinLejos('Ventanilla'));
      const n = e.mensajesA(conIA).length;
      await e.contesta(conIA, { texto: 'ahí mero causa' });
      expect(desde(e, conIA, n).map((m) => m.body)).toEqual([expect.stringMatching(REGISTRADA)]);
      await coherente(e, conIA, 'la IA dijo SI');
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('la distancia se edita en Ajustes (Tiempos): con 20 km el mismo pin ya no se pregunta; el texto de la pregunta se edita', async () => {
    const e = await armar();
    try {
      await e.entregas.guardarAjustes({ pinDistanciaMaxKm: 20, textos: { pinLejos: '¿Seguro que es ahí? ({distrito}) SÍ o NO' } } as never);
      const tel = '987780008';
      await pedidoEn(e, tel, 'G-8', 'San Juan de Lurigancho');
      let n = e.mensajesA(tel).length;
      await e.contesta(tel, { pin: PIN_LIMA });
      expect(desde(e, tel, n).map((m) => m.body)).toEqual([expect.stringMatching(REGISTRADA)]);
      await e.entregas.guardarAjustes({ pinDistanciaMaxKm: 3 });
      const otro = '987780009';
      await pedidoEn(e, otro, 'G-9', 'San Juan de Lurigancho');
      n = e.mensajesA(otro).length;
      await e.contesta(otro, { pin: PIN_LIMA });
      expect(desde(e, otro, n).map((m) => m.body)).toEqual(['¿Seguro que es ahí? (San Juan de Lurigancho) SÍ o NO']);
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});

// ===========================================================================
// H) La dirección escrita (pedido del dueño, 25/09)
// ===========================================================================

/** Un buscador de direcciones de mentira: lo que la prueba diga (nunca la red). */
function geoFalso(tabla: Record<string, ResultadoGeo | 'sin red'>): Geocodificador & { consultas: string[] } {
  const consultas: string[] = [];
  return {
    consultas,
    async buscar(direccion) {
      consultas.push(direccion);
      const r = tabla[direccion];
      if (r === 'sin red') throw new Error('sin red');
      return r ?? null;
    },
  };
}
const LARCO = { lat: -12.1215, lng: -77.0302, precision: 'alta' as const, distrito: 'Miraflores', texto: 'Avenida José Larco 345, Miraflores, Lima' };

describe('H. la dirección escrita: no gasta insistencias; ubicada → registrada (aproximada), dudosa o sin red → anotada y se pide el pin', () => {
  it('ubicada con buena precisión en su distrito: UBI REGISTRADA + «Tomamos tu dirección…», fuente «dirección escrita (aproximada)», el motorizado recibe la dirección, GSG la ubicación, y silencio', async () => {
    const geo = geoFalso({ 'Av. Larco 345, Miraflores': LARCO });
    const e = await armar({ geocodificador: geo });
    try {
      const tel = '987790001';
      await pedidoEn(e, tel, 'H-1', 'Miraflores');
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'Av. Larco 345, Miraflores' });
      const salio = desde(e, tel, antes).map((m) => m.body);
      expect(salio).toHaveLength(1);
      expect(salio[0]).toMatch(REGISTRADA);
      expect(salio[0]).toContain('Tomamos tu dirección: Av. Larco 345, Miraflores. Si puedes, mándanos también el pin para llegar exacto.');
      await e.trabajar();
      const f = await coherente(e, tel, 'dirección ubicada');
      const fila = f.filas[0]!;
      expect(fila.ubicacionEstado).toBe('recibida');
      expect(fila.ubicacionFuente).toBe(FUENTE_DIRECCION_ESCRITA);
      expect(fila.direccionCliente).toBe('Av. Larco 345, Miraflores');
      expect([fila.lat, fila.lng]).toEqual([LARCO.lat, LARCO.lng]);
      expect(fila.motorizado).toBeTruthy();
      expect(desde(e, fila.motorizado!.phone, 0).map((m) => m.body)).toContainEqual(expect.stringContaining('Dirección que escribió el cliente (la ubicación es aproximada): Av. Larco 345, Miraflores'));
      await e.despacharAGsg();
      expect(e.simulador.recibido.some((r) => r.tipo === 'ubicacion' && r.cuerpo.referencia === 'H-1')).toBe(true);
      const n = e.mensajesA(tel).length;
      await pasan(e, 90);
      expect(e.mensajesA(tel)).toHaveLength(n);
      // Si después manda el pin, queda el pin (corrige la aproximada).
      await e.contesta(tel, { pin: PIN_LIMA });
      const corregida = (await foto(e, tel)).filas[0]!;
      expect(corregida.ubicacionFuente).toBe('pin de whatsapp');
      expect([corregida.lat, corregida.lng]).toEqual([PIN_LIMA.lat, PIN_LIMA.lng]);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('dudosa (el mapa solo la ubica por la zona, u otro distrito): se guarda (chip en Hoy), «Gracias, anotamos…» y NO gasta insistencias: después vienen las 3 y el cierre', async () => {
    const geo = geoFalso({
      'jr puno 340 altura del mercado, cercado': { lat: -12.05, lng: -77.03, precision: 'baja', distrito: 'Lima', texto: 'Cercado de Lima' },
      'Av. Larco 345, Miraflores': LARCO,
    });
    const e = await armar({ geocodificador: geo });
    try {
      const tel = '987790002';
      const otroDistrito = '987790003';
      await pedidoEn(e, tel, 'H-2', 'Cercado de Lima');
      // Escribe Miraflores pero su pedido es de Surco: dudosa aunque el mapa la encuentre.
      await pedidoEn(e, otroDistrito, 'H-3', 'Surco');
      let antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'jr puno 340 altura del mercado, cercado' });
      expect(desde(e, tel, antes)).toEqual([{ kind: 'location_request', body: 'Gracias, anotamos: jr puno 340 altura del mercado, cercado. Para llegar exacto, ¿nos mandas tu ubicación desde el clip 📎 → Ubicación?' }]);
      let f = await coherente(e, tel, 'dirección dudosa');
      expect(f.filas[0]!.direccionCliente).toBe('jr puno 340 altura del mercado, cercado');
      expect(f.filas[0]!.ubicacionEstado).toBe('pendiente');
      expect(f.pasos).toEqual(['esperando']);
      // La misma dirección otra vez: no se le repite el mismo mensaje.
      antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'jr puno 340 altura del mercado, cercado' });
      expect(e.mensajesA(tel)).toHaveLength(antes);
      // No gastó insistencias: ahora las 3 enteras y el cierre.
      for (const t of ['hola', 'ok', 'buenas', 'qué tal']) await e.contesta(tel, { texto: t });
      const salio = desde(e, tel, antes).map((m) => m.body);
      expect(salio.slice(0, 3)).toEqual(INSISTENCIAS_UBICACION);
      expect(salio[3]).toMatch(CIERRE);
      f = await coherente(e, tel, 'tras el cierre');
      // El motorizado que lo lleva sin ubicación recibe la dirección escrita.
      const moto = f.filas[0]!.motorizado!;
      expect(desde(e, moto.phone, 0).map((m) => m.body)).toContainEqual(expect.stringContaining('Dirección: jr puno 340 altura del mercado, cercado'));
      // GSG no recibe ninguna ubicación.
      await e.despacharAGsg();
      expect(e.simulador.recibido.some((r) => r.tipo === 'ubicacion' && r.cuerpo.referencia === 'H-2')).toBe(false);

      antes = e.mensajesA(otroDistrito).length;
      await e.contesta(otroDistrito, { texto: 'Av. Larco 345, Miraflores' });
      expect(desde(e, otroDistrito, antes).map((m) => m.body)).toEqual([expect.stringMatching(/^Gracias, anotamos: Av\. Larco 345, Miraflores\./)]);
      expect((await foto(e, otroDistrito)).filas[0]!.ubicacionEstado).toBe('pendiente');
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('sin red (el mapa falla) o sin buscador: anotada y se pide el pin; «estoy en la calle» NO es una dirección (gasta una insistencia)', async () => {
    const geo = geoFalso({ 'mz B lote 5 urb los jardines SJL': 'sin red' });
    const e = await armar({ geocodificador: geo });
    try {
      const tel = '987790004';
      const calle = '987790005';
      await pedidoEn(e, tel, 'H-4', 'San Juan de Lurigancho');
      await pedidoEn(e, calle, 'H-5', 'Miraflores');
      let antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'mz B lote 5 urb los jardines SJL' });
      expect(geo.consultas).toEqual(['mz B lote 5 urb los jardines SJL']);
      expect(desde(e, tel, antes).map((m) => m.body)).toEqual([expect.stringMatching(/^Gracias, anotamos: mz B lote 5 urb los jardines SJL\./)]);
      expect((await coherente(e, tel, 'sin red')).filas[0]!.direccionCliente).toBe('mz B lote 5 urb los jardines SJL');
      antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'hola' });
      expect(desde(e, tel, antes).map((m) => m.body)).toEqual([INSISTENCIAS_UBICACION[0]]);

      antes = e.mensajesA(calle).length;
      await e.contesta(calle, { texto: 'estoy en la calle' });
      expect(desde(e, calle, antes).map((m) => m.body)).toEqual([INSISTENCIAS_UBICACION[0]]);
      expect((await foto(e, calle)).filas[0]!.direccionCliente).toBeNull();
    } finally {
      await e.cerrar();
    }

    // Sin buscador (apagado): igual, anotada.
    const e2 = await armar();
    try {
      const tel = '987790006';
      await pedidoEn(e2, tel, 'H-6', 'Miraflores');
      const antes = e2.mensajesA(tel).length;
      await e2.contesta(tel, { texto: 'Av. Larco 345, Miraflores' });
      expect(desde(e2, tel, antes).map((m) => m.body)).toEqual([expect.stringMatching(/^Gracias, anotamos: Av\. Larco 345, Miraflores\./)]);
    } finally {
      await e2.cerrar();
    }
  }, 60_000);

  it('la IA la clasifica como DIRECCION (un texto que las reglas no ven) y el ajuste apaga la búsqueda en el mapa', async () => {
    const geo = geoFalso({ 'a dos cuadras del óvalo higuereta, casa verde de rejas': LARCO });
    const e = await armar({ geocodificador: geo });
    try {
      const modelo = { responde: 'DIRECCION' };
      e.ia.completar = async () => modelo.responde;
      await e.asistente!.guardar({ activa: true, proveedor: 'openai', servicio: 'openai', modelo: 'gpt-4o-mini', token: 'sk-prueba' });
      await e.entregas.guardarAjustes({ buscarDireccionEnMapa: false });
      const tel = '987790007';
      await pedidoEn(e, tel, 'H-7', 'Santiago de Surco');
      const antes = e.mensajesA(tel).length;
      await e.contesta(tel, { texto: 'a dos cuadras del óvalo higuereta, casa verde de rejas' });
      expect(desde(e, tel, antes).map((m) => m.body)).toEqual([expect.stringMatching(/^Gracias, anotamos: a dos cuadras del óvalo higuereta/)]);
      expect(geo.consultas).toEqual([]);
      expect(leerCategoria('DIRECCION', CATEGORIAS_REGLA)).toBe('direccion');
      expect(promptClasificadorReglaGsg()).toContain('DIRECCION');
    } finally {
      await e.cerrar();
    }
  }, 60_000);
});

// ===========================================================================
// I) «Hay que mirar»: los pedidos trabados (pedido del dueño, 25/09)
// ===========================================================================

type Resumen = Awaited<ReturnType<EscenarioEntregas['entregas']['resumen']>>;
const alertasDe = (r: Resumen, tipo: string) => r.alertas.filter((a) => a.tipo === tipo);

describe('I. «Hay que mirar»: motorizado sin minutos, sin ubicación a las 12:00 y en camino tarde (nada va al cliente)', () => {
  it('el motorizado no da sus minutos en 20 min: el motor lo pasa SOLO a otro activo (aunque le quedaran avisos) y no hay alerta', async () => {
    const e = await armar({ motorizados: false });
    try {
      await e.entregas.guardarAjustes({ motorizadoEsperaMin: 15, motorizadoMaxIntentos: 5, reasignarMotorizadoMin: 20 });
      await e.api.post('/admin/motorizados', { telefono: '999000031', nombre: 'Uno' });
      await e.api.post('/admin/motorizados', { telefono: '999000032', nombre: 'Dos' });
      const tel = '987791001';
      await pedidoAMano(e, tel, 'I-1');
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const primero = await motorizadoDe(e, tel);
      const n = e.mensajesA(tel).length;
      e.avanzar(16);
      await e.trabajar();
      expect(await motorizadoDe(e, tel)).toBe(primero);
      e.avanzar(5);
      await e.trabajar();
      const segundo = await motorizadoDe(e, tel);
      expect(segundo).not.toBe(primero);
      expect(desde(e, primero, 0).map((m) => m.body)).toContainEqual(expect.stringMatching(/ya no lo llevas tú/));
      expect(alertasDe(await e.resumen(), 'motorizado_sin_minutos')).toEqual([]);
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('sin otro motorizado activo: sigue con el mismo, sale la alerta (Llamar / Pasar a otro) en Hoy y en la campana; al llegar otro se lo pasa solo y la alerta se va', async () => {
    const e = await armar({ motorizados: false });
    try {
      await e.api.post('/admin/motorizados', { telefono: '999000041', nombre: 'Solo' });
      const tel = '987791002';
      await pedidoAMano(e, tel, 'I-2');
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const n = e.mensajesA(tel).length;
      await pasan(e, 25);
      expect(await motorizadoDe(e, tel)).toBe(conPais('999000041'));
      let alertas = alertasDe(await e.resumen(), 'motorizado_sin_minutos');
      expect(alertas).toHaveLength(1);
      expect(alertas[0]).toMatchObject({ referencia: 'I-2', acciones: ['llamar_motorizado', 'reasignar'], motorizado: { phone: conPais('999000041') } });
      expect(alertas[0]!.texto).toMatch(/no dio sus minutos en .* y no hay otro motorizado activo/);
      const campana = await e.api.get<{ avisos: Array<{ tipo: string; texto: string; href: string }> }>('/admin/avisos');
      expect(campana.body.avisos).toContainEqual(expect.objectContaining({ tipo: 'hay_que_mirar_motorizado_sin_minutos', href: '/hoy' }));
      // Llega otro motorizado: en la siguiente vuelta se lo pasa solo.
      await e.api.post('/admin/motorizados', { telefono: '999000042', nombre: 'Otro' });
      await pasan(e, 10);
      expect(await motorizadoDe(e, tel)).toBe(conPais('999000042'));
      alertas = alertasDe(await e.resumen(), 'motorizado_sin_minutos');
      expect(alertas).toEqual([]);
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('sin ubicación a las 12:00 (hora editable): alerta con «Asignar motorizado sin ubicación»; al asignarlo la alerta se va', async () => {
    const e = await armar();
    try {
      const tel = '987791003';
      const id = await pedidoEn(e, tel, 'I-3', 'Miraflores');
      expect(alertasDe(await e.resumen(), 'sin_ubicacion')).toEqual([]);
      await e.entregas.guardarAjustes({ alertaSinUbicacionHora: '10:00' });
      e.avanzar(61);
      const n = e.mensajesA(tel).length;
      const alertas = alertasDe(await e.resumen(), 'sin_ubicacion');
      expect(alertas).toHaveLength(1);
      expect(alertas[0]).toMatchObject({ entregaId: id, acciones: ['sin_ubicacion'] });
      expect(alertas[0]!.texto).toMatch(/Son más de las 10:00/);
      const r = await e.api.post(`/admin/entregas/${id}/sin-ubicacion`, {});
      expect(r.status).toBe(200);
      expect(alertasDe(await e.resumen(), 'sin_ubicacion')).toEqual([]);
      expect(e.mensajesA(tel)).toHaveLength(n);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('en camino pasada su hora + 30 min sin «entregado»: alerta con el motorizado (Llamar / Marcar entregado); «Marcar entregado» la quita', async () => {
    const e = await armar();
    try {
      const tel = '987791004';
      await pedidoAMano(e, tel, 'I-4');
      await e.contesta(tel, { pin: PIN_LIMA });
      await e.trabajar();
      const moto = await motorizadoDe(e, tel);
      await e.contesta(moto, { texto: '30' });
      let fila = (await foto(e, tel)).filas[0]!;
      expect(fila.estado).toBe('avisada');
      const minutosHasta = Math.round((fila.llegaAproxAt!.getTime() - e.ahora().getTime()) / 60_000);
      e.avanzar(minutosHasta + 29);
      expect(alertasDe(await e.resumen(), 'en_camino_tarde')).toEqual([]);
      e.avanzar(2);
      const alertas = alertasDe(await e.resumen(), 'en_camino_tarde');
      expect(alertas).toHaveLength(1);
      expect(alertas[0]).toMatchObject({ referencia: 'I-4', acciones: ['llamar_motorizado', 'marcar_entregada'], motorizado: { phone: moto } });
      const campana = await e.api.get<{ avisos: Array<{ tipo: string }> }>('/admin/avisos');
      expect(campana.body.avisos.map((a) => a.tipo)).toContain('hay_que_mirar_en_camino_tarde');
      const r = await e.api.post(`/admin/entregas/${fila.id}/entregada`, {});
      expect(r.status).toBe(200);
      fila = (await foto(e, tel)).filas[0]!;
      expect(fila.estado).toBe('entregada');
      expect(alertasDe(await e.resumen(), 'en_camino_tarde')).toEqual([]);
    } finally {
      await e.cerrar();
    }
  }, 60_000);

  it('Hoy pinta la tarjeta «Hay que mirar» (solo si hay algo), el chip «dirección escrita» y los cuatro tiempos nuevos en Ajustes → Tiempos', () => {
    const html = entregasPage({ disponible: true, configured: true, demo: false, nombreNegocio: 'GSG' });
    expect(html).toContain('id="caja-mirar"');
    expect(html).toContain('Hay que mirar');
    expect(html).toContain('dirección escrita');
    for (const id of ['aj-pin-km', 'aj-reasignar', 'aj-alerta-ubi', 'aj-alerta-camino', 'aj-buscar-mapa']) expect(html).toContain(`id="${id}"`);
    expect(html).toContain('Distancia máxima entre el pin y el distrito (km)');
    expect(html).toContain('Llamar al motorizado');
    expect(html).toContain('Marcar entregado');
  });
});
