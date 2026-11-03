/**
 * Un cliente de WhatsApp por linea (canal -> cliente).
 *
 * La linea principal usa lo de siempre: el cliente dinamico de la tienda y su
 * sesion (src/whatsapp/dynamic.ts), que leen /setup en cada llamada. Las demas
 * tienen el suyo, armado con sus propias credenciales y, si son locales
 * (Baileys), con su PROPIA sesion y carpeta de vinculacion: una que se
 * desconecta no toca a las otras.
 */

import path from 'node:path';
import type { WhatsAppClient } from './client.js';
import { createWhatsAppClient } from './client.js';
import { createLocalClient, type LocalClientOptions } from './local/client.js';
import { crearSesionLocal, type SesionLocal } from './local/session.js';
import { createWahaClient } from './waha/client.js';
import { ID_LINEA_PRINCIPAL, type EstadoLinea, type Linea, type ServicioLineas } from './lineas.js';
import type { Provider } from '../settings/service.js';

export interface TransporteLinea {
  linea: Linea;
  cliente: WhatsAppClient;
  /** Solo las lineas locales (Baileys) tienen sesion con QR. */
  sesion: SesionLocal | null;
  /** Donde guarda su vinculacion (solo locales). */
  authDir: string | null;
}

export interface RegistroClientes {
  /**
   * El transporte de una linea. `null`/`undefined` = la principal. Una linea
   * inexistente o deshabilitada devuelve null: quien llama decide, no se
   * cae silenciosamente a otra.
   */
  transporte(id?: string | null): Promise<TransporteLinea | null>;
  /** Si la linea esta conectada ahora mismo (false si no se sabe o no existe). */
  conectada(id?: string | null): Promise<boolean>;
  /** Todas las lineas habilitadas con su estado vivo. */
  estados(): Promise<Array<{ linea: Linea; conectada: boolean }>>;
  /**
   * Pone al dia en la base el estado, el numero real y el proveedor de cada
   * linea a partir de su sesion viva. Es de donde lee la pantalla.
   */
  sincronizar(): Promise<void>;
  /** Olvida el transporte guardado (tras cambiar credenciales o quitar la linea). */
  olvidar(id: string): void;
  /** Cierra las sesiones de las lineas secundarias, sin desvincular. */
  detener(): void;
}

export interface OpcionesRegistro {
  lineas: ServicioLineas;
  /** El cliente y la sesion de la linea principal, tal como los armaba la tienda. */
  principal: { cliente: WhatsAppClient; sesion: SesionLocal };
  /** Carpeta base: cada linea local usa <authDir>/lineas/<id>. */
  authDir: string;
  /** Para el cliente local de las secundarias. */
  opcionesLocal?: Omit<LocalClientOptions, 'sesion'>;
  resolveTemplateBody?: (name: string, language: string) => Promise<string | undefined>;
  humanizar?: boolean | (() => boolean);
  graphVersion?: string;
  /** El proveedor y si esta configurada la linea principal (lo dicen los ajustes, no su fila). */
  principalAjustes?: () => { proveedor: Provider; configurada: boolean };
  /** Inyectable para las pruebas. */
  crearSesion?: () => SesionLocal;
}

export function crearRegistroClientes(o: OpcionesRegistro): RegistroClientes {
  const guardados = new Map<string, TransporteLinea>();

  async function armar(linea: Linea): Promise<TransporteLinea | null> {
    if (linea.proveedor === 'local') {
      const sesion = (o.crearSesion ?? crearSesionLocal)();
      const cliente = createLocalClient({ ...(o.opcionesLocal ?? {}), resolveTemplateBody: o.resolveTemplateBody, humanizar: o.humanizar, sesion });
      return { linea, cliente, sesion, authDir: path.join(o.authDir, 'lineas', linea.id) };
    }
    const cred = await o.lineas.credenciales(linea.id);
    if (linea.proveedor === 'waha') {
      if (!cred.wahaUrl) return null;
      const cliente = createWahaClient({
        baseUrl: cred.wahaUrl,
        apiKey: cred.wahaApiKey || undefined,
        session: cred.wahaSession || linea.idExterno || undefined,
        resolveTemplateBody: o.resolveTemplateBody,
        humanizar: o.humanizar,
      });
      return { linea, cliente, sesion: null, authDir: null };
    }
    if (!cred.token || !(cred.phoneNumberId || linea.idExterno) || !cred.businessAccountId) return null;
    const cliente = createWhatsAppClient({
      token: cred.token,
      phoneNumberId: cred.phoneNumberId ?? linea.idExterno ?? '',
      businessAccountId: cred.businessAccountId,
      graphVersion: o.graphVersion ?? 'v21.0',
    });
    return { linea, cliente, sesion: null, authDir: null };
  }

  async function transporte(id?: string | null): Promise<TransporteLinea | null> {
    const idReal = id || ID_LINEA_PRINCIPAL;
    const linea = await o.lineas.obtener(idReal);
    if (!linea || (!linea.principal && !linea.habilitada)) return null;
    if (linea.principal) {
      return { linea, cliente: o.principal.cliente, sesion: o.principal.sesion, authDir: null };
    }
    const previo = guardados.get(idReal);
    // El nombre puede haber cambiado; el transporte (y su socket) se conserva.
    if (previo) return { ...previo, linea };
    const nuevo = await armar(linea);
    if (nuevo) guardados.set(idReal, nuevo);
    return nuevo;
  }

  return {
    transporte,
    async conectada(id) {
      const t = await transporte(id);
      if (!t) return false;
      try {
        return t.cliente.conectado?.() ?? true;
      } catch {
        return false;
      }
    },
    async estados() {
      const salida: Array<{ linea: Linea; conectada: boolean }> = [];
      for (const linea of await o.lineas.listar()) {
        if (!linea.principal && !linea.habilitada) continue;
        salida.push({ linea, conectada: await this.conectada(linea.id) });
      }
      return salida;
    },
    async sincronizar() {
      for (const linea of await o.lineas.listar()) {
        const t = await transporte(linea.id);
        if (!t) continue;
        const ajustes = linea.principal ? o.principalAjustes?.() : undefined;
        const proveedor = ajustes?.proveedor ?? linea.proveedor;
        let estado: EstadoLinea;
        let telefono: string | undefined;
        if (t.sesion && proveedor === 'local') {
          const s = t.sesion.getLocalState();
          estado = s.status === 'WORKING' ? 'conectado' : s.status === 'SCAN_QR_CODE' ? 'esperando_qr' : s.status === 'FAILED' ? 'caido' : 'desconectado';
          telefono = s.phone || undefined;
        } else {
          const viva = (() => { try { return t.cliente.conectado?.(); } catch { return false; } })();
          estado = (ajustes ? ajustes.configurada : true) && viva !== false ? 'conectado' : 'desconectado';
        }
        await o.lineas.sincronizar(linea.id, { estado, telefono, proveedor: ajustes?.proveedor });
      }
    },
    olvidar(id) {
      guardados.get(id)?.sesion?.detener();
      guardados.delete(id);
    },
    detener() {
      for (const t of guardados.values()) t.sesion?.detener();
      guardados.clear();
    },
  };
}
