/**
 * La API de GSG, de mentira, para probar la conexion antes de que exista.
 *
 * Es un servidor aparte (otro proceso, otro puerto, su propio token), como
 * sera la API real. Por eso en GSGchat se conecta en modo «API real» con
 * direccion + token, NO como el simulador interno: lo que funciona contra
 * esto es el mismo codigo que correra el dia que GSG publique su API.
 *
 * Por ahora solo hace una cosa, la que pide el dueño: dar la lista del dia
 * con dos grupos (docs/CONTRATO-GSG.md, A.1). Cada cliente va con su
 * WhatsApp (`telefono`) y su codigo de tracking (`tracking`): esas dos cosas
 * lo identifican.
 *
 *   GET /reparto/pendientes   (Authorization: Bearer <token>)
 *   -> { dia, faltaUbicacion: [...], faltaConfirmacion: [...], terminados: [] }
 *
 *   faltaUbicacion     a quien hay que pedirle el pin por WhatsApp.
 *   faltaConfirmacion  GSG ya tiene su direccion: solo se le pregunta SI/NO.
 *
 * Lo que GSGchat le reporta despues (POST /ubicaciones, /confirmaciones...)
 * se contesta 200 y se anota, sin logica: para que nada quede como fallo.
 *
 * A mano:
 *   npx tsx scripts/gsg-falso.ts                       puerto 3500, token gsg-falso-token
 *   npx tsx scripts/gsg-falso.ts --puerto 3501 --token otro --lista mi-lista.json
 *
 * `--lista` es un JSON con la misma forma que la respuesta
 * ({ faltaUbicacion: [...], faltaConfirmacion: [...] }); sin el, sale la
 * lista de ejemplo con numeros de prueba (51 000 0xx xxx), que GSGchat nunca
 * manda por WhatsApp.
 */

import http from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';

export interface PedidoGsg {
  /** El WhatsApp del cliente: con el tracking, identifica el pedido. */
  telefono: string;
  /** El codigo de tracking de GSG: la llave del pedido. */
  tracking: string;
  /** Opcional: si GSG tiene un numero de pedido aparte. Sin el, manda el tracking. */
  referencia?: string;
  nombre?: string;
  direccion?: string;
  distrito?: string;
  notas?: string;
  lat?: number;
  lng?: number;
  [campo: string]: unknown;
}

export interface ListaDelDia {
  dia?: string;
  faltaUbicacion: PedidoGsg[];
  faltaConfirmacion: PedidoGsg[];
}

export interface Llamada {
  metodo: string;
  ruta: string;
  autorizacion: string | undefined;
  cuerpo: unknown;
  status: number;
}

export interface GsgFalso {
  url: string;
  token: string;
  /** Lo que devuelve GET /reparto/pendientes. Se puede cambiar en caliente. */
  lista: ListaDelDia;
  /** ok = contesta; caido = 503 a todo (para ver que GSGchat lo dice y no pierde nada). */
  modo: 'ok' | 'caido';
  llamadas: Llamada[];
  cerrar(): Promise<void>;
}

/**
 * Lista de ejemplo. Cada pedido se identifica por su WhatsApp + su codigo de
 * tracking. Numeros de prueba (51 000 0xx xxx): nunca salen por WhatsApp.
 */
export const LISTA_DE_EJEMPLO: ListaDelDia = {
  faltaUbicacion: [
    { tracking: 'GSG-A-1001', telefono: '51000000101', nombre: 'Ana Quispe', direccion: 'Av. La Marina 1234', distrito: 'San Miguel' },
    { tracking: 'GSG-A-1002', telefono: '51000000102', nombre: 'Bruno Salas', direccion: 'Jr. Huallaga 320', distrito: 'Cercado de Lima' },
  ],
  faltaConfirmacion: [
    { tracking: 'GSG-A-2001', telefono: '51000000201', nombre: 'Carla Rojas', direccion: 'Av. Arequipa 2450', distrito: 'Lince' },
    { tracking: 'GSG-A-2002', telefono: '51000000202', nombre: 'Diego Paz', direccion: 'Calle Las Begonias 415', distrito: 'San Isidro' },
  ],
};

export async function crearGsgFalso(opts: { puerto?: number; host?: string; token?: string; lista?: ListaDelDia } = {}): Promise<GsgFalso> {
  const llamadas: Llamada[] = [];
  const falso = {
    url: '',
    token: opts.token ?? 'gsg-falso-token',
    lista: opts.lista ?? structuredClone(LISTA_DE_EJEMPLO),
    modo: 'ok' as 'ok' | 'caido',
    llamadas,
  } as GsgFalso;

  const server = http.createServer((req, res) => {
    let datos = '';
    req.on('data', (c) => (datos += c));
    req.on('end', () => {
      const ruta = (req.url ?? '/').split('?')[0]!.replace(/\/+$/, '') || '/';
      let cuerpo: unknown = null;
      try {
        cuerpo = datos ? JSON.parse(datos) : null;
      } catch {
        cuerpo = datos;
      }
      const responder = (status: number, json: unknown) => {
        llamadas.push({ metodo: req.method ?? '', ruta, autorizacion: req.headers.authorization, cuerpo, status });
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(json));
      };

      if (req.headers.authorization !== `Bearer ${falso.token}`) return responder(401, { error: 'token invalido' });
      if (falso.modo === 'caido') return responder(503, { error: 'GSG en mantenimiento' });

      if (req.method === 'GET' && ruta === '/reparto/pendientes') {
        return responder(200, {
          // Sin `dia`, GSGchat entiende «hoy» con su propio reloj (contrato A.1).
          ...(falso.lista.dia ? { dia: falso.lista.dia } : {}),
          faltaUbicacion: falso.lista.faltaUbicacion,
          faltaConfirmacion: falso.lista.faltaConfirmacion,
          terminados: [],
        });
      }
      // Lo que GSGchat reporta despues: se acepta y se anota, sin mas.
      if (req.method === 'POST') return responder(200, { id: `gsg-falso-${llamadas.length + 1}` });
      return responder(404, { error: `No existe ${req.method} ${ruta}` });
    });
  });

  await new Promise<void>((r) => server.listen(opts.puerto ?? 0, opts.host ?? '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  falso.url = `http://${opts.host ?? '127.0.0.1'}:${port}`;
  falso.cerrar = () => new Promise<void>((r) => server.close(() => r()));
  return falso;
}

// ------------------------------------------------------------ desde la consola

const esPrincipal = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (esPrincipal) {
  const arg = (nombre: string): string | undefined => {
    const i = process.argv.indexOf(`--${nombre}`);
    return i > -1 ? process.argv[i + 1] : undefined;
  };
  const lista = arg('lista') ? (JSON.parse(readFileSync(arg('lista')!, 'utf8')) as ListaDelDia) : undefined;
  const falso = await crearGsgFalso({ puerto: Number(arg('puerto') ?? 3500), token: arg('token'), lista });
  const l = falso.lista;
  console.log(`
  API de GSG falsa escuchando en ${falso.url}
  Token: ${falso.token}

  En GSGchat: Entregas del día → Conexión con GSG → API real
    Dirección: ${falso.url}
    Token:     ${falso.token}
  y luego «Sincronizar ahora».

  Lista del día: ${l.faltaUbicacion.length} para pedir ubicación · ${l.faltaConfirmacion.length} para confirmar
`);
  const cantar = setInterval(() => {
    while (falso.llamadas.length) {
      const c = falso.llamadas.shift()!;
      console.log(`  ${new Date().toLocaleTimeString('es-PE')}  ${c.metodo} ${c.ruta} → ${c.status}`);
    }
  }, 500);
  process.on('SIGINT', async () => {
    clearInterval(cantar);
    await falso.cerrar();
    process.exit(0);
  });
}
