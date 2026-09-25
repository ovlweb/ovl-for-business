import type { FastifyInstance } from 'fastify';
import ece from 'http_ece';
import { createECDH, generateKeyPairSync, randomBytes, verify } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { createServer as createH2Server, type Http2Server } from 'node:http2';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let ann: Session;
let bob: Session;

/** A local push endpoint that records what it receives and answers with `status`. */
interface Received {
  path: string;
  headers: IncomingMessage['headers'];
  body: Buffer;
}
let endpoint: Server;
let received: Received[] = [];
let status = 201;
let base = '';

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });

const wallet = async (s: Session, currency = 'USD') =>
  (await api.get('/wallets', s)).body.find((w: { currency: string }) => w.currency === currency) as {
    id: string;
  };
const inbox = async (s: Session) => (await api.get('/notifications', s)).body;

/** A browser's push subscription: its keys, so the test can read the encrypted pushes. */
function browserKeys() {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    ecdh,
    auth,
    keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') },
  };
}

beforeAll(async () => {
  endpoint = createServer(async (req, res) => {
    received.push({ path: req.url ?? '', headers: req.headers, body: await readBody(req) });
    res.statusCode = status;
    res.end();
  });
  await new Promise<void>((resolve) => endpoint.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(endpoint.address() as AddressInfo).port}`;

  app = await createTestApp();
  api = client(app);
  ann = await api.register('ann');
  bob = await api.register('bob');
  await api.deposit(ann, 'USD', '100.00');
});
afterAll(async () => {
  await app.close();
  endpoint.close();
});

describe('notification center', () => {
  it('collects what happened, with read state', async () => {
    const res = await api.post('/wallets/transfer', ann, {
      fromWalletId: (await wallet(ann)).id,
      to: { type: 'user', username: 'bob' },
      amount: '12.50',
      note: 'Lunch',
    });
    expect(res.status).toBe(200);
    await app.push.flush();
    const page = await inbox(bob);
    expect(page.unreadCount).toBe(1);
    expect(page.items[0]).toMatchObject({
      type: 'money',
      title: 'Money received: 12.50 USD',
      link: '/wallet',
      read: false,
    });
    // The sender hears nothing about their own payment.
    expect((await inbox(ann)).items).toEqual([]);

    const read = await api.post('/notifications/read', bob, { ids: [page.items[0].id] });
    expect(read.body.unreadCount).toBe(0);
    expect((await api.post('/notifications/read', bob, { ids: [] })).body.unreadCount).toBe(0);
    expect((await api.del(`/notifications/${page.items[0].id}`, ann)).status).toBe(404);
    expect((await api.del(`/notifications/${page.items[0].id}`, bob)).status).toBe(204);
    expect((await inbox(bob)).items).toEqual([]);
  });

  it('tells people about mentions, replies and comments', async () => {
    const direct = (await api.post('/chats/direct', ann, { userId: bob.id })).body.id;
    const first = await api.post(`/chats/${direct}/messages`, bob, { body: 'Can you check the report?' });
    await api.post(`/chats/${direct}/messages`, ann, { body: 'Sure', replyToId: first.body.id });
    await api.post(`/contacts`, ann, { username: 'bob' });
    const group = (await api.post('/chats/groups', ann, { title: 'Team', memberIds: [bob.id] })).body.id;
    await api.post(`/chats/${group}/messages`, ann, { body: 'Ready for the demo @bob?' });
    await app.push.flush();
    const items = (await inbox(bob)).items;
    expect(items.map((n: { type: string; title: string }) => [n.type, n.title])).toEqual([
      ['mention', 'Ann mentioned you in Team'],
      ['reply', 'Ann replied to you'],
    ]);
    expect(items[0].link).toMatch(new RegExp(`^/chats/${group}\\?message=\\d+$`));
    await api.post('/notifications/read', bob, {});
    expect((await inbox(bob)).unreadCount).toBe(0);
  });
});

describe('web push', () => {
  it('encrypts pushes for the browser and forgets unsubscribed ones', async () => {
    const config = await api.get('/push/config', null);
    expect(config.body).toMatchObject({ fcm: false, apns: false });
    expect(config.body.webPushKey).toMatch(/^[\w-]{80,}$/);
    // The key pair is kept, so the same key comes back.
    expect((await api.get('/push/config', null)).body.webPushKey).toBe(config.body.webPushKey);

    const browser = browserKeys();
    const device = await api.post('/me/push-subscriptions', bob, {
      kind: 'webpush',
      endpoint: `${base}/push/bob-1`,
      keys: browser.keys,
      label: 'Firefox on Linux',
    });
    expect(device.status).toBe(200);
    expect(device.body).toMatchObject({ kind: 'webpush', label: 'Firefox on Linux', lastUsedAt: null });
    expect(
      (await api.post('/me/push-subscriptions', bob, { kind: 'fcm', token: 'x'.repeat(40) })).status,
    ).toBe(400);

    received = [];
    await api.post('/wallets/transfer', ann, {
      fromWalletId: (await wallet(ann)).id,
      to: { type: 'user', username: 'bob' },
      amount: '5.00',
    });
    await app.push.flush();
    const direct = (await api.post('/chats/direct', ann, { userId: bob.id })).body.id;
    await api.post(`/chats/${direct}/messages`, ann, { body: 'Sent you five' });
    await app.push.flush();

    expect(received.map((r) => r.path)).toEqual(['/push/bob-1', '/push/bob-1']);
    const push = received[0]!;
    expect(push.headers['content-encoding']).toBe('aes128gcm');
    expect(push.headers.authorization).toMatch(new RegExp(`^vapid t=.+, k=${config.body.webPushKey}$`));
    const open = (r: Received) =>
      JSON.parse(
        ece
          .decrypt(r.body, { version: 'aes128gcm', privateKey: browser.ecdh, authSecret: browser.auth })
          .toString(),
      );
    expect(open(push)).toMatchObject({ title: 'Money received: 5.00 USD', link: '/wallet', tag: 'money' });
    expect(open(received[1]!)).toMatchObject({ title: 'Ann', body: 'Sent you five', tag: `chat-${direct}` });
    expect((await api.get('/me/push-subscriptions', bob)).body[0].lastUsedAt).not.toBeNull();

    // Chats stay quiet for people who turned chat pushes off.
    received = [];
    await api.patch('/me/preferences', bob, { pushChats: false });
    await api.post(`/chats/${direct}/messages`, ann, { body: 'Still there?' });
    await app.push.flush();
    expect(received).toEqual([]);

    // The browser unsubscribed: the push service answers 410 and the device is forgotten.
    status = 410;
    const test = await api.post('/me/push-subscriptions/test', bob);
    expect(test.body).toEqual({ devices: 1, delivered: 0 });
    expect((await api.get('/me/push-subscriptions', bob)).body).toEqual([]);
    status = 201;
  });
});

describe('FCM and APNs', () => {
  it('sends through Firebase with a service account', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const account = {
      project_id: 'ovl-demo',
      client_email: 'push@ovl-demo.iam.gserviceaccount.com',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: `${base}/token`,
    };
    const calls: { path: string; auth?: string; body: string }[] = [];
    let reply: { status: number; body: unknown } = {
      status: 200,
      body: { name: 'projects/ovl-demo/messages/1' },
    };
    const google = createServer(async (req, res) => {
      const body = (await readBody(req)).toString();
      calls.push({ path: req.url ?? '', auth: req.headers.authorization, body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/token') {
        const assertion = new URLSearchParams(body).get('assertion')!;
        const [h, p, sig] = assertion.split('.');
        const ok = verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(sig!, 'base64url'));
        res.statusCode = ok ? 200 : 401;
        return res.end(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }));
      }
      res.statusCode = reply.status;
      res.end(JSON.stringify(reply.body));
    });
    await new Promise<void>((resolve) => google.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
    account.token_uri = `${url}/token`;
    const fcmApp = await createTestApp({ FCM_SERVICE_ACCOUNT: JSON.stringify(account), FCM_API_URL: url });
    try {
      const fcmApi = client(fcmApp);
      const cat = await fcmApi.register('cat');
      expect((await fcmApi.get('/push/config', null)).body).toMatchObject({ fcm: true });
      const token = `fcm-${'a'.repeat(40)}`;
      await fcmApi.post('/me/push-subscriptions', cat, { kind: 'fcm', token, label: 'Pixel' });
      expect((await fcmApi.post('/me/push-subscriptions/test', cat)).body).toEqual({
        devices: 1,
        delivered: 1,
      });
      const send = calls.find((c) => c.path === '/v1/projects/ovl-demo/messages:send')!;
      expect(send.auth).toBe('Bearer ya29.test');
      expect(JSON.parse(send.body).message).toMatchObject({
        token,
        notification: { title: 'Notifications work' },
        data: { link: '/settings' },
      });

      reply = {
        status: 404,
        body: { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } },
      };
      expect((await fcmApi.post('/me/push-subscriptions/test', cat)).body).toEqual({
        devices: 1,
        delivered: 0,
      });
      expect((await fcmApi.get('/me/push-subscriptions', cat)).body).toEqual([]);
      // One sign-in serves many pushes.
      expect(calls.filter((c) => c.path === '/token')).toHaveLength(1);
    } finally {
      await fcmApp.close();
      google.close();
    }
  });

  it('sends to Apple devices over HTTP/2 with a provider token', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const seen: { path: string; auth: string; topic: string; body: string }[] = [];
    let answer = 200;
    const apple: Http2Server = createH2Server();
    apple.on('stream', (stream, headers) => {
      let body = '';
      stream.setEncoding('utf8');
      stream.on('data', (c: string) => (body += c));
      stream.on('end', () => {
        seen.push({
          path: String(headers[':path']),
          auth: String(headers.authorization),
          topic: String(headers['apns-topic']),
          body,
        });
        stream.respond({ ':status': answer });
        stream.end(answer === 200 ? '' : JSON.stringify({ reason: 'Unregistered' }));
      });
    });
    await new Promise<void>((resolve) => apple.listen(0, '127.0.0.1', resolve));
    const apnsApp = await createTestApp({
      APNS_KEY: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      APNS_KEY_ID: 'KEY123',
      APNS_TEAM_ID: 'TEAM456',
      APNS_TOPIC: 'business.ovl.app',
      APNS_HOST: `http://127.0.0.1:${(apple.address() as AddressInfo).port}`,
    });
    try {
      const apnsApi = client(apnsApp);
      const dan = await apnsApi.register('dan');
      const token = 'ab'.repeat(32);
      await apnsApi.post('/me/push-subscriptions', dan, { kind: 'apns', token, label: 'iPhone' });
      expect((await apnsApi.post('/me/push-subscriptions/test', dan)).body).toEqual({
        devices: 1,
        delivered: 1,
      });
      const push = seen[0]!;
      expect(push).toMatchObject({ path: `/3/device/${token}`, topic: 'business.ovl.app' });
      const jwt = push.auth.replace(/^bearer /, '');
      const [h, p, sig] = jwt.split('.');
      expect(JSON.parse(Buffer.from(h!, 'base64url').toString())).toEqual({ alg: 'ES256', kid: 'KEY123' });
      expect(JSON.parse(Buffer.from(p!, 'base64url').toString())).toMatchObject({ iss: 'TEAM456' });
      expect(
        verify(
          'sha256',
          Buffer.from(`${h}.${p}`),
          { key: publicKey, dsaEncoding: 'ieee-p1363' },
          Buffer.from(sig!, 'base64url'),
        ),
      ).toBe(true);
      expect(JSON.parse(push.body)).toMatchObject({
        aps: { alert: { title: 'Notifications work' } },
        link: '/settings',
      });

      answer = 410;
      expect((await apnsApi.post('/me/push-subscriptions/test', dan)).body).toEqual({
        devices: 1,
        delivered: 0,
      });
      expect((await apnsApi.get('/me/push-subscriptions', dan)).body).toEqual([]);
    } finally {
      await apnsApp.close();
      apple.close();
    }
  });
});
