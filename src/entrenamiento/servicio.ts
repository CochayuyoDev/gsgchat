/**
 * El entrenamiento del asistente: lo que se le ensena, como se elige lo que
 * va en cada turno, y los trabajos largos (aprender de los chats, pulir con
 * la IA, examinar en masa).
 *
 * El asistente corre sobre modelos gratuitos de Puter: no se reentrena el
 * modelo, se le ensena. Cada leccion es un ejemplo (cliente dice X ->
 * contesta Y), un dato o una regla. Pueden ser miles: en cada turno se
 * eligen las que vienen al caso con el indice en memoria (indice.ts) y
 * solo esas van al prompt. Todo lo que cambia aqui se refleja en el indice
 * al momento; el proceso arranca cargando las activas de la base.
 *
 * Los trabajos largos corren dentro del proceso, uno por tipo, con progreso
 * que la pantalla consulta y un boton para cancelar. No hay cola externa:
 * son minutos, no horas, y si el proceso se reinicia el trabajo se vuelve
 * a lanzar (lo aprendido hasta ese momento ya quedo guardado).
 */

import { z } from 'zod';
import type { MensajeIA } from '../ia/proveedores.js';
import type { ServicioIA } from '../ia/servicio.js';
import type { Contact } from '../db/repos.js';
import { paresDeConversacion } from './aprender.js';
import { calificarLeccion } from './examen.js';
import { Indice } from './indice.js';
import type { EntradaImportacion, FilaImportada } from './importar.js';
import { leerImportacion } from './importar.js';
import type { CasoExamen, Cifras, EntrenamientoRepo, EstadoLeccion, Examen, FiltroLecciones, Leccion, NuevaLeccion, OrigenLeccion, PatchLeccion, TipoLeccion } from './repo.js';
import { acortar, huellaDe, normalizar, taparDatosPersonales } from './texto.js';

export type { Leccion, TipoLeccion, OrigenLeccion, EstadoLeccion, FiltroLecciones, Cifras, Examen, CasoExamen };

/** Lo que el servicio de la IA le da al entrenamiento para los trabajos. */
export interface IAParaEntrenar {
  /** Un turno completo del asistente (con lecciones, catalogo y defensas), sin enviar nada. */
  responder(texto: string): Promise<{ texto: string; derivar: boolean; pedirUbicacion: boolean }>;
  /** El modelo a secas, para pulir lecciones. */
  completar(mensajes: MensajeIA[], opts?: { maxTokens?: number }): Promise<string>;
  /** Lo que el negocio escribio en "Mi asistente IA", para el examen (precios conocidos). */
  conocimiento(): string;
  disponible(): boolean;
}

export interface LeccionesParaPrompt {
  reglas: Leccion[];
  datos: Leccion[];
  ejemplos: Leccion[];
}

export type TipoTrabajo = 'aprender' | 'pulir' | 'examen';

export interface Trabajo {
  tipo: TipoTrabajo;
  estado: 'corriendo' | 'terminado' | 'cancelado' | 'fallo';
  hecho: number;
  total: number;
  empezadoAt: Date;
  terminadoAt: Date | null;
  /** Cifras que va sumando: pares, nuevas, aprobados... */
  resumen: Record<string, number | string | null>;
  error: string | null;
  quien: string | null;
}

export const leccionEntradaSchema = z.object({
  tipo: z.enum(['ejemplo', 'dato', 'regla']).default('ejemplo'),
  pregunta: z.string().trim().max(1000).nullable().optional(),
  respuesta: z.string().trim().min(2).max(4000),
  mala: z.string().trim().max(4000).nullable().optional(),
  tema: z.string().trim().max(60).nullable().optional(),
  estado: z.enum(['activa', 'pendiente', 'descartada']).optional(),
  nota: z.string().trim().max(500).nullable().optional(),
});
export type LeccionEntrada = z.infer<typeof leccionEntradaSchema>;

export interface OpcionesEnsenar {
  origen: OrigenLeccion;
  origenDetalle?: string | null;
  quien?: string | null;
  /** Por defecto activa; las importaciones grandes pueden entrar pendientes de revisar. */
  estado?: EstadoLeccion;
}

export interface ServicioEntrenamiento {
  cargar(): Promise<void>;
  conectarIA(ia: IAParaEntrenar): void;
  /** Las lecciones que vienen al caso para este mensaje (y las reglas, siempre). */
  relevantes(texto: string, contexto?: string): LeccionesParaPrompt;
  /** El bloque para el prompt de sistema; vacio si no hay nada que decir. */
  textoParaPrompt(l: LeccionesParaPrompt): string;
  /** Todo el texto de las lecciones elegidas (para que el examen no tome sus precios por inventados). */
  textoPlano(l: LeccionesParaPrompt): string;
  anotarUso(l: LeccionesParaPrompt): void;
  /** Cuantas lecciones activas hay cargadas. */
  cargadas(): number;

  ensenar(entrada: LeccionEntrada, opts: OpcionesEnsenar): Promise<{ leccion: Leccion; nueva: boolean }>;
  ensenarVarias(filas: FilaImportada[], opts: OpcionesEnsenar): Promise<{ nuevas: number; repetidas: number; ids: number[] }>;
  /** Lee un fichero o un texto pegado sin guardar nada: para la vista previa. */
  leer(entrada: EntradaImportacion): ReturnType<typeof leerImportacion>;
  importar(entrada: EntradaImportacion, opts: OpcionesEnsenar): Promise<{ lectura: ReturnType<typeof leerImportacion>; nuevas: number; repetidas: number }>;
  cambiar(id: number, patch: Partial<LeccionEntrada>, quien?: string | null): Promise<Leccion | null>;
  borrar(id: number): Promise<boolean>;
  porId(id: number): Promise<Leccion | null>;
  listar(filtro: FiltroLecciones, pagina: { limite: number; pagina: number }): Promise<{ items: Leccion[]; total: number; pagina: number; paginas: number }>;
  /** Aprobar, descartar, reactivar o borrar todas las del filtro (o por ids). */
  enMasa(accion: 'aprobar' | 'descartar' | 'activar' | 'borrar', filtro: FiltroLecciones): Promise<number>;
  cifras(): Promise<Cifras>;
  temas(): Promise<Array<{ tema: string; total: number }>>;
  /** Para el prompt de la IA operadora y el inicio: dos lineas. */
  descripcionParaIA(): Promise<string>;

  aprenderDeChats(opts: { desde?: Date | null; revisar: boolean; quien?: string | null }): Trabajo;
  pulir(opts: { limite: number; activar: boolean; quien?: string | null }): Trabajo;
  examinar(opts: { tema?: string; origen?: OrigenLeccion; muestra?: number; soloFallidas?: boolean; ids?: number[]; quien?: string | null }): Promise<Trabajo>;
  trabajos(): Trabajo[];
  cancelar(tipo: TipoTrabajo): boolean;
  examenes(limite?: number): Promise<Examen[]>;
  examen(id: number): Promise<{ examen: Examen; casos: CasoExamen[] } | null>;
}

export interface DepsEntrenamiento {
  repo: EntrenamientoRepo;
  nombreNegocio: () => string;
  /** Cuantas de cada clase van al prompt, como mucho. */
  topes?: { ejemplos?: number; datos?: number; reglas?: number };
  log?: (m: string, d?: Record<string, unknown>) => void;
  /** Para pruebas: sin pausas entre llamadas al modelo. */
  pausaMs?: number;
}

const MAX_EJEMPLOS = 6;
const MAX_DATOS = 8;
const MAX_REGLAS = 40;
const MAX_TEXTO_PROMPT = 7000;

export async function crearServicioEntrenamiento(deps: DepsEntrenamiento): Promise<ServicioEntrenamiento> {
  const { repo } = deps;
  const log = deps.log ?? (() => undefined);
  const topes = { ejemplos: deps.topes?.ejemplos ?? MAX_EJEMPLOS, datos: deps.topes?.datos ?? MAX_DATOS, reglas: deps.topes?.reglas ?? MAX_REGLAS };
  const pausa = deps.pausaMs ?? 250;

  // Lo activo, en memoria: el indice elige por id y aqui esta el texto.
  const activas = new Map<number, Leccion>();
  const indiceEjemplos = new Indice();
  const indiceDatos = new Indice();
  let ia: IAParaEntrenar | null = null;
  const trabajos = new Map<TipoTrabajo, Trabajo & { cancelar: boolean }>();

  function textoIndexable(l: Leccion): string {
    return l.tipo === 'ejemplo' ? `${l.pregunta ?? ''} ${l.tema ?? ''}` : `${l.pregunta ?? ''} ${l.respuesta} ${l.tema ?? ''}`;
  }

  function meter(l: Leccion): void {
    sacar(l.id);
    if (l.estado !== 'activa') return;
    activas.set(l.id, l);
    if (l.tipo === 'ejemplo') indiceEjemplos.agregar(l.id, textoIndexable(l));
    else if (l.tipo === 'dato') indiceDatos.agregar(l.id, textoIndexable(l));
  }

  function sacar(id: number): void {
    activas.delete(id);
    indiceEjemplos.quitar(id);
    indiceDatos.quitar(id);
  }

  async function cargar(): Promise<void> {
    activas.clear();
    indiceEjemplos.vaciar();
    indiceDatos.vaciar();
    for (const l of await repo.activas()) meter(l);
    log('entrenamiento cargado', { lecciones: activas.size });
  }

  /** Vuelve a leer de la base esas lecciones (tras un cambio en masa). */
  async function refrescar(ids: number[]): Promise<void> {
    for (let i = 0; i < ids.length; i += 500) {
      const { items } = await repo.listar({ ids: ids.slice(i, i + 500) }, { limite: 500, offset: 0 });
      const vistas = new Set(items.map((l) => l.id));
      for (const l of items) meter(l);
      for (const id of ids.slice(i, i + 500)) if (!vistas.has(id)) sacar(id);
    }
  }

  function relevantes(texto: string, contexto?: string): LeccionesParaPrompt {
    const reglas = [...activas.values()].filter((l) => l.tipo === 'regla').sort((a, b) => a.id - b.id).slice(0, topes.reglas);
    // Con dos palabras ("cuanto?", "y a provincias?") la pregunta sola no
    // dice nada: se busca tambien con lo anterior de la conversacion.
    const consulta = normalizar(texto).split(' ').filter(Boolean).length < 3 && contexto ? `${contexto} ${texto}` : texto;
    const ejemplos = indiceEjemplos
      .buscar(consulta, topes.ejemplos, 0.22)
      .map((a) => activas.get(a.id))
      .filter((l): l is Leccion => Boolean(l));
    const datos = indiceDatos
      .buscar(consulta, topes.datos, 0.18)
      .map((a) => activas.get(a.id))
      .filter((l): l is Leccion => Boolean(l));
    return { reglas, datos, ejemplos };
  }

  function textoParaPrompt(l: LeccionesParaPrompt): string {
    const partes: string[] = [];
    let largo = 0;
    const cabe = (s: string) => {
      if (largo + s.length > MAX_TEXTO_PROMPT) return false;
      largo += s.length;
      return true;
    };
    if (l.reglas.length) {
      const lineas = l.reglas.map((r) => `- ${r.respuesta.replace(/\s+/g, ' ').trim()}`).filter(cabe);
      if (lineas.length) partes.push('Reglas que te dio el negocio (cúmplelas siempre):', ...lineas);
    }
    if (l.datos.length) {
      const lineas = l.datos.map((d) => `- ${d.pregunta ? `${d.pregunta.trim()}: ` : ''}${d.respuesta.replace(/\s+/g, ' ').trim()}`).filter(cabe);
      if (lineas.length) partes.push('', 'Datos del negocio que vienen al caso:', ...lineas);
    }
    if (l.ejemplos.length) {
      const bloques = l.ejemplos
        .map((e) => `Cliente: ${(e.pregunta ?? '').replace(/\s+/g, ' ').trim()}\nTú: ${e.respuesta.trim()}${e.mala ? `\n(No respondas así: «${acortar(e.mala, 200)}»)` : ''}`)
        .filter(cabe);
      if (bloques.length) partes.push('', 'Así responde el negocio a preguntas parecidas. Si el cliente pregunta lo mismo, contesta lo mismo, con los mismos datos (precios, plazos, condiciones); adapta solo el tono a la conversación:', ...bloques.map((b) => `\n${b}`));
    }
    return partes.join('\n').trim();
  }

  function textoPlano(l: LeccionesParaPrompt): string {
    return [...l.reglas, ...l.datos, ...l.ejemplos].map((x) => `${x.pregunta ?? ''}\n${x.respuesta}`).join('\n');
  }

  function anotarUso(l: LeccionesParaPrompt): void {
    const ids = [...l.datos, ...l.ejemplos].map((x) => x.id);
    if (!ids.length) return;
    repo.anotarUsos(ids, new Date()).catch((e) => log('no se pudo anotar el uso de las lecciones', { detalle: String(e) }));
  }

  function nuevaDesde(e: LeccionEntrada | FilaImportada, opts: OpcionesEnsenar): NuevaLeccion {
    const pregunta = (e.pregunta ?? '').trim() || null;
    const respuesta = e.respuesta.trim();
    return {
      tipo: e.tipo,
      pregunta,
      respuesta,
      mala: e.mala?.trim() || null,
      tema: e.tema?.trim().toLowerCase() || null,
      origen: opts.origen,
      origenDetalle: opts.origenDetalle ?? null,
      estado: ('estado' in e && e.estado) || opts.estado || 'activa',
      huella: huellaDe(pregunta, respuesta),
      nota: ('nota' in e && e.nota) || null,
      creadoPor: opts.quien ?? null,
    };
  }

  function validar(e: LeccionEntrada | FilaImportada): void {
    if (e.tipo === 'ejemplo' && !(e.pregunta ?? '').trim()) throw new Error('Un ejemplo necesita lo que dice el cliente.');
  }

  async function ensenar(entrada: LeccionEntrada, opts: OpcionesEnsenar) {
    validar(entrada);
    const r = await repo.crear(nuevaDesde(entrada, opts));
    meter(r.leccion);
    return r;
  }

  async function ensenarVarias(filas: FilaImportada[], opts: OpcionesEnsenar) {
    const buenas = filas.filter((f) => f.tipo !== 'ejemplo' || (f.pregunta ?? '').trim());
    const r = await repo.crearVarias(buenas.map((f) => nuevaDesde(f, opts)));
    if ((opts.estado ?? 'activa') === 'activa') await refrescar(r.ids);
    return r;
  }

  // ---------------------------------------------------------- trabajos

  function arrancar(tipo: TipoTrabajo, quien: string | null | undefined, cuerpo: (t: Trabajo & { cancelar: boolean }) => Promise<void>): Trabajo {
    const enCurso = trabajos.get(tipo);
    if (enCurso?.estado === 'corriendo') throw new Error(`Ya hay un trabajo de ${NOMBRE_TRABAJO[tipo]} en marcha: espera a que termine o cancélalo.`);
    const t: Trabajo & { cancelar: boolean } = { tipo, estado: 'corriendo', hecho: 0, total: 0, empezadoAt: new Date(), terminadoAt: null, resumen: {}, error: null, quien: quien ?? null, cancelar: false };
    trabajos.set(tipo, t);
    void cuerpo(t)
      .then(() => {
        if (t.estado === 'corriendo') t.estado = t.cancelar ? 'cancelado' : 'terminado';
      })
      .catch((e) => {
        t.estado = 'fallo';
        t.error = e instanceof Error ? e.message : String(e);
        log(`fallo el trabajo de ${NOMBRE_TRABAJO[tipo]}`, { detalle: t.error });
      })
      .finally(() => {
        t.terminadoAt = new Date();
      });
    return publico(t);
  }

  const publico = (t: Trabajo & { cancelar: boolean }): Trabajo => {
    const { cancelar: _c, ...resto } = t;
    return { ...resto, resumen: { ...resto.resumen } };
  };

  const respirar = () => new Promise<void>((r) => setImmediate(r));
  const esperar = (ms: number) => (ms > 0 ? new Promise<void>((r) => setTimeout(r, ms)) : Promise.resolve());

  function aprenderDeChats(opts: { desde?: Date | null; revisar: boolean; quien?: string | null }): Trabajo {
    return arrancar('aprender', opts.quien, async (t) => {
      const desde = opts.desde ?? null;
      const contactos = await repo.contactosConTexto(desde);
      t.total = contactos.length;
      t.resumen = { pares: 0, nuevas: 0, repetidas: 0, contactos: contactos.length };
      let tanda: NuevaLeccion[] = [];
      const ids: number[] = [];
      const guardar = async () => {
        if (!tanda.length) return;
        const r = await repo.crearVarias(tanda);
        t.resumen.nuevas = Number(t.resumen.nuevas) + r.nuevas;
        t.resumen.repetidas = Number(t.resumen.repetidas) + r.repetidas;
        ids.push(...r.ids);
        tanda = [];
      };
      for (const c of contactos) {
        if (t.cancelar) break;
        const mensajes = await repo.mensajesDeTexto(c.contactId, desde);
        const pares = paresDeConversacion(mensajes);
        t.resumen.pares = Number(t.resumen.pares) + pares.length;
        for (const p of pares) {
          tanda.push({
            tipo: 'ejemplo',
            pregunta: p.pregunta,
            respuesta: p.respuesta,
            tema: null,
            origen: 'chat',
            origenDetalle: c.nombre ? `${c.nombre} (${c.phone})` : c.phone,
            estado: opts.revisar ? 'pendiente' : 'activa',
            huella: huellaDe(p.pregunta, p.respuesta),
            creadoPor: opts.quien ?? null,
          });
        }
        if (tanda.length >= 400) await guardar();
        t.hecho++;
        await respirar();
      }
      await guardar();
      if (!opts.revisar) await refrescar(ids);
    });
  }

  const PULIR_SISTEMA = (negocio: string) => `Eres el editor de la base de conocimiento del asistente de WhatsApp de "${negocio}". Te doy un intercambio real: lo que escribió un cliente y lo que contestó una persona del negocio. Decide si sirve como EJEMPLO REUTILIZABLE para responder a otros clientes que pregunten algo parecido.
Responde SOLO con un JSON en una línea, sin texto alrededor, con esta forma exacta:
{"util": true, "motivo": "por qué", "pregunta": "la pregunta del cliente, corta y general", "respuesta": "la respuesta limpia y reutilizable: sin nombres propios, sin datos de esa persona, sin referencias a ese pedido concreto, con los mismos datos del negocio (precios, plazos, condiciones) y en el mismo tono", "tema": "una o dos palabras (envios, pagos, precios, horario, cambios, stock, reclamos, otros)"}
No es útil (util: false): saludos sueltos, coordinar una entrega o un pago concreto, cosas personales, respuestas que solo valen para ese cliente, o cuando la persona no contestó realmente a la pregunta. Si es útil pero hay que limpiarla, límpiala.`;

  function pulir(opts: { limite: number; activar: boolean; quien?: string | null }): Trabajo {
    if (!ia?.disponible()) throw new Error('Para pulir con la IA hace falta conectar Puter (o la clave de la API) en Mi asistente IA.');
    return arrancar('pulir', opts.quien, async (t) => {
      const ids = await repo.idsPara({ estado: 'pendiente', tipo: 'ejemplo' }, Math.min(opts.limite, 5000), false);
      t.total = ids.length;
      t.resumen = { utiles: 0, descartadas: 0, repetidas: 0, sinRespuesta: 0 };
      let fallosSeguidos = 0;
      const sistema = PULIR_SISTEMA(deps.nombreNegocio());
      for (const id of ids) {
        if (t.cancelar) break;
        const l = await repo.porId(id);
        if (!l || l.estado !== 'pendiente') {
          t.hecho++;
          continue;
        }
        let cruda = '';
        try {
          cruda = await ia!.completar([{ role: 'system', content: sistema }, { role: 'user', content: `Cliente: ${l.pregunta ?? ''}\nPersona del negocio: ${l.respuesta}` }], { maxTokens: 600 });
          fallosSeguidos = 0;
        } catch (e) {
          t.resumen.sinRespuesta = Number(t.resumen.sinRespuesta) + 1;
          if (++fallosSeguidos >= 5) throw new Error(`La IA no responde (${e instanceof Error ? e.message : String(e)}): se para para no seguir fallando.`);
          t.hecho++;
          await esperar(pausa * 4);
          continue;
        }
        const j = leerJson(cruda);
        if (!j) {
          t.resumen.sinRespuesta = Number(t.resumen.sinRespuesta) + 1;
          t.hecho++;
          continue;
        }
        if (!j.util) {
          await repo.actualizar(id, { estado: 'descartada', nota: `La IA la descartó: ${acortar(String(j.motivo ?? 'no sirve como ejemplo general'), 300)}` });
          sacar(id);
          t.resumen.descartadas = Number(t.resumen.descartadas) + 1;
        } else {
          const pregunta = taparDatosPersonales(String(j.pregunta ?? l.pregunta ?? '')).trim() || l.pregunta;
          const respuesta = taparDatosPersonales(String(j.respuesta ?? l.respuesta)).trim() || l.respuesta;
          const huella = huellaDe(pregunta, respuesta);
          const otra = huella !== l.huella ? await repo.porHuella(huella) : null;
          if (otra) {
            await repo.actualizar(id, { estado: 'descartada', nota: `Repetida: ya existe como lección #${otra.id}` });
            sacar(id);
            t.resumen.repetidas = Number(t.resumen.repetidas) + 1;
          } else {
            const tema = String(j.tema ?? '').trim().toLowerCase().slice(0, 60) || l.tema;
            const nueva = await repo.actualizar(id, { pregunta, respuesta, tema, huella, estado: opts.activar ? 'activa' : 'pendiente', nota: 'Pulida por la IA' });
            if (nueva) meter(nueva);
            t.resumen.utiles = Number(t.resumen.utiles) + 1;
          }
        }
        t.hecho++;
        await esperar(pausa);
      }
    });
  }

  async function examinar(opts: { tema?: string; origen?: OrigenLeccion; muestra?: number; soloFallidas?: boolean; ids?: number[]; quien?: string | null }): Promise<Trabajo> {
    if (!ia?.disponible()) throw new Error('Para examinar hace falta conectar Puter (o la clave de la API) en Mi asistente IA.');
    const filtro: FiltroLecciones = { estado: 'activa', tipo: 'ejemplo', tema: opts.tema, origen: opts.origen, ids: opts.ids, examenOk: opts.soloFallidas ? false : undefined };
    const muestra = Math.min(opts.muestra ?? 5000, 5000);
    const ids = await repo.idsPara(filtro, muestra, Boolean(opts.muestra));
    if (!ids.length) throw new Error('No hay lecciones activas de tipo ejemplo que examinar con ese filtro.');
    const nombre = [opts.tema ? `tema ${opts.tema}` : null, opts.origen ? `origen ${opts.origen}` : null, opts.soloFallidas ? 'solo las que fallaron' : null, opts.muestra ? `muestra de ${ids.length}` : `todas (${ids.length})`].filter(Boolean).join(' · ');
    const examen = await repo.crearExamen({ nombre, total: ids.length, creadoPor: opts.quien ?? null, detalle: { filtro: { tema: opts.tema ?? null, origen: opts.origen ?? null, soloFallidas: Boolean(opts.soloFallidas) } } });
    return arrancar('examen', opts.quien, async (t) => {
      t.total = ids.length;
      t.resumen = { examenId: examen.id, aprobados: 0, fallados: 0, errores: 0 };
      let fallosSeguidos = 0;
      const cifras = { aprobados: 0, fallados: 0, errores: 0 };
      const cerrar = async (estado: 'terminado' | 'cancelado') => {
        await repo.cerrarExamen(examen.id, estado, cifras, { porcentaje: cifras.aprobados + cifras.fallados ? Math.round((100 * cifras.aprobados) / (cifras.aprobados + cifras.fallados)) : null });
      };
      try {
        for (const id of ids) {
          if (t.cancelar) break;
          const l = activas.get(id) ?? (await repo.porId(id));
          if (!l || !l.pregunta) {
            t.hecho++;
            continue;
          }
          let dada: { texto: string; derivar: boolean; pedirUbicacion: boolean };
          try {
            dada = await ia!.responder(l.pregunta);
            fallosSeguidos = 0;
          } catch (e) {
            cifras.errores++;
            t.resumen.errores = cifras.errores;
            await repo.anotarCaso({ examenId: examen.id, leccionId: id, pregunta: l.pregunta, esperada: l.respuesta, respuesta: null, ok: false, motivos: [`la IA no respondió: ${acortar(e instanceof Error ? e.message : String(e), 200)}`] });
            if (++fallosSeguidos >= 5) throw new Error('La IA no responde: se para el examen para no seguir fallando.');
            t.hecho++;
            await esperar(pausa * 4);
            continue;
          }
          const nota = calificarLeccion(l.respuesta, dada, { conocimiento: `${ia!.conocimiento()}\n${textoPlano(relevantes(l.pregunta))}` });
          if (nota.ok) cifras.aprobados++;
          else cifras.fallados++;
          t.resumen.aprobados = cifras.aprobados;
          t.resumen.fallados = cifras.fallados;
          await repo.anotarCaso({ examenId: examen.id, leccionId: id, pregunta: l.pregunta, esperada: l.respuesta, respuesta: dada.texto, ok: nota.ok, motivos: nota.motivos });
          const actualizada = await repo.actualizar(id, { examenOk: nota.ok, examenAt: new Date(), examenNota: nota.ok ? null : nota.motivos.join(' · ').slice(0, 500) });
          if (actualizada) meter(actualizada);
          t.hecho++;
          await esperar(pausa);
        }
        await cerrar(t.cancelar ? 'cancelado' : 'terminado');
      } catch (e) {
        await cerrar('cancelado');
        throw e;
      }
    });
  }

  return {
    cargar,
    conectarIA(servicio) {
      ia = servicio;
    },
    relevantes,
    textoParaPrompt,
    textoPlano,
    anotarUso,
    cargadas: () => activas.size,
    ensenar,
    ensenarVarias,
    leer: (entrada) => leerImportacion(entrada),
    async importar(entrada, opts) {
      const lectura = leerImportacion(entrada);
      const r = lectura.filas.length ? await ensenarVarias(lectura.filas, opts) : { nuevas: 0, repetidas: 0, ids: [] };
      return { lectura, nuevas: r.nuevas, repetidas: r.repetidas };
    },
    async cambiar(id, patch, _quien) {
      const actual = await repo.porId(id);
      if (!actual) return null;
      const p: PatchLeccion = {};
      if (patch.tipo !== undefined) p.tipo = patch.tipo;
      if (patch.pregunta !== undefined) p.pregunta = patch.pregunta?.trim() || null;
      if (patch.respuesta !== undefined) p.respuesta = patch.respuesta.trim();
      if (patch.mala !== undefined) p.mala = patch.mala?.trim() || null;
      if (patch.tema !== undefined) p.tema = patch.tema?.trim().toLowerCase() || null;
      if (patch.estado !== undefined) p.estado = patch.estado;
      if (patch.nota !== undefined) p.nota = patch.nota?.trim() || null;
      const tipo = p.tipo ?? actual.tipo;
      const pregunta = p.pregunta !== undefined ? p.pregunta : actual.pregunta;
      const respuesta = p.respuesta ?? actual.respuesta;
      if (tipo === 'ejemplo' && !pregunta) throw new Error('Un ejemplo necesita lo que dice el cliente.');
      if (p.pregunta !== undefined || p.respuesta !== undefined) {
        p.huella = huellaDe(pregunta, respuesta);
        const otra = await repo.porHuella(p.huella);
        if (otra && otra.id !== id) throw new Error(`Ya existe una lección igual (#${otra.id}).`);
        // Cambio el contenido: el examen anterior ya no dice nada de esta.
        p.examenOk = null;
        p.examenAt = null;
        p.examenNota = null;
      }
      const nueva = await repo.actualizar(id, p);
      if (nueva) meter(nueva);
      return nueva;
    },
    async borrar(id) {
      const ok = await repo.borrar(id);
      if (ok) sacar(id);
      return ok;
    },
    porId: (id) => repo.porId(id),
    async listar(filtro, pagina) {
      const limite = Math.min(Math.max(pagina.limite, 1), 200);
      const p = Math.max(pagina.pagina, 1);
      const r = await repo.listar(filtro, { limite, offset: (p - 1) * limite });
      return { items: r.items, total: r.total, pagina: p, paginas: Math.max(1, Math.ceil(r.total / limite)) };
    },
    async enMasa(accion, filtro) {
      if (!filtro.ids?.length && !filtro.estado && !filtro.tipo && !filtro.tema && !filtro.origen && !filtro.origenDetalle && !filtro.q && filtro.examenOk === undefined) {
        throw new Error('Di a cuáles: un filtro o una lista de lecciones.');
      }
      const ids = await repo.idsPara(filtro, 100_000, false);
      let n = 0;
      if (accion === 'borrar') n = await repo.borrarEnMasa(filtro);
      else n = await repo.cambiarEstadoEnMasa(filtro, accion === 'aprobar' || accion === 'activar' ? 'activa' : 'descartada');
      await refrescar(ids);
      return n;
    },
    cifras: () => repo.cifras(),
    temas: () => repo.temas(),
    async descripcionParaIA() {
      const c = await repo.cifras();
      const ultimo = (await repo.examenes(1))[0];
      const partes = [`Entrenamiento del asistente: ${c.porEstado.activa} lecciones activas (${c.porTipo.ejemplo} ejemplos, ${c.porTipo.dato} datos, ${c.porTipo.regla} reglas)${c.porEstado.pendiente ? `, ${c.porEstado.pendiente} pendientes de revisar` : ''}.`];
      if (ultimo && ultimo.estado !== 'corriendo') {
        const pct = ultimo.detalle && typeof ultimo.detalle.porcentaje === 'number' ? `${ultimo.detalle.porcentaje} %` : 'sin nota';
        partes.push(`Último examen (${ultimo.nombre ?? ''}): ${pct}, ${ultimo.aprobados} bien y ${ultimo.fallados} mal de ${ultimo.total}.`);
      }
      return partes.join(' ');
    },
    aprenderDeChats,
    pulir,
    examinar,
    trabajos: () => [...trabajos.values()].map(publico),
    cancelar(tipo) {
      const t = trabajos.get(tipo);
      if (!t || t.estado !== 'corriendo') return false;
      t.cancelar = true;
      return true;
    },
    examenes: (limite = 20) => repo.examenes(limite),
    async examen(id) {
      const e = await repo.examen(id);
      if (!e) return null;
      return { examen: e, casos: await repo.casosDeExamen(id, false, 2000) };
    },
  };
}

/** El servicio de la IA, visto como lo necesita el entrenamiento (un turno sin enviar, el modelo a secas). */
export function iaParaEntrenar(ia: ServicioIA): IAParaEntrenar {
  const contact: Contact = { id: 'examen', phone: '000', name: 'Cliente de prueba', optInAt: null, optInSource: null, optOutAt: null, lastInboundAt: null };
  return {
    async responder(texto) {
      const r = await ia.responder({ contact, texto, historial: [] });
      return { texto: r.texto, derivar: r.derivar, pedirUbicacion: r.pedirUbicacion };
    },
    completar: (mensajes, opts) => ia.completar(mensajes, opts),
    conocimiento() {
      const e = ia.estado();
      return `${e.conocimiento}
${e.instrucciones}`;
    },
    disponible: () => ia.estado().tieneToken,
  };
}

export const NOMBRE_TRABAJO: Record<TipoTrabajo, string> = { aprender: 'aprender de los chats', pulir: 'pulir con la IA', examen: 'examen' };

/** El JSON que devuelve el modelo, aunque venga con texto alrededor o en un bloque de codigo. */
export function leerJson(cruda: string): Record<string, unknown> | null {
  const limpia = cruda.replace(/```(?:json)?/gi, '').trim();
  const inicio = limpia.indexOf('{');
  const fin = limpia.lastIndexOf('}');
  if (inicio < 0 || fin <= inicio) return null;
  try {
    const j = JSON.parse(limpia.slice(inicio, fin + 1)) as unknown;
    return j && typeof j === 'object' && !Array.isArray(j) ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
