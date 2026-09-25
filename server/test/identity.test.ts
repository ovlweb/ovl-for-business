import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALL_COMPANY_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let mod: Session;
let ann: Session;
let bob: Session;

const upload = async (s: Session, name: string) =>
  (
    await app.inject({
      method: 'POST',
      url: `/api/v1/files?name=${name}`,
      headers: { authorization: `Bearer ${s.token}`, 'content-type': 'image/jpeg' },
      payload: Buffer.from(`jpeg ${name}`),
    })
  ).json() as { id: string; url: string };

const details = (fileId: string, extra: Record<string, unknown> = {}) => ({
  legalName: 'Ann Example',
  dateOfBirth: '1990-04-12',
  country: 'Estonia',
  documentType: 'passport',
  documentNumber: 'AB 123 4567',
  documentFileId: fileId,
  ...extra,
});

beforeAll(async () => {
  app = await createTestApp({ REQUIRE_IDENTITY_FOR_COMPANIES: 'true' });
  api = client(app);
  owner = await api.owner();
  mod = await api.withRole('mod', 'moderator');
  ann = await api.register('ann');
  bob = await api.register('bob');
});
afterAll(() => app.close());

describe('identity checks', () => {
  let checkId: string;
  let applicationId: string;

  it('company approval waits for the owner’s identity check', async () => {
    const submitted = await api.post('/applications', ann, {
      type: 'company',
      payload: {
        name: 'Nova Studio',
        description: 'Virtual game studio',
        baseCurrency: 'USD',
        businessPlan: 'Make and sell virtual games',
        listOnExchange: false,
      },
    });
    applicationId = submitted.body.id;
    const blocked = await api.post(`/applications/${applicationId}/review`, mod, {
      decision: 'approve',
      checklist: ALL_COMPANY_CHECKS,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('identity_not_verified');
  });

  it('people send their details and a document photo', async () => {
    expect((await api.get('/me/identity', ann)).body).toBeNull();
    const photo = await upload(ann, 'passport.jpg');
    expect(
      (await api.post('/me/identity', ann, details(photo.id, { dateOfBirth: '2020-01-01' }))).status,
    ).toBe(400);
    const sent = await api.post('/me/identity', ann, details(photo.id));
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ status: 'pending', documentLast4: '4567', duplicate: false });
    expect(JSON.stringify(sent.body)).not.toContain('1234567');
    checkId = sent.body.id;
    expect((await api.post('/me/identity', ann, details((await upload(ann, 'x.jpg')).id))).status).toBe(409);

    // The document is visible to reviewers only.
    const plain = `/api/v1/files/${photo.id}`;
    const as = (s: Session) =>
      app.inject({ method: 'GET', url: plain, headers: { authorization: `Bearer ${s.token}` } });
    expect((await as(mod)).statusCode).toBe(200);
    expect((await as(bob)).statusCode).toBe(404);
    expect((await api.get('/admin/identity-checks', bob)).status).toBe(403);
    expect((await api.get('/admin/stats', owner)).body.pendingIdentityChecks).toBe(1);
  });

  it('staff approve: the person and the companies they own become verified', async () => {
    const queue = await api.get('/admin/identity-checks?status=pending', mod);
    expect(queue.body.map((c: { id: string }) => c.id)).toEqual([checkId]);
    expect(queue.body[0].files).toHaveLength(1);
    const approved = await api.post(`/admin/identity-checks/${checkId}/approve`, mod, {});
    expect(approved.body).toMatchObject({ status: 'approved', reviewedBy: { username: 'mod' } });
    expect((await api.get('/me', ann)).body.identityVerified).toBe(true);
    expect(app.mailer.outbox[0]).toMatchObject({ to: 'ann@example.test', subject: 'Your identity check' });

    await api.post(`/applications/${applicationId}/review`, mod, {
      decision: 'approve',
      checklist: ALL_COMPANY_CHECKS,
    });
    const done = await api.post(`/applications/${applicationId}/review`, owner, { decision: 'approve' });
    expect(done.body.status).toBe('approved');
    const company = await api.get(`/organizations/${done.body.result.organizationSlug}`, bob);
    expect(company.body.verified).toBe(true);
    const registry = await api.get(`/registry?q=Nova`, null);
    expect(registry.body.items.find((e: { kind: string }) => e.kind === 'organization').holder.verified).toBe(
      true,
    );
  });

  it('flags a document already used by another verified account, and staff can reject', async () => {
    const photo = await upload(bob, 'passport.jpg');
    const copy = await api.post('/me/identity', bob, details(photo.id, { documentNumber: 'ab1234567' }));
    expect(copy.body.duplicate).toBe(true);
    const rejected = await api.post(`/admin/identity-checks/${copy.body.id}/reject`, mod, {
      reason: 'This passport belongs to another account',
    });
    expect(rejected.body).toMatchObject({
      status: 'rejected',
      rejectionReason: 'This passport belongs to another account',
    });
    expect((await api.get('/me', bob)).body.identityVerified).toBe(false);
    // After a rejection a new check can be sent.
    const again = await api.post(
      '/me/identity',
      bob,
      details((await upload(bob, 'id.jpg')).id, { documentNumber: 'Z9' }),
    );
    expect(again.status).toBe(400); // too short a number
  });

  it('revoking removes verified, from the person and their companies', async () => {
    const revoked = await api.post(`/admin/identity-checks/${checkId}/revoke`, owner, {
      reason: 'Expired passport',
    });
    expect(revoked.body.status).toBe('revoked');
    expect((await api.get('/me', ann)).body.identityVerified).toBe(false);
    const [org] = (await api.get('/organizations/mine', ann)).body;
    expect(org.verified).toBe(false);
    // Reviewers never decide on their own check.
    const own = await api.post(
      '/me/identity',
      mod,
      details((await upload(mod, 'm.jpg')).id, { documentNumber: 'MOD-0001' }),
    );
    expect((await api.post(`/admin/identity-checks/${own.body.id}/approve`, mod, {})).status).toBe(409);
  });
});
