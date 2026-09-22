/**
 * Perfiles de instalacion: "para que se va a usar GSGchat". Cada perfil deja
 * de un clic el modo del menu, que contesta solo y los ajustes de las
 * entregas con valores sensatos para ese negocio. No toca los textos que el
 * dueño ya escribio ni sus datos: solo interruptores y el modo.
 *
 *  - reparto (por defecto): reparto para GSG, menu "Solo lo de GSG".
 *  - tienda: una tienda con delivery propio (menu completo, entregas con
 *    botones, sin preventa de courier).
 *  - chat: solo atencion por chat con el asistente (menu completo, sin
 *    automatismos de entregas).
 *
 * Se elige en Conexion (arriba del todo) y queda apuntado en settings.
 */

import type { SettingsRepo } from '../settings/service.js';

export type NombrePerfil = 'reparto' | 'tienda' | 'chat';

export interface Perfil {
  id: NombrePerfil;
  nombre: string;
  descripcion: string;
  /** Lo que cambia, en palabras, para que el dueño sepa a que dice que si. */
  cambia: string[];
  modo: 'gsg' | 'completo';
  tono: 'tu' | 'usted' | 'auto';
  preventaActiva: boolean;
  entregas: {
    responderDondeEsta: boolean;
    usarBotones: boolean;
    avisarEntregado: boolean;
    avisarCerca: boolean;
    clienteRecurrente: boolean;
    segundaVisita: boolean;
    cierreDelDia: boolean;
  };
}

export const PERFILES: Perfil[] = [
  {
    id: 'reparto',
    nombre: 'Reparto para GSG',
    descripcion: 'Los pedidos llegan de GSG (o se pegan), el sistema pide la ubicación, confirma, manda al motorizado y avisa la hora. Es el de siempre.',
    cambia: ['Menú «Solo lo de GSG»', 'Entregas con botones SÍ / NO, segunda visita, cliente recurrente y cierre del día', 'El asistente contesta lo demás; sin cotizador de envíos'],
    modo: 'gsg',
    tono: 'auto',
    preventaActiva: false,
    entregas: { responderDondeEsta: true, usarBotones: true, avisarEntregado: true, avisarCerca: true, clienteRecurrente: true, segundaVisita: true, cierreDelDia: true },
  },
  {
    id: 'tienda',
    nombre: 'Tienda con delivery',
    descripcion: 'Una tienda que vende por WhatsApp y reparte con sus propios motorizados: catálogo, pedidos desde el chat y entregas del día.',
    cambia: ['Menú completo (catálogo, pedidos del chat, campañas)', 'Entregas con botones, cliente recurrente y cierre del día', 'Trata de tú al cliente; sin cotizador de envíos'],
    modo: 'completo',
    tono: 'tu',
    preventaActiva: false,
    entregas: { responderDondeEsta: true, usarBotones: true, avisarEntregado: true, avisarCerca: true, clienteRecurrente: true, segundaVisita: true, cierreDelDia: true },
  },
  {
    id: 'chat',
    nombre: 'Solo atención por chat',
    descripcion: 'Atender y vender por WhatsApp con el asistente y las personas del equipo, sin reparto.',
    cambia: ['Menú completo', 'Sin automatismos de entregas (ni cierre del día, ni segunda visita)', 'Trata de usted al cliente; sin cotizador de envíos'],
    modo: 'completo',
    tono: 'usted',
    preventaActiva: false,
    entregas: { responderDondeEsta: false, usarBotones: true, avisarEntregado: false, avisarCerca: false, clienteRecurrente: false, segundaVisita: false, cierreDelDia: false },
  },
];

export const PERFIL_INICIAL: NombrePerfil = 'reparto';

const CLAVE = 'perfil.instalacion';

export interface PerfilAplicado {
  perfil: NombrePerfil;
  en: string;
  quien: string | null;
}

export interface DepsPerfiles {
  settingsRepo: SettingsRepo;
  ajustes?: { guardar(patch: { modo?: 'gsg' | 'completo'; tono?: 'tu' | 'usted' | 'auto' }): Promise<unknown> };
  entregas?: { guardarAjustes(patch: Record<string, unknown>): Promise<unknown>; ajustes(): { segundaVisita: { activa: boolean; esperaMin: number }; cierreDelDia: { activo: boolean; hora: number }; clienteRecurrente?: { activo: boolean } } };
  automation?: { setPrefs(prefs: { preventaActiva?: boolean }): Promise<unknown> };
  ahora?: () => Date;
}

export interface ServicioPerfiles {
  perfiles(): Perfil[];
  actual(): PerfilAplicado | null;
  /** Aplica el perfil: modo, tono, preventa y los interruptores de las entregas. */
  aplicar(id: NombrePerfil, quien: string | null): Promise<{ perfil: Perfil; aplicado: PerfilAplicado; detalle: string }>;
}

export async function crearServicioPerfiles(deps: DepsPerfiles): Promise<ServicioPerfiles> {
  const ahora = deps.ahora ?? (() => new Date());
  let aplicado: PerfilAplicado | null = null;
  for (const s of await deps.settingsRepo.getAll()) {
    if (s.key === CLAVE) {
      try {
        aplicado = JSON.parse(s.value) as PerfilAplicado;
      } catch {
        aplicado = null;
      }
    }
  }
  return {
    perfiles: () => PERFILES,
    actual: () => aplicado,
    async aplicar(id, quien) {
      const perfil = PERFILES.find((p) => p.id === id);
      if (!perfil) throw new Error('Ese perfil no existe.');
      const hecho: string[] = [];
      if (deps.ajustes) {
        await deps.ajustes.guardar({ modo: perfil.modo, tono: perfil.tono });
        hecho.push(perfil.modo === 'gsg' ? 'menú «Solo lo de GSG»' : 'menú completo');
      }
      if (deps.automation) {
        await deps.automation.setPrefs({ preventaActiva: perfil.preventaActiva });
        hecho.push(perfil.preventaActiva ? 'cotizador de envíos encendido' : 'cotizador de envíos apagado');
      }
      if (deps.entregas) {
        const e = deps.entregas.ajustes();
        await deps.entregas.guardarAjustes({
          responderDondeEsta: perfil.entregas.responderDondeEsta,
          usarBotones: perfil.entregas.usarBotones,
          avisarEntregado: perfil.entregas.avisarEntregado,
          avisarCerca: perfil.entregas.avisarCerca,
          segundaVisita: { ...e.segundaVisita, activa: perfil.entregas.segundaVisita },
          cierreDelDia: { ...e.cierreDelDia, activo: perfil.entregas.cierreDelDia },
          ...(e.clienteRecurrente ? { clienteRecurrente: { ...e.clienteRecurrente, activo: perfil.entregas.clienteRecurrente } } : {}),
        });
        hecho.push('ajustes de las entregas');
      }
      aplicado = { perfil: id, en: ahora().toISOString(), quien };
      await deps.settingsRepo.put(CLAVE, JSON.stringify(aplicado), false);
      return { perfil, aplicado, detalle: `Perfil «${perfil.nombre}» aplicado: ${hecho.join(', ')}. Tus textos y tus datos no se tocaron.` };
    },
  };
}
