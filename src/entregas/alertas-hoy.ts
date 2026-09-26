/**
 * «Hay que mirar»: los pedidos que se trabaron (pedido del dueño, 25/09).
 *
 * Arriba de la lista de Hoy, una tarjeta roja que solo aparece si hay algo, y
 * lo mismo en la campana. Nada de esto va al cliente. Tres casos, con sus
 * tiempos en Hoy → Ajustes de los mensajes → Tiempos:
 *
 *  a) un motorizado no dio sus minutos en `reasignarMotorizadoMin` y no hay
 *     otro activo a quien pasárselo (si lo hay, el motor se lo pasa solo);
 *  b) a la hora `alertaSinUbicacionHora` (12:00) un pedido sigue sin ubicación
 *     y sin motorizado: se puede asignar uno sin ubicación;
 *  c) un pedido «en camino» pasó su hora estimada + `alertaEnCaminoMin` sin
 *     «entregado»: llamar al motorizado o marcarlo entregado.
 *
 * Aquí solo se calcula (sin tocar nada): lo llama el resumen de Hoy.
 */

import { esNumeroDePrueba } from '../desarrollador/numeros.js';
import type { Entrega, Motorizado } from './repo.js';
import type { AjustesEntregas } from './textos.js';
import { horaEnReloj, minutosEnPalabras } from './textos.js';

export type TipoAlertaHoy = 'motorizado_sin_minutos' | 'sin_ubicacion' | 'en_camino_tarde';
export type AccionAlertaHoy = 'llamar_motorizado' | 'reasignar' | 'sin_ubicacion' | 'marcar_entregada';

export interface AlertaHoy {
  tipo: TipoAlertaHoy;
  entregaId: number;
  referencia: string;
  nombre: string | null;
  phone: string;
  /** Qué pasa, en palabras. */
  texto: string;
  motorizado: { id: number; nombre: string; phone: string } | null;
  acciones: AccionAlertaHoy[];
}

/** El título corto de cada caso (la campana y la tarjeta). */
export const TITULO_ALERTA: Record<TipoAlertaHoy, (n: number) => string> = {
  motorizado_sin_minutos: (n) => `${n} pedido${n === 1 ? '' : 's'} sin los minutos del motorizado y sin otro a quien pasárselo`,
  sin_ubicacion: (n) => `${n} pedido${n === 1 ? '' : 's'} todavía sin ubicación`,
  en_camino_tarde: (n) => `${n} pedido${n === 1 ? '' : 's'} en camino pasado${n === 1 ? '' : 's'} de su hora`,
};

const FINALES = new Set(['entregada', 'terminada', 'cancelada']);
/** Las apartadas que siguen siendo «solo le falta la ubicación». */
const INCIDENCIAS_DE_UBICACION = new Set(['sin_respuesta', 'sin_ubicacion', 'respondio_sin_ubicacion', 'consulta_ajena', 'ya_en_curso']);

/** "HH:MM" de ese momento en el reloj del negocio. */
function horaMinutos(fecha: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(fecha).slice(0, 5);
  } catch {
    return `${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;
  }
}

export function calcularAlertas(entregas: Entrega[], motorizados: Motorizado[], ajustes: AjustesEntregas, ahora: Date, tz: string): AlertaHoy[] {
  const alertas: AlertaHoy[] = [];
  const porId = new Map(motorizados.map((m) => [m.id, m]));
  const moto = (m: Motorizado | undefined) => (m ? { id: m.id, nombre: m.nombre, phone: m.phone } : null);
  const base = (e: Entrega) => ({ entregaId: e.id, referencia: e.referencia, nombre: e.nombre, phone: e.phone });
  const yaEsLaHora = horaMinutos(ahora, tz) >= ajustes.alertaSinUbicacionHora;

  for (const e of entregas) {
    if (FINALES.has(e.estado) || e.envioRetenidoAt) continue;
    const m = e.motorizadoId ? porId.get(e.motorizadoId) : undefined;

    // a) El motorizado no dio sus minutos a tiempo y no hay otro activo.
    if (e.estado === 'esperando_motorizado' && e.motorizadoEstado === 'enviado' && e.motorizadoEnviadoAt) {
      const esperando = (ahora.getTime() - e.motorizadoEnviadoAt.getTime()) / 60_000;
      if (esperando >= ajustes.reasignarMotorizadoMin) {
        const otros = motorizados.filter((x) => x.estado === 'activo' && x.id !== e.motorizadoId && !e.motorizadosDescartados.includes(x.id) && esNumeroDePrueba(x.phone) === esNumeroDePrueba(e.phone));
        if (!otros.length) {
          alertas.push({ tipo: 'motorizado_sin_minutos', ...base(e), texto: `${m?.nombre ?? 'El motorizado'} no dio sus minutos en ${minutosEnPalabras(esperando)} y no hay otro motorizado activo para pasárselo.`, motorizado: moto(m), acciones: m ? ['llamar_motorizado', 'reasignar'] : ['reasignar'] });
        }
      }
      continue;
    }

    // c) En camino y ya pasó su hora estimada (más el margen de la alerta) sin «entregado».
    if (e.estado === 'avisada' && e.llegaAproxAt) {
      const pasados = (ahora.getTime() - e.llegaAproxAt.getTime()) / 60_000;
      if (pasados >= ajustes.alertaEnCaminoMin) {
        alertas.push({ tipo: 'en_camino_tarde', ...base(e), texto: `${m?.nombre ?? 'El motorizado'} lo lleva: al cliente se le dijo ${horaEnReloj(e.llegaAproxAt, tz)} y ya pasaron ${minutosEnPalabras(pasados)} sin «entregado».`, motorizado: moto(m), acciones: m ? ['llamar_motorizado', 'marcar_entregada'] : ['marcar_entregada'] });
      }
      continue;
    }

    // b) A la hora del ajuste sigue sin ubicación y sin motorizado.
    if (yaEsLaHora && e.ubicacionEstado === 'pendiente') {
      const loLleva = Boolean(e.motorizadoId) && (e.motorizadoEstado === 'enviado' || e.motorizadoEstado === 'respondio');
      if (loLleva) continue;
      if (e.estado === 'incidencia' && !INCIDENCIAS_DE_UBICACION.has(e.incidencia ?? '')) continue;
      alertas.push({ tipo: 'sin_ubicacion', ...base(e), texto: `Son más de las ${ajustes.alertaSinUbicacionHora} y todavía no manda su ubicación${e.direccionCliente ? ` (escribió: ${e.direccionCliente})` : ''}.`, motorizado: null, acciones: ['sin_ubicacion'] });
    }
  }
  return alertas;
}
