/**
 * Caso real del 28/09 (GSG-IA-001): el servidor se reinició a las 9:38:03 y el
 * cliente escribió a las 9:38:07 «¿cuánto tiempo se tarda el pedido?». Llegó
 * en la sincronización como `append` y se guardó sin contestar.
 *
 * La regla del incidente del 11/09 (69 mensajes a 10 clientes al reconectar)
 * se mantiene: lo viejo que se reentrega al reconectar se guarda sin
 * contestar, y lo ya visto (mismo wamid) no se atiende dos veces. Pero un
 * `append` recién escrito se atiende como cualquier mensaje.
 */

import { describe, expect, it } from 'vitest';
import { processChange } from '../src/whatsapp/webhook.js';
import { createSender } from '../src/outbound/sender.js';
import { loadConfig } from '../src/config.js';
import { EDAD_APPEND_FRESCO_MS, esMensajeViejo, MAXIMA_EDAD_PARA_CONTESTAR_MS, resetLocalForTests, startLocal, type LocalSocket } from '../src/whatsapp/local/session.js';
import { createFakeRepos, createFakeSettings, createFakeWhatsApp } from './fakes.js';
import type { ChangeValue } from '../src/whatsapp/types.js';

const ENV = {
  PUBLIC_BASE_URL: 'https://ejemplo.test',
  DATABASE_URL: 'postgres://x/y',
  WHATSAPP_TOKEN: 't',
  WHATSAPP_PHONE_NUMBER_ID: 'PNID',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'WABA',
  WHATSAPP_APP_SECRET: 's',
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TRACKING_SECRET: 'x'.repeat(40),
  GEO_BBOX: 'lima',
};

async function build() {
  const config = loadConfig(ENV as NodeJS.ProcessEnv);
  const settings = await createFakeSettings(config);
  const repos = createFakeRepos();
  const wa = createFakeWhatsApp();
  const sender = createSender({ repos, wa, phoneNumberId: 'PNID', warmup: { startPerDay: 5000, growth: 2, hardCap: 10000 }, maxMarketingPerContact7d: 2, soloNumeros: config.soloNumeros });
  return { deps: { repos, wa, sender, config, settings }, repos, wa };
}

/** Una sesión local con un socket de mentira: devuelve cómo inyectar eventos y lo que entregó. */
async function sesionFalsa() {
  resetLocalForTests();
  const handlers = new Map<string, (arg: unknown) => void>();
  const recibidos: ChangeValue[] = [];
  const sock: LocalSocket = {
    async sendMessage() {
      return { key: { id: 'x' } };
    },
    async readMessages() {},
    async requestPairingCode() {
      return 'ABCD1234';
    },
    async logout() {},
    end() {},
    ev: { on: (evento, handler) => handlers.set(evento, handler as (arg: unknown) => void) },
    user: { id: '51900000000:1@s.whatsapp.net', name: 'GSG' },
  };
  const promesa = startLocal({
    authDir: 'C:/x',
    createSocket: async () => ({ sock, saveCreds: async () => {} }),
    onChange: (value) => {
      recibidos.push(value);
    },
  });
  for (let i = 0; i < 100 && !handlers.has('messages.upsert'); i++) await new Promise((r) => setTimeout(r, 5));
  handlers.get('connection.update')?.({ connection: 'open' });
  await promesa;
  const esperar = async (n: number) => {
    for (let i = 0; i < 400 && recibidos.length < n; i++) await new Promise((r) => setTimeout(r, 5));
  };
  return { handlers, recibidos, esperar };
}

const mensaje = (id: string, telefono: string, ts: number, texto: string) => ({
  key: { id, remoteJid: `${telefono}@s.whatsapp.net`, fromMe: false },
  messageTimestamp: ts,
  message: { conversation: texto },
});

describe('append al reconectar: lo fresco se atiende, lo viejo no', () => {
  it('la regla pura: fresco = menos de 3 min, o escrito después de la última conexión (dentro de 10 min)', () => {
    const ahora = Date.now();
    const hace = (seg: number) => Math.floor((ahora - seg * 1000) / 1000);
    expect(EDAD_APPEND_FRESCO_MS).toBe(3 * 60_000);
    expect(esMensajeViejo('append', hace(4), ahora)).toBe(false);
    expect(esMensajeViejo('append', hace(170), ahora)).toBe(false);
    expect(esMensajeViejo('append', hace(200), ahora)).toBe(true);
    // Se cortó hace 6 min: lo escrito después (hace 5 min) nunca se vio en vivo → se atiende.
    expect(esMensajeViejo('append', hace(300), ahora, { conectadaHastaMs: ahora - 6 * 60_000 })).toBe(false);
    // Lo escrito ANTES del corte ya se vio (o era viejo): no.
    expect(esMensajeViejo('append', hace(420), ahora, { conectadaHastaMs: ahora - 6 * 60_000 })).toBe(true);
    // Aunque sea posterior al corte, pasados los 10 min ya no se contesta (un apagón largo).
    expect(esMensajeViejo('append', hace(MAXIMA_EDAD_PARA_CONTESTAR_MS / 1000 + 60), ahora, { conectadaHastaMs: ahora - 3 * 3600_000 })).toBe(true);
    // Sin hora no se puede saber: un append sigue siendo viejo.
    expect(esMensajeViejo('append', undefined, ahora)).toBe(true);
  });

  it('ráfaga al reconectar: 20 append viejos de 10 clientes NO se contestan; el recién escrito SÍ; el ya atendido no se repite', async () => {
    const { deps, wa, repos } = await build();
    const { handlers, recibidos, esperar } = await sesionFalsa();
    const ahoraSeg = Math.floor(Date.now() / 1000);

    // Un mensaje ya atendido en vivo antes del reinicio.
    handlers.get('messages.upsert')?.({ type: 'notify', messages: [mensaje('YA-ATENDIDO', '51911000099', ahoraSeg - 20, 'hola')] });
    await esperar(1);
    await processChange('messages', recibidos[0]!, deps);
    const trasPrimero = wa.sent.filter((m) => String(m.to) === '51911000099' && m.kind !== 'read').length;
    expect(trasPrimero).toBeGreaterThan(0);

    // El reinicio: la cola de lo que se acumuló, todo como `append`.
    const viejos = [];
    for (let c = 0; c < 10; c++) {
      for (let k = 0; k < 2; k++) viejos.push(mensaje(`VIEJO-${c}-${k}`, `5191100000${c}`, ahoraSeg - (30 + c * 15 + k) * 60, `mensaje viejo ${k}`));
    }
    handlers.get('messages.upsert')?.({ type: 'append', messages: [...viejos, mensaje('YA-ATENDIDO', '51911000099', ahoraSeg - 20, 'hola'), mensaje('FRESCO', '51912426667', ahoraSeg - 4, 'cuanto tiempo se tarda el pedido')] });
    await esperar(1 + 22);
    const lote = recibidos.slice(1);
    expect(lote).toHaveLength(22);
    const marca = Object.fromEntries(lote.map((v) => [v.messages![0]!.id, v.messages![0]!.viejo ?? false]));
    for (const m of viejos) expect(marca[m.key.id], m.key.id).toBe(true);
    expect(marca.FRESCO).toBe(false);
    // Lo ya atendido pasa el filtro de edad (es de hace 20 s)... y lo para el wamid.
    expect(marca['YA-ATENDIDO']).toBe(false);

    for (const v of lote) await processChange('messages', v, deps);
    const salientes = wa.sent.filter((m) => m.kind !== 'read');
    // Ni una letra a los 10 clientes del lote viejo.
    for (let c = 0; c < 10; c++) expect(salientes.filter((m) => String(m.to) === `5191100000${c}`), `cliente ${c}`).toHaveLength(0);
    // Todos quedaron guardados en su hilo.
    expect(repos.messages._all.filter((m) => String(m.wamid ?? '').startsWith('VIEJO-'))).toHaveLength(20);
    // El recién escrito sí tuvo respuesta.
    expect(salientes.filter((m) => String(m.to) === '51912426667').length).toBeGreaterThan(0);
    // Y el ya atendido no se contestó otra vez.
    expect(salientes.filter((m) => String(m.to) === '51911000099')).toHaveLength(trasPrimero);
  });

  it('lo que llega del historial del teléfono nunca se contesta, aunque sea de hace segundos', async () => {
    const { handlers, recibidos, esperar } = await sesionFalsa();
    const ahoraSeg = Math.floor(Date.now() / 1000);
    handlers.get('messaging-history.set')?.({ messages: [mensaje('HIST-1', '51912426667', ahoraSeg - 5, 'hola')], syncType: 6 });
    await esperar(1);
    expect(recibidos[0]!.messages![0]!.viejo).toBe(true);
  });
});
