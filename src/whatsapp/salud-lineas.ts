/**
 * La salud de cada numero de WhatsApp, en una palabra.
 *
 *  - operativo:     la conexion esta viva.
 *  - con_problemas: esta conectada o configurada pero algo falla (clave vencida,
 *                   numero rechazado por WhatsApp, calidad en rojo, faltan datos).
 *  - desconectado:  la sesion no esta abierta (QR sin escanear, caida, deshabilitada).
 *  - no_verificado: no se pudo confirmar (el proveedor no contesto).
 *
 * Sale de la conexion que ya existe: el estado vivo de la sesion local o, con la
 * API de Meta y WAHA, la consulta de solo lectura del propio numero. NUNCA manda
 * un mensaje de prueba a un cliente. No tiene nada que ver con la conexion a GSG.
 */

import { WhatsAppApiError } from './client.js';
import type { ServicioLineas } from './lineas.js';
import type { RegistroClientes } from './registro.js';

export type EstadoSalud = 'operativo' | 'con_problemas' | 'desconectado' | 'no_verificado';

export interface SaludDeLinea {
  id: string;
  etiqueta: string;
  numero: string;
  estado: EstadoSalud;
  /** Una frase corta cuando hay algo que decir (todo menos operativo). */
  causa: string | null;
}

export interface SaludDeLineas {
  consultar(): Promise<SaludDeLinea[]>;
}

const corta = (t: string, n = 140) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

export function crearSaludDeLineas(deps: {
  lineas: Pick<ServicioLineas, 'listar'>;
  registro: Pick<RegistroClientes, 'transporte'>;
  /** Cuanto vale una respuesta del proveedor antes de volver a preguntarle. */
  cacheMs?: number;
  /** Cuanto se espera al proveedor antes de dar el estado por no verificado. */
  esperaMs?: number;
  ahora?: () => number;
}): SaludDeLineas {
  const cacheMs = deps.cacheMs ?? 30_000;
  const esperaMs = deps.esperaMs ?? 8_000;
  const ahora = deps.ahora ?? Date.now;
  const memoria = new Map<string, { hasta: number; valor: { estado: EstadoSalud; causa: string | null } }>();

  async function consultarProveedor(lineaId: string, cliente: { getPhoneNumber(): Promise<{ qualityRating: string }> }): Promise<{ estado: EstadoSalud; causa: string | null }> {
    const guardado = memoria.get(lineaId);
    if (guardado && guardado.hasta > ahora()) return guardado.valor;
    let valor: { estado: EstadoSalud; causa: string | null };
    let reloj: ReturnType<typeof setTimeout> | undefined;
    try {
      const info = await Promise.race([
        cliente.getPhoneNumber(),
        new Promise<never>((_, rechazar) => {
          reloj = setTimeout(() => rechazar(new Error('tiempo agotado')), esperaMs);
        }),
      ]);
      valor = info.qualityRating === 'RED' ? { estado: 'con_problemas', causa: 'Meta tiene la calidad del número en rojo' } : { estado: 'operativo', causa: null };
    } catch (error) {
      if (error instanceof WhatsAppApiError && error.httpStatus >= 400 && error.httpStatus < 500) {
        const sesion = error.httpStatus === 401 || error.code === 190;
        valor = { estado: 'con_problemas', causa: sesion ? 'La clave de acceso del proveedor no es válida o venció' : corta(error.message) };
      } else {
        valor = { estado: 'no_verificado', causa: 'El proveedor no contestó a la comprobación' };
      }
    } finally {
      if (reloj) clearTimeout(reloj);
    }
    memoria.set(lineaId, { hasta: ahora() + cacheMs, valor });
    return valor;
  }

  return {
    async consultar() {
      const salida: SaludDeLinea[] = [];
      for (const linea of await deps.lineas.listar()) {
        const base = { id: linea.id, etiqueta: linea.etiqueta, numero: linea.telefono };
        if (!linea.habilitada) {
          salida.push({ ...base, estado: 'desconectado', causa: 'Está deshabilitada: no recibe envíos' });
          continue;
        }
        let t;
        try {
          t = await deps.registro.transporte(linea.id);
        } catch {
          t = null;
        }
        if (!t) {
          salida.push({ ...base, estado: 'con_problemas', causa: 'Faltan datos de conexión de esta línea' });
          continue;
        }
        const numero = base.numero || (t.sesion?.getLocalState().phone ?? '');

        if (t.sesion && linea.proveedor === 'local') {
          const s = t.sesion.getLocalState();
          let r: { estado: EstadoSalud; causa: string | null };
          if (s.bloqueado) r = { estado: 'con_problemas', causa: 'WhatsApp rechazó este número' };
          else if (s.status === 'WORKING') r = { estado: 'operativo', causa: null };
          else if (s.status === 'SCAN_QR_CODE') r = { estado: 'desconectado', causa: 'Esperando que escanees el código QR' };
          else if (s.status === 'FAILED') r = { estado: 'con_problemas', causa: corta(s.detail || 'La sesión falló') };
          else if (s.status === 'STARTING') r = { estado: 'desconectado', causa: 'Conectando…' };
          else r = { estado: 'desconectado', causa: corta(s.detail || 'La sesión está cerrada') };
          salida.push({ ...base, numero, ...r });
          continue;
        }

        let vivo: boolean | undefined;
        try {
          vivo = t.cliente.conectado?.();
        } catch {
          vivo = false;
        }
        if (vivo === false) {
          salida.push({ ...base, numero, estado: 'desconectado', causa: 'La conexión está caída' });
          continue;
        }
        salida.push({ ...base, numero, ...(await consultarProveedor(linea.id, t.cliente)) });
      }
      return salida;
    },
  };
}
