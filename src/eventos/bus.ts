/**
 * Lo que pasa en el sistema, dicho para que otros se enteren.
 *
 * Hasta aqui cada modulo hacia lo suyo y nadie mas lo sabia: llegaba un
 * mensaje, se guardaba, el bot contestaba, y el sistema de al lado (Stoky,
 * GSG) seguia sin enterarse. Este bus es el sitio unico donde se anuncia:
 * quien quiera escuchar -los webhooks salientes, manana el chat embebido-
 * se suscribe aqui y no tiene que meterse en los handlers.
 *
 * Los eventos se emiten desde `observar.ts`, que envuelve los repositorios:
 * asi cubren a los tres proveedores (Cloud API, Baileys, WAHA) y a la
 * importacion de historial, porque todos acaban escribiendo en la misma
 * tabla.
 */

import { EventEmitter } from 'node:events';

/** Un contacto tal como viaja hacia fuera: lo justo para reconocerlo. */
export interface ContactoEvento {
  id: string;
  telefono: string;
  nombre: string | null;
}

export interface Eventos {
  /** Escribio el cliente (texto, ubicacion, foto...). */
  'mensaje.recibido': {
    contacto: ContactoEvento;
    /** `transcripcion`: lo que dijo en una nota de voz, si la voz esta configurada (ver src/voz); `texto` lo lleva tambien. */
    mensaje: {
      id: string | null;
      tipo: string;
      texto: string | null;
      transcripcion: string | null;
      /** El anuncio (Facebook/Instagram) desde el que escribio, si vino de uno. */
      anuncio: { id: string | null; titulo: string | null; texto: string | null; url: string | null; imagen: string | null; clid: string | null; origen: string | null } | null;
      datos: Record<string, unknown> | null;
      fecha: string;
    };
    /** Si se puede contestar con texto libre por la API de Meta. */
    ventanaAbierta: boolean;
  };
  /** Salio un mensaje hacia el cliente (a mano, por el bot, por campana). */
  'mensaje.enviado': {
    contacto: ContactoEvento;
    /** `autor`: quien lo mando: 'persona' (a mano), 'ia' (el asistente) o 'sistema' (reglas, reparto, campanas, la API). `voz`: salio como nota de voz. */
    mensaje: { id: string | null; tipo: string; texto: string | null; autor: 'persona' | 'ia' | 'sistema'; autorNombre: string | null; voz: boolean; fecha: string };
  };
  /** Meta (o el proveedor) dice como va: sent, delivered, read, failed. */
  'mensaje.estado': { mensajeId: string; estado: string; fecha: string };
  /** Se consiguio una ubicacion (pin nativo o link de mapa). */
  'ubicacion.recibida': {
    contacto: ContactoEvento;
    ubicacion: { lat: number; lng: number; fuente: string; confianza: string; necesitaConfirmacion: boolean };
    fecha: string;
  };
  /** Registro consentimiento (por palabra clave, por API, por la pantalla). */
  'contacto.alta': { contacto: { telefono: string }; origen: string; fecha: string };
  /** Se dio de baja: no se le vuelve a escribir. */
  'contacto.baja': { contacto: { telefono: string }; fecha: string };
  /** Una solicitud de ubicacion del reparto cambio de estado. */
  'reparto.solicitud.actualizada': {
    solicitud: { id: number; loteId: string; telefono: string; referencia: string | null; estado: string; incidencia: string | null };
    ubicacion: { lat: number; lng: number } | null;
    fecha: string;
  };
  /** El monitor cambio el semaforo del numero. */
  'salud.nivel': { de: string | null; a: string; puntos: number; motivos: string[]; fecha: string };
  /** Se tomo un pedido en el chat (el asistente o una persona). */
  'pedido.creado': {
    pedido: { id: number; estado: string; items: Array<{ sku: string; nombre: string; cantidad: number; precio: number | null; subtotal: number | null; url?: string | null }>; total: number; moneda: string; nombre: string | null; telefono: string | null; direccion: string | null; referencia: string | null; pago: string | null; notas: string | null; origen: string };
    contacto: ContactoEvento;
    fecha: string;
  };
  /** El cliente confirmo su pedido de hoy (por WhatsApp o a mano). */
  'entrega.confirmada': EventoEntregaDelDia;
  /** Al cliente se le aviso a que hora le llega (el motorizado dio su tiempo). */
  'entrega.avisada': EventoEntregaDelDia;
  /** El motorizado dijo "entregado" (o mando la foto, o lo marco una persona). */
  'entrega.entregada': EventoEntregaDelDia;
  /** La entrega necesita a una persona (sin confirmacion, sin motorizado, no estaba...). */
  'entrega.incidencia': EventoEntregaDelDia;
}

/** Una entrega del dia tal como viaja hacia fuera (ver src/entregas). */
export interface EventoEntregaDelDia {
  entrega: {
    id: number;
    referencia: string;
    telefono: string;
    nombre: string | null;
    estado: string;
    lat: number | null;
    lng: number | null;
    motorizado: { nombre: string; telefono: string } | null;
    minutosAviso: number | null;
    llegaAproxEn: string | null;
    entregadoEn: string | null;
    incidencia: string | null;
    incidenciaDetalle: string | null;
  };
  fecha: string;
}

export type NombreEvento = keyof Eventos;

export const NOMBRES_EVENTOS: NombreEvento[] = [
  'mensaje.recibido',
  'mensaje.enviado',
  'mensaje.estado',
  'ubicacion.recibida',
  'contacto.alta',
  'contacto.baja',
  'reparto.solicitud.actualizada',
  'salud.nivel',
  'pedido.creado',
  'entrega.confirmada',
  'entrega.avisada',
  'entrega.entregada',
  'entrega.incidencia',
];

/** Que significa cada uno, para el panel y la documentacion. */
export const DESCRIPCION_EVENTOS: Record<NombreEvento, string> = {
  'mensaje.recibido': 'El cliente escribio (texto, ubicacion, foto, audio...).',
  'mensaje.enviado': 'Salio un mensaje hacia el cliente, lo mandara quien lo mandara.',
  'mensaje.estado': 'Un mensaje enviado cambio de estado: sent, delivered, read o failed.',
  'ubicacion.recibida': 'Se consiguio la ubicacion de un cliente (pin o link de mapa).',
  'contacto.alta': 'Un contacto dio su consentimiento para recibir mensajes.',
  'contacto.baja': 'Un contacto pidio no recibir mas mensajes.',
  'reparto.solicitud.actualizada': 'Una solicitud de ubicacion del reparto cambio de estado o de incidencia.',
  'salud.nivel': 'El semaforo del numero cambio (verde, amarillo, naranja, rojo).',
  'pedido.creado': 'Se tomo un pedido en el chat, con sus lineas, total y datos de entrega.',
  'entrega.confirmada': 'El cliente confirmo que recibe hoy su pedido (entregas del dia).',
  'entrega.avisada': 'Al cliente se le aviso a que hora le llega su pedido (el motorizado dio su tiempo).',
  'entrega.entregada': 'El motorizado dijo que entrego el pedido (o mando la foto, o lo marco una persona).',
  'entrega.incidencia': 'Una entrega del dia necesita a una persona (sin confirmar, sin motorizado, no estaba...).',
};

export function esNombreEvento(valor: string): valor is NombreEvento {
  return (NOMBRES_EVENTOS as string[]).includes(valor);
}

export type Oyente<E extends NombreEvento> = (payload: Eventos[E]) => void | Promise<void>;

export interface Bus {
  emitir<E extends NombreEvento>(evento: E, payload: Eventos[E]): void;
  /** Devuelve la funcion que se desuscribe. */
  escuchar<E extends NombreEvento>(evento: E, oyente: Oyente<E>): () => void;
  /** Un oyente para todo, con el nombre del evento delante. */
  escucharTodo(oyente: (evento: NombreEvento, payload: Eventos[NombreEvento]) => void | Promise<void>): () => void;
}

/**
 * Un bus en memoria.
 *
 * Un oyente que falla no puede tumbar al que emitio: emitir un evento es
 * "que se sepa", no "que se haga". El error se apunta y se sigue.
 */
export function crearBus(log?: (mensaje: string, detalle: Record<string, unknown>) => void): Bus {
  const emisor = new EventEmitter();
  emisor.setMaxListeners(50);
  const TODO = '*';

  type Oyente = (...args: unknown[]) => void | Promise<void>;
  const seguro =
    (evento: string, oyente: Oyente) =>
    (...args: unknown[]) => {
      try {
        const r = oyente(...args);
        if (r && typeof (r as Promise<void>).catch === 'function') {
          (r as Promise<void>).catch((error) =>
            log?.('fallo un oyente de eventos', { evento, detalle: error instanceof Error ? error.message : String(error) }),
          );
        }
      } catch (error) {
        log?.('fallo un oyente de eventos', { evento, detalle: error instanceof Error ? error.message : String(error) });
      }
    };

  return {
    emitir(evento, payload) {
      emisor.emit(evento, payload);
      emisor.emit(TODO, evento, payload);
    },
    escuchar(evento, oyente) {
      const envuelto = seguro(evento, oyente as unknown as Oyente);
      emisor.on(evento, envuelto);
      return () => emisor.off(evento, envuelto);
    },
    escucharTodo(oyente) {
      const envuelto = seguro(TODO, oyente as unknown as Oyente);
      emisor.on(TODO, envuelto);
      return () => emisor.off(TODO, envuelto);
    },
  };
}
