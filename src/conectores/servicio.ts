/**
 * Que se hace con un pedido que avisa la tienda.
 *
 * Se busca la regla del evento, se limpia el telefono con el plan de
 * numeracion del pais, se deja el consentimiento escrito (el cliente dio su
 * numero al hacer el pedido: ese es el origen) y sale el mensaje por el
 * sender de siempre, con sus guardas. Todo lo que pasa, salga o no, queda
 * en `conector_entradas` para poder responder a "no me llego el mensaje del
 * pedido 1024" sin adivinar.
 */

import type { Config } from '../config.js';
import type { Repos } from '../db/repos.js';
import type { Sender, SendOutcome } from '../outbound/sender.js';
import { providerOf, type SettingsService } from '../settings/service.js';
import { PLANES, revisarTelefono } from '../rutas/telefono.js';
import type { Conector, ConectoresRepo, ResultadoEntrada } from './repo.js';
import { rellenar, type PedidoTienda } from './tiendas.js';

export interface ConectoresDeps {
  repos: Repos & { conectores: ConectoresRepo };
  sender: Sender;
  settings: SettingsService;
  config: Config;
  nombreNegocio?: () => string;
  ahora?: () => Date;
}

export interface ResultadoProceso {
  resultado: ResultadoEntrada;
  detalle: string | null;
  telefono: string | null;
}

export async function procesarPedido(conector: Conector, pedido: PedidoTienda, deps: ConectoresDeps): Promise<ResultadoProceso> {
  const { repos, sender, settings, config } = deps;
  const anotar = async (resultado: ResultadoEntrada, detalle: string | null, telefono: string | null): Promise<ResultadoProceso> => {
    await repos.conectores.anotarEntrada({
      conectorId: conector.id,
      evento: pedido.evento,
      eventoOrigen: pedido.eventoOrigen,
      pedido: pedido.numero || null,
      telefono,
      resultado,
      detalle,
      at: deps.ahora?.(),
    });
    return { resultado, detalle, telefono };
  };

  const regla = conector.reglas.find((r) => r.evento === pedido.evento && r.activo);
  if (!regla) return anotar('sin_regla', `no hay regla activa para ${pedido.evento}`, pedido.telefono);

  if (!pedido.telefono) return anotar('sin_telefono', 'el pedido no trae telefono', null);
  const revision = revisarTelefono(pedido.telefono, PLANES[config.RUTAS_PAIS] ?? PLANES.generico);
  if (!revision.ok) return anotar('sin_telefono', `${revision.incidencia}: ${revision.detalle}`, pedido.telefono);
  const phone = revision.phone;

  // El cliente dio su numero al comprar: eso es el consentimiento, y aqui
  // queda escrito de donde sale.
  await repos.contacts.upsertFromInbound(phone, pedido.nombre ?? undefined);
  await repos.contacts.setOptIn(phone, `pedido ${pedido.numero} en ${conector.nombre}`);

  const tienda = deps.nombreNegocio?.() ?? config.businessName;
  const oficial = providerOf(settings.current()) === 'cloud';

  // Con la API de Meta manda la plantilla (fuera de 24 h el texto no sale);
  // con un cliente no oficial, el texto es mas natural y la plantilla se
  // manda como su cuerpo ya sustituido.
  const usarPlantilla = oficial ? Boolean(regla.plantilla) : Boolean(regla.plantilla) && !regla.texto;

  let outcome: SendOutcome;
  if (usarPlantilla && regla.plantilla) {
    const template =
      (await repos.templates.get(regla.plantilla.nombre, regla.plantilla.idioma)) ??
      (await repos.templates.list()).find((t) => t.name === regla.plantilla!.nombre) ??
      null;
    if (!template) return anotar('error', `la plantilla "${regla.plantilla.nombre}" no existe`, phone);
    outcome = await sender.send({
      phone,
      kind: 'template',
      category: template.category,
      templateName: template.name,
      templateLanguage: template.language,
      variables: regla.variables.map((v) => rellenar(v, pedido, tienda)),
    });
  } else if (regla.texto) {
    outcome = await sender.send({ phone, kind: 'freeform', category: 'UTILITY', text: rellenar(regla.texto, pedido, tienda) });
  } else {
    return anotar('error', oficial ? 'la regla no tiene plantilla (con la API de Meta hace falta una)' : 'la regla no tiene texto ni plantilla', phone);
  }

  if (outcome.ok) return anotar('enviado', `mensaje ${outcome.wamid}`, phone);
  if (outcome.blocked) return anotar('bloqueado', `${outcome.code}: ${outcome.reason}`, phone);
  return anotar('error', outcome.error, phone);
}
