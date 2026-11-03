/**
 * Un entrante se guarda con la linea por la que llego, en el mismo hilo del
 * cliente, y la misma id de mensaje en dos lineas no se confunde.
 */

import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baseDePrueba, type BaseDePrueba } from './mysql.js';
import { crearServicioLineas, ID_LINEA_PRINCIPAL, type ServicioLineas } from '../src/whatsapp/lineas.js';
import { lineaDelAviso } from '../src/whatsapp/webhook.js';
import { claveEntrada } from '../src/handlers/inbound.js';
import { createRepos } from '../src/db/repos.js';

let b: BaseDePrueba;
let lineas: ServicioLineas;

beforeAll(async () => {
  b = await baseDePrueba();
  lineas = crearServicioLineas(b.pool, randomBytes(32), 'prueba_entrada');
});
afterAll(async () => {
  await b?.cerrar();
});

describe('entrada por linea', () => {
  it('resuelve la linea por phone_number_id de Meta, por id directo, y cae en la principal', async () => {
    const meta = await lineas.crear({ etiqueta: 'Oficial', proveedor: 'cloud', telefono: '51911111111', credenciales: { token: 't', phoneNumberId: 'PN1', businessAccountId: 'B' } });
    expect((await lineaDelAviso({ metadata: { phone_number_id: 'PN1' } }, lineas))).toEqual({ id: meta.id, etiqueta: 'Oficial', numero: '51911111111' });
    expect((await lineaDelAviso({ lineaId: meta.id }, lineas))?.id).toBe(meta.id);
    expect((await lineaDelAviso({ metadata: { phone_number_id: 'desconocido' } }, lineas))?.id).toBe(ID_LINEA_PRINCIPAL);
    expect(await lineaDelAviso({}, undefined)).toBeUndefined();
  });

  it('la clave de deduplicacion separa lineas y conserva la de la principal', () => {
    const base = { id: 'ABC', from: '519', timestamp: '1', type: 'text' };
    expect(claveEntrada(base)).toBe('ABC');
    expect(claveEntrada({ ...base, linea: { id: ID_LINEA_PRINCIPAL, etiqueta: 'P', numero: '' } })).toBe('ABC');
    expect(claveEntrada({ ...base, linea: { id: 'aaaaaaaa-1', etiqueta: 'X', numero: '' } })).toBe('aaaaaaaa:ABC');
  });

  it('el mensaje guarda la linea y la etiqueta de ese momento', async () => {
    const repos = createRepos(b.pool);
    const contacto = await repos.contacts.upsertFromInbound('51900000001', 'Cliente');
    const id = await repos.messages.add({ contactId: contacto.id, direction: 'in', wamid: 'W1', kind: 'text', body: 'hola', lineaId: ID_LINEA_PRINCIPAL, lineaEtiqueta: 'Principal', lineaNumero: '51922222222' });
    const { rows } = await b.pool.query<{ whatsapp_number_id: string; linea_etiqueta: string; linea_numero: string }>('select whatsapp_number_id, linea_etiqueta, linea_numero from messages where id = $1', [id]);
    expect(rows[0]).toEqual({ whatsapp_number_id: ID_LINEA_PRINCIPAL, linea_etiqueta: 'Principal', linea_numero: '51922222222' });
  });
});
