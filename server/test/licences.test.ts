import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { registryEntries } from '../src/db/schema';
import { issueRegistryEntry, licenceExpiry, runLicenceExpiry } from '../src/modules/registry';
import { client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let moderator: Session;
let ann: Session;
let ben: Session;
let entryId: string;

const DAY = 86_400_000;
const inDays = (n: number, from = new Date()) => new Date(from.getTime() + n * DAY);
const setExpiry = (d: Date, stage = 0) =>
  app.db
    .update(registryEntries)
    .set({ expiresAt: d, reminderStage: stage })
    .where(eq(registryEntries.id, entryId));
const entry = async () =>
  (await app.db.select().from(registryEntries).where(eq(registryEntries.id, entryId)))[0]!;
const renew = (as: Session) =>
  api.post('/applications', as, {
    type: 'renewal',
    payload: { registryEntryId: entryId, note: 'Still on air' },
  });

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  moderator = await api.withRole('mod', 'moderator');
  ann = await api.register('ann');
  ben = await api.register('ben');
  const e = await issueRegistryEntry(app.db, {
    kind: 'license',
    licenseType: 'tv_channel',
    title: 'Ann TV',
    description: 'A channel',
    holder: { type: 'user', id: ann.id },
    expiresAt: licenceExpiry(app.config),
  });
  entryId = e.id;
});
afterAll(() => app.close());

describe('licence expiry and renewals', () => {
  it('licences run for the configured term and list under /me/licences', async () => {
    const expected = licenceExpiry(app.config)!;
    expect(Math.abs(expected.getTime() - inDays(365).getTime())).toBeLessThan(2 * DAY);
    const mine = await api.get('/me/licences', ann);
    expect(mine.body).toMatchObject([
      { id: entryId, title: 'Ann TV', status: 'active', renewalApplicationId: null },
    ]);
    expect(mine.body[0].expiresAt).not.toBeNull();
    expect((await api.get('/me/licences', ben)).body).toEqual([]);
    expect((await api.get(`/registry/${entryId}`)).body.expiresAt).not.toBeNull();
  });

  it('renewals open 60 days before expiry, for the holder only, one at a time', async () => {
    expect((await renew(ann)).status).toBe(400);
    const expires = inDays(20);
    await setExpiry(expires);
    expect((await renew(ben)).status).toBe(403);
    const first = await renew(ann);
    expect(first.status).toBe(201);
    expect(first.body.payload).toMatchObject({ registryEntryId: entryId, title: 'Ann TV' });
    expect((await renew(ann)).status).toBe(409);
    expect((await api.get('/me/licences', ann)).body[0].renewalApplicationId).toBe(first.body.id);

    const approved = await api.post(`/applications/${first.body.id}/review`, moderator, {
      decision: 'approve',
      checklist: ['holder', 'activity'],
    });
    expect(approved.body.status).toBe('approved');
    const renewed = await entry();
    // A new term from the old expiry date, not from today.
    expect(renewed.expiresAt!.getTime()).toBe(licenceExpiry(app.config, expires)!.getTime());
    expect(renewed.status).toBe('active');
  });

  it('reminds at 30 and 7 days, then expires; a late renewal restarts from today', async () => {
    const expires = inDays(25);
    await setExpiry(expires);
    const mails = () =>
      app.mailer.outbox.filter((m) => m.to === 'ann@example.test' && m.subject.includes('Ann TV'));
    const before = mails().length;

    expect(await runLicenceExpiry(app)).toEqual({ reminded: 1, expired: 0 });
    expect(await runLicenceExpiry(app)).toEqual({ reminded: 0, expired: 0 });
    expect((await entry()).reminderStage).toBe(1);
    expect(await runLicenceExpiry(app, inDays(-5, expires))).toEqual({ reminded: 1, expired: 0 });
    expect(await runLicenceExpiry(app, inDays(-3, expires))).toEqual({ reminded: 0, expired: 0 });
    expect(await runLicenceExpiry(app, inDays(1, expires))).toEqual({ reminded: 0, expired: 1 });
    expect((await entry()).status).toBe('expired');
    expect(mails().length - before).toBe(3);
    const expired = mails().find((m) => m.subject === 'Ann TV has expired')!;
    expect(expired.text).toContain(`/#/applications?renew=${entryId}`);

    // Expired, but inside the grace period.
    await setExpiry(inDays(-10), 2);
    const late = await renew(ann);
    expect(late.status).toBe(201);
    await api.post(`/applications/${late.body.id}/review`, moderator, {
      decision: 'approve',
      checklist: ['holder', 'activity'],
    });
    const back = await entry();
    expect(back.status).toBe('active');
    expect(Math.abs(back.expiresAt!.getTime() - licenceExpiry(app.config)!.getTime())).toBeLessThan(60_000);
    expect(back.reminderStage).toBe(0);
  });

  it('past the grace period, or for revoked licences, renewing is closed', async () => {
    await setExpiry(inDays(-100));
    await app.db.execute(sql`update registry_entries set status = 'expired' where id = ${entryId}`);
    expect((await renew(ann)).status).toBe(400);
    await setExpiry(inDays(10));
    await app.db.execute(sql`update registry_entries set status = 'revoked' where id = ${entryId}`);
    expect((await renew(ann)).status).toBe(400);
  });
});
