/**
 * Libro de Reclamaciones virtual (Codigo de Proteccion y Defensa del
 * Consumidor, Ley 29571, y su reglamento, D.S. 011-2011-PCM y modificatorias).
 *
 * Es de la PLATAFORMA, como las paginas legales: vive en la base del
 * directorio (`<raiz>_plataforma`) y lo atiende el superadministrador. Cada
 * hoja lleva un codigo correlativo por año (LR-2026-000001) y se responde en
 * el plazo legal (15 dias habiles).
 */

import { z } from 'zod';
import type { Pool } from '../db/pool.js';

export const ESQUEMA_RECLAMOS = `
create table if not exists pl_reclamos (
  id bigint unsigned not null auto_increment primary key,
  codigo varchar(32) null unique,
  tipo varchar(16) not null,
  nombre varchar(191) not null,
  documento_tipo varchar(16) not null,
  documento_numero varchar(32) not null,
  domicilio varchar(300) not null,
  telefono varchar(32) not null,
  correo varchar(191) not null,
  menor_de_edad tinyint(1) not null default 0,
  apoderado varchar(191) null,
  bien_tipo varchar(16) not null,
  monto varchar(32) null,
  bien_descripcion varchar(500) not null,
  detalle text not null,
  pedido text not null,
  estado varchar(16) not null default 'pendiente',
  respuesta text null,
  respondido_por varchar(191) null,
  respondido_at datetime(3) null,
  ip varchar(64) null,
  created_at datetime(3) not null default current_timestamp(3),
  key pl_reclamos_estado (estado, created_at)
) engine=InnoDB default charset=utf8mb4 collate=utf8mb4_unicode_ci
`;

/** Lo que manda el formulario publico. */
export const reclamoSchema = z.object({
  tipo: z.enum(['reclamo', 'queja'], { message: 'Elige si es un reclamo o una queja.' }),
  nombre: z.string().trim().min(3, 'Escribe tu nombre completo.').max(191, 'El nombre es demasiado largo.'),
  documentoTipo: z.enum(['DNI', 'CE', 'PASAPORTE', 'RUC'], { message: 'Elige el tipo de documento.' }),
  documentoNumero: z.string().trim().min(6, 'Escribe el número de tu documento.').max(32).regex(/^[A-Za-z0-9-]+$/, 'El número de documento solo lleva letras y números.'),
  domicilio: z.string().trim().min(5, 'Escribe tu domicilio.').max(300),
  telefono: z.string().trim().min(6, 'Escribe tu teléfono.').max(32).regex(/^[\d +()-]+$/, 'El teléfono solo lleva números.'),
  correo: z.string().trim().email('Escribe un correo válido: ahí te enviaremos la respuesta.').max(191),
  menorDeEdad: z.boolean().optional().default(false),
  apoderado: z.string().trim().max(191).optional().nullable(),
  bienTipo: z.enum(['producto', 'servicio'], { message: 'Elige si es un producto o un servicio.' }),
  monto: z.string().trim().max(32).optional().nullable(),
  bienDescripcion: z.string().trim().min(3, 'Describe el producto o servicio.').max(500),
  detalle: z.string().trim().min(10, 'Cuéntanos qué pasó (al menos 10 letras).').max(5000),
  pedido: z.string().trim().min(3, 'Escribe qué solicitas.').max(3000),
  acepta: z.boolean().refine((v) => v === true, { message: 'Marca la casilla para confirmar que los datos son ciertos.' }),
}).refine((d) => !d.menorDeEdad || (d.apoderado ?? '').trim().length >= 3, {
  message: 'Si eres menor de edad, escribe el nombre de tu padre, madre o apoderado.',
  path: ['apoderado'],
});

export type DatosReclamo = z.infer<typeof reclamoSchema>;

export interface Reclamo {
  id: number;
  codigo: string;
  tipo: 'reclamo' | 'queja';
  nombre: string;
  documentoTipo: string;
  documentoNumero: string;
  domicilio: string;
  telefono: string;
  correo: string;
  menorDeEdad: boolean;
  apoderado: string | null;
  bienTipo: 'producto' | 'servicio';
  monto: string | null;
  bienDescripcion: string;
  detalle: string;
  pedido: string;
  estado: 'pendiente' | 'respondido';
  respuesta: string | null;
  respondidoPor: string | null;
  respondidoAt: Date | null;
  createdAt: Date;
}

export interface LibroReclamaciones {
  registrar(datos: DatosReclamo, ip: string | null): Promise<Reclamo>;
  listar(estado?: 'pendiente' | 'respondido'): Promise<Reclamo[]>;
  porCodigo(codigo: string): Promise<Reclamo | null>;
  responder(codigo: string, respuesta: string, por: string): Promise<Reclamo | null>;
  pendientes(): Promise<number>;
}

/** Plazo legal para responder: 15 dias habiles (lunes a viernes) desde el registro. */
export function venceEl(desde: Date, diasHabiles = 15): Date {
  const d = new Date(desde.getTime());
  let quedan = diasHabiles;
  while (quedan > 0) {
    d.setDate(d.getDate() + 1);
    const dia = d.getDay();
    if (dia !== 0 && dia !== 6) quedan--;
  }
  return d;
}

export const codigoDe = (id: number, fecha: Date): string => `LR-${fecha.getFullYear()}-${String(id).padStart(6, '0')}`;

type Fila = {
  id: number | string; codigo: string; tipo: Reclamo['tipo']; nombre: string; documento_tipo: string; documento_numero: string;
  domicilio: string; telefono: string; correo: string; menor_de_edad: number | boolean; apoderado: string | null;
  bien_tipo: Reclamo['bienTipo']; monto: string | null; bien_descripcion: string; detalle: string; pedido: string;
  estado: Reclamo['estado']; respuesta: string | null; respondido_por: string | null; respondido_at: Date | string | null; created_at: Date | string;
};

const fecha = (v: Date | string | null): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v));

const deFila = (f: Fila): Reclamo => ({
  id: Number(f.id),
  codigo: f.codigo,
  tipo: f.tipo,
  nombre: f.nombre,
  documentoTipo: f.documento_tipo,
  documentoNumero: f.documento_numero,
  domicilio: f.domicilio,
  telefono: f.telefono,
  correo: f.correo,
  menorDeEdad: Boolean(f.menor_de_edad),
  apoderado: f.apoderado,
  bienTipo: f.bien_tipo,
  monto: f.monto,
  bienDescripcion: f.bien_descripcion,
  detalle: f.detalle,
  pedido: f.pedido,
  estado: f.estado,
  respuesta: f.respuesta,
  respondidoPor: f.respondido_por,
  respondidoAt: fecha(f.respondido_at),
  createdAt: fecha(f.created_at)!,
});

export async function crearLibroReclamaciones(pool: Pool): Promise<LibroReclamaciones> {
  await pool.query(ESQUEMA_RECLAMOS);
  const q = async (sql: string, params: unknown[] = []): Promise<Fila[]> => (await pool.query(sql, params)).rows as Fila[];
  const porCodigo = async (codigo: string) => {
    const [f] = await q('select * from pl_reclamos where codigo = $1', [codigo]);
    return f ? deFila(f) : null;
  };

  return {
    async registrar(d, ip) {
      const r = await pool.query(
        `insert into pl_reclamos (tipo, nombre, documento_tipo, documento_numero, domicilio, telefono, correo, menor_de_edad, apoderado,
           bien_tipo, monto, bien_descripcion, detalle, pedido, ip)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [d.tipo, d.nombre, d.documentoTipo, d.documentoNumero.toUpperCase(), d.domicilio, d.telefono, d.correo.toLowerCase(), d.menorDeEdad ? 1 : 0,
          d.menorDeEdad ? (d.apoderado ?? null) : null, d.bienTipo, d.monto || null, d.bienDescripcion, d.detalle, d.pedido, ip],
      );
      const id = r.insertId;
      const [f] = await q('select * from pl_reclamos where id = $1', [id]);
      const codigo = codigoDe(id, fecha(f!.created_at)!);
      await pool.query('update pl_reclamos set codigo = $1 where id = $2', [codigo, id]);
      return deFila({ ...f!, codigo });
    },
    async listar(estado) {
      const filas = estado
        ? await q('select * from pl_reclamos where estado = $1 order by created_at desc limit 500', [estado])
        : await q('select * from pl_reclamos order by (estado = \'pendiente\') desc, created_at desc limit 500');
      return filas.map(deFila);
    },
    porCodigo,
    async responder(codigo, respuesta, por) {
      await pool.query(
        "update pl_reclamos set estado = 'respondido', respuesta = $1, respondido_por = $2, respondido_at = current_timestamp(3) where codigo = $3",
        [respuesta, por, codigo],
      );
      return porCodigo(codigo);
    },
    async pendientes() {
      const r = await pool.query("select count(*) as n from pl_reclamos where estado = 'pendiente'");
      return Number((r.rows[0] as { n?: number | string } | undefined)?.n ?? 0);
    },
  };
}
