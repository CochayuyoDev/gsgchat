/**
 * Mandarle a un numero (o a un chat por su nombre) lo que haga falta, desde
 * la IA operadora: una plantilla aprobada con sus variables, un sticker de la
 * biblioteca, un pin de ubicacion, una nota de voz, el mismo texto a varios
 * numeros sueltos, una respuesta citando al cliente o reenviar lo que mando
 * otro chat.
 *
 * Todo sale por las MISMAS rutas que usa el chat del panel (/admin/chat/send,
 * /admin/chat/reenviar, /admin/stickers/:id/enviar), asi que pasa por el
 * sender con todas sus guardas (modo prueba, anti-baneo, horario, tope, baja).
 * Como en acciones-panel.ts, `preparar` solo lee y arma la tarjeta con el
 * mensaje exacto; si hay dos chats o dos plantillas que encajan, pregunta.
 */

import { z } from 'zod';
import {
  acortar,
  avisosDeEnvio,
  candidatosContacto,
  def,
  errorDe,
  lineaContacto,
  normal,
  ok,
  prepararConContacto,
  telefonoADigitos,
  telefonoBonito,
  texto,
  unContacto,
  type Accion,
  type ContactoVista,
  type ContextoAccion,
  type Preparado,
  type RespuestaLlamada,
  type ResultadoAccion,
} from './acciones-base.js';

// ============================================================ A QUIEN VA

/** A quien sale el mensaje, ya resuelto: su telefono y, si lo hay, su chat. */
interface Destino {
  phone: string;
  nombre: string | null;
  contactId?: string;
  baja: boolean;
}

/** Numero de WhatsApp valido (con pais): 8 a 15 digitos. */
const esNumero = (d: string) => /^\d{8,15}$/.test(d);

/** «Rosa (51 912 426 667)». */
const quienEs = (d: Destino) => `${d.nombre ? `${d.nombre} ` : ''}(${telefonoBonito(d.phone)})`;

/** El contacto de ese telefono en la libreta (nombre, id y si se dio de baja), si existe. */
async function contactoDeTelefono(ctx: ContextoAccion, tel: string): Promise<{ id: string; name: string | null; optOutAt: string | null } | undefined> {
  const c = await ctx.llamar({ method: 'GET', url: `/admin/contacts?q=${tel}&limit=5` });
  if (!ok(c)) return undefined;
  return ((c.json as { items?: Array<{ id: string; phone: string; name: string | null; optOutAt: string | null }> }).items ?? []).find((x) => x.phone === tel);
}

/**
 * Para preparar: el destino por numero ("987654321", "51 987 654 321") o por
 * el nombre de su chat ("Rosa"). Si el nombre encaja con varios chats, se
 * devuelven las opciones (con el contactId ya puesto) para elegir.
 */
async function prepararDestino<P extends { telefono: string; contactId?: string }>(ctx: ContextoAccion, p: P, pregunta: string, armar: (d: Destino) => Promise<Preparado<P>>): Promise<Preparado<P>> {
  const tel = telefonoADigitos(p.telefono);
  if (!p.contactId && esNumero(tel)) {
    const c = await contactoDeTelefono(ctx, tel);
    return armar({ phone: tel, nombre: c?.name ?? null, contactId: c?.id, baja: Boolean(c?.optOutAt) });
  }
  if (!p.contactId && !/[a-zA-ZÀ-ÿ]/.test(p.telefono)) return { tipo: 'no', resumen: `"${p.telefono}" no parece un número de WhatsApp: escríbelo con sus 9 dígitos (o con el 51 delante), o dime el nombre del chat.` };
  return prepararConContacto(ctx, p, p.telefono, pregunta, async (c) => {
    const x = await contactoDeTelefono(ctx, c.phone);
    return armar({ phone: c.phone, nombre: c.name, contactId: c.id, baja: Boolean(x?.optOutAt) });
  });
}

/** Para ejecutar: el mismo destino (por su chat si ya se eligio, o si solo uno encaja). */
async function destinoParaEjecutar(ctx: ContextoAccion, telefono: string, contactId?: string): Promise<{ d: Destino } | { error: ResultadoAccion }> {
  const tel = telefonoADigitos(telefono);
  if (!contactId && esNumero(tel)) return { d: { phone: tel, nombre: null, baja: false } };
  const u = await unContacto(ctx, telefono, contactId);
  if ('error' in u) return u;
  return { d: { phone: u.c.phone, nombre: u.c.name, contactId: u.c.id, baja: false } };
}

/** Los avisos de siempre (modo prueba, horario, pausa...) y la baja delante. */
async function avisosPara(ctx: ContextoAccion, d: Destino, extra: string[] = []): Promise<string[]> {
  const avisos = await avisosDeEnvio(ctx, [d.phone]);
  if (d.baja) avisos.unshift('Este número se dio de BAJA: el sistema no le escribirá (salvo que él escriba primero).');
  return [...extra, ...avisos];
}

/** Lo que contesto /admin/chat/send (o el envio de un sticker), dicho para una persona. */
function resultadoEnvio(r: RespuestaLlamada, bien: string): ResultadoAccion {
  if (!ok(r)) return errorDe(r, 'No se pudo enviar.');
  const j = r.json as { ok?: boolean; blocked?: boolean; reason?: string; error?: string };
  if (j.ok) return { ok: true, resumen: bien, ir: '/chat' };
  return { ok: false, resumen: `No salió: ${(j.blocked ? j.reason : j.error) ?? j.reason ?? j.error ?? 'WhatsApp lo rechazó'}`, ir: '/panel#historial' };
}

const destinoSchema = { telefono: z.string().trim().min(2).max(120), contactId: z.string().max(80).optional() };

// ============================================================== PLANTILLAS

interface PlantillaVista {
  name: string;
  language: string;
  category?: string;
  status?: string;
  variables?: number;
  body?: string | null;
  variablesDoc?: string[] | null;
  pausadaHasta?: string | Date | null;
}

async function leerPlantillas(ctx: ContextoAccion): Promise<PlantillaVista[] | { error: ResultadoAccion }> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/templates' });
  if (!ok(r)) return { error: errorDe(r, 'No se pudieron leer las plantillas.') };
  const j = r.json as PlantillaVista[] | { items?: PlantillaVista[]; templates?: PlantillaVista[] };
  return Array.isArray(j) ? j : (j.items ?? j.templates ?? []);
}

/** Distancia de edicion, para encontrar "confirmacion_pedido" cuando dicen "confirmar pedido". */
function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previo = fila[0]!;
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = fila[j]!;
      fila[j] = Math.min(fila[j]! + 1, fila[j - 1]! + 1, previo + (a[i - 1] === b[j - 1] ? 0 : 1));
      previo = tmp;
    }
  }
  return fila[b.length]!;
}

/**
 * Las plantillas que pueden ser la que dijo la persona: por nombre exacto, por
 * nombre sin tildes ni mayusculas ("Pedir Ubicación" = pedir_ubicacion), por
 * palabras del nombre y, al final, por parecido. Se para en el primer nivel
 * que encuentra algo.
 */
export function candidatasPlantilla(lista: PlantillaVista[], quien: string, idioma?: string): PlantillaVista[] {
  const deIdioma = idioma ? lista.filter((t) => normal(t.language) === normal(idioma)) : lista;
  const q = normal(quien).replace(/[\s-]+/g, '_');
  if (!q) return [];
  const clave = (t: PlantillaVista) => normal(t.name).replace(/[\s-]+/g, '_');
  const niveles: Array<(t: PlantillaVista) => boolean> = [
    (t) => t.name === quien.trim(),
    (t) => clave(t) === q,
    (t) => q.split('_').filter((x) => x.length > 1).every((w) => clave(t).split('_').some((n) => n.startsWith(w) || w.startsWith(n))),
    (t) => clave(t).includes(q) || (q.length >= 5 && q.includes(clave(t))),
    (t) => distancia(clave(t), q) <= Math.max(2, Math.floor(q.length * 0.25)),
  ];
  for (const nivel of niveles) {
    const c = deIdioma.filter(nivel);
    if (c.length) return c;
  }
  return [];
}

/** Cuantas variables pide la plantilla: lo que diga el registro o el {{n}} mas alto del texto. */
function variablesQuePide(t: PlantillaVista): number {
  const delTexto = Math.max(0, ...[...(t.body ?? '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])));
  return Math.max(t.variables ?? 0, delTexto);
}

/** El texto final, con cada {{n}} sustituido por su valor. */
export function textoDePlantilla(body: string, variables: string[]): string {
  return body.replace(/\{\{\s*(\d+)\s*\}\}/g, (todo, n) => variables[Number(n) - 1] ?? todo);
}

const estaPausada = (t: PlantillaVista) => t.status === 'PAUSED' || (t.pausadaHasta ? new Date(t.pausadaHasta).getTime() > Date.now() : false);
const lineaPlantilla = (t: PlantillaVista) => `${t.name} (${t.language})${t.body ? ` · «${acortar(t.body, 70)}»` : ''}`;
const queSignifica = (t: PlantillaVista, n: number) => Array.from({ length: n }, (_, i) => `{{${i + 1}}} = ${t.variablesDoc?.[i] ?? `dato ${i + 1}`}`).join(', ');

/** Las variables como lleguen: ["Ana","P-1"], {"1":"Ana","2":"P-1"} o "Ana". Siempre una lista de textos. */
const variablesSchema = z.union([z.array(z.union([z.string(), z.number()])), z.record(z.string(), z.union([z.string(), z.number()])), z.string(), z.number()]).optional();

function listaDeVariables(v: z.infer<typeof variablesSchema>): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim());
  if (typeof v === 'object') return Object.entries(v).sort(([a], [b]) => (Number(a.replace(/\D/g, '')) || 0) - (Number(b.replace(/\D/g, '')) || 0)).map(([, x]) => String(x).trim());
  return [String(v).trim()];
}

type PlantillaElegida = { t: PlantillaVista } | { no: string; opciones?: PlantillaVista[] };

/** La plantilla aprobada que toca, o por que no (no existe, no esta aprobada, hay varias). */
function elegirPlantilla(lista: PlantillaVista[], nombre: string, idioma?: string): PlantillaElegida {
  const aprobadas = lista.filter((t) => t.status === 'APPROVED' && !estaPausada(t));
  const nombres = aprobadas.slice(0, 15).map((t) => t.name).join(', ') || 'ninguna (sincronízalas o créalas en Plantillas)';
  const c = candidatasPlantilla(lista, nombre, idioma);
  if (!c.length) return { no: `No encuentro ninguna plantilla que se llame "${nombre}". Las aprobadas son: ${nombres}.` };
  const buenas = c.filter((t) => t.status === 'APPROVED' && !estaPausada(t));
  if (!buenas.length) {
    const t = c[0]!;
    const estado = estaPausada(t) ? 'pausada por Meta' : t.status === 'REJECTED' ? 'rechazada' : t.status === 'PENDING' ? 'pendiente de aprobar' : `en estado ${t.status ?? 'desconocido'}`;
    return { no: `La plantilla «${t.name}» está ${estado}: solo se pueden mandar las aprobadas. Las aprobadas son: ${nombres}.` };
  }
  if (buenas.length > 1) return { no: `Hay ${buenas.length} plantillas que encajan con "${nombre}".`, opciones: buenas };
  return { t: buenas[0]! };
}

const mensajePlantilla = def({
  nombre: 'mensaje.plantilla',
  tipo: 'cambio',
  descripcion: 'Mandar UNA plantilla aprobada (un mensaje ya aprobado por WhatsApp, lo que sale aunque hayan pasado 24 h) a UN número o a un chat por su nombre, con sus variables {{1}}, {{2}}... en orden. Si no sabes cómo se llama la plantilla, usa antes plantillas.ver.',
  parametros: 'telefono (número o nombre del chat), plantilla (el nombre de la plantilla, como lo diga la persona), variables (lista de textos en orden: el primero es {{1}}, el segundo {{2}}...; vacía si la plantilla no lleva), idioma (opcional, "es" por defecto)',
  ejemplo: { orden: 'mándale al 987654321 la plantilla aviso_pedido con Ana y P-1003', accion: { accion: 'mensaje.plantilla', telefono: '987654321', plantilla: 'aviso_pedido', variables: ['Ana', 'P-1003'] } },
  schema: z.object({ ...destinoSchema, plantilla: z.string().trim().min(2).max(120), variables: variablesSchema, idioma: z.string().trim().min(2).max(10).optional() }),
  async preparar(p, ctx) {
    const l = await leerPlantillas(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen, ir: '/panel#plantillas' };
    const e = elegirPlantilla(l, p.plantilla, p.idioma);
    if ('no' in e) {
      if (e.opciones) return { tipo: 'elegir', pregunta: `${e.no} ¿Cuál mando?`, opciones: e.opciones.slice(0, 8).map((t) => ({ etiqueta: lineaPlantilla(t), params: { ...p, plantilla: t.name, idioma: t.language } })) };
      return { tipo: 'no', resumen: e.no, ir: '/panel#plantillas' };
    }
    const t = e.t;
    const pide = variablesQuePide(t);
    const vars = listaDeVariables(p.variables);
    if (vars.length < pide || vars.slice(0, pide).some((v) => !v)) return { tipo: 'no', resumen: `La plantilla «${t.name}» pide ${pide} dato(s) (${queSignifica(t, pide)}) y me diste ${vars.filter(Boolean).length}. Dime lo que falta, en orden.`, ir: '/panel#plantillas' };
    if (vars.length > pide) return { tipo: 'no', resumen: pide ? `La plantilla «${t.name}» solo lleva ${pide} dato(s) (${queSignifica(t, pide)}) y me diste ${vars.length}: dime solo esos.` : `La plantilla «${t.name}» no lleva datos: se manda tal cual («${acortar(t.body, 120)}»). Pídemela sin variables.` };
    return prepararDestino(ctx, p, '¿A quién le mando la plantilla?', async (d) => {
      const extra = t.category === 'MARKETING' ? ['Es una plantilla de MARKETING: solo le sale si aceptó recibir promociones, y cuenta en el tope de marketing por cliente.'] : [];
      return {
        tipo: 'listo',
        params: { ...p, plantilla: t.name, idioma: t.language, variables: vars, contactId: d.contactId },
        tarjeta: { que: `Mandar la plantilla «${t.name}» a ${d.nombre ?? telefonoBonito(d.phone)}`, aQuien: quienEs(d), cuantos: 1, mensaje: t.body ? textoDePlantilla(t.body, vars) : `(plantilla ${t.name}${vars.length ? ` con ${vars.join(', ')}` : ''})`, avisos: await avisosPara(ctx, d, extra) },
      };
    });
  },
  async ejecutar(p, ctx) {
    const l = await leerPlantillas(ctx);
    if ('error' in l) return l.error;
    const e = elegirPlantilla(l, p.plantilla, p.idioma);
    if ('no' in e) return { ok: false, resumen: e.opciones ? `${e.no} Dime cuál: ${e.opciones.map((t) => t.name).join(', ')}.` : e.no, ir: '/panel#plantillas' };
    const u = await destinoParaEjecutar(ctx, p.telefono, p.contactId);
    if ('error' in u) return u.error;
    const vars = listaDeVariables(p.variables);
    const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/send', body: { phone: u.d.phone, templateName: e.t.name, templateLanguage: e.t.language, variables: vars } });
    return resultadoEnvio(r, `Plantilla «${e.t.name}» enviada a ${u.d.nombre ?? u.d.phone}${e.t.body ? `: «${acortar(textoDePlantilla(e.t.body, vars), 100)}»` : ''}.`);
  },
});

// ================================================================ STICKERS

interface StickerVista {
  id: string;
  nombre: string;
  uso: string;
}

const USO_EN_PALABRAS: Record<string, string[]> = {
  inicio: ['inicio', 'saludo', 'hola', 'bienvenida'],
  gracias: ['gracias', 'agradecimiento'],
  despedida: ['despedida', 'adios', 'chau', 'chao'],
};

/** Los stickers que pueden ser "el de gracias" o "el del perrito": por nombre, por uso o por parte del nombre. */
function candidatosSticker(lista: StickerVista[], quien: string): StickerVista[] {
  const q = normal(quien).replace(/^(el|un) (sticker )?(de |del )?/, '').replace(/^sticker (de |del )?/, '').trim();
  if (!q) return [];
  const exactos = lista.filter((s) => normal(s.nombre) === q);
  if (exactos.length) return exactos;
  const uso = Object.entries(USO_EN_PALABRAS).find(([, ps]) => ps.some((x) => q === x || q.split(' ').includes(x)))?.[0];
  if (uso) {
    const porUso = lista.filter((s) => s.uso === uso);
    if (porUso.length) return porUso;
  }
  const palabras = q.split(' ').filter((w) => w.length > 2);
  return lista.filter((s) => normal(s.nombre).includes(q) || (palabras.length > 0 && palabras.every((w) => normal(s.nombre).includes(w))));
}

async function leerStickers(ctx: ContextoAccion): Promise<StickerVista[] | { error: ResultadoAccion }> {
  const r = await ctx.llamar({ method: 'GET', url: '/admin/stickers' });
  if (r.status === 404) return { error: { ok: false, resumen: 'La biblioteca de stickers no está activa en este sistema.' } };
  if (!ok(r)) return { error: errorDe(r, 'No se pudieron leer los stickers.') };
  return ((r.json as { stickers?: StickerVista[] }).stickers ?? []) as StickerVista[];
}

const mensajeSticker = def({
  nombre: 'mensaje.sticker',
  tipo: 'cambio',
  descripcion: 'Mandar un sticker de la biblioteca de stickers guardados a UN número o a un chat por su nombre. Se elige por su nombre o por su uso (saludo, gracias, despedida).',
  parametros: 'telefono (número o nombre del chat), sticker (el nombre del sticker o su uso: "gracias", "saludo", "despedida")',
  ejemplo: { orden: 'mándale el sticker de gracias al 987654321', accion: { accion: 'mensaje.sticker', telefono: '987654321', sticker: 'gracias' } },
  schema: z.object({ ...destinoSchema, sticker: z.string().trim().min(1).max(60), stickerId: z.string().max(40).optional() }),
  async preparar(p, ctx) {
    const l = await leerStickers(ctx);
    if ('error' in l) return { tipo: 'no', resumen: l.error.resumen };
    if (!l.length) return { tipo: 'no', resumen: 'No hay ningún sticker guardado todavía: súbelos en Stickers (o guarda uno desde un chat).' };
    let s = p.stickerId ? l.find((x) => x.id === p.stickerId) : undefined;
    if (!s) {
      const c = candidatosSticker(l, p.sticker);
      if (!c.length) return { tipo: 'no', resumen: `No encuentro ningún sticker "${p.sticker}". Los guardados son: ${l.slice(0, 15).map((x) => x.nombre).join(', ')}.` };
      if (c.length > 1) return { tipo: 'elegir', pregunta: `Hay ${c.length} stickers que encajan con "${p.sticker}": ¿cuál mando?`, opciones: c.slice(0, 8).map((x) => ({ etiqueta: `${x.nombre} (${x.uso})`, params: { ...p, sticker: x.nombre, stickerId: x.id } })) };
      s = c[0]!;
    }
    const st = s;
    return prepararDestino(ctx, p, '¿A quién le mando el sticker?', async (d) => ({
      tipo: 'listo',
      params: { ...p, sticker: st.nombre, stickerId: st.id, contactId: d.contactId },
      tarjeta: { que: `Mandar el sticker «${st.nombre}» a ${d.nombre ?? telefonoBonito(d.phone)}`, aQuien: quienEs(d), cuantos: 1, mensaje: `[sticker: ${st.nombre}]`, avisos: await avisosPara(ctx, d) },
    }));
  },
  async ejecutar(p, ctx) {
    const l = await leerStickers(ctx);
    if ('error' in l) return l.error;
    const s = p.stickerId ? l.find((x) => x.id === p.stickerId) : candidatosSticker(l, p.sticker).length === 1 ? candidatosSticker(l, p.sticker)[0] : undefined;
    if (!s) return { ok: false, resumen: `Ese sticker (${p.sticker}) ya no existe o hay varios que encajan: vuelve a pedírmelo.` };
    const u = await destinoParaEjecutar(ctx, p.telefono, p.contactId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: `/admin/stickers/${encodeURIComponent(s.id)}/enviar`, body: { phone: u.d.phone } });
    return resultadoEnvio(r, `Sticker «${s.nombre}» enviado a ${u.d.nombre ?? u.d.phone}.`);
  },
});

// =============================================================== UBICACION

/** Unas coordenadas escritas ("-12.05,-77.03"), si lo son. */
function coordenadas(s: string): { lat: number; lng: number } | null {
  if (/^https?:\/\//i.test(s.trim())) return null;
  const m = /^\s*(-?\d{1,3}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(s);
  return m ? { lat: Number(m[1]), lng: Number(m[2]) } : null;
}

const mensajeUbicacion = def({
  nombre: 'mensaje.ubicacion',
  tipo: 'cambio',
  descripcion: 'Mandarle a UN número (o a un chat por su nombre) un PIN de ubicación de WhatsApp: el de la tienda, un punto de recojo... a partir de unas coordenadas o un enlace de Google Maps. (Para PEDIRLE su ubicación al cliente usa mensaje.pedirUbicacion.)',
  parametros: 'telefono (número o nombre del chat), lugar (coordenadas "-12.05,-77.03" o un enlace de Google Maps)',
  ejemplo: { orden: 'mándale al 987654321 la ubicación de la tienda: -12.0464,-77.0428', accion: { accion: 'mensaje.ubicacion', telefono: '987654321', lugar: '-12.0464,-77.0428' } },
  schema: z.object({ ...destinoSchema, lugar: z.string().trim().min(3).max(2000) }),
  async preparar(p, ctx) {
    const c = coordenadas(p.lugar);
    if (c && (Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180)) return { tipo: 'no', resumen: `"${p.lugar}" no son coordenadas válidas: van como latitud, longitud (por ejemplo -12.05,-77.03).` };
    if (!c && !/^https?:\/\/\S+$/i.test(p.lugar)) return { tipo: 'no', resumen: `"${acortar(p.lugar, 60)}" no es ni unas coordenadas (-12.05,-77.03) ni un enlace de Google Maps: dime uno de los dos.` };
    const pin = c ? `${c.lat}, ${c.lng} (https://maps.google.com/?q=${c.lat},${c.lng})` : p.lugar;
    return prepararDestino(ctx, p, '¿A quién le mando el pin?', async (d) => ({
      tipo: 'listo',
      params: { ...p, contactId: d.contactId },
      tarjeta: { que: `Mandar un pin de ubicación a ${d.nombre ?? telefonoBonito(d.phone)}`, aQuien: quienEs(d), cuantos: 1, mensaje: `[pin de ubicación: ${pin}]`, avisos: await avisosPara(ctx, d, c ? [] : ['Es un enlace: si no tiene coordenadas dentro, el sistema no podrá sacar el punto y lo dirá.']) },
    }));
  },
  async ejecutar(p, ctx) {
    const u = await destinoParaEjecutar(ctx, p.telefono, p.contactId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/send', body: { phone: u.d.phone, location: p.lugar } });
    return resultadoEnvio(r, `Pin de ubicación enviado a ${u.d.nombre ?? u.d.phone}.`);
  },
});

// ==================================================================== VOZ

const mensajeVoz = def({
  nombre: 'mensaje.voz',
  tipo: 'cambio',
  descripcion: 'Mandarle a UN número (o a un chat por su nombre) un texto como NOTA DE VOZ, con la voz del asistente. Solo si la voz está configurada; si al final no se puede, sale por escrito y se dice.',
  parametros: 'telefono (número o nombre del chat), texto (lo que dirá el audio)',
  ejemplo: { orden: 'mándale un audio al 987654321 diciendo que su pedido llega a las 5', accion: { accion: 'mensaje.voz', telefono: '987654321', texto: 'Hola, tu pedido llega hoy a las 5 de la tarde.' } },
  schema: z.object({ ...destinoSchema, texto: texto(4000) }),
  async preparar(p, ctx) {
    const v = await ctx.llamar({ method: 'GET', url: '/admin/voz' });
    if (v.status === 404) return { tipo: 'no', resumen: 'La voz no está configurada en este sistema (Mi asistente IA → Voz): puedo mandarlo por escrito con mensaje.enviar.' };
    if (!ok(v)) return { tipo: 'no', resumen: errorDe(v, 'No se pudo leer cómo está la voz.').resumen };
    const e = v.json as { lista?: boolean; motivo?: string | null; maxCaracteres?: number };
    if (!e.lista) return { tipo: 'no', resumen: `La voz no está lista${e.motivo ? `: ${e.motivo}` : ''}. Puedo mandarlo por escrito con mensaje.enviar.`, ir: '/panel#ia' };
    const extra = e.maxCaracteres && p.texto.length > e.maxCaracteres ? [`El texto pasa de ${e.maxCaracteres} caracteres (el tope de la voz): puede salir por escrito.`] : [];
    return prepararDestino(ctx, p, '¿A quién le mando el audio?', async (d) => ({
      tipo: 'listo',
      params: { ...p, contactId: d.contactId },
      tarjeta: { que: `Mandar una nota de voz a ${d.nombre ?? telefonoBonito(d.phone)}`, aQuien: quienEs(d), cuantos: 1, mensaje: p.texto, avisos: await avisosPara(ctx, d, extra) },
    }));
  },
  async ejecutar(p, ctx) {
    const u = await destinoParaEjecutar(ctx, p.telefono, p.contactId);
    if ('error' in u) return u.error;
    const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/send', body: { phone: u.d.phone, text: p.texto, voz: true } });
    const res = resultadoEnvio(r, `Nota de voz enviada a ${u.d.nombre ?? u.d.phone}.`);
    const voz = (r.json as { voz?: { enviada?: boolean; motivo?: string | null } } | null)?.voz;
    if (res.ok && voz && !voz.enviada) return { ...res, resumen: `A ${u.d.nombre ?? u.d.phone} le salió por ESCRITO, no como audio${voz.motivo ? ` (${voz.motivo})` : ''}.` };
    return res;
  },
});

// ============================================================ A VARIOS

/** Un destino de una lista: numero directo o el unico chat con ese nombre. */
async function resolverUno(ctx: ContextoAccion, quien: string): Promise<{ phone: string; nombre: string | null } | { problema: string }> {
  const tel = telefonoADigitos(quien);
  if (esNumero(tel)) return { phone: tel, nombre: null };
  if (!/[a-zA-ZÀ-ÿ]/.test(quien)) return { problema: `${quien} (no es un número)` };
  const c = await candidatosContacto(ctx, quien);
  if ('error' in c) return { problema: `${quien} (${c.error.resumen})` };
  if (!c.length) return { problema: `${quien} (no hay ningún chat con ese nombre)` };
  if (c.length > 1) return { problema: `${quien} (hay ${c.length} chats con ese nombre: ${c.slice(0, 3).map(lineaContacto).join(', ')}; dime el número)` };
  return { phone: c[0]!.phone, nombre: c[0]!.name };
}

const mensajeVarios = def({
  nombre: 'mensaje.varios',
  tipo: 'cambio',
  peligrosa: true,
  descripcion: 'Mandar el MISMO texto a VARIOS números sueltos (o chats por su nombre) de una vez, con una sola tarjeta. Para un grupo de clientes según un criterio usa grupo.enviar; para uno solo, mensaje.enviar.',
  parametros: 'telefonos (lista de números o nombres de chat, de 2 a 30), texto',
  ejemplo: { orden: 'mándales a 987654321, 912345678 y a Rosa: hoy no hay reparto', accion: { accion: 'mensaje.varios', telefonos: ['987654321', '912345678', 'Rosa'], texto: 'Hoy no hay reparto.' } },
  schema: z.object({ telefonos: z.array(z.string().trim().min(2).max(120)).min(1).max(30), texto: texto(4000) }),
  async preparar(p, ctx) {
    const listos: Array<{ phone: string; nombre: string | null }> = [];
    const problemas: string[] = [];
    for (const q of p.telefonos) {
      const r = await resolverUno(ctx, q);
      if ('problema' in r) problemas.push(r.problema);
      else if (!listos.some((x) => x.phone === r.phone)) listos.push(r);
    }
    if (!listos.length) return { tipo: 'no', resumen: `No tengo a quién mandárselo: ${problemas.join('; ')}.` };
    const avisos = await avisosDeEnvio(ctx, listos.map((x) => x.phone));
    if (problemas.length) avisos.unshift(`A estos NO se les manda: ${problemas.join('; ')}.`);
    const lista = listos.map((x) => (x.nombre ? `${x.nombre} (${telefonoBonito(x.phone)})` : telefonoBonito(x.phone)));
    return {
      tipo: 'listo',
      params: { telefonos: listos.map((x) => x.phone), texto: p.texto },
      tarjeta: { que: `Mandar el mismo WhatsApp a ${listos.length} número(s)`, cuantos: listos.length, aQuien: `${lista.slice(0, 10).join(', ')}${lista.length > 10 ? ` y ${lista.length - 10} más` : ''}`, mensaje: p.texto, avisos },
    };
  },
  async ejecutar(p, ctx) {
    let enviados = 0;
    const fallos: string[] = [];
    const hechos = new Set<string>();
    for (const q of p.telefonos) {
      const r = await resolverUno(ctx, q);
      if ('problema' in r) {
        fallos.push(r.problema);
        continue;
      }
      if (hechos.has(r.phone)) continue;
      hechos.add(r.phone);
      const s = resultadoEnvio(await ctx.llamar({ method: 'POST', url: '/admin/chat/send', body: { phone: r.phone, text: p.texto } }), '');
      if (s.ok) enviados++;
      else fallos.push(`${r.phone}: ${s.resumen}`);
    }
    return { ok: enviados > 0, resumen: `Enviado a ${enviados} de ${enviados + fallos.length}${fallos.length ? `; no salió a ${fallos.length}: ${fallos.slice(0, 4).join(' · ')}` : ''}.`, ir: enviados ? '/chat' : '/panel#historial' };
  },
});

// ==================================================== RESPONDER EN UN CHAT

interface MensajeVista {
  id: number;
  direction: 'in' | 'out';
  kind: string;
  body: string | null;
  payload?: { media?: { id?: string; kind?: string; filename?: string } } | null;
}

async function leerHilo(ctx: ContextoAccion, contactId: string): Promise<MensajeVista[]> {
  const r = await ctx.llamar({ method: 'GET', url: `/admin/chat/${encodeURIComponent(contactId)}?limit=60` });
  return ok(r) ? (((r.json as { messages?: MensajeVista[] }).messages ?? []) as MensajeVista[]) : [];
}

const ADJUNTO_EN_PALABRAS: Record<string, string> = { image: 'foto', video: 'video', audio: 'audio', document: 'documento', sticker: 'sticker', location: 'ubicación' };
const esAdjunto = (m: MensajeVista) => Boolean(m.payload?.media?.id) && ['image', 'video', 'audio', 'document'].includes(m.payload?.media?.kind ?? m.kind);

/** Un mensaje del hilo en una linea: «[foto] mira esto» o el texto. */
function lineaMensaje(m: MensajeVista): string {
  const tipo = m.payload?.media?.kind ?? m.kind;
  const etiqueta = ADJUNTO_EN_PALABRAS[tipo];
  const cuerpo = (m.body ?? '').trim() || m.payload?.media?.filename || '';
  return etiqueta && tipo !== 'text' ? `[${etiqueta}]${cuerpo ? ` ${acortar(cuerpo, 90)}` : ''}` : acortar(cuerpo, 120);
}

const mensajeResponder = def({
  nombre: 'mensaje.responder',
  tipo: 'cambio',
  descripcion: 'Escribir en el chat de alguien por su NOMBRE (o número) y, si se pide, respondiendo CITANDO su último mensaje. Para un número suelto sin más, vale también mensaje.enviar.',
  parametros: 'telefono (nombre del chat o número), texto, citar (true = cita el último mensaje que mandó el cliente)',
  ejemplo: { orden: 'respóndele a Luis citando su mensaje: ya va en camino', accion: { accion: 'mensaje.responder', telefono: 'Luis', texto: 'Ya va en camino.', citar: true } },
  schema: z.object({ telefono: z.string().trim().min(2).max(120), contactId: z.string().max(80).optional(), texto: texto(4000), citar: z.boolean().default(false), citaId: z.coerce.number().int().positive().optional() }),
  async preparar(p, ctx) {
    // Hace falta el chat (para citar y para escribir por nombre): por numero o por nombre.
    return prepararConContacto(ctx, p, p.telefono, '¿En qué chat escribo?', async (c: ContactoVista) => {
      const x = await contactoDeTelefono(ctx, c.phone);
      const d: Destino = { phone: c.phone, nombre: c.name, contactId: c.id, baja: Boolean(x?.optOutAt) };
      const extra: string[] = [];
      let citaId: number | undefined;
      if (p.citar) {
        const ultimo = [...(await leerHilo(ctx, c.id))].reverse().find((m) => m.direction === 'in');
        if (!ultimo) return { tipo: 'no', resumen: `${c.name ?? c.phone} no ha escrito nada en su chat: no hay mensaje que citar. Dime si lo mando sin citar.`, ir: '/chat' };
        citaId = ultimo.id;
        extra.push(`Cita su último mensaje: «${lineaMensaje(ultimo)}».`);
      }
      return {
        tipo: 'listo',
        params: { ...p, contactId: c.id, citaId },
        tarjeta: { que: `${p.citar ? 'Responder citando' : 'Escribir'} en el chat de ${c.name ?? telefonoBonito(c.phone)}`, aQuien: quienEs(d), cuantos: 1, mensaje: p.texto, avisos: await avisosPara(ctx, d, extra) },
      };
    });
  },
  async ejecutar(p, ctx) {
    const u = await unContacto(ctx, p.telefono, p.contactId);
    if ('error' in u) return u.error;
    let citaId = p.citaId;
    if (p.citar && !citaId) citaId = [...(await leerHilo(ctx, u.c.id))].reverse().find((m) => m.direction === 'in')?.id;
    const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/send', body: { contactId: u.c.id, text: p.texto, ...(citaId ? { citaId } : {}) } });
    return resultadoEnvio(r, `${citaId ? 'Respondido (citando su mensaje)' : 'Escrito'} en el chat de ${u.c.name ?? u.c.phone}: «${acortar(p.texto, 80)}».`);
  },
});

// ================================================================ REENVIAR

/** Los ultimos mensajes que se pueden reenviar de un hilo, segun lo pedido. */
function paraReenviar(hilo: MensajeVista[], p: { cuantos?: number; solo?: 'todo' | 'adjuntos'; incluirMios?: boolean }): MensajeVista[] {
  return hilo
    .filter((m) => (p.incluirMios || m.direction === 'in') && m.kind !== 'sticker' && m.payload?.media?.kind !== 'sticker')
    .filter((m) => (p.solo === 'adjuntos' ? esAdjunto(m) : esAdjunto(m) || Boolean((m.body ?? '').trim())))
    .slice(-(p.cuantos ?? 1));
}

const mensajeReenviar = def({
  nombre: 'mensaje.reenviar',
  tipo: 'cambio',
  descripcion: 'Reenviar a otro número (o chat por su nombre) lo último que mandó alguien en su chat: su último mensaje, su última foto/documento, o los últimos N. Llega con la marca «Reenviado».',
  parametros: 'desde (el chat de donde sale: nombre o número), telefono (a quién se le reenvía: número o nombre), cuantos (cuántos de los últimos, 1 por defecto), solo ("adjuntos" = solo fotos, videos, audios o documentos; "todo" por defecto), incluirMios (true = cuenta también lo que le escribimos nosotros)',
  ejemplo: { orden: 'reenvíale al 999000001 la última foto que mandó Luis', accion: { accion: 'mensaje.reenviar', desde: 'Luis', telefono: '999000001', solo: 'adjuntos', cuantos: 1 } },
  schema: z.object({
    desde: z.string().trim().min(2).max(120),
    contactId: z.string().max(80).optional(),
    telefono: z.string().trim().min(2).max(120),
    destinoId: z.string().max(80).optional(),
    cuantos: z.coerce.number().int().min(1).max(20).default(1),
    solo: z.enum(['todo', 'adjuntos']).default('todo'),
    incluirMios: z.boolean().default(false),
    mensajeIds: z.array(z.coerce.number().int().positive()).max(20).optional(),
  }),
  async preparar(p, ctx) {
    return prepararConContacto(ctx, p, p.desde, '¿De qué chat reenvío?', async (origen) => {
      const elegidos = paraReenviar(await leerHilo(ctx, origen.id), p);
      if (!elegidos.length) return { tipo: 'no', resumen: `En el chat de ${origen.name ?? origen.phone} no hay ${p.solo === 'adjuntos' ? 'ninguna foto ni documento' : 'ningún mensaje'} ${p.incluirMios ? '' : 'suyo '}que reenviar.`, ir: '/chat' };
      // El destino: por numero (puede no tener chat todavia) o por nombre.
      let destino: Destino;
      const tel = telefonoADigitos(p.telefono);
      if (p.destinoId) {
        const u = await unContacto(ctx, p.telefono, p.destinoId);
        if ('error' in u) return { tipo: 'no', resumen: u.error.resumen, ir: u.error.ir };
        destino = { phone: u.c.phone, nombre: u.c.name, contactId: u.c.id, baja: false };
      } else if (esNumero(tel)) {
        const c = await contactoDeTelefono(ctx, tel);
        destino = { phone: tel, nombre: c?.name ?? null, contactId: c?.id, baja: Boolean(c?.optOutAt) };
      } else {
        const c = await candidatosContacto(ctx, p.telefono);
        if ('error' in c) return { tipo: 'no', resumen: c.error.resumen, ir: c.error.ir };
        if (!c.length) return { tipo: 'no', resumen: `No encuentro ningún chat de "${p.telefono}" al que reenviarlo. Dime su número.`, ir: '/chat' };
        if (c.length > 1) return { tipo: 'elegir', pregunta: `¿A quién se lo reenvío? Hay ${c.length} chats que coinciden con "${p.telefono}":`, opciones: c.slice(0, 8).map((x) => ({ etiqueta: lineaContacto(x), params: { ...p, contactId: origen.id, destinoId: x.id } })) };
        destino = { phone: c[0]!.phone, nombre: c[0]!.name, contactId: c[0]!.id, baja: false };
      }
      if (destino.phone === origen.phone) return { tipo: 'no', resumen: 'El chat de origen y el de destino son el mismo.' };
      return {
        tipo: 'listo',
        params: { ...p, contactId: origen.id, destinoId: destino.contactId, mensajeIds: elegidos.map((m) => m.id) },
        tarjeta: {
          que: `Reenviar ${elegidos.length} mensaje(s) de ${origen.name ?? telefonoBonito(origen.phone)} a ${destino.nombre ?? telefonoBonito(destino.phone)}`,
          aQuien: quienEs(destino),
          cuantos: elegidos.length,
          mensaje: elegidos.map(lineaMensaje).join('\n'),
          avisos: await avisosPara(ctx, destino, ['Llega con la marca «Reenviado».']),
        },
      };
    });
  },
  async ejecutar(p, ctx) {
    const o = await unContacto(ctx, p.desde, p.contactId);
    if ('error' in o) return o.error;
    const ids = p.mensajeIds?.length ? p.mensajeIds : paraReenviar(await leerHilo(ctx, o.c.id), p).map((m) => m.id);
    if (!ids.length) return { ok: false, resumen: `En el chat de ${o.c.name ?? o.c.phone} no hay nada que reenviar.`, ir: '/chat' };
    let destinoId = p.destinoId;
    const tel = telefonoADigitos(p.telefono);
    if (!destinoId && esNumero(tel)) {
      // Sin chat todavia: se abre, como el boton «nuevo chat» de la pantalla.
      destinoId = (await contactoDeTelefono(ctx, tel))?.id;
      if (!destinoId) {
        const s = await ctx.llamar({ method: 'POST', url: '/admin/chat/start', body: { phone: tel } });
        if (!ok(s)) return errorDe(s, 'No se pudo abrir el chat del destino.');
        destinoId = (s.json as { contact?: { id?: string } }).contact?.id;
      }
    } else if (!destinoId) {
      const u = await unContacto(ctx, p.telefono);
      if ('error' in u) return u.error;
      destinoId = u.c.id;
    }
    if (!destinoId) return { ok: false, resumen: 'No se encontró el chat del destino (vuelve a pedírmelo).' };
    const r = await ctx.llamar({ method: 'POST', url: '/admin/chat/reenviar', body: { origenId: o.c.id, ids, destinos: [destinoId] } });
    if (!ok(r)) return errorDe(r, 'No se pudo reenviar.');
    const j = r.json as { ok?: boolean; enviados?: number; fallos?: string[] };
    return { ok: Boolean(j.ok), resumen: j.ok ? `Reenviado(s) ${j.enviados ?? ids.length} mensaje(s) de ${o.c.name ?? o.c.phone} a ${p.telefono}${j.fallos?.length ? `; ${j.fallos.length} no: ${j.fallos.slice(0, 3).join(' · ')}` : ''}.` : `No salió: ${j.fallos?.slice(0, 3).join(' · ') || 'WhatsApp lo rechazó'}`, ir: j.ok ? '/chat' : '/panel#historial' };
  },
});

export const ACCIONES_MENSAJES: Accion[] = [mensajePlantilla, mensajeSticker, mensajeUbicacion, mensajeVoz, mensajeVarios, mensajeResponder, mensajeReenviar];
