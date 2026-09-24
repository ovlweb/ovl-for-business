import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_COMPANY_CHECKS, ALL_LICENSE_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let moderator: Session;
let admin: Session;
let council1: Session;
let council2: Session;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  owner = await api.owner();
  moderator = await api.withRole('mod', 'moderator');
  admin = await api.withRole('admin1', 'admin');
  council1 = await api.withRole('council1', 'council');
  council2 = await api.withRole('council2', 'council');
});
afterAll(() => app.close());

const licensePayload = {
  licenseType: 'tv_channel',
  title: 'OVL News TV',
  description: 'A virtual TV channel about business news',
  website: 'https://tv.example.test',
};

describe('license approval: moderation → council → owner → registry', () => {
  let applicant: Session;
  let applicationId: string;

  it('submits and announces to the moderation team', async () => {
    applicant = await api.register('tvmaker');
    const res = await api.post('/applications', applicant, { type: 'license', payload: licensePayload });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'pending', currentStage: 'moderation' });
    applicationId = res.body.id;

    const queue = await api.get('/applications/queue', moderator);
    expect(queue.body.map((a: { id: string }) => a.id)).toContain(applicationId);
    expect((await api.get('/applications/queue', council1)).body).toHaveLength(0);

    const chats = await api.get('/chats', moderator);
    const moderation = chats.body.find((c: { type: string }) => c.type === 'moderation');
    expect(moderation.lastMessage.meta.applicationId).toBe(applicationId);
  });

  it('enforces stage roles, the checklist and single reviews', async () => {
    expect(
      (await api.post(`/applications/${applicationId}/review`, applicant, { decision: 'approve' })).status,
    ).toBe(403);
    expect(
      (await api.post(`/applications/${applicationId}/review`, council1, { decision: 'approve' })).status,
    ).toBe(403);
    const noChecklist = await api.post(`/applications/${applicationId}/review`, moderator, {
      decision: 'approve',
    });
    expect(noChecklist.status).toBe(400);
    expect(noChecklist.body.details.missing).toEqual(ALL_LICENSE_CHECKS);

    const ok = await api.post(`/applications/${applicationId}/review`, moderator, {
      decision: 'approve',
      checklist: ALL_LICENSE_CHECKS,
    });
    expect(ok.status).toBe(200);
    expect(ok.body.currentStage).toBe('council');
  });

  it('needs the council quorum (capped by council size) then the owner', async () => {
    const first = await api.post(`/applications/${applicationId}/review`, council1, { decision: 'approve' });
    expect(first.body.currentStage).toBe('council');
    expect(
      (await api.post(`/applications/${applicationId}/review`, council1, { decision: 'approve' })).status,
    ).toBe(409);

    const second = await api.post(`/applications/${applicationId}/review`, council2, { decision: 'approve' });
    expect(second.body.currentStage).toBe('owner');

    const councilChat = (await api.get('/chats', council1)).body.find(
      (c: { type: string }) => c.type === 'council',
    );
    expect(councilChat.pinned).toBe(true);

    expect(
      (await api.post(`/applications/${applicationId}/review`, admin, { decision: 'approve' })).status,
    ).toBe(403);
    const final = await api.post(`/applications/${applicationId}/review`, owner, { decision: 'approve' });
    expect(final.body.status).toBe('approved');
    expect(final.body.result.registryNumber).toMatch(/^OVL-LIC-\d{6}$/);
  });

  it('publishes the license in the public registry (no auth needed)', async () => {
    const search = await api.get('/registry?q=news tv', null);
    expect(search.status).toBe(200);
    expect(search.body.total).toBe(1);
    expect(search.body.items[0]).toMatchObject({
      kind: 'license',
      licenseType: 'tv_channel',
      title: 'OVL News TV',
      holder: { type: 'user', handle: 'tvmaker' },
    });
    const byNumber = await api.get(`/registry/${search.body.items[0].number}`, null);
    expect(byNumber.status).toBe(200);
  });

  it('files virtual countries under their own registry kind', async () => {
    const res = await api.post('/applications', applicant, {
      type: 'license',
      payload: {
        licenseType: 'virtual_country',
        title: 'Republic of Ovalia',
        description: 'A virtual country',
      },
    });
    const id = res.body.id;
    await api.post(`/applications/${id}/review`, moderator, {
      decision: 'approve',
      checklist: ALL_LICENSE_CHECKS,
    });
    await api.post(`/applications/${id}/review`, council1, { decision: 'approve' });
    await api.post(`/applications/${id}/review`, council2, { decision: 'approve' });
    const done = await api.post(`/applications/${id}/review`, owner, { decision: 'approve' });
    expect(done.body.result.registryNumber).toMatch(/^OVL-VC-/);
    const countries = await api.get('/registry?kind=virtual_country', null);
    expect(countries.body.items[0].title).toBe('Republic of Ovalia');
  });

  it('requires a reason to reject and stops the workflow', async () => {
    const res = await api.post('/applications', applicant, { type: 'license', payload: licensePayload });
    const id = res.body.id;
    expect((await api.post(`/applications/${id}/review`, moderator, { decision: 'reject' })).status).toBe(
      400,
    );
    const rejected = await api.post(`/applications/${id}/review`, moderator, {
      decision: 'reject',
      comment: 'Duplicate of an existing license',
    });
    expect(rejected.body).toMatchObject({
      status: 'rejected',
      rejectionReason: 'Duplicate of an existing license',
    });
  });
});

describe('company registration → organization, business license, stock listing', () => {
  it('registers the company after moderation and council/admin approval', async () => {
    const founder = await api.register('founder');
    const res = await api.post('/applications', founder, {
      type: 'company',
      payload: {
        name: 'Acme Virtual Ltd',
        description: 'We build virtual things for virtual people',
        baseCurrency: 'EUR',
        businessPlan: 'Sell virtual widgets worldwide',
        listOnExchange: true,
        listing: { ticker: 'ACME', sharePrice: '10.00', totalShares: 1000 },
      },
    });
    expect(res.status).toBe(201);
    const id = res.body.id;

    const partial = await api.post(`/applications/${id}/review`, moderator, {
      decision: 'approve',
      checklist: ALL_COMPANY_CHECKS.slice(0, 3),
    });
    expect(partial.status).toBe(400);
    await api.post(`/applications/${id}/review`, moderator, {
      decision: 'approve',
      checklist: ALL_COMPANY_CHECKS,
    });

    // A single admin approval is enough at the "council or administration" stage.
    const approved = await api.post(`/applications/${id}/review`, admin, { decision: 'approve' });
    expect(approved.body.status).toBe('approved');
    expect(approved.body.result).toMatchObject({ organizationSlug: 'acme-virtual-ltd', ticker: 'ACME' });

    const mine = await api.get('/organizations/mine', founder);
    expect(mine.body[0]).toMatchObject({ name: 'Acme Virtual Ltd', myRole: 'owner', ticker: 'ACME' });
    expect(mine.body[0].registryNumber).toMatch(/^OVL-ORG-/);

    const orgs = await api.get('/registry?kind=organization', null);
    expect(orgs.body.items.map((e: { title: string }) => e.title)).toContain('Acme Virtual Ltd');
    const licenses = await api.get('/registry?licenseType=business', null);
    expect(licenses.body.total).toBe(1);

    const listing = await api.get('/stock/listings/ACME', null);
    expect(listing.body).toMatchObject({
      sharePrice: '10.00',
      totalShares: '1000',
      freezePercent: 30,
      lockDays: 90,
    });
  });

  it('refuses a ticker that is already listed', async () => {
    const other = await api.register('copycat');
    const res = await api.post('/applications', other, {
      type: 'company',
      payload: {
        name: 'Copy Corp',
        description: 'Trying to reuse a ticker',
        baseCurrency: 'USD',
        businessPlan: 'Nothing original at all',
        listOnExchange: true,
        listing: { ticker: 'acme', sharePrice: '1', totalShares: 10 },
      },
    });
    expect(res.status).toBe(409);
  });
});

describe('joining the council and the moderation team', () => {
  it('council vote then owner confirmation grants the role and the pinned council chat', async () => {
    const candidate = await api.register('candidate');
    const res = await api.post('/applications', candidate, {
      type: 'council',
      payload: { motivation: 'I want to help the community grow responsibly.' },
    });
    const id = res.body.id;
    expect(
      (
        await api.post('/applications', candidate, {
          type: 'council',
          payload: { motivation: 'x'.repeat(30) },
        })
      ).status,
    ).toBe(409);

    await api.post(`/applications/${id}/review`, council1, { decision: 'approve' });
    await api.post(`/applications/${id}/review`, council2, { decision: 'approve' });
    const done = await api.post(`/applications/${id}/review`, owner, { decision: 'approve' });
    expect(done.body.status).toBe('approved');

    const me = await api.get('/me', candidate);
    expect(me.body).toMatchObject({ role: 'council', badges: ['council'] });
    const chats = await api.get('/chats', candidate);
    expect(chats.body[0]).toMatchObject({ type: 'council', pinned: true });
  });

  it('moderator applications go through council and administration', async () => {
    const helper = await api.register('helper');
    const res = await api.post('/applications', helper, {
      type: 'moderator',
      payload: { motivation: 'I answer questions all day long anyway.' },
    });
    const id = res.body.id;
    await api.post(`/applications/${id}/review`, admin, { decision: 'approve' });
    const done = await api.post(`/applications/${id}/review`, owner, { decision: 'approve' });
    expect(done.body.status).toBe('approved');
    expect((await api.get('/me', helper)).body.role).toBe('moderator');
  });

  it('news channels are created through moderation', async () => {
    const author = await api.register('author');
    const res = await api.post('/applications', author, {
      type: 'news_channel',
      payload: { title: 'Market News', handle: 'market_news', description: 'Daily market updates' },
    });
    await api.post(`/applications/${res.body.id}/review`, moderator, { decision: 'approve' });
    const chats = await api.get('/chats', author);
    expect(chats.body[0]).toMatchObject({ type: 'channel', handle: 'market_news', myRole: 'owner' });
  });
});
