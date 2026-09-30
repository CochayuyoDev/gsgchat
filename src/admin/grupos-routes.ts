/**
 * Grupos de clientes: ver quienes son, mandarles a todos (por goteo), meterlos
 * en una secuencia o exportarlos. Ver src/segmentos/segmentos.ts.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Repos } from '../db/repos.js';
import type { SettingsService } from '../settings/service.js';
import { providerOf } from '../settings/service.js';
import type { ServicioAjustes } from '../ajustes/generales.js';
import type { Config } from '../config.js';
import { crearCampana } from '../campanas/crear.js';
import { CATALOG } from '../templates/catalog.js';
import { aCsvCon } from './csv.js';
import {
  criterioSchema,
  evaluarGrupo,
  ETIQUETAS_ACTIVIDAD,
  ETIQUETAS_FICHA,
  ETIQUETAS_REPARTO,
  renderParaCliente,
  textoAPlantilla,
  variablesDeCliente,
} from '../segmentos/segmentos.js';

export interface GruposRoutesDeps {
  repos: Repos;
  config: Config;
  settings: SettingsService;
  ajustes?: ServicioAjustes;
}

const MUESTRA = 200;

export async function registerGruposRoutes(app: FastifyInstance, deps: GruposRoutesDeps): Promise<void> {
  const { repos, config, settings } = deps;
  const negocio = () => deps.ajustes?.nombreNegocio() ?? config.businessName;
  const esCloud = () => providerOf(settings.current()) === 'cloud';

  /** Las opciones de cada filtro con su etiqueta, y los lotes para elegir. */
  app.get('/admin/grupos/opciones', async () => ({
    reparto: ETIQUETAS_REPARTO,
    ficha: ETIQUETAS_FICHA,
    actividad: ETIQUETAS_ACTIVIDAD,
    lotes: (await repos.rutas.listarLotes(100, 0)).map((l) => ({ id: l.id, nombre: l.nombre, estado: l.estado, total: l.total })),
    plantillas: (await repos.templates.list())
      .filter((t) => t.status === 'APPROVED')
      .map((t) => ({ name: t.name, language: t.language, category: t.category, variables: t.variables, body: t.body, propia: Boolean(t.propia), variablesDoc: t.variablesDoc ?? CATALOG.find((c) => c.name === t.name && c.language === t.language)?.variables ?? [] })),
    secuencias: (await repos.automation.listSequences()).map((s) => ({ id: s.id, name: s.name, pasos: s.steps.length })),
    textoLibre: !esCloud(),
    negocio: negocio(),
  }));

  /** Quienes son: total, cifras y una muestra. */
  app.post('/admin/grupos/previsualizar', async (request) => {
    const criterio = criterioSchema.parse(request.body ?? {});
    const r = await evaluarGrupo(repos, criterio);
    return { total: r.total, cifras: r.cifras, clientes: r.clientes.slice(0, MUESTRA), telefonos: r.clientes.map((c) => c.phone) };
  });

  const envioSchema = z.object({
    criterio: criterioSchema,
    nombre: z.string().trim().min(1).max(120).optional(),
    /** O una plantilla del registro... */
    plantilla: z.object({ name: z.string().min(1), language: z.string().min(2).default('es') }).optional(),
    /** ...o un texto con {nombre}, {pedido}, {negocio}, {direccion}, {distrito} (solo sin la API de Meta). */
    texto: z.string().trim().min(5).max(1024).optional(),
    canario: z.coerce.number().int().nonnegative().optional(),
    ritmoPorHora: z.coerce.number().int().positive().optional(),
    /** Solo pintar como quedaria para los primeros, sin mandar nada. */
    soloVistaPrevia: z.boolean().default(false),
  });

  app.post('/admin/grupos/enviar', async (request, reply) => {
    const body = envioSchema.parse(request.body ?? {});
    if (!body.plantilla && !body.texto) return reply.code(400).send({ error: 'Elige una plantilla o escribe un texto.' });
    if (body.texto && esCloud()) {
      return reply.code(400).send({ error: 'Con la API oficial de Meta solo puede salir una plantilla aprobada: elige una o crea una en Plantillas.' });
    }

    const grupo = await evaluarGrupo(repos, body.criterio);
    if (!grupo.total) return reply.code(400).send({ error: 'Con esos filtros no hay ningún cliente.' });

    // La plantilla: la elegida, o una propia creada al vuelo a partir del texto.
    let name: string;
    let language: string;
    let body_: string;
    let doc: string[];
    let category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
    if (body.plantilla) {
      const t = await repos.templates.get(body.plantilla.name, body.plantilla.language);
      if (!t) return reply.code(400).send({ error: 'Esa plantilla no está en el registro.' });
      if (t.status !== 'APPROVED') return reply.code(400).send({ error: `Esa plantilla está en estado ${t.status}.` });
      name = t.name;
      language = t.language;
      body_ = t.body ?? '';
      // Las del catalogo documentan sus variables en el codigo; las propias, en el registro.
      doc = t.variablesDoc ?? CATALOG.find((c) => c.name === t.name && c.language === t.language)?.variables ?? [];
      category = t.category;
    } else {
      const { body: cuerpo, variables } = textoAPlantilla(body.texto!);
      name = `grupo_${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`;
      language = 'es';
      body_ = cuerpo;
      doc = variables;
      category = 'UTILITY';
      if (!body.soloVistaPrevia) {
        await repos.templates.upsert({
          name,
          language,
          category,
          status: 'APPROVED',
          quality: null,
          variables: variables.length,
          body: cuerpo,
          propia: true,
          variablesDoc: variables,
          footer: null,
        });
      }
    }

    const cuantas = (body_.match(/\{\{\d+\}\}/g) ?? []).length;
    const muestra = grupo.clientes.slice(0, 5).map((c) => ({ phone: c.phone, nombre: c.nombre, texto: renderParaCliente(body_, doc, c, negocio()) }));
    if (body.soloVistaPrevia) return { ok: true, total: grupo.total, muestra, plantilla: { name, language, body: body_ } };

    const resultado = await crearCampana(repos, {
      name: body.nombre || `Grupo ${new Date().toLocaleDateString('es-PE')} (${grupo.total})`,
      templateName: name,
      templateLanguage: language,
      category,
      recipients: grupo.clientes.map((c) => ({ phone: c.phone, variables: variablesDeCliente(c, doc, negocio(), cuantas) })),
      ritmoPorHora: body.ritmoPorHora ?? null,
      canario: body.canario,
      canarioEsperaMin: 60,
    });
    if (!resultado.ok) return reply.code(400).send({ error: resultado.error });
    return { ...resultado, total: grupo.total, muestra, plantilla: { name, language } };
  });

  /** El grupo en CSV, con su estado de reparto y de ficha. */
  app.post('/admin/grupos/exportar', async (request, reply) => {
    const criterio = criterioSchema.parse(request.body ?? {});
    const r = await evaluarGrupo(repos, criterio);
    const csv = aCsvCon(
      [
        ['telefono', (c) => c.phone],
        ['nombre', (c) => c.nombre],
        ['opt_in', (c) => (c.optIn ? 'si' : 'no')],
        ['ultimo_mensaje', (c) => c.ultimoMensajeAt],
        ['reparto', (c) => c.reparto?.estado ?? 'sin solicitud'],
        ['pedido', (c) => c.reparto?.pedido ?? ''],
        ['direccion', (c) => c.variables.direccion],
        ['distrito', (c) => c.variables.distrito],
        ['lote', (c) => c.reparto?.lote ?? ''],
        ['ficha', (c) => (c.ficha ? (c.ficha.completa ? 'completa' : 'incompleta') : 'sin ficha')],
        ['ficha_faltan', (c) => c.ficha?.faltan.join(', ') ?? ''],
      ],
      r.clientes,
    );
    return reply.type('text/csv; charset=utf-8').header('content-disposition', 'attachment; filename="grupo-clientes.csv"').send(csv);
  });
}
