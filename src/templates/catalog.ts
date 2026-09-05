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
    language: 'es_MX',
    category: 'UTILITY',
    body: 'Hola {{1}}, tu pedido #{{2}} ha sido registrado con exito. Puedes ver el estado de tu envio aqui: {{3}}. Gracias por confiar en nosotros.',
    variables: ['nombre', 'numero de pedido', 'enlace de seguimiento'],
  },
  {
    name: 'seguimiento_entrega',
    language: 'es_MX',
    category: 'UTILITY',
    body: 'Hola {{1}}, te informamos que tu paquete esta en camino y llegara el dia {{2}}. Si necesitas cambiar la direccion, responde a este mensaje.',
    variables: ['nombre', 'fecha de entrega'],
  },
  {
    name: 'recuperacion_carrito',
    language: 'es_MX',
    category: 'MARKETING',
    body: 'Hola {{1}}, vimos que dejaste algunos articulos en tu carrito de {{2}}. Tienes alguna duda sobre el producto? Si no deseas recibir mas avisos, responde BAJA.',
    variables: ['nombre', 'nombre de la tienda'],
  },
  {
    name: 'recordatorio_cita',
    language: 'es_MX',
    category: 'UTILITY',
    body: 'Hola {{1}}, te recordamos que tienes una cita agendada para el {{2}} a las {{3}}. Por favor, confirmanos tu asistencia.',
    variables: ['nombre', 'fecha', 'hora'],
  },
];

export function findInCatalog(name: string, language = 'es_MX'): CatalogTemplate | undefined {
  return CATALOG.find((t) => t.name === name && t.language === language);
}
