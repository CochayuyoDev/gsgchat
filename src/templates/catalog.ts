/**
 * Catalogo de plantillas que se dan de alta en Meta.
 *
 * Este fichero es la fuente de verdad de lo que se ENVIA a aprobar; el
 * estado real (aprobada, pausada, calidad) vive en la tabla `templates` y
 * lo actualizan la sincronizacion y los webhooks. Antes de subir nada,
 * `npm run templates:push` pasa cada plantilla por el linter.
 */

import type { TemplateCategory } from '../db/repos.js';

export interface CatalogTemplate {
  name: string;
  language: string;
  category: TemplateCategory;
  body: string;
  /** Que significa cada {{n}}, para que quien lance la campana no se equivoque. */
  variables: string[];
  footer?: string;
}

export const CATALOG: CatalogTemplate[] = [
  {
    name: 'confirmacion_pedido',
    language: 'es',
    category: 'UTILITY',
    body: 'Hola {{1}}, tu pedido #{{2}} ha sido registrado con exito. Puedes ver el estado de tu envio aqui: {{3}}. Gracias por confiar en nosotros.',
    variables: ['nombre', 'numero de pedido', 'enlace de seguimiento'],
  },
  {
    name: 'seguimiento_entrega',
    language: 'es',
    category: 'UTILITY',
    body: 'Hola {{1}}, te informamos que tu paquete esta en camino y llegara el dia {{2}}. Si necesitas cambiar la direccion, responde a este mensaje.',
    variables: ['nombre', 'fecha de entrega'],
  },
  {
    name: 'recuperacion_carrito',
    language: 'es',
    category: 'MARKETING',
    body: 'Hola {{1}}, vimos que dejaste algunos articulos en tu carrito de {{2}}. Tienes alguna duda sobre el producto? Si no deseas recibir mas avisos, responde BAJA.',
    variables: ['nombre', 'nombre de la tienda'],
  },
  {
    name: 'recordatorio_cita',
    language: 'es',
    category: 'UTILITY',
    body: 'Hola {{1}}, te recordamos que tienes una cita agendada para el {{2}} a las {{3}}. Por favor, confirmanos tu asistencia.',
    variables: ['nombre', 'fecha', 'hora'],
  },

  // --- reparto: conseguir la ubicacion del cliente -----------------------
  //
  // Las tres son del mismo trabajo y se mandan en este orden: se pide, se
  // recuerda, y si el cliente contesta cualquier otra cosa se le vuelve a
  // pedir reconociendo que contesto. Categoria UTILITY porque son sobre un
  // pedido que el cliente ya hizo; con lexico promocional Meta las
  // reclasificaria como MARKETING y ahi si haria falta su opt-in.
  {
    name: 'solicitud_ubicacion',
    language: 'es',
    category: 'UTILITY',
    body: 'Hola {{1}}, le escribimos de {{2}} por su pedido {{3}}. Para llegar exacto a su dirección necesitamos su ubicación. Puede compartirla desde el clip, opción Ubicación, y elegir su ubicación actual. Gracias.',
    variables: ['nombre del cliente', 'nombre del negocio', 'número de pedido o guía'],
  },
  {
    name: 'recordatorio_ubicacion',
    language: 'es',
    category: 'UTILITY',
    body: 'Hola {{1}}, seguimos pendientes de su ubicación para entregar su pedido {{2}}. Puede compartirla desde el clip, opción Ubicación. Si prefiere, responda este mensaje y le llamamos.',
    variables: ['nombre del cliente', 'número de pedido o guía'],
  },
  {
    name: 'ubicacion_pendiente',
    language: 'es',
    category: 'UTILITY',
    body: 'Gracias por responder, {{1}}. Para su pedido {{2}} nos falta el punto exacto en el mapa. Comparta su ubicación desde el clip, opción Ubicación, o responda y le llamamos.',
    variables: ['nombre del cliente', 'número de pedido o guía'],
  },

  // Variantes B de las tres anteriores. Dicen lo mismo con otras palabras, y
  // existen por una razon concreta: Meta pausa una plantilla en cuanto recibe
  // quejas (3 h la primera vez, 6 h la segunda, la tercera para siempre). Con
  // dos plantillas por paso, el motor las alterna y una pausa deja de ser un
  // apagon del reparto. Meta rechaza cuerpos identicos: por eso no son copias.
  {
    name: 'solicitud_ubicacion_b',
    language: 'es',
    category: 'UTILITY',
    body: 'Buen día {{1}}, somos {{2}} y tenemos su pedido {{3}} listo para entregar. Para que el repartidor llegue sin dar vueltas, ¿nos comparte su ubicación? Está en el clip, opción Ubicación, y luego su ubicación actual.',
    variables: ['nombre del cliente', 'nombre del negocio', 'número de pedido o guía'],
  },
  {
    name: 'recordatorio_ubicacion_b',
    language: 'es',
    category: 'UTILITY',
    body: 'Estimado {{1}}, todavía no recibimos su ubicación para su pedido {{2}}. Cuando pueda, compártala desde el clip, opción Ubicación. Si le viene mejor por teléfono, responda y le llamamos.',
    variables: ['nombre del cliente', 'número de pedido o guía'],
  },
  {
    name: 'ubicacion_pendiente_b',
    language: 'es',
    category: 'UTILITY',
    body: 'Recibimos su mensaje, {{1}}, gracias. Lo que nos falta para entregar su pedido {{2}} es el punto en el mapa: clip, opción Ubicación, ubicación actual. También podemos llamarle si lo prefiere.',
    variables: ['nombre del cliente', 'número de pedido o guía'],
  },
];

export function findInCatalog(name: string, language = 'es'): CatalogTemplate | undefined {
  return CATALOG.find((t) => t.name === name && t.language === language);
}
