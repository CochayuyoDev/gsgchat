/**
 * Los avisos de vencimiento de las tiendas.
 *
 * Cada hora se mira la lista: a la tienda que vence en 7 dias, en 1 dia y el
 * dia que vence se le manda UN WhatsApp (al contacto de la tienda, si en su
 * ficha hay un numero) y otro al dueño (el supervisor de Configuracion →
 * Avisos). Cada aviso queda apuntado con la fecha de vencimiento a la que se
 * refiere: asi no se repite, y al renovar (vencimiento nuevo) vuelve a
 * avisar cuando toque.
 *
 * Los textos se cambian desde la pantalla Tiendas, con las variables
 * {tienda}, {dias}, {fecha}, {plan}, {precio}, {moneda}, {contacto}.
 * Van con `manual: true`: son del dueño a sus clientes, no marketing.
 */

import type { Sender } from '../outbound/sender.js';
import type { TiendasRepo } from './repo.js';
import { fechaLima, type ServicioTiendas, type TiendaVista } from './servicio.js';

export interface TextosAvisos {
  activo: boolean;
  /** Tambien al contacto de la tienda (si tiene numero); si no, solo al dueño. */
  aLaTienda: boolean;
  vence7: string;
  vence1: string;
  vencida: string;
  /** Lo que recibe el dueño (una linea por tienda, en un solo mensaje). */
  alDueno: string;
}

export const TEXTOS_AVISOS_POR_DEFECTO: TextosAvisos = {
  activo: true,
  aLaTienda: true,
  vence7: 'Hola, le escribimos de GSGchat. La membresía de {tienda} ({plan}) vence el {fecha}, en {dias} días. Para seguir sin cortes, puede renovar desde su panel (Mi negocio → Pagar). {contacto}',
  vence1: 'Hola, la membresía de {tienda} vence mañana ({fecha}). Si ya pagó, no haga caso a este mensaje; si no, puede renovar desde su panel (Mi negocio → Pagar). {contacto}',
  vencida: 'Hola, la membresía de {tienda} venció hoy ({fecha}): el asistente IA y las campañas quedan en pausa hasta renovar; los chats siguen funcionando. Puede renovar desde su panel (Mi negocio → Pagar). {contacto}',
  alDueno: 'Membresías por vencer:\n{lineas}',
};

export const VARIABLES_AVISOS = ['{tienda}', '{dias}', '{fecha}', '{plan}', '{precio}', '{moneda}', '{contacto}'];

export type TipoAviso = 'vence7' | 'vence1' | 'vencida';

export interface AvisoMandado {
  tienda: string;
  tipo: TipoAviso;
  /** A quien salio: la tienda (su numero) y/o el dueño. */
  aTienda: string | null;
  alDueno: boolean;
  /** Si a la tienda no le salio, por que. */
  fallo: string | null;
}

export interface ResultadoRevision {
  cuando: string;
  revisadas: number;
  mandados: AvisoMandado[];
  /** Tiendas que tocaba avisar y ya se habian avisado. */
  yaAvisadas: number;
  apagado: boolean;
}

export interface DepsAvisosTiendas {
  tiendas: ServicioTiendas;
  repo: TiendasRepo;
  sender?: Sender;
  /** El WhatsApp del dueño (supervisor). Vacio = solo a las tiendas. */
  supervisor?: () => string;
  ahora?: () => Date;
  log?: (mensaje: string, detalle?: Record<string, unknown>) => void;
}

export interface ServicioAvisosTiendas {
  textos(): Promise<TextosAvisos>;
  guardarTextos(cambio: Partial<TextosAvisos>): Promise<TextosAvisos>;
  /** Mira todas las tiendas y manda lo que toque. Devuelve lo que hizo. */
  revisar(): Promise<ResultadoRevision>;
  ultimaRevision(): ResultadoRevision | null;
  /** Como queda un texto con una tienda de ejemplo (o la primera real). */
  previsualizar(tipo: TipoAviso, texto: string): Promise<string>;
  /** Arranca el ticker (cada hora; la primera vez a los dos minutos). Devuelve la funcion que lo para. */
  arrancar(): () => void;
}

const CLAVE_TEXTOS = 'avisos';
const CADA_MS = 60 * 60_000;
const PRIMERA_MS = 2 * 60_000;

export function rellenarAviso(texto: string, t: Pick<TiendaVista, 'nombre' | 'plan' | 'membresia'>): string {
  const fecha = fechaLima(t.membresia.vencimiento);
  const dias = Math.max(0, t.plan.diasRestantes);
  const valores: Record<string, string> = {
    '{tienda}': t.nombre,
    '{dias}': String(dias),
    '{fecha}': fecha,
    '{plan}': t.plan.nombre,
    '{precio}': String(t.membresia.precioMes ?? 0),
    '{moneda}': t.membresia.moneda,
    '{contacto}': t.membresia.contacto ?? '',
  };
  return texto.replace(/\{[a-z]+\}/g, (m) => valores[m] ?? m).replace(/[ \t]+$/gm, '').trim();
}

/** Que aviso toca hoy para esta tienda, si alguno. */
export function tipoQueToca(t: Pick<TiendaVista, 'plan' | 'membresia'>): TipoAviso | null {
  if (t.membresia.estado === 'suspendida') return null;
  const dias = t.plan.diasRestantes;
  if (dias <= 0) return dias >= -1 ? 'vencida' : null; // el dia que vence (o el siguiente, por si el ticker no corrio)
  if (dias <= 1) return 'vence1';
  if (dias <= 7) return 'vence7';
  return null;
}

/** La clave con la que se apunta el aviso: tipo + vencimiento al que se refiere. */
export const claveAviso = (tipo: TipoAviso, vencimiento: string): string => `${tipo}:${vencimiento.slice(0, 10)}`;

export function crearAvisosTiendas(deps: DepsAvisosTiendas): ServicioAvisosTiendas {
  const ahora = deps.ahora ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  let ultima: ResultadoRevision | null = null;

  async function textos(): Promise<TextosAvisos> {
    const g = await deps.repo.config<Partial<TextosAvisos>>(CLAVE_TEXTOS);
    return { ...TEXTOS_AVISOS_POR_DEFECTO, ...(g ?? {}) };
  }

  async function mandar(telefono: string, texto: string): Promise<string | null> {
    if (!deps.sender) return 'este arranque no manda WhatsApp';
    try {
      const r = await deps.sender.send({ phone: telefono, kind: 'freeform', category: 'UTILITY', text: texto, manual: true, origen: 'sistema' });
      if (r.ok) return null;
      return r.blocked ? r.reason : r.error;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  async function revisar(): Promise<ResultadoRevision> {
    const cuando = ahora().toISOString();
    const cfg = await textos();
    const resultado: ResultadoRevision = { cuando, revisadas: 0, mandados: [], yaAvisadas: 0, apagado: !cfg.activo };
    if (!cfg.activo) {
      ultima = resultado;
      return resultado;
    }
    const { tiendas } = await deps.tiendas.listar();
    const lineasDueno: string[] = [];
    for (const t of tiendas) {
      resultado.revisadas++;
      const tipo = tipoQueToca(t);
      if (!tipo) continue;
      const clave = claveAviso(tipo, t.membresia.vencimiento);
      const hechos = await deps.repo.avisos(t.id);
      if (hechos.some((a) => a.tipo === clave)) {
        resultado.yaAvisadas++;
        continue;
      }
      const texto = rellenarAviso(cfg[tipo], t);
      const aviso: AvisoMandado = { tienda: t.nombre, tipo, aTienda: null, alDueno: false, fallo: null };
      if (cfg.aLaTienda && t.telefonoContacto) {
        const fallo = await mandar(t.telefonoContacto, texto);
        if (fallo) aviso.fallo = fallo;
        else aviso.aTienda = t.telefonoContacto;
      } else if (cfg.aLaTienda) {
        aviso.fallo = 'la tienda no tiene WhatsApp en su contacto';
      }
      lineasDueno.push(`• ${t.nombre}: ${tipo === 'vencida' ? 'venció hoy' : tipo === 'vence1' ? 'vence mañana' : `vence en ${t.plan.diasRestantes} días`} (${fechaLima(t.membresia.vencimiento)})${aviso.aTienda ? ' · avisada' : aviso.fallo ? ` · sin avisar: ${aviso.fallo}` : ''}`);
      aviso.alDueno = Boolean(deps.supervisor?.());
      await deps.repo.anotarAviso(t.id, clave, ahora());
      resultado.mandados.push(aviso);
    }
    const dueno = deps.supervisor?.();
    if (dueno && lineasDueno.length) {
      const fallo = await mandar(dueno, cfg.alDueno.replace('{lineas}', lineasDueno.join('\n')));
      if (fallo) {
        log('no se pudo avisar al dueño de los vencimientos', { detalle: fallo });
        for (const m of resultado.mandados) m.alDueno = false;
      }
    }
    ultima = resultado;
    return resultado;
  }

  return {
    textos,
    async guardarTextos(cambio) {
      const actual = await textos();
      const nuevo: TextosAvisos = {
        activo: cambio.activo ?? actual.activo,
        aLaTienda: cambio.aLaTienda ?? actual.aLaTienda,
        vence7: (cambio.vence7 ?? actual.vence7).trim().slice(0, 1000) || TEXTOS_AVISOS_POR_DEFECTO.vence7,
        vence1: (cambio.vence1 ?? actual.vence1).trim().slice(0, 1000) || TEXTOS_AVISOS_POR_DEFECTO.vence1,
        vencida: (cambio.vencida ?? actual.vencida).trim().slice(0, 1000) || TEXTOS_AVISOS_POR_DEFECTO.vencida,
        alDueno: (cambio.alDueno ?? actual.alDueno).trim().slice(0, 1000) || TEXTOS_AVISOS_POR_DEFECTO.alDueno,
      };
      if (!nuevo.alDueno.includes('{lineas}')) nuevo.alDueno = `${nuevo.alDueno}\n{lineas}`;
      await deps.repo.guardarConfig(CLAVE_TEXTOS, nuevo);
      return nuevo;
    },
    revisar,
    ultimaRevision: () => ultima,
    async previsualizar(tipo, texto) {
      const { tiendas } = await deps.tiendas.listar();
      const ejemplo: Pick<TiendaVista, 'nombre' | 'plan' | 'membresia'> = tiendas[0] ?? {
        nombre: 'Zapatería Lima',
        plan: { plan: 'basico', nombre: 'Básico', limites: { iaTurnosMes: null, campanas: true, conectores: true, usuarios: null }, precioMes: 49, moneda: 'PEN', vencimiento: new Date(ahora().getTime() + 7 * 86400_000).toISOString(), diasRestantes: 7, vencido: false, aviso: null, contacto: 'Escríbenos al 987 654 321' },
        membresia: { plan: 'basico', nombre: 'Básico', limites: { iaTurnosMes: null, campanas: true, conectores: true, usuarios: null }, precioMes: 49, moneda: 'PEN', vencimiento: new Date(ahora().getTime() + 7 * 86400_000).toISOString(), estado: 'activa', contacto: 'Escríbenos al 987 654 321', aviso: null, pagos: [], actualizadoEn: ahora().toISOString(), actualizadoPor: null },
      };
      const dias = tipo === 'vence7' ? 7 : tipo === 'vence1' ? 1 : 0;
      const vence = new Date(ahora().getTime() + dias * 86400_000).toISOString();
      return rellenarAviso(texto, { ...ejemplo, plan: { ...ejemplo.plan, diasRestantes: dias, vencimiento: vence }, membresia: { ...ejemplo.membresia, vencimiento: vence } });
    },
    arrancar() {
      let intervalo: ReturnType<typeof setInterval> | null = null;
      const primera = setTimeout(() => {
        void revisar().catch((e) => log('fallo la revisión de vencimientos', { detalle: e instanceof Error ? e.message : String(e) }));
        intervalo = setInterval(() => void revisar().catch((e) => log('fallo la revisión de vencimientos', { detalle: e instanceof Error ? e.message : String(e) })), CADA_MS);
        intervalo.unref?.();
      }, PRIMERA_MS);
      primera.unref?.();
      return () => {
        clearTimeout(primera);
        if (intervalo) clearInterval(intervalo);
      };
    },
  };
}
