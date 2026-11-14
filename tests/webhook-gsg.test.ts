import { describe, expect, it } from 'vitest';
import { createFakeWebhooks } from './fakes-webhooks.js';
import { DESCRIPCION_WEBHOOK_GSG, rotarSecretoWebhookGsg, sincronizarWebhookGsg } from '../src/entregas/webhook-gsg.js';

const DESTINO = 'https://gsg.example/api/v1/gsgchat/webhook';

describe('el webhook de GSG desde Conexión GSG', () => {
  it('sin ruta no crea nada; con ruta nace con su secreto (una vez) y apunta a base + ruta', async () => {
    const repo = createFakeWebhooks();
    expect(await sincronizarWebhookGsg(repo, null)).toEqual({ webhook: null, secreto: null, creado: false });
    expect(await repo.listar()).toHaveLength(0);

    const r = await sincronizarWebhookGsg(repo, DESTINO, 'u1');
    expect(r.creado).toBe(true);
    expect(r.secreto).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(r.webhook).toMatchObject({ url: DESTINO, activo: true });
    const guardado = await repo.listar();
    expect(guardado).toHaveLength(1);
    expect(guardado[0]).toMatchObject({ descripcion: DESCRIPCION_WEBHOOK_GSG, eventos: ['*'], creadoPor: 'u1' });
    expect(JSON.stringify(guardado)).not.toContain(r.secreto!);
    expect((await repo.conSecreto(guardado[0]!.id))?.secreto).toBe(r.secreto);
  });

  it('guardar otra vez la misma ruta no cambia el secreto; otra ruta cambia la URL y lo conserva', async () => {
    const repo = createFakeWebhooks();
    const primero = await sincronizarWebhookGsg(repo, DESTINO);
    const igual = await sincronizarWebhookGsg(repo, DESTINO);
    expect(igual).toMatchObject({ creado: false, secreto: null });
    const otra = await sincronizarWebhookGsg(repo, 'https://gsg.example/api/v2/hook');
    expect(otra).toMatchObject({ creado: false, secreto: null, webhook: { url: 'https://gsg.example/api/v2/hook' } });
    expect(await repo.listar()).toHaveLength(1);
    expect((await repo.conSecreto(primero.webhook!.id))?.secreto).toBe(primero.secreto);
  });

  it('vaciar la ruta lo apaga; volver a ponerla lo reactiva con el mismo secreto', async () => {
    const repo = createFakeWebhooks();
    const primero = await sincronizarWebhookGsg(repo, DESTINO);
    const apagado = await sincronizarWebhookGsg(repo, null);
    expect(apagado.webhook).toMatchObject({ activo: false });
    const otraVez = await sincronizarWebhookGsg(repo, DESTINO);
    expect(otraVez).toMatchObject({ creado: false, secreto: null, webhook: { activo: true } });
    expect((await repo.conSecreto(primero.webhook!.id))?.secreto).toBe(primero.secreto);
  });

  it('rotar da un secreto nuevo y distinto, y sin webhook devuelve null', async () => {
    const repo = createFakeWebhooks();
    expect(await rotarSecretoWebhookGsg(repo)).toBeNull();
    const primero = await sincronizarWebhookGsg(repo, DESTINO);
    const nuevo = await rotarSecretoWebhookGsg(repo);
    expect(nuevo).toMatch(/^whsec_[0-9a-f]{48}$/);
    expect(nuevo).not.toBe(primero.secreto);
    expect((await repo.conSecreto(primero.webhook!.id))?.secreto).toBe(nuevo);
  });
});
