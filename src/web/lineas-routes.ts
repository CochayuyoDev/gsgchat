/**
 * Administrar las lineas de WhatsApp desde /setup (hasta 8 por tienda).
 *
 * La principal es la conexion de siempre y se maneja con /admin/local/* y las
 * credenciales de /setup; aqui se listan junto a las demas, pero conectarla o
 * desvincularla sigue pasando por lo suyo. Cada linea local secundaria tiene
 * su propia sesion y su propia carpeta de vinculacion: conectar, desconectar o
 * quitar una no toca a las otras.
 */

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LineasError, MAX_LINEAS, type Linea, type ServicioLineas } from '../whatsapp/lineas.js';
import type { RegistroClientes } from '../whatsapp/registro.js';
import { LimiteInvalido } from '../whatsapp/limite-diario.js';
import { hayVinculacion } from '../whatsapp/local/session.js';
import type { RepartoDeLineas } from '../whatsapp/reparto-lineas.js';

export interface LineasRoutesDeps {
  lineas: ServicioLineas;
  registro: RegistroClientes;
  /** Arranca el socket de una linea local secundaria con sus entrantes marcados con su id. */
  arrancarLinea: (id: string) => Promise<unknown>;
  /** Como se reparten los clientes entre las lineas y los ultimos cambios. */
  reparto?: RepartoDeLineas;
}

const crearSchema = z.object({
  etiqueta: z.string().trim().min(1).max(80),
  proveedor: z.enum(['local', 'cloud', 'waha']).default('local'),
  telefono: z.string().trim().max(40).optional(),
  credenciales: z
    .object({
      token: z.string().trim().max(1000).optional(),
      phoneNumberId: z.string().trim().max(100).optional(),
      businessAccountId: z.string().trim().max(100).optional(),
      wahaUrl: z.string().trim().max(300).optional(),
      wahaApiKey: z.string().trim().max(300).optional(),
      wahaSession: z.string().trim().max(100).optional(),
    })
    .optional(),
});

const cambiarSchema = z.object({
  etiqueta: z.string().trim().min(1).max(80).optional(),
  habilitada: z.boolean().optional(),
  /** Maximo de mensajes por dia: vacio, null o 0 = sin limite; se valida en `fijarLimite`. */
  limiteDiario: z.unknown().optional(),
});

export async function registerLineasRoutes(app: FastifyInstance, deps: LineasRoutesDeps): Promise<void> {
  const { lineas, registro } = deps;

  /** La principal de uso (ver `ServicioLineas.preferida`); sin el metodo, la de /setup. */
  const preferida = async (): Promise<string | null> => (lineas.preferida ? lineas.preferida().catch(() => null) : null);

  /** Una linea tal como la ve la pantalla: sin credenciales, con su estado vivo y, si toca, el QR. */
  async function vista(linea: Linea, preferidaId?: string | null) {
    const t = await registro.transporte(linea.id);
    const vivo = t?.sesion && linea.proveedor === 'local' ? t.sesion.getLocalState() : null;
    const idPrincipal = preferidaId === undefined ? await preferida() : preferidaId;
    return {
      id: linea.id,
      etiqueta: linea.etiqueta,
      numero: linea.telefono || vivo?.phone || '',
      proveedor: linea.proveedor,
      estado: linea.estado,
      // `principal` = la de uso (la que eligio la tienda). `deSetup` = la conexion
      // de siempre: se conecta y desvincula desde su pantalla y no se puede quitar.
      principal: idPrincipal ? linea.id === idPrincipal : linea.principal,
      deSetup: linea.principal,
      habilitada: linea.habilitada,
      limiteDiario: linea.limiteDiario,
      conectada: await registro.conectada(linea.id),
      ...(vivo ? { sesion: { status: vivo.status, qr: vivo.qr, pairingCode: vivo.pairingCode, detalle: vivo.detail, nombre: vivo.name } } : {}),
    };
  }

  function responderError(error: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) {
    if (error instanceof LimiteInvalido) return reply.code(400).send({ error: error.message, codigo: 'limite_invalido' });
    if (error instanceof LineasError) {
      const status = error.codigo === 'no_existe' ? 404 : error.codigo === 'tope' ? 409 : 400;
      return reply.code(status).send({ error: error.message, codigo: error.codigo });
    }
    throw error;
  }

  app.get('/admin/lineas', async () => {
    const todas = await lineas.listar();
    const idPrincipal = await preferida();
    return { max: MAX_LINEAS, puedeElegirPrincipal: Boolean(lineas.fijarPreferida), lineas: await Promise.all(todas.map((l) => vista(l, idPrincipal))) };
  });

  /**
   * «Hacer principal»: cualquier linea habilitada pasa a ser la principal de uso
   * (la que se rotula como principal y la primera a la que pasa un envio cuando
   * la linea del cliente esta caida). Cada cliente sigue con su linea.
   */
  app.post<{ Params: { id: string } }>('/admin/lineas/:id/principal', async (request, reply) => {
    if (request.usuario && request.usuario.rol !== 'admin') return reply.code(403).send({ error: 'Solo un administrador elige la línea principal.' });
    if (!lineas.fijarPreferida) return reply.code(404).send({ error: 'Elegir la línea principal no está disponible aquí.' });
    try {
      const linea = await lineas.fijarPreferida(request.params.id);
      return { ok: true, linea: await vista((await lineas.obtener(linea.id))!) };
    } catch (error) {
      return responderError(error, reply);
    }
  });

  app.post('/admin/lineas', async (request, reply) => {
    const body = crearSchema.parse(request.body ?? {});
    try {
      const linea = await lineas.crear({ etiqueta: body.etiqueta, proveedor: body.proveedor, telefono: body.telefono, credenciales: body.credenciales });
      return { ok: true, linea: await vista(linea) };
    } catch (error) {
      return responderError(error, reply);
    }
  });

  app.patch<{ Params: { id: string } }>('/admin/lineas/:id', async (request, reply) => {
    const body = cambiarSchema.parse(request.body ?? {});
    try {
      let linea = await lineas.obtener(request.params.id);
      if (!linea) return reply.code(404).send({ error: 'Esa linea no existe.', codigo: 'no_existe' });
      if (body.etiqueta !== undefined) linea = await lineas.renombrar(linea.id, body.etiqueta);
      if (body.habilitada !== undefined) {
        if (linea.principal && !body.habilitada) return reply.code(400).send({ error: 'La linea principal no se puede deshabilitar.', codigo: 'principal' });
        await lineas.habilitar(linea.id, body.habilitada);
        // Deshabilitar corta su socket; las demas siguen como estaban.
        if (!body.habilitada) registro.olvidar(linea.id);
        linea = (await lineas.obtener(linea.id))!;
      }
      if ('limiteDiario' in ((request.body ?? {}) as object)) {
        await lineas.fijarLimite(linea.id, body.limiteDiario);
        linea = (await lineas.obtener(linea.id))!;
      }
      return { ok: true, linea: await vista(linea) };
    } catch (error) {
      return responderError(error, reply);
    }
  });

  /** Cuantos clientes lleva cada linea y los ultimos cambios de linea. */
  app.get<{ Querystring: { contactId?: string } }>('/admin/lineas/reparto', async (request, reply) => {
    const { reparto } = deps;
    if (!reparto) return reply.code(404).send({ error: 'El reparto de líneas no está disponible aquí.' });
    const [cargas, cambios] = await Promise.all([reparto.cargas(), reparto.cambios({ limite: 20, contactId: request.query.contactId })]);
    return {
      lineas: cargas.map((c) => ({ ...c, sinConexionDesde: registro.sinConexionDesde(c.id) })),
      cambios,
    };
  });

  /** Abre la sesion de una linea local secundaria y devuelve su estado (con el QR si toca). */
  app.post<{ Params: { id: string } }>('/admin/lineas/:id/conectar', async (request, reply) => {
    const linea = await lineas.obtener(request.params.id);
    if (!linea) return reply.code(404).send({ error: 'Esa linea no existe.', codigo: 'no_existe' });
    if (linea.principal) return reply.code(400).send({ error: 'La linea principal se conecta desde la pantalla de Conexion de siempre.', codigo: 'principal' });
    if (linea.proveedor !== 'local') {
      return reply.code(400).send({ error: 'Esta linea usa credenciales del proveedor: no hay QR que escanear.', codigo: 'proveedor' });
    }
    if (!linea.habilitada) return reply.code(409).send({ error: 'Esta linea esta deshabilitada.', codigo: 'deshabilitada' });
    let t = await registro.transporte(linea.id);
    if (!t?.sesion || !t.authDir) return reply.code(400).send({ error: 'No se pudo preparar la sesion de esta linea.' });
    await deps.arrancarLinea(linea.id);
    // Una vinculacion vieja que ya no vale se borra al abrir: se reabre una vez para sacar el QR.
    t = (await registro.transporte(linea.id))!;
    if (t.sesion!.getLocalState().status === 'STOPPED' && !hayVinculacion(t.authDir!)) await deps.arrancarLinea(linea.id);
    await registro.sincronizar();
    return { ok: true, linea: await vista((await lineas.obtener(linea.id))!) };
  });

  /** Desvincula una linea local secundaria: pide escanear otra vez. Las demas siguen. */
  app.post<{ Params: { id: string } }>('/admin/lineas/:id/desconectar', async (request, reply) => {
    const linea = await lineas.obtener(request.params.id);
    if (!linea) return reply.code(404).send({ error: 'Esa linea no existe.', codigo: 'no_existe' });
    if (linea.principal) return reply.code(400).send({ error: 'La linea principal se desvincula desde la pantalla de Conexion de siempre.', codigo: 'principal' });
    const t = await registro.transporte(linea.id);
    if (t?.sesion && t.authDir) await t.sesion.logoutLocal(t.authDir);
    await lineas.sincronizar(linea.id, { estado: 'desconectado' });
    return { ok: true, linea: await vista((await lineas.obtener(linea.id))!) };
  });

  /** Vincular una linea local con el numero en vez de con la camara. */
  app.post<{ Params: { id: string } }>('/admin/lineas/:id/codigo', async (request, reply) => {
    const body = z.object({ phone: z.string().trim().min(6) }).parse(request.body ?? {});
    const linea = await lineas.obtener(request.params.id);
    if (!linea || linea.principal || linea.proveedor !== 'local') return reply.code(400).send({ error: 'Esta linea no se vincula con codigo.' });
    const t = await registro.transporte(linea.id);
    if (!t?.sesion || !t.authDir) return reply.code(400).send({ error: 'No se pudo preparar la sesion de esta linea.' });
    try {
      if (t.sesion.getLocalState().status === 'STOPPED') {
        await deps.arrancarLinea(linea.id);
        if (t.sesion.getLocalState().status === 'STOPPED' && !hayVinculacion(t.authDir)) await deps.arrancarLinea(linea.id);
      }
      return { ok: true, code: await t.sesion.requestLocalPairingCode(body.phone) };
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : 'no se pudo pedir el codigo' });
    }
  });

  /** Quita una linea (nunca la principal). Sus mensajes viejos conservan su etiqueta y numero. */
  app.delete<{ Params: { id: string } }>('/admin/lineas/:id', async (request, reply) => {
    try {
      const linea = await lineas.obtener(request.params.id);
      if (!linea) return reply.code(404).send({ error: 'Esa linea no existe.', codigo: 'no_existe' });
      if (linea.principal) return reply.code(400).send({ error: 'La linea principal no se puede quitar.', codigo: 'principal' });
      const t = await registro.transporte(linea.id);
      if (t?.sesion && t.authDir) await t.sesion.logoutLocal(t.authDir).catch(() => undefined);
      registro.olvidar(linea.id);
      await lineas.eliminar(linea.id);
      return { ok: true };
    } catch (error) {
      return responderError(error, reply);
    }
  });
}
