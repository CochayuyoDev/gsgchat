/**
 * El sistema de GSG de mentira: para probar el flujo entero sin que GSG
 * tenga API todavia.
 *
 * GSGchat no le pregunta nada (tampoco al de verdad): lo que se carga en el
 * simulador entra en el sistema por `enviarListaDelSimulador`, como si GSG lo
 * empujara, sin red y en memoria.
 *
 * Se comporta como se espera que se comporte el de verdad, con el contrato
 * de src/rutas/gsg.ts:
 *
 *  - Tiene la lista del dia con tres apartados: a quien **falta pedir la
 *    ubicacion**, a quien **falta confirmar** y quien **ya termino**.
 *    `GET /reparto/estado` la ensena (para mirarla desde fuera); GSGchat no
 *    la lee por red: se la pasa `enviarListaDelSimulador`, en memoria.
 *  - Recibe lo que este sistema le manda: `POST /ubicaciones`,
 *    `POST /confirmaciones`, `POST /entregas` (la hora de llegada),
 *    `POST /incidencias` y `POST /resumenes`.
 *  - Cuando un cliente tiene las dos cosas (ubicacion y confirmacion, o
 *    solo la que le faltaba) lo pasa solo a **terminados**. Un cliente que
 *    no confirma pasa a **cancelados**.
 *  - GSG tambien puede **cancelar** un pedido por su cuenta o **cambiarle**
 *    el telefono, la direccion o el distrito despues de haberlo mandado
 *    (`POST /reparto/cancelar`, `POST /reparto/cambiar`): en la lista sale
 *    con `cancelado: true` y `motivoCancelacion`, o con los datos nuevos.
 *    Una lista vacia o un fallo NO cancela nada: solo `cancelado: true`,
 *    pedido a pedido.
 *
 * Vive en memoria dentro de este mismo servidor, colgado de
 * `/simulador/gsg`, y exige la misma clave que usaria la API real: en la
 * cabecera `X-API-Key` (un `Authorization: Bearer` solo se rechaza con 401). Desde la
 * pantalla se carga con los diez clientes ficticios y se reinicia. Las
 * pruebas lo usan igual.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { igualSeguro } from '../util/comparar.js';
import { CLIENTES_DE_PRUEBA, type ClienteDePrueba } from './datos-de-prueba.js';
import { datosEnvioDeCrudo } from './datos-envio.js';
import type { DatosEnvio } from './repo.js';
import type { PendientesGsg, ResultadoSincronizacion, ServicioEntregas } from './servicio.js';

export interface ClienteSimulado {
  referencia: string;
  telefono: string;
  nombre: string;
  direccion: string | null;
  distrito: string | null;
  notas: string | null;
  necesitaUbicacion: boolean;
  necesitaConfirmacion: boolean;
  /** Lo que GSG ya sabe (si el cliente lo dio en un pedido anterior). */
  lat: number | null;
  lng: number | null;
  /** GSG puede marcar el pedido como urgente: sale primero hacia el motorizado. */
  urgente: boolean;
  /** GSG lo cancelo por su cuenta (no el cliente por WhatsApp). */
  canceladoPorGsg: boolean;
  motivoCancelacion: string | null;
  /** GSG cambio telefono/direccion/distrito despues de mandarlo. */
  cambiadoEn: string | null;
  /** Producto, empresa, codigo de seguimiento, numero de pedido, pago, monto y quien firma (el primer mensaje al cliente). */
  datosEnvio: DatosEnvio | null;
  ubicacion: { lat: number; lng: number; mapsUrl: string | null; corregida: boolean; en: string } | null;
  confirmacion: { confirmada: boolean; respuesta: string | null; como: string | null; motivo: string | null; en: string } | null;
  entrega: { motorizado: unknown; minutosMotorizado: number | null; minutosAviso: number | null; llegaAproxEn: string | null; en: string; entregadoEn: string | null; entregadaComo: string | null; incidencia: string | null; segundaVisita: boolean; visitas: number } | null;
  estado: 'pendiente' | 'terminado' | 'cancelado';
  terminadoEn: string | null;
}

export interface EstadoSimulador {
  dia: string;
  clientes: ClienteSimulado[];
  faltaUbicacion: number;
  faltaConfirmacion: number;
  terminados: number;
  cancelados: number;
  recibidos: { ubicaciones: number; confirmaciones: number; entregas: number; incidencias: number; resumenes: number };
  llamadas: number;
  ultimaLlamadaEn: string | null;
}

export interface GsgSimulado {
  /** La lista del dia con sus apartados (lo que el simulador le manda a GSGchat en memoria). */
  pendientes(): { dia: string; faltaUbicacion: Record<string, unknown>[]; faltaConfirmacion: Record<string, unknown>[]; terminados: Record<string, unknown>[]; cancelados: Record<string, unknown>[] };
  estado(): EstadoSimulador;
  /** Mete clientes en la lista del dia (los que ya estan, se dejan como estan). */
  cargar(clientes: Array<Partial<ClienteDePrueba> & { referencia: string; telefono: string }>): number;
  /** Los diez de siempre. */
  cargarDePrueba(): number;
  /** GSG cancela un pedido por su cuenta: sale en `cancelados` con `cancelado: true`. */
  cancelar(referencia: string, motivo?: string): boolean;
  /** GSG cambia datos de un pedido ya mandado (telefono, direccion, distrito, nombre, notas, urgente). */
  cambiar(referencia: string, cambios: CambioPedidoSimulado): ClienteSimulado | null;
  reiniciar(): void;
  /** Lo recibido, tal cual llego (para las pruebas y la pantalla). */
  recibido: Array<{ tipo: string; cuerpo: Record<string, unknown>; en: string }>;
  /**
   * Como contesta ahora mismo: se cambia a mitad de prueba. `sin_red` corta la
   * conexion sin contestar (como un servidor que no se alcanza).
   */
  modo: 'ok' | 'caido' | 'rechaza' | 'sin_red';
  /** Atiende una llamada HTTP (lo usa el plugin y el fetch de las pruebas). */
  atender(method: string, ruta: string, token: string | null, cuerpo: unknown): { status: number; body: unknown };
}

export interface CambioPedidoSimulado {
  telefono?: string;
  nombre?: string;
  direccion?: string;
  distrito?: string;
  notas?: string;
  urgente?: boolean;
  /** Los datos del envio (se juntan con los que ya tenia). */
  datosEnvio?: DatosEnvio | null;
}

const cambioSchema = z.object({
  referencia: z.string().min(1).max(60),
  telefono: z.string().min(6).max(20).optional(),
  nombre: z.string().max(120).optional(),
  direccion: z.string().max(300).optional(),
  distrito: z.string().max(120).optional(),
  notas: z.string().max(300).optional(),
  urgente: z.boolean().optional(),
}).passthrough();

export interface OpcionesSimulador {
  token: string;
  ahora?: () => Date;
  /** El dia del reparto (AAAA-MM-DD). Por defecto, hoy en Lima. */
  dia?: () => string;
}

const clienteSchema = z.object({
  referencia: z.string().min(1).max(60),
  telefono: z.string().min(6).max(20),
  nombre: z.string().max(120).optional(),
  direccion: z.string().max(300).optional(),
  distrito: z.string().max(120).optional(),
  notas: z.string().max(300).optional(),
  lat: z.number().optional(),
  lng: z.number().optional(),
  faltaUbicacion: z.boolean().optional(),
  faltaConfirmacion: z.boolean().optional(),
  urgente: z.boolean().optional(),
}).passthrough();

/** Los datos del envio como los manda GSG: la empresa como {codigo, nombre}. */
export function datosEnvioParaGsg(d: DatosEnvio): Record<string, unknown> {
  const fuera: Record<string, unknown> = {};
  if (d.producto) fuera.producto = d.producto;
  if (d.empresaCodigo || d.empresaNombre) fuera.empresa = { codigo: d.empresaCodigo ?? null, nombre: d.empresaNombre ?? null };
  if (d.tracking) fuera.tracking = d.tracking;
  if (d.nroPedido) fuera.nroPedido = d.nroPedido;
  if (d.metodoPago) fuera.metodoPago = d.metodoPago;
  if (d.monto) fuera.monto = d.monto;
  if (d.remitente) fuera.remitente = d.remitente;
  // El motorizado que GSG ya asigno (opcional): su numero es el que se le da al cliente.
  if (d.motorizadoNombre || d.telefonoMotorizado) fuera.motorizado = { nombre: d.motorizadoNombre ?? null, telefono: d.telefonoMotorizado ?? null };
  if (d.horarioEntregaDesde && d.horarioEntregaHasta) fuera.horarioEntrega = { desde: d.horarioEntregaDesde, hasta: d.horarioEntregaHasta, ...(d.horarioEntregaFechaDesde ? { fechaDesde: d.horarioEntregaFechaDesde, fechaHasta: d.horarioEntregaFechaHasta, zonaHoraria: d.horarioEntregaZonaHoraria } : {}) };
  return fuera;
}

function diaEnLima(fecha: Date): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(fecha).slice(0, 10);
  } catch {
    return fecha.toISOString().slice(0, 10);
  }
}

export function crearGsgSimulado(opts: OpcionesSimulador): GsgSimulado {
  const ahora = opts.ahora ?? (() => new Date());
  const dia = opts.dia ?? (() => diaEnLima(ahora()));
  const clientes = new Map<string, ClienteSimulado>();
  const recibido: GsgSimulado['recibido'] = [];
  const contadores = { ubicaciones: 0, confirmaciones: 0, entregas: 0, incidencias: 0, resumenes: 0 };
  let llamadas = 0;
  let ultimaLlamadaEn: string | null = null;

  const publico = (c: ClienteSimulado): Record<string, unknown> => ({
    id: `gsg-${c.referencia}`,
    referencia: c.referencia,
    telefono: c.telefono,
    nombre: c.nombre,
    direccion: c.direccion,
    distrito: c.distrito,
    notas: c.notas,
    urgente: c.urgente,
    // Lo que sale en el primer mensaje al cliente (ver /api/v1/openapi.json).
    ...(c.datosEnvio ? datosEnvioParaGsg(c.datosEnvio) : {}),
    ...(c.canceladoPorGsg ? { cancelado: true, motivoCancelacion: c.motivoCancelacion ?? 'cancelado por GSG' } : {}),
    // Si GSG ya tiene la ubicacion (de un pedido anterior o porque acaba de
    // llegar), la manda: asi el otro lado no la vuelve a pedir.
    ...(c.ubicacion ? { lat: c.ubicacion.lat, lng: c.ubicacion.lng } : c.lat != null && c.lng != null && !c.necesitaUbicacion ? { lat: c.lat, lng: c.lng } : {}),
  });

  /** Si ya tiene todo, pasa a terminados; si dijo que no, a cancelados. */
  function revisar(c: ClienteSimulado): void {
    if (c.estado !== 'pendiente') return;
    // Sin respuesta, con cambio, por reprogramar, «no soy yo» o cerrado por el dia: sigue pendiente (una persona lo coordina).
    if (c.confirmacion && !c.confirmacion.confirmada && !['sin_respuesta', 'cambio', 'no_confirma', 'dia_cerrado', 'sin_plantilla', 'error_envio', 'reprogramar', 'numero_equivocado'].includes(c.confirmacion.motivo ?? '')) {
      c.estado = 'cancelado';
      c.terminadoEn = ahora().toISOString();
      return;
    }
    const ubicacionLista = !c.necesitaUbicacion || Boolean(c.ubicacion);
    const confirmacionLista = !c.necesitaConfirmacion || Boolean(c.confirmacion?.confirmada);
    if (ubicacionLista && confirmacionLista) {
      c.estado = 'terminado';
      c.terminadoEn = ahora().toISOString();
    }
  }

  /**
   * A qué pedido va un reporte. Por teléfono solo si `porTelefono`: una
   * ubicación es de la persona (el reparto la manda con su propia referencia),
   * pero una confirmación o una entrega es de UN pedido. Sin esa distinción,
   * la cancelación de G-2001 canceló G-2002, el pedido nuevo del mismo
   * cliente (26/09).
   */
  const porReferencia = (cuerpo: Record<string, unknown>, opts: { porTelefono?: boolean } = {}): ClienteSimulado | null => {
    const ref = String(cuerpo.referencia ?? '').trim();
    if (ref && clientes.has(ref)) return clientes.get(ref)!;
    if (ref && !opts.porTelefono) return null;
    // Sin referencia que cuadre, por telefono (el reparto manda los dos).
    const tel = String(cuerpo.telefono ?? '').replace(/\D+/g, '');
    if (!tel) return null;
    for (const c of clientes.values()) {
      const suyo = c.telefono.replace(/\D+/g, '');
      if (suyo === tel || `51${suyo}` === tel || suyo === `51${tel}`) return c;
    }
    return null;
  };

  const sim: GsgSimulado = {
    recibido,
    modo: 'ok',

    pendientes() {
      const todos = [...clientes.values()];
      return {
        dia: dia(),
        faltaUbicacion: todos.filter((c) => c.estado === 'pendiente' && c.necesitaUbicacion && !c.ubicacion).map(publico),
        faltaConfirmacion: todos.filter((c) => c.estado === 'pendiente' && c.necesitaConfirmacion && !c.confirmacion?.confirmada).map(publico),
        terminados: todos.filter((c) => c.estado === 'terminado').map((c) => ({ ...publico(c), terminadoEn: c.terminadoEn, llegaAproxEn: c.entrega?.llegaAproxEn ?? null })),
        cancelados: todos.filter((c) => c.estado === 'cancelado').map((c) => ({ ...publico(c), motivo: c.canceladoPorGsg ? 'cancelado_por_gsg' : (c.confirmacion?.motivo ?? 'cancela') })),
      };
    },

    estado() {
      const todos = [...clientes.values()];
      return {
        dia: dia(),
        clientes: todos,
        faltaUbicacion: todos.filter((c) => c.estado === 'pendiente' && c.necesitaUbicacion && !c.ubicacion).length,
        faltaConfirmacion: todos.filter((c) => c.estado === 'pendiente' && c.necesitaConfirmacion && !c.confirmacion?.confirmada).length,
        terminados: todos.filter((c) => c.estado === 'terminado').length,
        cancelados: todos.filter((c) => c.estado === 'cancelado').length,
        recibidos: { ...contadores },
        llamadas,
        ultimaLlamadaEn,
      };
    },

    cargar(lista) {
      let nuevos = 0;
      for (const bruto of lista) {
        const c = clienteSchema.parse(bruto);
        if (clientes.has(c.referencia)) continue;
        clientes.set(c.referencia, {
          referencia: c.referencia,
          telefono: c.telefono,
          nombre: c.nombre ?? '',
          direccion: c.direccion ?? null,
          distrito: c.distrito ?? null,
          notas: c.notas ?? null,
          necesitaUbicacion: c.faltaUbicacion ?? true,
          necesitaConfirmacion: c.faltaConfirmacion ?? true,
          lat: c.lat ?? null,
          lng: c.lng ?? null,
          urgente: c.urgente === true,
          canceladoPorGsg: false,
          motivoCancelacion: null,
          cambiadoEn: null,
          datosEnvio: datosEnvioDeCrudo(c),
          ubicacion: null,
          confirmacion: null,
          entrega: null,
          estado: 'pendiente',
          terminadoEn: null,
        });
        nuevos++;
      }
      return nuevos;
    },

    cargarDePrueba: () => sim.cargar(CLIENTES_DE_PRUEBA),

    cancelar(referencia, motivo) {
      const c = clientes.get(referencia.trim());
      if (!c || c.estado !== 'pendiente') return false;
      c.canceladoPorGsg = true;
      c.motivoCancelacion = (motivo ?? '').trim() || 'cancelado por GSG';
      c.estado = 'cancelado';
      c.terminadoEn = ahora().toISOString();
      return true;
    },

    cambiar(referencia, cambios) {
      const c = clientes.get(referencia.trim());
      if (!c || c.estado !== 'pendiente') return null;
      if (cambios.telefono !== undefined) c.telefono = cambios.telefono;
      if (cambios.nombre !== undefined) c.nombre = cambios.nombre;
      if (cambios.direccion !== undefined) c.direccion = cambios.direccion;
      if (cambios.distrito !== undefined) c.distrito = cambios.distrito;
      if (cambios.notas !== undefined) c.notas = cambios.notas;
      if (cambios.urgente !== undefined) c.urgente = cambios.urgente;
      if (cambios.datosEnvio) c.datosEnvio = { ...(c.datosEnvio ?? {}), ...cambios.datosEnvio };
      c.cambiadoEn = ahora().toISOString();
      return c;
    },

    reiniciar() {
      clientes.clear();
      recibido.length = 0;
      for (const k of Object.keys(contadores) as Array<keyof typeof contadores>) contadores[k] = 0;
      llamadas = 0;
      ultimaLlamadaEn = null;
      sim.modo = 'ok';
    },

    atender(method, ruta, token, cuerpo) {
      llamadas++;
      ultimaLlamadaEn = ahora().toISOString();
      // Sin red: ni siquiera se contesta (status 0; el plugin corta la conexion).
      if (sim.modo === 'sin_red') return { status: 0, body: null };
      if (!igualSeguro(token, opts.token)) return { status: 401, body: { error: token === null ? 'Falta la cabecera X-API-Key.' : 'X-API-Key inválida.' } };
      if (sim.modo === 'caido') return { status: 502, body: '<html>502 Bad Gateway</html>' };
      const camino = ruta.replace(/\?.*$/, '').replace(/\/+$/, '');

      if (method === 'GET' && camino === '/reparto/estado') return { status: 200, body: sim.estado() };
      if (method === 'POST' && camino === '/reparto/cargar') {
        const lista = z.array(clienteSchema).parse((cuerpo as { clientes?: unknown })?.clientes ?? cuerpo);
        return { status: 200, body: { ok: true, nuevos: sim.cargar(lista) } };
      }
      if (method === 'DELETE' && camino === '/reparto') {
        sim.reiniciar();
        return { status: 200, body: { ok: true } };
      }
      // Lo que GSG puede hacer con un pedido ya mandado (para probar el espejo de cambios).
      if (method === 'POST' && camino === '/reparto/cancelar') {
        const b = z.object({ referencia: z.string().min(1).max(60), motivo: z.string().max(300).optional() }).parse(cuerpo ?? {});
        if (!clientes.has(b.referencia)) return { status: 404, body: { error: `no conozco el pedido ${b.referencia}` } };
        const ok = sim.cancelar(b.referencia, b.motivo);
        return ok ? { status: 200, body: { ok: true, referencia: b.referencia, cancelado: true } } : { status: 409, body: { error: `el pedido ${b.referencia} ya estaba cerrado` } };
      }
      if (method === 'POST' && camino === '/reparto/cambiar') {
        const b = cambioSchema.parse(cuerpo ?? {});
        if (!clientes.has(b.referencia)) return { status: 404, body: { error: `no conozco el pedido ${b.referencia}` } };
        const { referencia, telefono, nombre, direccion, distrito, notas, urgente } = b;
        const c = sim.cambiar(referencia, { telefono, nombre, direccion, distrito, notas, urgente, datosEnvio: datosEnvioDeCrudo(b) });
        return c ? { status: 200, body: { ok: true, pedido: publico(c) } } : { status: 409, body: { error: `el pedido ${referencia} ya estaba cerrado` } };
      }

      if (method !== 'POST') return { status: 404, body: { error: `ruta desconocida ${camino}` } };
      const c = (cuerpo && typeof cuerpo === 'object' ? cuerpo : {}) as Record<string, unknown>;
      if (sim.modo === 'rechaza') return { status: 422, body: { error: 'payload no válido: falta el campo pedido' } };

      const en = ahora().toISOString();
      switch (camino) {
        case '/ubicaciones': {
          contadores.ubicaciones++;
          recibido.push({ tipo: 'ubicacion', cuerpo: c, en });
          const cli = porReferencia(c, { porTelefono: true });
          if (cli) {
            cli.ubicacion = { lat: Number(c.lat), lng: Number(c.lng), mapsUrl: (c.mapsUrl as string) ?? null, corregida: c.corregida === true, en };
            revisar(cli);
          }
          return { status: 200, body: { id: `GSG-UBI-${contadores.ubicaciones}`, encontrado: Boolean(cli) } };
        }
        case '/confirmaciones': {
          contadores.confirmaciones++;
          recibido.push({ tipo: 'confirmacion', cuerpo: c, en });
          const cli = porReferencia(c);
          if (cli) {
            cli.confirmacion = { confirmada: c.confirmada === true, respuesta: (c.respuesta as string) ?? null, como: (c.como as string) ?? null, motivo: (c.motivo as string) ?? null, en };
            revisar(cli);
          }
          return { status: 200, body: { id: `GSG-CONF-${contadores.confirmaciones}`, encontrado: Boolean(cli) } };
        }
        case '/entregas': {
          contadores.entregas++;
          recibido.push({ tipo: 'entrega', cuerpo: c, en });
          const cli = porReferencia(c);
          if (cli) {
            // El "entregado" llega en un segundo reporte con los mismos campos: se
            // conserva lo que ya se sabia y se anota cuando se entrego.
            cli.entrega = {
              motorizado: c.motorizado ?? cli.entrega?.motorizado ?? null,
              minutosMotorizado: (c.minutosMotorizado as number) ?? cli.entrega?.minutosMotorizado ?? null,
              minutosAviso: (c.minutosAviso as number) ?? cli.entrega?.minutosAviso ?? null,
              llegaAproxEn: (c.llegaAproxEn as string) ?? cli.entrega?.llegaAproxEn ?? null,
              en,
              entregadoEn: (c.entregadoEn as string) ?? cli.entrega?.entregadoEn ?? null,
              entregadaComo: (c.entregadaComo as string) ?? cli.entrega?.entregadaComo ?? null,
              incidencia: (c.incidencia as string) ?? null,
              segundaVisita: c.segundaVisita === true,
              visitas: Number(c.visitas ?? 0),
            };
            revisar(cli);
          }
          return { status: 200, body: { id: `GSG-ENT-${contadores.entregas}`, encontrado: Boolean(cli) } };
        }
        case '/incidencias': {
          contadores.incidencias++;
          recibido.push({ tipo: 'incidencia', cuerpo: c, en });
          return { status: 200, body: { id: `GSG-INC-${contadores.incidencias}` } };
        }
        case '/resumenes': {
          contadores.resumenes++;
          recibido.push({ tipo: 'resumen', cuerpo: c, en });
          return { status: 200, body: { id: `GSG-RES-${contadores.resumenes}` } };
        }
        default:
          return { status: 404, body: { error: `ruta desconocida ${camino}` } };
      }
    },
  };

  return sim;
}

/** La clave de una llamada al simulador: SOLO la cabecera X-API-Key (Bearer no cuenta). */
export function claveDeCabeceras(headers: Record<string, unknown> | Headers): string | null {
  const valor = headers instanceof Headers ? headers.get('x-api-key') : headers['x-api-key'];
  const v = Array.isArray(valor) ? valor[0] : valor;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/**
 * El simulador le manda a GSGchat su lista del dia, como haria GSG empujando
 * sus pedidos: lo nuevo se crea, lo cambiado se refleja, lo cancelado se
 * cancela y lo terminado se marca. Sin red: es memoria de este mismo
 * servidor. En modo «caído» o «sin red» no manda nada (y aqui no se toca
 * nada: una lista que no llega no cancela ningun pedido).
 */
export async function enviarListaDelSimulador(sim: GsgSimulado, entregas: Pick<ServicioEntregas, 'recibirListaGsg' | 'hoy'>): Promise<ResultadoSincronizacion> {
  if (sim.modo === 'caido' || sim.modo === 'sin_red') {
    const detalle = `El simulador de GSG está en modo «${sim.modo === 'caido' ? 'caído' : 'sin red'}»: no manda nada y aquí no se toca ningún pedido.`;
    return { ok: false, detalle, dia: entregas.hoy(), nuevas: 0, actualizadas: 0, ubicacionesPedidas: 0, confirmacionesPendientes: 0, terminadas: 0, lote: null, at: new Date().toISOString() };
  }
  return entregas.recibirListaGsg(sim.pendientes() as unknown as PendientesGsg);
}

/** Cuelga el simulador de este servidor en `prefijo` (p. ej. /simulador/gsg). */
export async function registerGsgSimulado(app: FastifyInstance, deps: { simulador: GsgSimulado; prefijo: string }): Promise<void> {
  const { simulador, prefijo } = deps;
  const atender = (method: string) => async (request: { url: string; headers: Record<string, unknown>; body: unknown; raw: { socket: { destroy(): void } } }, reply: { code(n: number): { send(b: unknown): unknown }; hijack(): void }) => {
    const ruta = request.url.slice(prefijo.length);
    // Como la API real: la clave solo vale en X-API-Key. Un Bearer solo no entra.
    const clave = claveDeCabeceras(request.headers);
    if (clave === null && typeof request.headers.authorization === 'string') {
      return reply.code(401).send({ error: 'Falta la cabecera X-API-Key.' });
    }
    const r = simulador.atender(method, ruta, clave, request.body);
    if (r.status === 0) {
      // Modo "sin red": la conexion se corta sin respuesta.
      reply.hijack();
      request.raw.socket.destroy();
      return;
    }
    return reply.code(r.status).send(r.body);
  };
  app.get(`${prefijo}/*`, atender('GET'));
  app.post(`${prefijo}/*`, atender('POST'));
  app.delete(`${prefijo}/*`, atender('DELETE'));
}
