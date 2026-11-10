/**
 * BAJA y «borren mis datos» (regla del dueño, 09/11): el sistema lo reconoce
 * (reglas o IA), lo apunta y lo pasa a una persona; NO da de baja ni borra
 * nada solo. El borrado lo hace el equipo desde la web y deja al cliente
 * libre para empezar de cero con un pedido nuevo.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectarPrivacidad, hayPistaDePrivacidad, leerClasePrivacidad, privacidadPorReglas } from '../src/privacidad/detectar.js';
import { crearPrivacidadRepo, numeroOculto, variantesDelNumero, type PrivacidadRepo, type SolicitudPrivacidad } from '../src/privacidad/repo.js';
import { handleInboundMessage } from '../src/handlers/inbound.js';
import { loadConfig } from '../src/config.js';
import { createSender } from '../src/outbound/sender.js';
import { createRepos, type Repos } from '../src/db/repos.js';
import type { Pool } from '../src/db/pool.js';
import { createFakeRepos, createFakeWhatsApp } from './fakes.js';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';

describe('reconocer el pedido del cliente', () => {
  it('las reglas reconocen la baja con las frases de siempre', () => {
    for (const t of ['BAJA', 'baja.', 'Stop', 'Denme de baja por favor', 'no me escriban más', 'Ya no me escriban', 'dejen de escribirme', 'No quiero recibir más mensajes', 'sáquenme de su lista', 'esto es spam']) {
      expect(privacidadPorReglas(t), t).toBe('baja');
    }
  });

  it('las reglas reconocen el pedido de borrar los datos (y gana a la baja)', () => {
    for (const t of ['Borren mis datos', 'quiero que eliminen toda mi información', 'eliminen mi número de su sistema', 'no me escriban más y borren mis datos', 'solicito la eliminación de datos', 'derecho de cancelación']) {
      expect(privacidadPorReglas(t), t).toBe('borrar_datos');
    }
  });

  it('lo que no es eso no salta: cancelar un pedido, hablar del motorizado, mandar la dirección', () => {
    for (const t of ['ok gracias', 'cancelar el pedido', 'no me manden al motorizado antes de las 3', 'no estoy en casa, mándenlo mañana', 'Av. Brasil 1234, Jesús María', 'ya les mandé mi ubicación', 'bajo en 5 minutos', 'la baja de precios está buena?', 'quiero el pedido de nuevo']) {
      expect(privacidadPorReglas(t), t).toBeNull();
    }
  });

  it('la IA solo se consulta si hay una pista, y solo clasifica', async () => {
    expect(hayPistaDePrivacidad('ok')).toBe(false);
    expect(hayPistaDePrivacidad('ya no quiero que me lleguen sus mensajes')).toBe(true);
    let llamadas = 0;
    const ia = async () => { llamadas++; return 'BAJA'; };
    expect(await detectarPrivacidad('ok gracias', ia)).toBeNull();
    expect(llamadas).toBe(0);
    expect(await detectarPrivacidad('ya no quiero que me lleguen sus mensajes', ia)).toEqual({ tipo: 'baja', como: 'ia' });
    expect(await detectarPrivacidad('saquen mi información de su base, no autoricé nada', async () => 'BORRAR')).toEqual({ tipo: 'borrar_datos', como: 'ia' });
    expect(await detectarPrivacidad('me escribieron por mi pedido?', async () => 'OTRA')).toBeNull();
    // La IA caída no rompe nada: el mensaje sigue su camino.
    expect(await detectarPrivacidad('ya me cansaron sus mensajes', async () => { throw new Error('sin red'); })).toBeNull();
    // Sin IA, las reglas siguen funcionando.
    expect(await detectarPrivacidad('BAJA')).toEqual({ tipo: 'baja', como: 'reglas' });
    expect(leerClasePrivacidad('Borrar.')).toBe('borrar_datos');
    expect(leerClasePrivacidad('no sé')).toBeNull();
  });

  it('numero oculto y variantes del número', () => {
    expect(numeroOculto('51987654321')).toBe('•••••••4321');
    expect(variantesDelNumero('51987654321')).toEqual(expect.arrayContaining(['51987654321', '987654321', '+51987654321']));
  });
});

/** La misma logica que el repositorio de MySQL, en memoria, para probar el entrante. */
function privacidadEnMemoria(): PrivacidadRepo & { filas: SolicitudPrivacidad[] } {
  const filas: SolicitudPrivacidad[] = [];
  return {
    filas,
    async registrar(s) {
      const ya = filas.find((f) => f.phone === s.phone && f.tipo === s.tipo && f.estado === 'pendiente');
      if (ya) return { solicitud: ya, nueva: false };
      const nueva: SolicitudPrivacidad = { id: filas.length + 1, ...s, estado: 'pendiente', atendidaComo: null, atendidaPor: null, atendidaAt: null, createdAt: new Date(), updatedAt: new Date() };
      filas.push(nueva);
      return { solicitud: nueva, nueva: true };
    },
    async pendientes() { return filas.filter((f) => f.estado === 'pendiente'); },
    async contarPendientes() { return filas.filter((f) => f.estado === 'pendiente').length; },
    async pendientesDe(phone) { return filas.filter((f) => f.phone === phone && f.estado === 'pendiente'); },
    async atender() { return 0; },
    async borrarDatosDelCliente() { throw new Error('no se usa aquí'); },
  };
}

describe('un cliente escribe «BAJA» por WhatsApp', () => {
  const config = loadConfig({
    PUBLIC_BASE_URL: 'https://ejemplo.test',
    DATABASE_URL: 'mysql://x/y',
    WHATSAPP_PROVIDER: 'local',
    GOOGLE_MAPS_API_KEY: 'maps-key',
    TRACKING_SECRET: 'x'.repeat(40),
    GEO_BBOX: 'lima',
  } as NodeJS.ProcessEnv);

  async function escribir(texto: string, id: string, repos = createFakeRepos(), privacidad = privacidadEnMemoria()) {
    (repos as unknown as Repos).privacidad = privacidad;
    const wa = createFakeWhatsApp();
    const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 50, growth: 1.5, hardCap: 1000 }, maxMarketingPerContact7d: 2 });
    await handleInboundMessage({ id, from: '51987654321', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: texto } }, 'Rosa', { repos, sender, wa, config, rafagaMs: 0 });
    return { repos, privacidad, wa };
  }

  it('se apunta, se calla el bot, se le contesta una vez y NO se le da de baja', async () => {
    const { repos, privacidad, wa } = await escribir('BAJA', 'wamid.baja.1');
    expect(privacidad.filas).toHaveLength(1);
    expect(privacidad.filas[0]).toMatchObject({ phone: '51987654321', tipo: 'baja', como: 'reglas', estado: 'pendiente', texto: 'BAJA' });
    const c = await repos.contacts.getByPhone('51987654321');
    expect(c?.optOutAt).toBeNull();
    expect(c?.botPausadoAt).toBeTruthy();
    const enviados = wa.sent.filter((s) => JSON.stringify(s).includes('Recibimos tu pedido de no recibir más mensajes'));
    expect(enviados).toHaveLength(1);

    // Lo repite: no se duplica el aviso ni se le vuelve a contestar.
    await escribir('baja!!', 'wamid.baja.2', repos, privacidad);
    expect(privacidad.filas).toHaveLength(1);
  });

  it('«borren mis datos» queda como su propio estado', async () => {
    const { privacidad, repos } = await escribir('Por favor borren mis datos', 'wamid.borrar.1');
    expect(privacidad.filas[0]).toMatchObject({ tipo: 'borrar_datos', estado: 'pendiente' });
    expect((await repos.contacts.getByPhone('51987654321'))?.optOutAt).toBeNull();
  });

  it('un mensaje normal no se apunta', async () => {
    const { privacidad } = await escribir('hola, a qué hora llega mi pedido?', 'wamid.normal.1');
    expect(privacidad.filas).toHaveLength(0);
  });
});

describe('eliminar los datos del cliente (MySQL)', () => {
  let b: BaseDePrueba;
  let pool: Pool;
  let repos: Repos;
  let repo: PrivacidadRepo;
  const phone = '51911222333';

  beforeAll(async () => {
    b = await baseDePrueba();
    pool = b.pool;
    repos = createRepos(pool);
    repo = crearPrivacidadRepo(pool);
  }, 300_000);

  afterAll(async () => {
    await b?.cerrar();
  });

  it('la migración 020 crea la tabla', async () => {
    const hechas = await pool.query<{ name: string }>('select name from schema_migrations');
    expect(hechas.rows.map((r) => r.name)).toContain('020_solicitudes_privacidad.sql');
  });

  it('registrar no duplica la pendiente del mismo tipo y cuenta para la campana', async () => {
    const a = await repo.registrar({ phone, contactId: null, tipo: 'baja', texto: 'BAJA', como: 'reglas' });
    const b2 = await repo.registrar({ phone, contactId: null, tipo: 'baja', texto: 'baja otra vez', como: 'reglas' });
    expect(a.nueva).toBe(true);
    expect(b2.nueva).toBe(false);
    expect(b2.solicitud.id).toBe(a.solicitud.id);
    expect(b2.solicitud.texto).toBe('baja otra vez');
    await repo.registrar({ phone, contactId: null, tipo: 'borrar_datos', texto: 'borren mis datos', como: 'ia' });
    expect(await repo.contarPendientes()).toBe(2);
    expect((await repo.pendientesDe(phone)).map((s) => s.tipo).sort()).toEqual(['baja', 'borrar_datos']);
  });

  it('borra todo lo del cliente, deja la constancia sin su número y el cliente puede volver a empezar', async () => {
    const contacto = await repos.contacts.upsertFromInbound(phone, 'Rosa');
    await repos.messages.add({ contactId: contacto.id, direction: 'in', wamid: 'wamid.x1', kind: 'text', body: 'borren mis datos', payload: null, createdAt: new Date() });
    await repos.messages.add({ contactId: contacto.id, direction: 'out', wamid: 'wamid.x2', kind: 'text', body: 'Recibimos tu pedido', payload: null, createdAt: new Date() });
    const { entrega } = await repos.entregas.crearEntrega({ dia: '2026-11-09', referencia: 'PRIV-1', phone, nombre: 'Rosa', ubicacionEstado: 'pendiente', confirmacionEstado: 'no_hace_falta', estado: 'pendiente' });
    const lote = await repos.rutas.crearLote({ nombre: 'Lote privacidad' });
    await repos.rutas.agregarSolicitudes(lote.id, [{ telefonoCrudo: '911222333', phone, nombre: 'Rosa', referencia: 'PRIV-1' }]);
    // Otro cliente no se toca.
    const otro = await repos.contacts.upsertFromInbound('51900000999', 'Otro');
    await repos.messages.add({ contactId: otro.id, direction: 'in', wamid: 'wamid.otro', kind: 'text', body: 'hola', payload: null, createdAt: new Date() });

    const r = await repo.borrarDatosDelCliente(phone, 'Ana');
    expect(r.contacto).toBe(true);
    expect(r.mensajes).toBe(2);
    expect(r.pedidos).toBe(1);
    expect(r.wamids.sort()).toEqual(['wamid.x1', 'wamid.x2']);
    expect(r.solicitudesUbicacion).toBe(1);

    expect(await repos.contacts.getByPhone(phone)).toBeNull();
    expect(await repos.entregas.entrega(entrega.id)).toBeNull();
    expect(await repos.rutas.listarSolicitudes({ loteId: lote.id, limit: 10, offset: 0 })).toHaveLength(0);
    const quedan = await pool.query<{ n: number }>('select count(*) as n from messages where contact_id = $1', [contacto.id]);
    expect(Number(quedan.rows[0]?.n)).toBe(0);
    // El otro cliente sigue igual.
    expect(await repos.contacts.getByPhone('51900000999')).not.toBeNull();

    // La constancia: atendida como «datos_borrados», sin el número completo ni el texto.
    const { rows } = await pool.query<{ phone: string; texto: string | null; estado: string; atendida_como: string; atendida_por: string }>('select phone, texto, estado, atendida_como, atendida_por from solicitudes_privacidad');
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const f of rows) {
      expect(f.phone).toBe(numeroOculto(phone));
      expect(f.texto).toBeNull();
      expect(f.estado).toBe('atendida');
    }
    expect(rows.some((f) => f.atendida_como === 'datos_borrados' && f.atendida_por === 'Ana')).toBe(true);
    expect(await repo.contarPendientes()).toBe(0);

    // Vuelve a escribir (o entra un pedido nuevo): es un cliente nuevo, de cero.
    const nuevo = await repos.contacts.upsertFromInbound(phone, 'Rosa');
    expect(nuevo.id).not.toBe(contacto.id);
    expect(nuevo.optOutAt).toBeNull();
    expect(nuevo.botPausadoAt ?? null).toBeNull();
    const { entrega: otraVez } = await repos.entregas.crearEntrega({ dia: '2026-11-10', referencia: 'PRIV-2', phone, nombre: 'Rosa', ubicacionEstado: 'pendiente', confirmacionEstado: 'no_hace_falta', estado: 'pendiente' });
    expect(otraVez.id).toBeGreaterThan(0);
  });
});
