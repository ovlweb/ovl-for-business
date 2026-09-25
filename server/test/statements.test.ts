import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueRegistryEntry } from '../src/modules/registry';
import { sendMonthlyStatements } from '../src/modules/statements';
import { client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let ann: Session;
let ben: Session;
let walletId: string;

const raw = (url: string, headers: Record<string, string> = {}) =>
  app.inject({ method: 'GET', url: `/api/v1${url}`, headers });
const bearer = (s: Session) => ({ authorization: `Bearer ${s.token}` });

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  ann = await api.register('ann');
  ben = await api.register('ben');
  walletId = (await api.deposit(ann, 'USD', '100.00')).walletId;
  await api.deposit(ben, 'USD', '5.00');
  await api.post('/wallets/transfer', ann, {
    fromWalletId: walletId,
    to: { type: 'user', username: 'ben' },
    amount: '30',
    note: 'Лицензия — =SUM(A1)',
  });
});
afterAll(() => app.close());

describe('PDF statements', () => {
  it('downloads a PDF for the owner only', async () => {
    const res = await raw(`/wallets/${walletId}/statement.pdf`, bearer(ann));
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toMatch(/^inline; filename="ovl-statement-usd-/);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
    expect(res.rawPayload.length).toBeGreaterThan(5_000);
    expect((await raw(`/wallets/${walletId}/statement.pdf`, bearer(ben))).statusCode).toBe(403);
    expect((await raw(`/wallets/${walletId}/statement.pdf`)).statusCode).toBe(401);
  });

  it('signed links pick the format', async () => {
    const link = await api.post(`/wallets/${walletId}/statement-link`, ann, { format: 'pdf' });
    expect(link.body.path).toMatch(/^\/api\/v1\/wallets\/.+\/statement\.pdf\?link=/);
    const pdf = await app.inject({ method: 'GET', url: link.body.path });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const csv = await api.post(`/wallets/${walletId}/statement-link`, ann, {});
    expect(csv.body.path).toContain('/statement.csv?link=');
  });

  it('lists monthly statements with opening and closing balances', async () => {
    const res = await api.get(`/wallets/${walletId}/statements`, ann);
    const month = new Date().toISOString().slice(0, 7);
    expect(res.body).toEqual([
      expect.objectContaining({
        month,
        from: `${month}-01`,
        opening: '0.00',
        moneyIn: '100.00',
        moneyOut: '30.00',
        closing: '70.00',
        operations: 2,
      }),
    ]);
    expect((await api.get(`/wallets/${walletId}/statements`, ben)).status).toBe(403);
  });
});

describe('monthly statement emails', () => {
  it('go once a month to people who asked, with a PDF link that works for a week', async () => {
    await api.patch('/me/preferences', ann, { statementEmails: true });
    await app.db.execute(sql`update users set email_verified_at = now()`);
    const now = new Date();
    const early = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 2, 6));
    expect(
      await sendMonthlyStatements(app, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 12))),
    ).toBe(0);
    expect(await sendMonthlyStatements(app, early)).toBe(1);
    expect(await sendMonthlyStatements(app, early)).toBe(0);
    const mail = app.mailer.outbox.find(
      (m) => m.to === 'ann@example.test' && m.subject.startsWith('Your statements'),
    )!;
    expect(mail.text).toContain('Personal · USD — closing balance 70.00 USD (PDF)');
    expect(
      app.mailer.outbox.some((m) => m.to === 'ben@example.test' && m.subject.startsWith('Your statements')),
    ).toBe(false);
    const path = mail.text.match(
      /http:\/\/[^/]+(\/api\/v1\/wallets\/[^\s]+statement\.pdf\?link=[\w.-]+)/,
    )![1]!;
    const pdf = await app.inject({ method: 'GET', url: path });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
  });
});

describe('registry certificates', () => {
  it('anyone can download a certificate; revoked ones still render, marked', async () => {
    const entry = await issueRegistryEntry(app.db, {
      kind: 'license',
      licenseType: 'tv_channel',
      title: 'Ann TV',
      description: 'A channel',
      holder: { type: 'user', id: ann.id },
    });
    const res = await raw(`/registry/${entry.number}/certificate.pdf`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain(`${entry.number.toLowerCase()}-certificate.pdf`);
    await app.db.execute(sql`update registry_entries set status = 'revoked' where id = ${entry.id}`);
    expect((await raw(`/registry/${entry.id}/certificate.pdf`)).statusCode).toBe(200);
    expect((await raw('/registry/OVL-LIC-999999/certificate.pdf')).statusCode).toBe(404);
  });
});
