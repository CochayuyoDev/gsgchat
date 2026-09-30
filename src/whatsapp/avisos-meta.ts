/**
 * Los avisos con fecha de Meta: lo que cambia en la Cloud API y hay que
 * hacer antes de un dia concreto, dicho en la pantalla y no en un correo que
 * nadie lee.
 *
 * Solo importan a quien usa la API oficial (proveedor `cloud`); con el
 * cliente local (QR) o WAHA no aplica ninguno. Cada aviso tiene su fecha
 * limite, lo que hay que hacer, y un "ya lo hice" que queda con fecha en los
 * ajustes generales (`meta.*`), porque Meta no deja comprobar por API ni el
 * metodo de pago ni la version de la configuracion del registro.
 *
 *  - Metodo de pago: desde el 1/10/2026 Meta cobra tambien los mensajes de
 *    servicio (los que se contestan dentro de la ventana de 24 h) tras los
 *    1 000 gratis al mes por numero; sin metodo de pago cargado antes del
 *    30/09/2026, despues de esos 1 000 los mensajes dejan de salir.
 *  - Registro incorporado v4: Meta apaga v2 y v3 el 15/10/2026; el sistema ya
 *    manda el flujo v4, pero la configuracion en la app de Meta tiene que
 *    ser nueva (Facebook Login for Business → Configurations).
 *  - Graph API: v21 caduca el 21/01/2027; el sistema usa v25 salvo que el
 *    .env fije otra.
 *
 * Fuentes: developers.facebook.com → pricing (non-template-messages),
 * embedded-signup (implementation, onboarding-business-app-users) y
 * graph-api/changelog, consultadas el 18/09/2026.
 */

export type EstadoAviso = 'hecho' | 'ok' | 'pendiente' | 'urgente' | 'vencido';

export interface AvisoMeta {
  id: 'metodoPago' | 'registroV4' | 'graphVersion';
  titulo: string;
  /** Que hay que hacer, en palabras. */
  detalle: string;
  /** La fecha limite, ISO (dia). */
  limite: string;
  /** Cuantos dias quedan (negativo = pasado). */
  diasRestantes: number;
  estado: EstadoAviso;
  /** Cuando se marco como hecho, si se marco. */
  hechoEl: string | null;
  /** Si el aviso se puede marcar como hecho desde la pantalla (los que Meta no deja comprobar). */
  marcable: boolean;
}

export interface EntradaAvisos {
  ahora: Date;
  proveedor: 'cloud' | 'local' | 'waha';
  /** La version de Graph con la que habla el sistema (p. ej. "v25.0"). */
  graphVersion: string;
  /** Lo marcado como hecho desde la pantalla, con fecha. */
  hechos: { metodoPagoEl?: string | null; registroV4El?: string | null };
}

export const FECHA_METODO_PAGO = '2026-09-30';
export const FECHA_COBRO_SERVICIO = '2026-10-01';
export const FECHA_REGISTRO_V4 = '2026-10-15';
export const FECHA_GRAPH_V21 = '2027-01-21';
/** La primera version de Graph con los campos nuevos de limites (por portafolio). */
export const GRAPH_MINIMA = 24;

const DIA = 24 * 60 * 60 * 1000;

function diasHasta(limite: string, ahora: Date): number {
  const fin = new Date(`${limite}T23:59:59`);
  return Math.floor((fin.getTime() - ahora.getTime()) / DIA);
}

const fechaLegible = (iso: string): string => new Date(`${iso}T12:00:00`).toLocaleDateString('es-PE', { day: 'numeric', month: 'long', year: 'numeric' });

function estadoDe(dias: number, hechoEl: string | null | undefined): EstadoAviso {
  if (hechoEl) return 'hecho';
  if (dias < 0) return 'vencido';
  if (dias <= 30) return 'urgente';
  return 'pendiente';
}

/** El numero de la version: "v25.0" → 25; algo raro → 0. */
export function numeroDeGraph(version: string): number {
  const m = /v?(\d+)/.exec(version ?? '');
  return m ? Number(m[1]) : 0;
}

export function avisosDeMeta(e: EntradaAvisos): AvisoMeta[] {
  if (e.proveedor !== 'cloud') return [];
  const avisos: AvisoMeta[] = [];

  const diasPago = diasHasta(FECHA_METODO_PAGO, e.ahora);
  avisos.push({
    id: 'metodoPago',
    titulo: 'Carga un método de pago en Meta',
    detalle:
      `Desde el ${fechaLegible(FECHA_COBRO_SERVICIO)} Meta cobra también lo que se contesta dentro de la ventana de 24 h (S/ 0,0998 por mensaje en Perú; los primeros 1 000 del mes por número son gratis). ` +
      `Sin un método de pago cargado (Meta Business Suite → Facturación) antes del ${fechaLegible(FECHA_METODO_PAGO)}, en cuanto se gasten los 1 000 gratis los mensajes dejan de salir.`,
    limite: FECHA_METODO_PAGO,
    diasRestantes: diasPago,
    estado: estadoDe(diasPago, e.hechos.metodoPagoEl),
    hechoEl: e.hechos.metodoPagoEl ?? null,
    marcable: true,
  });

  const diasV4 = diasHasta(FECHA_REGISTRO_V4, e.ahora);
  avisos.push({
    id: 'registroV4',
    titulo: 'La configuración del registro incorporado tiene que ser v4',
    detalle:
      `Meta apaga las versiones 2 y 3 el ${fechaLegible(FECHA_REGISTRO_V4)}: desde ese día la ventana "Conectar con Facebook" ya no abre con una configuración vieja. ` +
      'Este sistema ya usa el flujo v4; lo que hace falta es una configuración nueva en tu app de Meta (Facebook Login for Business → Configurations → crear, variante "Embedded Signup", con el producto Cloud API y, si el número sigue en el celular, "WhatsApp Business App onboarding") y pegar su ID aquí en Datos de tu app de Meta.',
    limite: FECHA_REGISTRO_V4,
    diasRestantes: diasV4,
    estado: estadoDe(diasV4, e.hechos.registroV4El),
    hechoEl: e.hechos.registroV4El ?? null,
    marcable: true,
  });

  const diasGraph = diasHasta(FECHA_GRAPH_V21, e.ahora);
  const version = numeroDeGraph(e.graphVersion);
  const alDia = version >= GRAPH_MINIMA;
  avisos.push({
    id: 'graphVersion',
    titulo: alDia ? `Graph API al día (${e.graphVersion})` : `Graph API ${e.graphVersion}: caduca el ${fechaLegible(FECHA_GRAPH_V21)}`,
    detalle: alDia
      ? 'La versión con la que este sistema habla con Meta ya trae los límites por portafolio y sigue viva después de enero de 2027. Nada que hacer.'
      : `Este sistema está fijado a ${e.graphVersion} (GRAPH_API_VERSION en el .env). Quita esa línea o pon v25.0: la v21 deja de responder el ${fechaLegible(FECHA_GRAPH_V21)} y las versiones anteriores a la 24 no traen el límite de mensajería por portafolio.`,
    limite: FECHA_GRAPH_V21,
    diasRestantes: diasGraph,
    estado: alDia ? 'ok' : diasGraph < 0 ? 'vencido' : diasGraph <= 60 ? 'urgente' : 'pendiente',
    hechoEl: null,
    marcable: false,
  });

  return avisos;
}
