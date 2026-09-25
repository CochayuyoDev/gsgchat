/**
 * La bitacora: quien hizo que, y cuando.
 *
 * Se escribe sola. Un hook `onResponse` mira cada peticion que cambia algo
 * (POST/DELETE/PUT que acabo bien) y la anota con quien la hizo, un codigo
 * corto de la accion y un detalle sin secretos. Asi no hay que acordarse de
 * anotar nada en cada ruta, y lo que se olvida no queda fuera.
 *
 * Lo que NO se apunta: lecturas (GET), lo que falla, y las rutas de mucho
 * trafico que no cambian nada importante (marcar un chat como leido, la
 * previsualizacion de un lote). Y en `detalle` nunca van contrasenas,
 * tokens ni claves: se quitan por nombre de campo antes de guardar.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Pool } from '../db/pool.js';

export interface EntradaActividad {
  id: number;
  at: Date;
  usuarioId: string | null;
  usuario: string;
  accion: string;
  detalle: Record<string, unknown> | null;
  ip: string | null;
}

export interface ActividadRepo {
  anotar(e: Omit<EntradaActividad, 'id' | 'at'> & { at?: Date }): Promise<void>;
  listar(query: { limit: number; offset: number; accion?: string; usuario?: string }): Promise<{ items: EntradaActividad[]; total: number }>;
  /** Los codigos de accion que hay, para el filtro. */
  acciones(): Promise<string[]>;
}

/** Codigo y etiqueta legible por ruta. Lo que no este aqui se anota con un codigo generico. */
const ACCIONES: Array<[method: string, ruta: RegExp, accion: string]> = [
  ['POST', /^\/login\/primera-cuenta$/, 'cuenta.primera'],
  ['POST', /^\/login$/, 'entrar'],
  ['POST', /^\/logout$/, 'salir'],
  ['POST', /^\/admin\/usuarios$/, 'usuario.crear'],
  ['POST', /^\/admin\/usuarios\/:id$/, 'usuario.cambiar'],
  ['POST', /^\/admin\/mi-clave$/, 'cuenta.clave'],
  ['POST', /^\/admin\/claves-api$/, 'clave.crear'],
  ['DELETE', /^\/admin\/claves-api\/:id$/, 'clave.revocar'],
  ['POST', /^\/admin\/ajustes$/, 'ajustes.guardar'],
  ['DELETE', /^\/admin\/ajustes$/, 'ajustes.restablecer'],
  ['POST', /^\/admin\/pause$/, 'envios.pausa'],
  ['POST', /^\/admin\/salud\/reanudar$/, 'salud.reanudar'],
  ['POST', /^\/admin\/salud\/contactos\/levantar$/, 'salud.levantar'],
  ['POST', /^\/admin\/number\/sync$/, 'numero.sincronizar'],
  ['POST', /^\/admin\/templates$/, 'plantilla.crear'],
  ['DELETE', /^\/admin\/templates/, 'plantilla.borrar'],
  ['POST', /^\/admin\/templates\/sync$/, 'plantilla.sincronizar'],
  ['POST', /^\/admin\/templates\/push$/, 'plantilla.subir'],
  ['POST', /^\/admin\/campaigns$/, 'campana.crear'],
  ['POST', /^\/admin\/campaigns\/goteo$/, 'campana.goteo'],
  ['POST', /^\/admin\/campaigns\/:id\/estado$/, 'campana.estado'],
  ['POST', /^\/admin\/grupos\/enviar$/, 'grupo.enviar'],
  ['POST', /^\/admin\/stickers$/, 'sticker.subir'],
  ['DELETE', /^\/admin\/stickers\/:id$/, 'sticker.borrar'],
  ['POST', /^\/admin\/stickers\/configuracion$/, 'sticker.configuracion'],
  ['POST', /^\/admin\/stickers\/desde-chat$/, 'sticker.desdeChat'],
  ['POST', /^\/admin\/stickers\/:id\/enviar$/, 'sticker.enviar'],
  ['POST', /^\/admin\/chat\/atajos$/, 'chat.atajos'],
  ['POST', /^\/admin\/tracking$/, 'rastreo.crear'],
  // Las tiendas del superadministrador (ver src/tiendas): su historial sale de aqui.
  ['POST', /^\/admin\/tiendas$/, 'tienda.alta'],
  ['POST', /^\/admin\/tiendas\/cobro$/, 'tienda.cobro'],
  ['POST', /^\/admin\/tiendas\/avisos$/, 'tienda.avisos'],
  ['POST', /^\/admin\/tiendas\/pagos\/:pagoId\/aceptar$/, 'tienda.pago.aceptar'],
  ['POST', /^\/admin\/tiendas\/pagos\/:pagoId\/rechazar$/, 'tienda.pago.rechazar'],
  ['POST', /^\/admin\/tiendas\/:id$/, 'tienda.cambiar'],
  ['POST', /^\/admin\/tiendas\/:id\/pagos$/, 'tienda.pago'],
  ['POST', /^\/admin\/tiendas\/:id\/suspender$/, 'tienda.suspender'],
  ['POST', /^\/admin\/tiendas\/:id\/token$/, 'tienda.token'],
  ['POST', /^\/admin\/tiendas\/:id\/avisar$/, 'tienda.avisar'],
  ['DELETE', /^\/admin\/tiendas\/:id$/, 'tienda.borrar'],
  ['POST', /^\/admin\/messages\//, 'mensaje.enviar'],
  ['POST', /^\/admin\/chat\/send$/, 'chat.enviar'],
  ['POST', /^\/admin\/chat\/start$/, 'chat.abrir'],
  ['POST', /^\/admin\/chat\/adjunto$/, 'chat.adjunto'],
  ['POST', /^\/admin\/chat\/:contactId\/bot$/, 'chat.bot'],
  ['POST', /^\/admin\/contacts\/import$/, 'contactos.importar'],
  ['POST', /^\/admin\/contacts\/opt-in$/, 'contacto.optin'],
  ['POST', /^\/admin\/contacts\/opt-out$/, 'contacto.baja'],
  ['POST', /^\/admin\/automation\/rules/, 'automatizacion.regla'],
  ['PUT', /^\/admin\/automation\/rules/, 'automatizacion.regla'],
  ['DELETE', /^\/admin\/automation\/rules/, 'automatizacion.regla.borrar'],
  ['POST', /^\/admin\/automation\/sequences/, 'automatizacion.secuencia'],
  ['PUT', /^\/admin\/automation\/sequences/, 'automatizacion.secuencia'],
  ['DELETE', /^\/admin\/automation\/sequences/, 'automatizacion.secuencia.borrar'],
  ['POST', /^\/admin\/automation\/enrollments\/:id\/cancel$/, 'automatizacion.cancelar'],
  ['PUT', /^\/admin\/preventa\/mensajes$/, 'preventa.mensajes'],
  ['POST', /^\/admin\/automation\/scheduled/, 'automatizacion.programar'],
  ['POST', /^\/admin\/automation\/prefs$/, 'automatizacion.preferencias'],
  ['POST', /^\/admin\/rutas\/ajustes$/, 'reparto.ajustes'],
  ['DELETE', /^\/admin\/rutas\/ajustes$/, 'reparto.ajustes.restablecer'],
  ['POST', /^\/admin\/rutas\/lotes$/, 'lote.crear'],
  ['POST', /^\/admin\/rutas\/lotes\/:id\/estado$/, 'lote.estado'],
  ['DELETE', /^\/admin\/rutas\/lotes\/:id$/, 'lote.borrar'],
  ['POST', /^\/admin\/rutas\/solicitudes\/:id\/resolver$/, 'solicitud.resolver'],
  ['POST', /^\/admin\/rutas\/solicitudes\/:id\/derivar$/, 'solicitud.derivar'],
  ['POST', /^\/admin\/rutas\/solicitudes\/:id\/reintentar$/, 'solicitud.reintentar'],
  ['PATCH', /^\/admin\/rutas\/solicitudes\/:id$/, 'solicitud.cambiar'],
  ['POST', /^\/admin\/rutas\/cola\/despachar$/, 'gsg.despachar'],
  ['POST', /^\/admin\/settings/, 'conexion.cambiar'],
  ['POST', /^\/admin\/connect/, 'conexion.conectar'],
  ['POST', /^\/admin\/local\//, 'conexion.local'],
  ['POST', /^\/admin\/waha\//, 'conexion.waha'],
  ['POST', /^\/admin\/archives/, 'respaldo'],
  ['DELETE', /^\/admin\/archives\/:id$/, 'respaldo.borrar'],
  ['POST', /^\/admin\/leads/, 'ficha'],
  ['PUT', /^\/admin\/leads/, 'ficha'],
  ['DELETE', /^\/admin\/tracking\/:id$/, 'rastreo.cerrar'],
  ['POST', /^\/admin\/ia$/, 'ia.configurar'],
  ['POST', /^\/admin\/ia\/ordenes$/, 'ia.orden'],
  ['POST', /^\/admin\/ia\/ordenes\/confirmar$/, 'ia.confirmar'],
  ['POST', /^\/admin\/envio-automatico$/, 'lista.poner'],
  ['DELETE', /^\/admin\/envio-automatico\/:clave$/, 'lista.quitar'],
  ['POST', /^\/admin\/envio-automatico\/:clave\/pausar$/, 'lista.pausar'],
  ['POST', /^\/admin\/envio-automatico\/:clave\/reanudar$/, 'lista.reanudar'],
  ['POST', /^\/admin\/envio-automatico\/:clave\/editar$/, 'lista.editar'],
  ['POST', /^\/admin\/envio-automatico\/ajustes$/, 'lista.ajustes'],
  ['POST', /^\/admin\/dev\//, 'dev.simular'],
  // La API publica: lo que hace otro sistema con su clave tambien queda apuntado.
  ['POST', /^\/api\/v1\/mensajes$/, 'api.mensaje'],
  ['POST', /^\/api\/v1\/ia\/ordenes$/, 'ia.orden'],
  ['POST', /^\/api\/v1\/ia\/ordenes\/confirmar$/, 'ia.confirmar'],
  ['POST', /^\/api\/v1\/contactos$/, 'api.contacto'],
  ['POST', /^\/api\/v1\/contactos\/:telefono\/baja$/, 'contacto.baja'],
  ['POST', /^\/api\/v1\/webhooks$/, 'webhook.crear'],
  ['PATCH', /^\/api\/v1\/webhooks\/:id$/, 'webhook.cambiar'],
  ['DELETE', /^\/api\/v1\/webhooks\/:id$/, 'webhook.borrar'],
  ['POST', /^\/api\/v1\/webhooks\/:id\/secreto$/, 'webhook.secreto'],
  ['POST', /^\/api\/v1\/webhooks\/:id\/reencolar$/, 'webhook.reencolar'],
  ['POST', /^\/api\/v1\/conectores$/, 'conector.crear'],
  ['PATCH', /^\/api\/v1\/conectores\/:id$/, 'conector.cambiar'],
  ['DELETE', /^\/api\/v1\/conectores\/:id$/, 'conector.borrar'],
  ['POST', /^\/api\/v1\/conectores\/:id\/secreto$/, 'conector.secreto'],
  ['PATCH', /^\/api\/v1\/pedidos\/:id$/, 'pedido.estado'],
  // Los procesos (src/procesos).
  ['POST', /^\/admin\/procesos\/desde-plantilla$/, 'proceso.crear'],
  ['POST', /^\/admin\/procesos$/, 'proceso.crear'],
  ['POST', /^\/admin\/procesos\/:id$/, 'proceso.editar'],
  ['POST', /^\/admin\/procesos\/:id\/estado$/, 'proceso.estado'],
  ['DELETE', /^\/admin\/procesos\/:id$/, 'proceso.borrar'],
  ['POST', /^\/admin\/procesos\/:id\/personas$/, 'proceso.personas'],
  ['POST', /^\/api\/v1\/procesos\/:id\/personas$/, 'proceso.personas'],
  ['POST', /^\/admin\/procesos\/corridas\/:id\/estado$/, 'proceso.corrida'],
  ['POST', /^\/admin\/procesos\/personas\/masa$/, 'proceso.masa'],
];

/** Lo que no merece una fila: mucho trafico y nada que auditar. */
const IGNORAR: RegExp[] = [/^\/admin\/tiendas\/avisos\/(revisar|previsualizar)$/, /^\/api\/v1\/webhooks\/:id\/probar$/, /^\/api\/v1\/conectores\/:id\/probar$/, /^\/api\/v1\/embed\/token$/, /^\/api\/v1\/conversaciones\/:telefono\/leido$/, /^\/admin\/chat\/[^/]+\/read$/, /^\/admin\/rutas\/previsualizar$/, /^\/admin\/grupos\/previsualizar$/, /^\/admin\/grupos\/exportar$/, /^\/admin\/geo\/extract$/, /^\/admin\/salud\/evaluar$/, /^\/admin\/automation\/run$/, /^\/admin\/settings\/status$/, /^\/admin\/ia\/(ayuda|probar|escenarios)$/];

export const ETIQUETAS: Record<string, string> = {
  'cuenta.primera': 'Creo la primera cuenta',
  entrar: 'Entro al sistema',
  salir: 'Salio del sistema',
  'entrar.fallido': 'Intento entrar y fallo',
  'usuario.crear': 'Creo un usuario',
  'usuario.cambiar': 'Cambio un usuario',
  'cuenta.clave': 'Cambio su contraseña',
  'clave.crear': 'Creo una clave de API',
  'clave.revocar': 'Revoco una clave de API',
  'ajustes.guardar': 'Guardo la configuracion',
  'ajustes.restablecer': 'Restablecio la configuracion',
  'envios.pausa': 'Pauso o reanudo los envios',
  'salud.reanudar': 'Reanudo el numero (salud)',
  'salud.levantar': 'Levanto la supresion de un contacto',
  'numero.sincronizar': 'Sincronizo el numero con Meta',
  'plantilla.crear': 'Creo una plantilla',
  'plantilla.borrar': 'Borro una plantilla',
  'plantilla.sincronizar': 'Sincronizo plantillas',
  'plantilla.subir': 'Subio plantillas a Meta',
  'campana.crear': 'Creo una campaña',
  'campana.goteo': 'Lanzo una campaña por goteo',
  'campana.estado': 'Pauso, reanudo o paro una campaña',
  'grupo.enviar': 'Envio un mensaje a un grupo de clientes',
  'sticker.subir': 'Subio un sticker',
  'sticker.borrar': 'Quito un sticker',
  'sticker.configuracion': 'Cambio los stickers automaticos',
  'sticker.enviar': 'Mando un sticker desde el chat',
  'sticker.desdeChat': 'Guardo un sticker que llego por el chat',
  'chat.atajos': 'Cambio las respuestas rapidas',
  'rastreo.crear': 'Creo un rastreo en vivo',
  'mensaje.enviar': 'Envio un mensaje desde el panel',
  'chat.enviar': 'Escribio en un chat',
  'chat.abrir': 'Abrio un chat nuevo',
  'chat.adjunto': 'Mando un adjunto desde el chat',
  'chat.bot': 'Paro o reanudo el bot en un chat',
  'contactos.importar': 'Importo contactos',
  'contacto.optin': 'Registro un consentimiento',
  'contacto.baja': 'Dio de baja un contacto',
  'automatizacion.regla': 'Cambio una regla automatica',
  'automatizacion.secuencia': 'Cambio una secuencia',
  'automatizacion.programar': 'Programo un mensaje',
  'automatizacion.preferencias': 'Cambio preferencias del asistente',
  'automatizacion.regla.borrar': 'Borro una regla automatica',
  'automatizacion.secuencia.borrar': 'Borro una secuencia',
  'automatizacion.cancelar': 'Saco a un contacto de una secuencia',
  'preventa.mensajes': 'Cambio los mensajes de preventa',
  'reparto.ajustes': 'Guardo los ajustes del reparto',
  'reparto.ajustes.restablecer': 'Restablecio los ajustes del reparto',
  'lote.crear': 'Cargo un lote de reparto',
  'lote.estado': 'Cambio el estado de un lote',
  'lote.borrar': 'Borro un lote',
  'solicitud.resolver': 'Resolvio una solicitud a mano',
  'solicitud.derivar': 'Derivo una solicitud al repartidor',
  'solicitud.reintentar': 'Reintento una solicitud',
  'solicitud.cambiar': 'Cambio una solicitud a mano',
  'gsg.despachar': 'Despacho la cola hacia GSG',
  'conexion.cambiar': 'Cambio la conexion de WhatsApp',
  'conexion.conectar': 'Conecto WhatsApp',
  'conexion.local': 'Toco la sesion local (QR)',
  'conexion.waha': 'Toco la sesion de WAHA',
  respaldo: 'Respaldo conversaciones',
  'respaldo.borrar': 'Borro un respaldo',
  'rastreo.cerrar': 'Cerro un rastreo en vivo',
  'ia.orden': 'Dio una orden a la IA operadora',
  'ia.confirmar': 'Confirmo acciones de la IA operadora',
  'lista.poner': 'Puso numeros en la lista de envio automatico',
  'lista.quitar': 'Quito un numero de la lista de envio automatico',
  'lista.pausar': 'Pauso un numero de la lista de envio automatico',
  'lista.reanudar': 'Reanudo un numero de la lista de envio automatico',
  'lista.editar': 'Cambio un numero de la lista de envio automatico',
  'lista.ajustes': 'Cambio el ritmo del envio automatico',
  'ia.configurar': 'Cambio la configuracion del asistente IA',
  'dev.simular': 'Simulo un mensaje entrante (pruebas)',
  ficha: 'Cambio una ficha de preventa',
  'api.mensaje': 'Envio un mensaje por la API publica',
  'api.contacto': 'Creo o actualizo un contacto por la API publica',
  'webhook.crear': 'Registro un webhook',
  'webhook.cambiar': 'Cambio un webhook',
  'webhook.borrar': 'Borro un webhook',
  'webhook.secreto': 'Roto el secreto de un webhook',
  'webhook.reencolar': 'Reencolo las entregas fallidas de un webhook',
  'conector.crear': 'Creo un conector de tienda',
  'conector.cambiar': 'Cambio un conector de tienda',
  'conector.borrar': 'Borro un conector de tienda',
  'conector.secreto': 'Cambio el secreto de un conector',
  'pedido.estado': 'Cambio el estado de un pedido del chat',
  'tienda.alta': 'Dio de alta una tienda',
  'tienda.cambiar': 'Cambio una tienda (nombre, plan o datos)',
  'tienda.pago': 'Apunto un pago de una tienda',
  'tienda.suspender': 'Suspendio o reactivo una tienda',
  'tienda.token': 'Creo un token nuevo para una tienda',
  'tienda.borrar': 'Borro una tienda',
  'tienda.avisar': 'Le escribio por WhatsApp a una tienda',
  'tienda.cobro': 'Cambio como se cobra a las tiendas',
  'tienda.avisos': 'Cambio los avisos de vencimiento de las tiendas',
  'tienda.pago.aceptar': 'Acepto una captura de pago de una tienda',
  'tienda.pago.rechazar': 'Rechazo una captura de pago de una tienda',
  'proceso.crear': 'Creo un proceso',
  'proceso.editar': 'Cambio los pasos de un proceso',
  'proceso.estado': 'Activo, pauso o archivo un proceso',
  'proceso.borrar': 'Borro un proceso',
  'proceso.personas': 'Cargo personas en un proceso',
  'proceso.corrida': 'Pauso, reanudo o termino una corrida',
  'proceso.masa': 'Actuo sobre personas de un proceso (pedir, pausar, pasar a una persona)',
  otro: 'Otra accion',
};

// `actual` y `nueva` son los campos de /admin/mi-clave: sin ellos aqui, la
// bitacora guardaba las dos contraseñas en claro (visto el 2026-09-17).
const CAMPOS_SECRETOS = /clave|password|contrase|token|secret|appsecret|authorization|cookie|^actual$|^nueva$|^pin$/i;

/** Copia superficial del cuerpo sin secretos ni textos largos. */
export function detalleSeguro(body: unknown, params?: Record<string, string>): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  if (params) for (const [k, v] of Object.entries(params)) out[k] = v;
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (CAMPOS_SECRETOS.test(k)) continue;
      if (typeof v === 'string') out[k] = v.length > 120 ? v.slice(0, 117) + '...' : v;
      else if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v;
      else if (Array.isArray(v)) out[k] = `[${v.length}]`;
      else if (typeof v === 'object') out[k] = '{...}';
    }
  }
  return Object.keys(out).length ? out : null;
}

export function accionDe(method: string, ruta: string): string | null {
  if (IGNORAR.some((r) => r.test(ruta))) return null;
  for (const [m, r, accion] of ACCIONES) if (m === method && r.test(ruta)) return accion;
  return ruta.startsWith('/admin/') || ruta.startsWith('/api/') ? 'otro' : null;
}

/** Instala el hook que anota sola cada accion. */
export function instalarBitacora(app: FastifyInstance, repo: ActividadRepo, log?: (m: string, d?: Record<string, unknown>) => void): void {
  app.addHook('onResponse', async (request: FastifyRequest, reply) => {
    const method = request.method;
    if (method !== 'POST' && method !== 'DELETE' && method !== 'PUT' && method !== 'PATCH') return;
    const ruta = request.routeOptions?.url ?? request.url.split('?')[0] ?? '';
    const ok = reply.statusCode >= 200 && reply.statusCode < 300;
    let accion = accionDe(method, ruta);
    if (!accion) return;
    // Un login fallido si se apunta (es lo que se mira cuando alguien insiste).
    if (!ok) {
      if (accion === 'entrar' && reply.statusCode === 401) accion = 'entrar.fallido';
      else return;
    }
    const u = request.usuario;
    const body = request.body as Record<string, unknown> | undefined;
    const usuario = u ? u.nombre : typeof body?.usuario === 'string' ? String(body.usuario) : 'desconocido';
    try {
      await repo.anotar({
        usuarioId: u?.id ?? null,
        usuario,
        accion,
        detalle: detalleSeguro(body, request.params as Record<string, string>),
        ip: request.ip || null,
      });
    } catch (error) {
      log?.('no se pudo anotar en la bitacora', { detalle: error instanceof Error ? error.message : String(error) });
    }
  });
}

interface Row {
  id: number;
  at: Date;
  usuario_id: string | null;
  usuario: string;
  accion: string;
  detalle: Record<string, unknown> | null;
  ip: string | null;
}

export function createActividadRepo(pool: Pool): ActividadRepo {
  return {
    async anotar(e) {
      await pool.query('insert into actividad (at, usuario_id, usuario, accion, detalle, ip) values ($1,$2,$3,$4,$5,$6)', [
        e.at ?? new Date(),
        e.usuarioId,
        e.usuario,
        e.accion,
        e.detalle ? JSON.stringify(e.detalle) : null,
        e.ip,
      ]);
    },
    async listar(query) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (query.accion) {
        params.push(query.accion);
        where.push(`accion = $${params.length}`);
      }
      if (query.usuario) {
        params.push(`%${query.usuario.toLowerCase()}%`);
        where.push(`lower(usuario) like $${params.length}`);
      }
      const filtro = where.length ? `where ${where.join(' and ')}` : '';
      const { rows: total } = await pool.query<{ total: number }>(`select count(*)::int as total from actividad ${filtro}`, params);
      params.push(query.limit, query.offset);
      const { rows } = await pool.query<Row>(
        `select * from actividad ${filtro} order by at desc, id desc limit $${params.length - 1} offset $${params.length}`,
        params,
      );
      return {
        total: total[0]?.total ?? 0,
        items: rows.map((r) => ({
          id: Number(r.id),
          at: r.at,
          usuarioId: r.usuario_id,
          usuario: r.usuario,
          accion: r.accion,
          detalle: typeof r.detalle === 'string' ? (JSON.parse(r.detalle) as Record<string, unknown>) : r.detalle,
          ip: r.ip,
        })),
      };
    },
    async acciones() {
      const { rows } = await pool.query<{ accion: string }>('select distinct accion from actividad order by accion');
      return rows.map((r) => r.accion);
    },
  };
}
