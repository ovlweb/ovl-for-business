import { verifyWebhookSignature } from '@ovl/sdk';
import type { FastifyInstance } from 'fastify';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertPublicUrl, deliverWebhooks, signPayload } from '../src/lib/webhooks';
import { issueRegistryEntry } from '../src/modules/registry';
import { client, createTestApp, type Session } from './helpers';

interface Received {
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let dev: Session;
let other: Session;
let server: Server;
let url: string;
let answer = 200;
const received: Received[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = answer;
      res.end('ok');
    });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  app = await createTestApp();
  api = client(app);
  owner = await api.owner();
  dev = await api.register('dev');
  other = await api.register('other');
});
afterAll(async () => {
  await app.close();
  await new Promise((done) => server.close(done));
});

let webhook: { id: string; secret: string };
const last = () => received.at(-1)!;
const parsed = () => JSON.parse(last().body) as { id: string; type: string; data: Record<string, unknown> };

describe('webhooks', () => {
  it('private addresses and plain http are refused outside development', async () => {
    await expect(assertPublicUrl('http://example.com/hook', false)).rejects.toThrow('https');
    await expect(assertPublicUrl('https://127.0.0.1/hook', false)).rejects.toThrow('private');
    await expect(assertPublicUrl('https://10.1.2.3/hook', false)).rejects.toThrow('private');
    await expect(assertPublicUrl('https://[::1]/hook', false)).rejects.toThrow('private');
    await expect(assertPublicUrl('https://169.254.169.254/latest', false)).rejects.toThrow('private');
    await expect(assertPublicUrl('https://93.184.216.34/hook', false)).resolves.toBeUndefined();
  });

  it('developers register endpoints and get the signing secret once', async () => {
    const created = await api.post('/webhooks', dev, {
      url,
      events: ['registry.created', 'registry.updated'],
      description: 'Registry mirror',
    });
    expect(created.status).toBe(201);
    expect(created.body.secret).toMatch(/^whsec_/);
    webhook = created.body;
    const list = await api.get('/webhooks', dev);
    expect(list.body).toEqual([
      expect.objectContaining({ id: webhook.id, url, active: true, events: ['registry.created', 'registry.updated'] }),
    ]);
    expect(list.body[0].secret).toBeUndefined();
    expect((await api.get('/webhooks', other)).body).toEqual([]);
    expect((await api.patch(`/webhooks/${webhook.id}`, other, { active: false })).status).toBe(404);
    expect((await api.post('/webhooks', dev, { url: 'ftp://example.com', events: ['registry.created'] })).status).toBe(
      400,
    );
  });

  it('the test button sends a signed ping', async () => {
    const res = await api.post(`/webhooks/${webhook.id}/test`, dev);
    expect(res.body).toMatchObject({ event: 'ping', status: 'delivered', attempts: 1, responseStatus: 200 });
    const got = last();
    expect(got.headers['x-ovl-event']).toBe('ping');
    expect(got.headers['x-ovl-delivery']).toBe(res.body.id);
    const signature = String(got.headers['x-ovl-signature']);
    const t = Number(signature.match(/^t=(\d+),/)![1]);
    expect(signature).toBe(signPayload(webhook.secret, t, got.body));
    expect(Math.abs(t - Date.now() / 1000)).toBeLessThan(60);
    // What consumers do with the SDK.
    expect(await verifyWebhookSignature(webhook.secret, signature, got.body)).toBe(true);
    expect(await verifyWebhookSignature(webhook.secret, signature, got.body.replace('Hello', 'Hullo'))).toBe(false);
    expect(await verifyWebhookSignature('whsec_wrong', signature, got.body)).toBe(false);
    expect(await verifyWebhookSignature(webhook.secret, signature, got.body, -1)).toBe(false);
  });

  it('registry changes are delivered to subscribers', async () => {
    const entry = await issueRegistryEntry(app.db, {
      kind: 'license',
      licenseType: 'game',
      title: 'Dev Game',
      description: 'A game',
      holder: { type: 'user', id: dev.id },
    });
    expect(await deliverWebhooks(app)).toBe(1);
    expect(parsed()).toMatchObject({ type: 'registry.created', data: { id: entry.id, number: entry.number } });
    expect(last().headers['x-ovl-event']).toBe('registry.created');

    await api.patch(`/admin/registry/${entry.id}`, owner, { status: 'suspended' });
    expect(await deliverWebhooks(app)).toBe(1);
    expect(parsed()).toMatchObject({ type: 'registry.updated', data: { id: entry.id, status: 'suspended' } });
    expect(await deliverWebhooks(app)).toBe(0);
  });

  it('failed deliveries retry with backoff and can be sent again', async () => {
    answer = 500;
    const entry = await issueRegistryEntry(app.db, {
      kind: 'license',
      licenseType: 'game',
      title: 'Dev Game 2',
      description: 'A game',
      holder: { type: 'user', id: dev.id },
    });
    expect(await deliverWebhooks(app)).toBe(0);
    const [failed] = (await api.get(`/webhooks/${webhook.id}/deliveries`, dev)).body;
    expect(failed).toMatchObject({ event: 'registry.created', status: 'pending', attempts: 1, responseStatus: 500, error: 'HTTP 500' });
    const retryIn = new Date(failed.nextAttemptAt).getTime() - Date.now();
    expect(retryIn).toBeGreaterThan(50_000);
    expect(retryIn).toBeLessThan(70_000);
    expect((await api.get('/webhooks', dev)).body[0].failures).toBe(1);
    expect(await deliverWebhooks(app)).toBe(0); // not due yet

    answer = 200;
    const again = await api.post(`/webhooks/${webhook.id}/deliveries/${failed.id}/redeliver`, dev);
    expect(again.body).toMatchObject({ status: 'delivered', responseStatus: 200 });
    expect(parsed()).toMatchObject({ type: 'registry.created', data: { id: entry.id } });
    expect((await api.get('/webhooks', dev)).body[0]).toMatchObject({ failures: 0 });
  });

  it('secrets rotate; switched-off and deleted endpoints get nothing', async () => {
    const rotated = await api.post(`/webhooks/${webhook.id}/rotate-secret`, dev);
    expect(rotated.body.secret).not.toBe(webhook.secret);
    await api.post(`/webhooks/${webhook.id}/test`, dev);
    const signature = String(last().headers['x-ovl-signature']);
    const t = Number(signature.match(/^t=(\d+),/)![1]);
    expect(signature).toBe(signPayload(rotated.body.secret, t, last().body));

    await api.patch(`/webhooks/${webhook.id}`, dev, { active: false });
    const count = received.length;
    await issueRegistryEntry(app.db, {
      kind: 'license',
      licenseType: 'game',
      title: 'Dev Game 3',
      description: 'A game',
      holder: { type: 'user', id: dev.id },
    });
    expect(await deliverWebhooks(app)).toBe(0);
    expect(received.length).toBe(count);
    expect((await api.del(`/webhooks/${webhook.id}`, dev)).status).toBe(204);
    expect((await api.get('/webhooks', dev)).body).toEqual([]);
  });
});
