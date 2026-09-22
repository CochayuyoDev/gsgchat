/**
 * "Probar el día entero con datos ficticios", en un clic.
 *
 * Recorre el día tal como lo haría la calle, pero con los diez clientes y los
 * diez motorizados de mentira: GSG (el simulador) manda su lista, cada
 * cliente manda su ubicación y confirma, cada motorizado da su tiempo y dice
 * "entregado", y al final los reportes salen hacia GSG. Cada paso queda
 * escrito en palabras para que quien mira la pantalla entienda qué está
 * pasando, y entre paso y paso hay una pausa corta para verlo moverse.
 *
 * Las respuestas de clientes y motorizados entran por el mismo camino que un
 * WhatsApp de verdad (el simulador de entrantes de la demostración), así que
 * lo que se prueba es el flujo completo, no un atajo.
 */

import type { ServicioEntregas } from './servicio.js';
import type { GsgSimulado } from './gsg-simulado.js';
import type { ServicioConexionGsg } from '../rutas/conexion-gsg.js';
import { CLIENTES_DE_PRUEBA, MOTORIZADOS_DE_PRUEBA } from './datos-de-prueba.js';

export type EntranteSimulado = { text: string } | { location: { latitude: number; longitude: number } };

export interface DepsGuion {
  entregas: ServicioEntregas;
  simulador: GsgSimulado;
  conexionGsg?: ServicioConexionGsg;
  /** Mete un WhatsApp entrante como si lo mandara ese numero. Devuelve false si no hay forma (fuera de la demostracion). */
  inyectar(phone: string, contenido: EntranteSimulado, nombre?: string): Promise<boolean>;
  /** Manda a GSG lo que espera en la cola de reportes. */
  despachar(): Promise<{ enviados: number; fallidos: number } | null>;
  log?: (m: string, d?: Record<string, unknown>) => void;
}

export interface PasoGuion {
  at: string;
  texto: string;
  /** haciendo | hecho | fallo | saltado */
  estado: 'haciendo' | 'hecho' | 'fallo' | 'saltado';
  detalle?: string;
}

export interface EstadoGuion {
  estado: 'nunca' | 'corriendo' | 'terminado' | 'detenido' | 'error';
  empezoAt: string | null;
  terminoAt: string | null;
  pasos: PasoGuion[];
  resumen: string | null;
}

export interface GuionDelDia {
  estado(): EstadoGuion;
  empezar(opciones?: { pausaMs?: number }): { ok: true } | { ok: false; motivo: string };
  parar(): boolean;
}

const dormir = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function crearGuionDelDia(deps: DepsGuion): GuionDelDia {
  const { entregas, simulador } = deps;
  let actual: EstadoGuion = { estado: 'nunca', empezoAt: null, terminoAt: null, pasos: [], resumen: null };
  let parado = false;
  let corriendo = false;

  const paso = (texto: string): PasoGuion => {
    const p: PasoGuion = { at: new Date().toISOString(), texto, estado: 'haciendo' };
    actual.pasos.push(p);
    return p;
  };
  const cierra = (p: PasoGuion, estado: PasoGuion['estado'], detalle?: string) => {
    p.estado = estado;
    if (detalle) p.detalle = detalle;
  };

  async function pausa(ms: number): Promise<void> {
    await dormir(ms);
    if (parado) throw new Error('detenido');
  }

  /**
   * Un envio del sistema puede quedar frenado por el ritmo del numero (la
   * pausa entre mensajes): se espera lo que pida y se vuelve a intentar, como
   * haria el motor, hasta ocho veces.
   */
  async function conReintento(p: PasoGuion, intento: () => Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number }>): Promise<{ ok: boolean; motivo?: string; retryAfterMs?: number }> {
    let r = await intento();
    for (let vuelta = 0; vuelta < 8 && !r.ok && r.retryAfterMs; vuelta++) {
      const esperaMs = Math.min(Math.max(500, r.retryAfterMs), 15_000);
      p.detalle = `esperando el ritmo del número (${Math.ceil(esperaMs / 1000)} s): ${r.motivo ?? ''}`;
      await pausa(esperaMs);
      r = await intento();
    }
    return r;
  }

  async function correr(pausaMs: number): Promise<void> {
    // 1. GSG = el simulador.
    let p = paso('Poniendo el simulador como el sistema de GSG');
    const modoGsg = deps.conexionGsg?.estado().modo ?? 'simulador';
    if (deps.conexionGsg && modoGsg === 'ninguna') {
      await deps.conexionGsg.usarSimulador();
      cierra(p, 'hecho', 'listo: GSG es ahora el simulador de este servidor');
    } else cierra(p, 'saltado', modoGsg === 'real' ? 'GSG ya está conectado a una dirección: se usa tal cual' : 'ya lo era');
    await pausa(pausaMs);

    // 2. Los clientes y los motorizados de mentira.
    p = paso('Cargando 10 clientes ficticios en la lista de GSG (7 sin ubicación, 3 sin confirmar)');
    const nuevos = simulador.cargarDePrueba();
    cierra(p, 'hecho', nuevos ? `${nuevos} clientes nuevos` : 'ya estaban cargados');
    await pausa(pausaMs);

    p = paso('Dando de alta 10 motorizados ficticios (999 000 001 a 010)');
    let altas = 0;
    for (const m of MOTORIZADOS_DE_PRUEBA) {
      const r = await entregas.crearMotorizado({ phone: m.telefono, nombre: m.nombre, placa: m.placa, zona: m.zona });
      if (r.ok && r.nuevo) altas++;
    }
    cierra(p, 'hecho', altas ? `${altas} motorizados nuevos` : 'ya estaban dados de alta');
    await pausa(pausaMs);

    // 3. La lista del dia.
    p = paso('Preguntándole a GSG su lista del día');
    const s = await entregas.sincronizar();
    cierra(p, s.ok ? 'hecho' : 'fallo', s.detalle);
    if (!s.ok) throw new Error(s.detalle);
    await pausa(pausaMs);

    // 4. Cada cliente manda su ubicacion.
    const pines = new Map(CLIENTES_DE_PRUEBA.map((c) => [c.referencia, { lat: c.lat, lng: c.lng }]));
    let filas = (await entregas.resumen()).entregas.filter((e) => e.ubicacionEstado === 'pendiente' && e.estado !== 'cancelada' && e.estado !== 'incidencia');
    const yaMandaron = new Set<string>();
    for (const e of filas) {
      if (yaMandaron.has(e.phone)) continue;
      yaMandaron.add(e.phone);
      const pin = pines.get(e.referencia) ?? { lat: -12.0464 + Math.random() * 0.05, lng: -77.0428 + Math.random() * 0.05 };
      p = paso(`${e.nombre ?? e.phone} manda su ubicación por WhatsApp (${e.referencia})`);
      const ok = await deps.inyectar(e.phone, { location: { latitude: pin.lat, longitude: pin.lng } }, e.nombre ?? undefined);
      if (!ok) {
        cierra(p, 'fallo', 'esta prueba automática solo funciona en la demostración; con el WhatsApp real usa «Modo prueba con mi número»');
        throw new Error('sin simulador de entrantes');
      }
      cierra(p, 'hecho', 'el sistema la registra, se la reporta a GSG y, si falta confirmar, le pregunta en el mismo mensaje');
      await pausa(pausaMs);
    }

    // 5. Confirmaciones: a los que aun no se les pregunto, se les pregunta; y todos dicen que si.
    filas = (await entregas.resumen()).entregas;
    for (const e of filas.filter((x) => x.confirmacionEstado === 'pendiente' && x.ubicacionEstado !== 'pendiente' && x.estado !== 'cancelada' && x.estado !== 'incidencia')) {
      p = paso(`Preguntándole a ${e.nombre ?? e.phone} si recibe hoy ${e.referencia}`);
      const r = await conReintento(p, () => entregas.pedirConfirmacion(e));
      cierra(p, r.ok ? 'hecho' : 'saltado', r.ok ? 'pregunta enviada con botones SÍ / NO' : (r.motivo ?? ''));
      await pausa(pausaMs);
    }
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const pedidas = (await entregas.resumen()).entregas.filter((x) => x.confirmacionEstado === 'pedida');
      if (!pedidas.length) break;
      const porTelefono = new Set<string>();
      for (const e of pedidas) {
        if (porTelefono.has(e.phone)) continue;
        porTelefono.add(e.phone);
        p = paso(`${e.nombre ?? e.phone} contesta "sí" (${e.referencia})`);
        await deps.inyectar(e.phone, { text: 'sí' }, e.nombre ?? undefined);
        cierra(p, 'hecho', 'confirmado: GSG se entera y el pedido queda listo para un motorizado');
        await pausa(pausaMs);
      }
    }

    // 6. Los pedidos listos salen hacia los motorizados.
    filas = (await entregas.resumen()).entregas.filter((x) => x.estado === 'lista');
    for (const e of filas) {
      const fresca = (await entregas.resumen()).entregas.find((x) => x.id === e.id);
      if (!fresca || fresca.estado !== 'lista') continue;
      p = paso(`Mandando el pin de ${e.referencia} (${e.nombre ?? e.phone}) al motorizado que toca`);
      let motorizado: { nombre: string } | undefined;
      const r = await conReintento(p, async () => {
        const otra = (await entregas.resumen()).entregas.find((x) => x.id === e.id);
        if (!otra || otra.estado !== 'lista') return { ok: true };
        const x = await entregas.mandarAMotorizado(otra);
        motorizado = x.motorizado ?? motorizado;
        return x;
      });
      cierra(p, r.ok ? 'hecho' : 'fallo', r.ok ? `lo lleva ${motorizado?.nombre ?? 'un motorizado'}: se le preguntó en cuántos minutos entrega` : (r.motivo ?? ''));
      await pausa(pausaMs);
    }

    // 7. Cada motorizado dice su tiempo, pedido por pedido (nombrandolo, como
    //    haria uno que lleva varios). Si el sistema le pregunta "¿seguro?"
    //    porque el tiempo no cuadra con la distancia, insiste.
    for (const e of (await entregas.resumen()).entregas.filter((x) => x.estado === 'esperando_motorizado' && x.motorizadoEstado === 'enviado' && x.motorizado)) {
      const minutos = 25 + Math.floor(Math.random() * 25);
      p = paso(`${e.motorizado!.nombre} contesta "${e.referencia} ${minutos}" (minutos)`);
      await deps.inyectar(e.motorizado!.phone, { text: `${e.referencia} ${minutos}` });
      const otraVez = (await entregas.resumen()).entregas.find((x) => x.id === e.id);
      if (otraVez && otraVez.motorizadoEstado === 'enviado' && otraVez.motorizadoTiempoDudosoAt) {
        cierra(p, 'hecho', 'el sistema le preguntó "¿seguro?" porque el tiempo no cuadra con la distancia');
        await pausa(pausaMs);
        p = paso(`${e.motorizado!.nombre} insiste: "${e.referencia} ${minutos}"`);
        await deps.inyectar(e.motorizado!.phone, { text: `${e.referencia} ${minutos}` });
      }
      cierra(p, 'hecho', `al cliente se le avisa la hora aproximada (con el margen de ${entregas.ajustes().margenMinutos} min encima)`);
      await pausa(pausaMs);
    }

    // 8. Cada motorizado entrega.
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      const avisadas = (await entregas.resumen()).entregas.filter((x) => x.estado === 'avisada' && x.motorizado);
      if (!avisadas.length) break;
      for (const e of avisadas) {
        p = paso(`${e.motorizado!.nombre} escribe "entregado ${e.referencia}"`);
        await deps.inyectar(e.motorizado!.phone, { text: `entregado ${e.referencia}` });
        cierra(p, 'hecho', 'entregado: al cliente se le da las gracias y GSG recibe la entrega');
        await pausa(Math.min(pausaMs, 600));
      }
    }

    // 9. Los reportes salen hacia GSG.
    p = paso('Mandando a GSG todo lo que quedó en la cola de reportes');
    const d = await deps.despachar();
    cierra(p, d ? 'hecho' : 'saltado', d ? `${d.enviados} reportes aceptados${d.fallidos ? `, ${d.fallidos} fallidos` : ''}` : 'no se pudo despachar');

    const r = await entregas.resumen();
    const sim = simulador.estado();
    actual.resumen = `Día de prueba terminado: ${r.cifras.total} pedidos, ${r.cifras.entregada} entregados, ${r.cifras.incidencia} que necesitan a alguien. En el simulador de GSG: ${sim.terminados} terminados, ${sim.faltaUbicacion} sin ubicación, ${sim.faltaConfirmacion} sin confirmar. Míralo en Hoy, en Chats (las conversaciones de los clientes y de los motorizados) y en el Mapa del día.`;
  }

  return {
    estado: () => ({ ...actual, pasos: actual.pasos.slice(-80) }),
    empezar(opciones = {}) {
      if (corriendo) return { ok: false, motivo: 'Ya hay un día de prueba en marcha: espera a que termine o detenlo.' };
      const pausaMs = Math.max(200, Math.min(10_000, opciones.pausaMs ?? 1_200));
      actual = { estado: 'corriendo', empezoAt: new Date().toISOString(), terminoAt: null, pasos: [], resumen: null };
      parado = false;
      corriendo = true;
      void correr(pausaMs)
        .then(() => {
          actual.estado = 'terminado';
        })
        .catch((error: unknown) => {
          const detalle = error instanceof Error ? error.message : String(error);
          if (detalle === 'detenido') {
            actual.estado = 'detenido';
            actual.resumen = 'Se detuvo a mitad: lo que ya pasó se queda tal cual en Hoy.';
          } else {
            actual.estado = 'error';
            actual.resumen = `No se pudo seguir: ${detalle}`;
            deps.log?.('el día de prueba se cortó', { detalle });
          }
        })
        .finally(() => {
          actual.terminoAt = new Date().toISOString();
          corriendo = false;
        });
      return { ok: true };
    },
    parar() {
      if (!corriendo) return false;
      parado = true;
      return true;
    },
  };
}
