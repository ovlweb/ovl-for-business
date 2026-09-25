import { councilVotesNeeded } from '@ovl/shared';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auditLogs, users } from '../src/db/schema';
import { expireCouncilTerms } from '../src/lib/governance';
import { ALL_LICENSE_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let admin: Session;
let moderator: Session;
let applicant: Session;
const council: Session[] = [];

const license = (title: string) =>
  api.post('/applications', applicant, {
    type: 'license',
    payload: {
      licenseType: 'tv_channel',
      title,
      description: 'A virtual TV channel',
      website: 'https://tv.example.test',
    },
  });

beforeAll(async () => {
  app = await createTestApp({ COUNCIL_QUORUM: '2' });
  api = client(app);
  owner = await api.owner();
  admin = await api.withRole('admin1', 'admin');
  moderator = await api.withRole('mod1', 'moderator');
  applicant = await api.register('applicant');
  for (const name of ['coun1', 'coun2', 'coun3', 'coun4']) council.push(await api.withRole(name, 'council'));
});
afterAll(() => app.close());

describe('council voting rules', () => {
  it('counts votes as a quorum, a majority or two thirds', () => {
    expect(councilVotesNeeded({ councilVoting: 'quorum', councilQuorum: 3 }, 2)).toBe(2);
    expect(councilVotesNeeded({ councilVoting: 'quorum', councilQuorum: 3 }, 7)).toBe(3);
    expect(councilVotesNeeded({ councilVoting: 'majority', councilQuorum: 3 }, 4)).toBe(3);
    expect(councilVotesNeeded({ councilVoting: 'majority', councilQuorum: 3 }, 5)).toBe(3);
    expect(councilVotesNeeded({ councilVoting: 'two_thirds', councilQuorum: 3 }, 6)).toBe(4);
    expect(councilVotesNeeded({ councilVoting: 'two_thirds', councilQuorum: 3 }, 0)).toBe(1);
  });

  it('only the owner changes them, and council stages follow them', async () => {
    const before = await api.get('/governance', null);
    expect(before.body).toMatchObject({
      councilVoting: 'quorum',
      councilQuorum: 2,
      activeCouncilMembers: 4,
      votesNeeded: 2,
    });
    expect(before.body.council).toHaveLength(4);

    expect((await api.put('/admin/governance', admin, { councilVoting: 'majority' })).status).toBe(403);
    const set = await api.put('/admin/governance', owner, { councilVoting: 'majority' });
    expect(set.body).toMatchObject({ councilVoting: 'majority', votesNeeded: 3 });
    expect((await api.get('/meta', null)).body.councilQuorum).toBe(2);

    const id = (await license('Majority TV')).body.id;
    await api.post(`/applications/${id}/review`, moderator, {
      decision: 'approve',
      checklist: ALL_LICENSE_CHECKS,
    });
    await api.post(`/applications/${id}/review`, council[0]!, { decision: 'approve' });
    const two = await api.post(`/applications/${id}/review`, council[1]!, { decision: 'approve' });
    expect(two.body.currentStage).toBe('council');
    const three = await api.post(`/applications/${id}/review`, council[2]!, { decision: 'approve' });
    expect(three.body.currentStage).not.toBe('council');

    const [change] = await app.db.select().from(auditLogs).where(eq(auditLogs.action, 'governance.update'));
    expect(change?.data).toMatchObject({ to: { councilVoting: 'majority' } });
    await api.put('/admin/governance', owner, { councilVoting: 'quorum' });
  });
});

describe('council terms', () => {
  it('start when someone joins the council and end on their own', async () => {
    await api.put('/admin/governance', owner, { councilTermMonths: 6 });
    const member = await api.withRole('coun5', 'council');
    const seat = (await api.get('/governance', null)).body.council.find(
      (c: { user: { id: string } }) => c.user.id === member.id,
    );
    const months = (new Date(seat.termEndsAt).getTime() - Date.now()) / (30.4 * 86_400_000);
    expect(months).toBeGreaterThan(5.8);
    expect(months).toBeLessThan(6.2);
    // Seats given before a term length was set have no end.
    expect(
      (await api.get('/governance', null)).body.council.find(
        (c: { user: { id: string } }) => c.user.id === council[0]!.id,
      ).termEndsAt,
    ).toBeNull();

    const renewed = await api.post(`/admin/users/${member.id}/council-term`, admin, { months: 12 });
    expect(renewed.status).toBe(200);
    expect((await api.post(`/admin/users/${applicant.id}/council-term`, admin, { months: 12 })).status).toBe(
      400,
    );

    await app.db
      .update(users)
      .set({ councilTermEndsAt: new Date(Date.now() - 1000) })
      .where(eq(users.id, member.id));
    expect(await expireCouncilTerms(app)).toBe(1);
    expect(await expireCouncilTerms(app)).toBe(0);
    const [after] = await app.db.select().from(users).where(eq(users.id, member.id));
    expect(after).toMatchObject({ role: 'user', councilTermEndsAt: null });
    const chats = (await api.get('/chats', member)).body as { type: string }[];
    expect(chats.some((c) => c.type === 'council')).toBe(false);
    await app.push.flush();
    expect((await api.get('/notifications', member)).body.items[0].title).toBe('Your council term has ended');
  });
});

describe('transparency reports', () => {
  it('are previewed, published with a frozen snapshot and public', async () => {
    const from = new Date(Date.now() - 86_400_000).toISOString();
    const to = new Date(Date.now() + 60_000).toISOString();
    expect((await api.get(`/admin/transparency/preview?from=${from}&to=${to}`, council[0]!)).status).toBe(
      403,
    );
    const preview = await api.get(`/admin/transparency/preview?from=${from}&to=${to}`, admin);
    expect(preview.status).toBe(200);
    expect(preview.body.applications).toMatchObject({ received: 1 });
    expect(preview.body.applications.byType).toEqual([
      expect.objectContaining({ type: 'license', received: 1 }),
    ]);
    expect(preview.body.council).toMatchObject({ members: 4, votes: 3, approvals: 3, rejections: 0 });
    expect(preview.body.economy.newAccounts).toBe(9);
    expect((await api.get(`/admin/transparency/preview?from=${to}&to=${from}`, admin)).status).toBe(400);

    const published = await api.post('/admin/transparency', admin, {
      title: 'September 2026',
      periodStart: from,
      periodEnd: to,
      notes: 'Our first report.',
    });
    expect(published.status).toBe(201);
    expect(published.body).toMatchObject({ title: 'September 2026', publishedBy: { username: 'admin1' } });

    // Later activity does not change what was published.
    await license('After the report');
    const list = await api.get('/transparency', null);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].stats.applications.received).toBe(1);
    expect((await api.get(`/transparency/${published.body.id}`, null)).body.notes).toBe('Our first report.');

    expect((await api.del(`/admin/transparency/${published.body.id}`, admin)).status).toBe(204);
    expect((await api.get('/transparency', null)).body).toEqual([]);
  });
});
