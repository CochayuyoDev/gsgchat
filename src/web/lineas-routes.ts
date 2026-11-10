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
import { LineasError, MAX_LINEAS, type CredencialesLinea, type Linea, type ServicioLineas } from '../whatsapp/lineas.js';
import { admiteTipo, esModoLineas, MODO_LINEAS_POR_DEFECTO, MODOS_LINEAS, TEXTO_MODO_LINEAS, tipoDeProveedor, type ModoLineas, type TipoLinea } from '../whatsapp/modo-lineas.js';
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
  /** Normal o API: la principal es del tipo que diga /setup. Sin esto, por su fila. */
  tipoDe?: (linea: Linea) => TipoLinea;
  /**
   * Comprueba con Meta las credenciales de una linea de la API y devuelve su
   * numero. Inyectable para las pruebas; sin esto no se comprueba.
   */
  probarApi?: (cred: { token: string; phoneNumberId: string; businessAccountId: string }) => Promise<{ numero: string; nombre: string }>;
  /** La direccion que hay que pegar en Meta como webhook. */
  webhookUrl?: () => string;
}

const credencialesSchema = z.object({
  token: z.string().trim().max(1000).optional(),
  phoneNumberId: z.string().trim().max(100).optional(),
  businessAccountId: z.string().trim().max(100).optional(),
  wahaUrl: z.string().trim().max(300).optional(),
  wahaApiKey: z.string().trim().max(300).optional(),
  wahaSession: z.string().trim().max(100).optional(),
  appSecret: z.string().trim().max(300).optional(),
  verifyToken: z.string().trim().max(300).optional(),
});

const crearSchema = z.object({
  etiqueta: z.string().trim().min(1).max(80),
  proveedor: z.enum(['local', 'cloud', 'waha']).default('local'),
  telefono: z.string().trim().max(40).optional(),
  credenciales: credencialesSchema.optional(),
});

/** Lo que falta para que una linea de la API pueda enviar y recibir, en palabras. */
function faltanDeApi(c: CredencialesLinea): string[] {
  return [
    !c.token && 'el token de acceso',
    !c.phoneNumberId && 'el identificador del número (Phone number ID)',
    !c.businessAccountId && 'el identificador de la cuenta (WhatsApp Business Account ID)',
    !c.appSecret && 'la clave secreta de la app (App secret)',
  ].filter((x): x is string => Boolean(x));
}

/**
 * Lo que esta mal puesto ANTES de preguntarle a Meta: el campo y como
 * corregirlo. Los errores tipicos: el numero de telefono en vez de su ID, el
 * token de 24 h o el ID de la app en vez de la clave secreta.
 */
export function revisarCredencialesApi(c: CredencialesLinea): { campo: string; error: string } | null {
  const token = (c.token ?? '').trim();
  const pnid = (c.phoneNumberId ?? '').trim();
  const waba = (c.businessAccountId ?? '').trim();
  const secreto = (c.appSecret ?? '').trim();
  const verify = (c.verifyToken ?? '').trim();
  if (token && (!/^EAA/.test(token) || token.length < 60 || /\s/.test(token))) {
    return { campo: 'token', error: 'El token de acceso no tiene la forma de uno de Meta: empieza con «EAA» y es muy largo (unos 200 caracteres), sin espacios. Cópialo entero desde Business Manager → Usuarios del sistema → Generar token.' };
  }
  if (pnid && !/^\d{10,20}$/.test(pnid)) {
    const pareceTelefono = /^\+/.test(pnid) || /^(51)?9\d{8}$/.test(pnid.replace(/[\s()-]/g, ''));
    return {
      campo: 'phoneNumberId',
      error: pareceTelefono
        ? 'Eso es el número de teléfono, no su ID. En Meta → WhatsApp → Configuración de la API, elige el número en «De» y copia el «Identificador del número de teléfono» (solo cifras, por ejemplo 123456789012345).'
        : 'El Phone number ID son solo cifras (entre 10 y 20), sin espacios ni signos. Por ejemplo: 123456789012345.',
    };
  }
  if (waba && !/^\d{10,20}$/.test(waba)) {
    return { campo: 'businessAccountId', error: 'El WhatsApp Business Account ID son solo cifras (entre 10 y 20), sin espacios. Está en Meta → WhatsApp → Configuración de la API, como «Identificador de la cuenta de WhatsApp Business».' };
  }
  if (pnid && waba && pnid === waba) {
    return { campo: 'businessAccountId', error: 'El Phone number ID y el WhatsApp Business Account ID son distintos: pusiste el mismo en los dos. Revisa cuál es cuál en Meta → WhatsApp → Configuración de la API.' };
  }
  if (secreto && !/^[a-f0-9]{32}$/i.test(secreto)) {
    return {
      campo: 'appSecret',
      error: /^EAA/.test(secreto)
        ? 'Ahí pegaste un token de acceso. La clave secreta de la app tiene 32 letras y números: Meta → Configuración de la app → Básica → Clave secreta de la app → Mostrar.'
        : /^\d+$/.test(secreto)
          ? 'Eso parece el identificador de la app (solo cifras), no su clave secreta. La clave tiene 32 letras y números: Configuración de la app → Básica → Clave secreta de la app → Mostrar.'
          : `La clave secreta de la app tiene exactamente 32 letras y números (de la a a la f y del 0 al 9); la que pusiste tiene ${secreto.length}. Está en Configuración de la app → Básica → Clave secreta de la app → Mostrar.`,
    };
  }
  if (verify && !/^[\x21-\x7e]{8,200}$/.test(verify)) {
    return { campo: 'verifyToken', error: 'El verify token es una palabra que tú inventas: al menos 8 caracteres, sin espacios ni tildes. Por ejemplo: gsgwhatsapp2026.' };
  }
  return null;
}

/** El primer dato que falta, para marcarlo en la pantalla. */
function primerFaltante(c: CredencialesLinea): string | null {
  if (!c.token) return 'token';
  if (!c.phoneNumberId) return 'phoneNumberId';
  if (!c.businessAccountId) return 'businessAccountId';
  if (!c.appSecret) return 'appSecret';
  return null;
}

/** Un error de Meta en palabras de la pantalla, con el campo que hay que revisar. */
function explicarFalloMeta(error: unknown): { error: string; campo: string | null } {
  const texto = error instanceof Error ? error.message : String(error);
  if (/401|190|token|OAuth/i.test(texto)) return { error: 'Meta no aceptó el token: revisa que sea el token permanente (de un usuario del sistema) y que no haya caducado.', campo: 'token' };
  if (/100|does not exist|Unsupported get request|nonexisting/i.test(texto)) return { error: 'Meta no encuentra ese número: revisa el Phone number ID (el «Identificador del número de teléfono», no el número) y que el token tenga permiso sobre esa cuenta.', campo: 'phoneNumberId' };
  if (/fetch failed|ENOTFOUND|ECONN|timeout/i.test(texto)) return { error: 'No se pudo hablar con Meta (sin internet o Meta no responde). Prueba otra vez en un rato.', campo: null };
  return { error: `Meta contestó con un error: ${texto.slice(0, 200)}`, campo: null };
}

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
  const modoActual = async (): Promise<ModoLineas> => (lineas.modo ? lineas.modo().catch(() => MODO_LINEAS_POR_DEFECTO) : MODO_LINEAS_POR_DEFECTO);
  const tipoDe = (linea: Linea): TipoLinea => deps.tipoDe?.(linea) ?? tipoDeProveedor(linea.proveedor);
  const soloAdmin = (request: { usuario?: { rol?: string } | null }) => !request.usuario || request.usuario.rol === 'admin';

  /** Una linea tal como la ve la pantalla: sin credenciales, con su estado vivo y, si toca, el QR. */
  async function vista(linea: Linea, preferidaId?: string | null, modo?: ModoLineas) {
    const t = await registro.transporte(linea.id);
    const vivo = t?.sesion && linea.proveedor === 'local' ? t.sesion.getLocalState() : null;
    const idPrincipal = preferidaId === undefined ? await preferida() : preferidaId;
    const tipo = tipoDe(linea);
    const cred = linea.proveedor === 'cloud' && !linea.principal ? await lineas.credenciales(linea.id) : null;
    return {
      id: linea.id,
      etiqueta: linea.etiqueta,
      numero: linea.telefono || vivo?.phone || '',
      proveedor: linea.proveedor,
      tipo,
      // false = el modo de Conexion la deja en pausa (sigue conectada).
      enUso: admiteTipo(modo ?? (await modoActual()), tipo),
      // Solo de una linea de la API: que datos tiene (nunca los valores) y cuales le faltan.
      ...(cred
        ? {
            api: {
              phoneNumberId: cred.phoneNumberId ?? linea.idExterno ?? '',
              businessAccountId: cred.businessAccountId ?? '',
              conToken: Boolean(cred.token),
              conAppSecret: Boolean(cred.appSecret),
              conVerifyToken: Boolean(cred.verifyToken),
              faltan: faltanDeApi({ ...cred, phoneNumberId: cred.phoneNumberId ?? linea.idExterno ?? undefined }),
            },
          }
        : {}),
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
    const modo = await modoActual();
    return {
      max: MAX_LINEAS,
      puedeElegirPrincipal: Boolean(lineas.fijarPreferida),
      puedeElegirModo: Boolean(lineas.fijarModo),
      modo,
      modos: MODOS_LINEAS.map((m) => ({ id: m, ...TEXTO_MODO_LINEAS[m] })),
      webhookUrl: deps.webhookUrl?.() ?? '',
      lineas: await Promise.all(todas.map((l) => vista(l, idPrincipal, modo))),
    };
  });

  /**
   * Que lineas se usan: solo las normales, solo las de la API o las dos. No
   * desconecta nada. No deja elegir un modo sin ninguna linea habilitada de
   * ese tipo: con eso no saldria ningun mensaje.
   */
  app.post('/admin/lineas/modo', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia qué líneas se usan.' });
    if (!lineas.fijarModo) return reply.code(404).send({ error: 'Elegir qué líneas se usan no está disponible aquí.' });
    const modo = (request.body as { modo?: unknown } | undefined)?.modo;
    if (!esModoLineas(modo)) return reply.code(400).send({ error: 'Elige uno de los tres: solo WhatsApp normal, solo WhatsApp API o los dos juntos.', codigo: 'modo' });
    if (modo !== 'ambos') {
      const hay = (await lineas.listar()).some((l) => (l.principal || l.habilitada) && tipoDe(l) === modo);
      if (!hay) {
        return reply.code(409).send({
          error: modo === 'api'
            ? 'Todavía no tienes ninguna línea de WhatsApp API. Agrega una abajo («Agregar línea» → WhatsApp API) y vuelve a elegir este modo.'
            : 'No tienes ninguna línea de WhatsApp normal habilitada. Agrega una con QR o habilita una y vuelve a elegir este modo.',
          codigo: 'sin_lineas_del_tipo',
        });
      }
    }
    const guardado = await lineas.fijarModo(modo);
    const conectadas = (await registro.estados()).filter((e) => e.conectada && admiteTipo(guardado, tipoDe(e.linea))).length;
    return { ok: true, modo: guardado, conectadasEnUso: conectadas };
  });

  /** Cambia los datos de una linea de la API (lo que se deje vacio se conserva) y los comprueba con Meta. */
  app.patch<{ Params: { id: string } }>('/admin/lineas/:id/credenciales', async (request, reply) => {
    if (!soloAdmin(request)) return reply.code(403).send({ error: 'Solo un administrador cambia los datos de una línea.' });
    if (!lineas.fijarCredenciales) return reply.code(404).send({ error: 'Cambiar los datos de una línea no está disponible aquí.' });
    const body = credencialesSchema.parse(request.body ?? {});
    try {
      const linea = await lineas.obtener(request.params.id);
      if (!linea) return reply.code(404).send({ error: 'Esa linea no existe.', codigo: 'no_existe' });
      if (linea.principal) return reply.code(400).send({ error: 'Los datos de la línea principal se cambian en su tarjeta de Conexión.', codigo: 'principal' });
      if (linea.proveedor !== 'cloud') return reply.code(400).send({ error: 'Solo las líneas de WhatsApp API tienen datos que cambiar.', codigo: 'proveedor' });
      const juntas = { ...(await lineas.credenciales(linea.id)), ...Object.fromEntries(Object.entries(body).filter(([, v]) => v)) } as CredencialesLinea;
      const faltan = faltanDeApi(juntas);
      if (faltan.length) return reply.code(400).send({ error: `Falta ${faltan.join(', ')}.`, codigo: 'faltan', campo: primerFaltante(juntas) });
      const malPuesto = revisarCredencialesApi(juntas);
      if (malPuesto) return reply.code(400).send({ error: malPuesto.error, codigo: 'formato', campo: malPuesto.campo });
      let numero = '';
      if (deps.probarApi) {
        try {
          numero = (await deps.probarApi({ token: juntas.token!, phoneNumberId: juntas.phoneNumberId!, businessAccountId: juntas.businessAccountId! })).numero;
        } catch (error) {
          return reply.code(400).send({ ...explicarFalloMeta(error), codigo: 'meta' });
        }
      }
      await lineas.fijarCredenciales(linea.id, body);
      // Meta contesto: la linea queda conectada ya (sin esperar a la siguiente vuelta del registro).
      if (deps.probarApi) await lineas.sincronizar(linea.id, { estado: 'conectado', ...(numero ? { telefono: numero } : {}) });
      // El cliente guardado se armo con los datos viejos.
      registro.olvidar(linea.id);
      return { ok: true, linea: await vista((await lineas.obtener(linea.id))!) };
    } catch (error) {
      return responderError(error, reply);
    }
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
      let telefono = body.telefono;
      if (body.proveedor === 'cloud') {
        // Una linea de la API se da de alta completa y comprobada: si no, quedaria
        // «conectada» en la pantalla sin poder mandar nada.
        const cred = body.credenciales ?? {};
        const faltan = faltanDeApi(cred);
        if (faltan.length) return reply.code(400).send({ error: `Falta ${faltan.join(', ')}.`, codigo: 'faltan', campo: primerFaltante(cred) });
        const malPuesto = revisarCredencialesApi(cred);
        if (malPuesto) return reply.code(400).send({ error: malPuesto.error, codigo: 'formato', campo: malPuesto.campo });
        if (deps.probarApi) {
          try {
            telefono = (await deps.probarApi({ token: cred.token!, phoneNumberId: cred.phoneNumberId!, businessAccountId: cred.businessAccountId! })).numero || telefono;
          } catch (error) {
            return reply.code(400).send({ ...explicarFalloMeta(error), codigo: 'meta' });
          }
        }
      }
      const linea = await lineas.crear({ etiqueta: body.etiqueta, proveedor: body.proveedor, telefono, credenciales: body.credenciales });
      // Una linea de la API que Meta acepto ya esta conectada.
      if (body.proveedor === 'cloud' && deps.probarApi) {
        await lineas.sincronizar(linea.id, { estado: 'conectado' });
        return { ok: true, linea: await vista((await lineas.obtener(linea.id)) ?? linea) };
      }
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
