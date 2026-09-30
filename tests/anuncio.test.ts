/**
 * El anuncio del que viene un cliente ("click to WhatsApp" de Facebook o
 * Instagram): por QR se lee del `externalAdReply` de Baileys, por Meta del
 * `referral`, y en los dos casos el mensaje guardado, el evento
 * `mensaje.recibido` y la API lo llevan con la misma forma (`anuncio`). Un
 * enlace pegado por el cliente no cuenta como anuncio.
 */

import { describe, expect, it } from 'vitest';
import { anuncioDe } from '../src/whatsapp/local/session.js';
import { anuncioDelMensaje, readInbound } from '../src/handlers/inbound.js';
import { crearBus } from '../src/eventos/bus.js';
import { observarRepos } from '../src/eventos/observar.js';
import { createFakeRepos } from './fakes.js';

const AD = {
  extendedTextMessage: {
    text: 'Hola, vi las zapatillas',
    contextInfo: {
      conversionSource: 'FB_Ads',
      externalAdReply: {
        title: 'Zapatillas urbanas desde S/ 89',
        body: 'Envío gratis en Lima',
        sourceType: 'ad',
        sourceId: '120212345678901234',
        sourceUrl: 'https://fb.me/ad/abc',
        thumbnailUrl: 'https://scontent.example/zapatilla.jpg',
        ctwaClid: 'ARAbcDef123',
        showAdAttribution: true,
      },
    },
  },
};

describe('leer el anuncio', () => {
  it('del externalAdReply de Baileys sale con id, titulo, texto, url, imagen y clid', () => {
    expect(anuncioDe(AD)).toEqual({
      id: '120212345678901234',
      titulo: 'Zapatillas urbanas desde S/ 89',
      texto: 'Envío gratis en Lima',
      url: 'https://fb.me/ad/abc',
      imagen: 'https://scontent.example/zapatilla.jpg',
      clid: 'ARAbcDef123',
      origen: 'ad',
    });
    // Tambien dentro de una foto.
    expect(anuncioDe({ imageMessage: { mimetype: 'image/jpeg', contextInfo: AD.extendedTextMessage.contextInfo } })?.clid).toBe('ARAbcDef123');
  });

  it('un enlace pegado por el cliente (sin id de anuncio ni clic) no es un anuncio; solo conversionSource si lo es', () => {
    expect(anuncioDe({ extendedTextMessage: { text: 'mira https://x.com', contextInfo: { externalAdReply: { title: 'X', body: 'un link', sourceUrl: 'https://x.com' } } } })).toBeNull();
    expect(anuncioDe({ conversation: 'hola' })).toBeNull();
    expect(anuncioDe({ extendedTextMessage: { text: 'hola', contextInfo: { conversionSource: 'FB_Ads' } } })).toEqual({ id: null, titulo: null, texto: null, url: null, imagen: null, clid: null, origen: 'fb_ads' });
  });

  it('el referral de Meta se traduce a la misma forma', () => {
    const a = anuncioDelMensaje({
      id: 'w', from: '51987654321', timestamp: '1', type: 'text', text: { body: 'hola' },
      referral: { source_url: 'https://fb.me/ad/xyz', source_id: '99', source_type: 'ad', headline: 'Oferta', body: 'Solo hoy', image_url: 'https://img/1.jpg', ctwa_clid: 'CLID1' },
    });
    expect(a).toEqual({ id: '99', titulo: 'Oferta', texto: 'Solo hoy', url: 'https://fb.me/ad/xyz', imagen: 'https://img/1.jpg', clid: 'CLID1', origen: 'ad' });
  });

  it('queda en el mensaje guardado y sale en el evento mensaje.recibido (y no en los mensajes normales)', async () => {
    const bus = crearBus();
    const eventos: Array<Record<string, unknown>> = [];
    bus.escuchar('mensaje.recibido', (p) => {
      eventos.push(p as unknown as Record<string, unknown>);
    });
    const repos = observarRepos(createFakeRepos(), bus);
    const c = await repos.contacts.upsertFromInbound('51987654321', 'Maria');

    const leido = readInbound({ id: 'w1', from: '51987654321', timestamp: '1', type: 'text', text: { body: 'Hola, vi las zapatillas' }, anuncio: anuncioDe(AD)! });
    expect(leido.payload).toMatchObject({ anuncio: { id: '120212345678901234', clid: 'ARAbcDef123' } });
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'w1', kind: leido.kind, body: leido.body, payload: leido.payload });
    await new Promise((r) => setTimeout(r, 0));
    expect((eventos[0]!.mensaje as { anuncio: unknown }).anuncio).toMatchObject({ titulo: 'Zapatillas urbanas desde S/ 89', url: 'https://fb.me/ad/abc', clid: 'ARAbcDef123' });

    const normal = readInbound({ id: 'w2', from: '51987654321', timestamp: '1', type: 'text', text: { body: 'gracias' } });
    expect(normal.payload).toBeNull();
    await repos.messages.add({ contactId: c.id, direction: 'in', wamid: 'w2', kind: normal.kind, body: normal.body, payload: normal.payload });
    await new Promise((r) => setTimeout(r, 0));
    expect((eventos[1]!.mensaje as { anuncio: unknown }).anuncio).toBeNull();
  });
});
