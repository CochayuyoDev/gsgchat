/**
 * El caso del 11/11 en producción: un pedido salió como «no contestó» y en su
 * chat no había ningún mensaje. Regla del dueño: que no vuelva a pasar o, si
 * pasa, que se sepa por qué.
 *
 *  - «No contestó» solo si de verdad le llegó algo. Si ninguno de los mensajes
 *    contados está en su chat (o WhatsApp lo rechazó), la incidencia es
 *    `no_se_le_escribio`, con el porqué de cada uno, y GSG la recibe.
 *  - «Ver qué pasó con este pedido» lo explica también en pedidos viejos:
 *    solo lee lo que ya se guardaba.
 */
import { describe, expect, it } from 'vitest';
import { crearEscenarioEntregas, OBLIGATORIOS_GSG, type EscenarioEntregas } from './escenario-entregas.js';

const tel = '987601777';
const pedido = { ...OBLIGATORIOS_GSG, tracking: 'NOESCRITO-1', cliente: 'Cliente de prueba', telefono: tel };

/** El pedido con su primer mensaje mandado de verdad y la espera final ya vencida. */
async function conPlazoVencido(e: EscenarioEntregas) {
  await e.api.post('/api/v1/entregas', pedido);
  await e.trabajar();
  const s = e.repos.rutas._solicitudes[0]!;
  await e.repos.rutas.actualizarSolicitud(s.id, {
    estado: 'enviado',
    intentos: 4,
    ultimoEnvioAt: e.ahora(),
    proximoIntentoAt: new Date(e.ahora().getTime() + 5 * 60_000),
  });
  return s.id;
}

const solicitud = (e: EscenarioEntregas, id: number) => e.repos.rutas._solicitudes.find((s) => s.id === id)!;
const wamidsContados = (e: EscenarioEntregas, id: number) =>
  e.repos.rutas._eventos.filter((x) => x.solicitudId === id && x.tipo === 'envio').map((x) => String(x.payload?.wamid ?? ''));

interface QuePaso {
  diagnostico: { tono: string; titulo: string; porque: string; queHacer: string | null };
  cifras: Record<string, number>;
  linea: Array<{ que: string }>;
}

describe('«no contestó» solo si de verdad se le escribió', () => {
  it('con el mensaje en su chat, sigue siendo «no contestó» (lo de siempre)', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const id = await conPlazoVencido(e);
      expect(wamidsContados(e, id).length).toBeGreaterThan(0);
      e.avanzar(6);
      await e.trabajar();
      expect(solicitud(e, id)).toMatchObject({ estado: 'derivado', incidencia: 'sin_respuesta' });
    } finally {
      await e.cerrar();
    }
  });

  it('si WhatsApp rechazó todos los mensajes contados, es «no se le llegó a escribir» y GSG lo recibe', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const id = await conPlazoVencido(e);
      // El rechazo se apunta directo en el repo: sin pasar por el aviso que ya lo corrige al momento
      // (como en producción antes del 11/11, cuando ese aviso no existía o no llegó).
      for (const w of wamidsContados(e, id)) await e.repos.messages.setStatusByWamid(w, 'failed', { code: '131049', title: 'healthy ecosystem' });
      e.avanzar(6);
      await e.trabajar();
      const s = solicitud(e, id);
      expect(s).toMatchObject({ estado: 'derivado', incidencia: 'no_se_le_escribio' });
      expect(s.incidenciaDetalle).toMatch(/WhatsApp no entregó/);
      expect(e.repos.rutas._reportes.some((r) => r.tipo === 'incidencia' && r.payload.codigo === 'no_se_le_escribio')).toBe(true);
    } finally {
      await e.cerrar();
    }
  });

  it('si los mensajes contados no están en ningún chat, lo dice con su identificador', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const id = await conPlazoVencido(e);
      for (const ev of e.repos.rutas._eventos) {
        if (ev.solicitudId === id && ev.tipo === 'envio') ev.payload = { ...(ev.payload ?? {}), wamid: 'wamid.QUE_NO_EXISTE' };
      }
      e.avanzar(6);
      await e.trabajar();
      const s = solicitud(e, id);
      expect(s.incidencia).toBe('no_se_le_escribio');
      expect(s.incidenciaDetalle).toMatch(/no quedó guardado en ningún chat \(wamid\.QUE_NO_EXISTE\)/);
    } finally {
      await e.cerrar();
    }
  });

  it('pasar al repartidor a mano antes de escribirle no lo marca «no contestó»', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido);
      const s = e.repos.rutas._solicitudes[0]!;
      expect(s.intentos).toBe(0);
      await e.api.post(`/admin/rutas/solicitudes/${s.id}/derivar`, {});
      expect(solicitud(e, s.id)).toMatchObject({ estado: 'derivado', incidencia: 'no_se_le_escribio' });
    } finally {
      await e.cerrar();
    }
  });
});

describe('«Ver qué pasó con este pedido»', () => {
  it('explica un pedido viejo marcado «no contestó» al que no le llegó nada', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const id = await conPlazoVencido(e);
      // Así quedaba antes del arreglo: «no contestó» con mensajes que no llegaron.
      for (const w of wamidsContados(e, id)) await e.repos.messages.setStatusByWamid(w, 'failed', { code: '131049', title: 'healthy ecosystem' });
      await e.repos.rutas.actualizarSolicitud(id, { estado: 'derivado', incidencia: 'sin_respuesta', incidenciaDetalle: 'no contestó a 4 mensajes', proximoIntentoAt: null });

      const r = await e.api.get<QuePaso>(`/admin/rutas/solicitudes/${id}/que-paso`);
      expect(r.status).toBe(200);
      expect(r.body.diagnostico).toMatchObject({ tono: 'bad', titulo: 'No se le llegó a escribir' });
      expect(r.body.diagnostico.porque).toMatch(/Por eso decía «no contestó», y no era cierto/);
      expect(r.body.cifras.leLlegaron).toBe(0);
    } finally {
      await e.cerrar();
    }
  });

  it('en un pedido de hace más de 72 h sin registros no afirma nada: dice que ya no se puede comprobar', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const id = await conPlazoVencido(e);
      // Como un pedido viejo de producción: el chat ya se borró (72 h) y el envío no está en `deliveries`.
      for (const ev of e.repos.rutas._eventos) {
        if (ev.solicitudId === id && ev.tipo === 'envio') {
          ev.payload = { ...(ev.payload ?? {}), wamid: 'wamid.BORRADO_POR_ANTIGUEDAD' };
          ev.createdAt = new Date('2020-01-01T15:00:00Z');
        }
      }
      await e.repos.rutas.actualizarSolicitud(id, { estado: 'derivado', incidencia: 'sin_respuesta', proximoIntentoAt: null });
      const r = await e.api.get<QuePaso>(`/admin/rutas/solicitudes/${id}/que-paso`);
      expect(r.body.diagnostico).toMatchObject({ tono: 'warn', titulo: 'Ya no se puede comprobar si le llegó' });
    } finally {
      await e.cerrar();
    }
  });

  it('un pedido en curso cuenta lo que salió y lo que espera', async () => {
    const e = await crearEscenarioEntregas();
    try {
      await e.api.post('/api/v1/entregas', pedido);
      await e.trabajar();
      const id = e.repos.rutas._solicitudes[0]!.id;
      const r = await e.api.get<QuePaso>(`/admin/rutas/solicitudes/${id}/que-paso`);
      expect(r.status).toBe(200);
      expect(r.body.diagnostico.titulo).toBe('Esperando su respuesta');
      expect(r.body.linea.some((p) => /Salió/.test(p.que))).toBe(true);
    } finally {
      await e.cerrar();
    }
  });

  it('un id que no existe da 404 con el motivo', async () => {
    const e = await crearEscenarioEntregas();
    try {
      const r = await e.api.get('/admin/rutas/solicitudes/99999/que-paso');
      expect(r.status).toBe(404);
    } finally {
      await e.cerrar();
    }
  });
});
