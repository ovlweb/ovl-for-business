import type { PushConfig } from '@ovl/shared';
import { eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createSign, sign } from 'node:crypto';
import { connect } from 'node:http2';
import webpush from 'web-push';
import { platformSettings, pushSubscriptions } from '../db/schema';
import { openSecret, sealSecret } from './totp';
import { assertPublicUrl } from './webhooks';

export interface PushMessage {
  title: string;
  body: string;
  /** App route to open, e.g. /chats/<id>. */
  link: string | null;
  /** Newer pushes with the same tag replace older ones on the device. */
  tag?: string;
}

type Subscription = typeof pushSubscriptions.$inferSelect;
/** ok: delivered; gone: the device unsubscribed (forget it); failed: try again next time. */
type Outcome = 'ok' | 'gone' | 'failed';

const TIMEOUT_MS = 10_000;
/** Devices that failed this many times in a row are dropped. */
const MAX_FAILURES = 10;

const b64url = (data: Buffer | string) => Buffer.from(data).toString('base64url');

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/**
 * Sends push notifications to people's devices: browsers through Web Push (VAPID), Android
 * apps through FCM and Apple apps through APNs. Sending never blocks a request; `flush()` waits
 * for what is on its way (tests, shutdown).
 */
export class PushService {
  private vapid: Promise<{ publicKey: string; privateKey: string }> | null = null;
  private fcmToken: { token: string; expires: number } | null = null;
  private apnsToken: { token: string; issued: number } | null = null;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly fcmAccount: ServiceAccount | null;

  constructor(private readonly app: FastifyInstance) {
    const raw = app.config.FCM_SERVICE_ACCOUNT?.trim();
    this.fcmAccount = raw
      ? (JSON.parse(raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString()) as ServiceAccount)
      : null;
  }

  private get apnsReady() {
    const c = this.app.config;
    return !!(c.APNS_KEY && c.APNS_KEY_ID && c.APNS_TEAM_ID && c.APNS_TOPIC);
  }

  /** The VAPID key pair: from the configuration, or made once and kept (sealed) in the database. */
  vapidKeys() {
    this.vapid ??= (async () => {
      const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, JWT_SECRET } = this.app.config;
      if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
        return { publicKey: VAPID_PUBLIC_KEY, privateKey: VAPID_PRIVATE_KEY };
      const read = async () => {
        const [row] = await this.app.db
          .select()
          .from(platformSettings)
          .where(eq(platformSettings.key, 'webpush'));
        const value = row?.value as { publicKey: string; privateKey: string } | undefined;
        return value
          ? { publicKey: value.publicKey, privateKey: openSecret(value.privateKey, JWT_SECRET) }
          : null;
      };
      const existing = await read();
      if (existing) return existing;
      const keys = webpush.generateVAPIDKeys();
      await this.app.db
        .insert(platformSettings)
        .values({
          key: 'webpush',
          value: { publicKey: keys.publicKey, privateKey: sealSecret(keys.privateKey, JWT_SECRET) },
        })
        .onConflictDoNothing();
      // Another instance may have made its pair first: everyone uses the stored one.
      return (await read())!;
    })();
    this.vapid.catch(() => (this.vapid = null));
    return this.vapid;
  }

  async publicConfig(): Promise<PushConfig> {
    return { webPushKey: (await this.vapidKeys()).publicKey, fcm: !!this.fcmAccount, apns: this.apnsReady };
  }

  /** Queue a push to every device of these people. */
  sendToUsers(userIds: string[], message: PushMessage) {
    if (!userIds.length) return;
    this.track(
      (async () => {
        const subs = await this.app.db
          .select()
          .from(pushSubscriptions)
          .where(inArray(pushSubscriptions.userId, userIds));
        await Promise.all(subs.map((s) => this.deliver(s, message)));
      })(),
    );
  }

  /** Push to these devices now and report how many received it. */
  async sendNow(subs: Subscription[], message: PushMessage) {
    const outcomes = await Promise.all(subs.map((s) => this.deliver(s, message)));
    return outcomes.filter((o) => o === 'ok').length;
  }

  track(work: Promise<unknown>) {
    const p = work.catch((e: unknown) => this.app.log.warn({ err: e }, 'push delivery failed'));
    this.pending.add(p);
    void p.finally(() => this.pending.delete(p));
  }

  async flush() {
    while (this.pending.size) await Promise.allSettled([...this.pending]);
  }

  private async deliver(sub: Subscription, message: PushMessage): Promise<Outcome> {
    let outcome: Outcome;
    try {
      outcome =
        sub.kind === 'webpush'
          ? await this.webPush(sub, message)
          : sub.kind === 'fcm'
            ? await this.fcm(sub, message)
            : await this.apns(sub, message);
    } catch (e) {
      this.app.log.warn({ err: e, kind: sub.kind }, 'push failed');
      outcome = 'failed';
    }
    if (outcome === 'gone') {
      await this.app.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    } else if (outcome === 'ok') {
      await this.app.db
        .update(pushSubscriptions)
        .set({ failures: 0, lastUsedAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id));
    } else if (sub.failures + 1 >= MAX_FAILURES) {
      await this.app.db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
    } else {
      await this.app.db
        .update(pushSubscriptions)
        .set({ failures: sql`${pushSubscriptions.failures} + 1` })
        .where(eq(pushSubscriptions.id, sub.id));
    }
    return outcome;
  }

  private async webPush(sub: Subscription, message: PushMessage): Promise<Outcome> {
    // The endpoint came from a browser, but through a person: never call into our own network.
    await assertPublicUrl(sub.endpoint, this.app.config.WEBHOOK_ALLOW_PRIVATE_NETWORKS);
    const keys = await this.vapidKeys();
    const request = webpush.generateRequestDetails(
      { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh ?? '', auth: sub.keys.auth ?? '' } },
      JSON.stringify(message),
      {
        vapidDetails: { subject: this.app.config.VAPID_SUBJECT, ...keys },
        TTL: 24 * 3600,
        urgency: 'normal',
        ...(message.tag
          ? { topic: message.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined }
          : {}),
      },
    );
    const res = await fetch(request.endpoint, {
      method: request.method,
      headers: request.headers as Record<string, string>,
      body: new Uint8Array(request.body as Buffer),
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => undefined);
    if (res.status === 404 || res.status === 410) return 'gone';
    return res.ok ? 'ok' : 'failed';
  }

  private async fcmAccessToken(): Promise<string> {
    const account = this.fcmAccount!;
    if (this.fcmToken && this.fcmToken.expires > Date.now() + 60_000) return this.fcmToken.token;
    const now = Math.floor(Date.now() / 1000);
    const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
      JSON.stringify({
        iss: account.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: tokenUri,
        iat: now,
        exp: now + 3600,
      }),
    )}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(account.private_key);
    const res = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: `${unsigned}.${b64url(signature)}`,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`FCM sign-in failed: HTTP ${res.status}`);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    this.fcmToken = { token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
    return body.access_token;
  }

  private async fcm(sub: Subscription, message: PushMessage): Promise<Outcome> {
    if (!this.fcmAccount) return 'failed';
    const res = await fetch(
      `${this.app.config.FCM_API_URL.replace(/\/$/, '')}/v1/projects/${this.fcmAccount.project_id}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.fcmAccessToken()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: sub.endpoint,
            notification: { title: message.title, body: message.body },
            data: { link: message.link ?? '' },
            android: { priority: 'high', ...(message.tag ? { notification: { tag: message.tag } } : {}) },
          },
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return 'ok';
    }
    const error = (await res.json().catch(() => ({}))) as {
      error?: { status?: string; details?: { errorCode?: string }[] };
    };
    const code = error.error?.details?.find((d) => d.errorCode)?.errorCode ?? error.error?.status;
    return res.status === 404 || code === 'UNREGISTERED' || code === 'INVALID_ARGUMENT' ? 'gone' : 'failed';
  }

  /** Provider token for APNs: an ES256 JWT, reused for 50 minutes as Apple asks. */
  private apnsJwt(): string {
    const c = this.app.config;
    if (this.apnsToken && Date.now() - this.apnsToken.issued < 50 * 60_000) return this.apnsToken.token;
    const unsigned = `${b64url(JSON.stringify({ alg: 'ES256', kid: c.APNS_KEY_ID }))}.${b64url(
      JSON.stringify({ iss: c.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) }),
    )}`;
    const key = c.APNS_KEY!.replace(/\\n/g, '\n');
    const signature = sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
    this.apnsToken = { token: `${unsigned}.${b64url(signature)}`, issued: Date.now() };
    return this.apnsToken.token;
  }

  private apns(sub: Subscription, message: PushMessage): Promise<Outcome> {
    if (!this.apnsReady) return Promise.resolve('failed');
    const c = this.app.config;
    const body = JSON.stringify({
      aps: {
        alert: { title: message.title, body: message.body },
        sound: 'default',
        'thread-id': message.tag,
      },
      link: message.link,
    });
    return new Promise<Outcome>((resolve, reject) => {
      const session = connect(c.APNS_HOST);
      const done = (fn: () => void) => {
        session.close();
        fn();
      };
      session.on('error', (e) => done(() => reject(e)));
      session.setTimeout(TIMEOUT_MS, () => done(() => reject(new Error('APNs timed out'))));
      const req = session.request({
        ':method': 'POST',
        ':path': `/3/device/${sub.endpoint}`,
        authorization: `bearer ${this.apnsJwt()}`,
        'apns-topic': c.APNS_TOPIC!,
        'apns-push-type': 'alert',
        'content-type': 'application/json',
        ...(message.tag ? { 'apns-collapse-id': message.tag.slice(0, 64) } : {}),
      });
      let status = 0;
      let text = '';
      req.on('response', (headers) => (status = Number(headers[':status'])));
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => (text += chunk));
      req.on('end', () =>
        done(() => {
          if (status === 200) return resolve('ok');
          const reason = (JSON.parse(text || '{}') as { reason?: string }).reason;
          resolve(
            status === 410 || reason === 'BadDeviceToken' || reason === 'Unregistered' ? 'gone' : 'failed',
          );
        }),
      );
      req.on('error', (e) => done(() => reject(e)));
      req.end(body);
    });
  }
}
