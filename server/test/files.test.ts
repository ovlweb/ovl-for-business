import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStorage, signV4 } from '../src/lib/storage';
import { loadConfig } from '../src/config';
import { ALL_COMPANY_CHECKS, client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let ann: Session;
let bob: Session;
let mod: Session;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

beforeAll(async () => {
  app = await createTestApp({ MAX_UPLOAD_MB: '1' });
  api = client(app);
  ann = await api.register('ann');
  bob = await api.register('bob');
  mod = await api.withRole('mod', 'moderator');
});
afterAll(() => app.close());

const upload = (s: Session, body: Buffer, type: string, name = 'logo.png') =>
  app.inject({
    method: 'POST',
    url: `/api/v1/files?name=${encodeURIComponent(name)}`,
    headers: { authorization: `Bearer ${s.token}`, 'content-type': type },
    payload: body,
  });
const download = (url: string, s?: Session) =>
  app.inject({ method: 'GET', url, headers: s ? { authorization: `Bearer ${s.token}` } : {} });

const company = {
  type: 'company',
  payload: {
    name: 'Nova Studio',
    description: 'Virtual game studio',
    baseCurrency: 'USD',
    businessPlan: 'Make and sell virtual games',
    listOnExchange: false,
  },
};

describe('files', () => {
  let logo: { id: string; url: string };

  it('uploads allowed types, privately', async () => {
    const res = await upload(ann, PNG, 'image/png');
    expect(res.statusCode).toBe(201);
    logo = res.json();
    expect(logo).toMatchObject({ name: 'logo.png', contentType: 'image/png', size: PNG.length });
    expect(logo.url).toMatch(new RegExp(`^/api/v1/files/${logo.id}\\?sig=`));

    // The signed link works without a token (for <img> tags); plain URLs need access.
    const signed = await download(logo.url);
    expect(signed.statusCode).toBe(200);
    expect(signed.headers['content-type']).toBe('image/png');
    expect(signed.rawPayload.equals(PNG)).toBe(true);
    expect((await download(`/api/v1/files/${logo.id}`, ann)).statusCode).toBe(200);
    expect((await download(`/api/v1/files/${logo.id}`, bob)).statusCode).toBe(404);
    expect((await download(`/api/v1/files/${logo.id}?sig=bogus.sig`)).statusCode).toBe(401);

    expect((await upload(ann, Buffer.from('<script>'), 'text/html', 'x.html')).statusCode).toBe(415);
    expect((await upload(ann, Buffer.from('<svg/>'), 'image/svg+xml', 'x.svg')).statusCode).toBe(415);
    expect((await upload(ann, Buffer.alloc(1024 * 1024 + 10), 'application/pdf', 'big.pdf')).statusCode).toBe(
      413,
    );
  });

  it('attaches files to applications, visible to the applicant and reviewers', async () => {
    const plan = (
      await upload(ann, Buffer.from('%PDF-1.4 plan'), 'application/pdf', 'business-plan.pdf')
    ).json();
    // Only your own files, once.
    const theirs = (await upload(bob, PNG, 'image/png')).json();
    expect((await api.post('/applications', ann, { ...company, attachments: [theirs.id] })).status).toBe(400);

    const submitted = await api.post('/applications', ann, { ...company, attachments: [logo.id, plan.id] });
    expect(submitted.status).toBe(201);
    expect(submitted.body.attachments.map((f: { name: string }) => f.name)).toEqual([
      'logo.png',
      'business-plan.pdf',
    ]);
    const again = await api.post('/applications', ann, {
      ...company,
      payload: { ...company.payload, name: 'Other' },
      attachments: [plan.id],
    });
    expect(again.status).toBe(400);

    expect((await download(`/api/v1/files/${plan.id}`, mod)).statusCode).toBe(200);
    expect((await download(`/api/v1/files/${plan.id}`, bob)).statusCode).toBe(404);
    expect((await api.del(`/files/${plan.id}`, ann)).status).toBe(403);
    expect((await api.del(`/files/${theirs.id}`, bob)).status).toBe(204);
  });

  it('reviewers can ask for changes; the applicant resubmits and the stage starts over', async () => {
    const [application] = (await api.get('/applications/mine', ann)).body;
    const url = `/applications/${application.id}/review`;
    expect((await api.post(url, mod, { decision: 'request_changes' })).status).toBe(400);
    const asked = await api.post(url, mod, {
      decision: 'request_changes',
      comment: 'Add the founders’ names',
    });
    expect(asked.body).toMatchObject({
      status: 'changes_requested',
      changesRequested: 'Add the founders’ names',
    });
    expect((await api.get('/applications/queue', mod)).body).toEqual([]);
    expect((await api.post(url, mod, { decision: 'approve', checklist: ALL_COMPANY_CHECKS })).status).toBe(
      409,
    );

    const resubmit = `/applications/${application.id}/resubmit`;
    expect((await api.post(resubmit, bob, { payload: company.payload })).status).toBe(404);
    expect((await api.post(resubmit, ann, { payload: { name: 'x' } })).status).toBe(400);
    const extra = (await upload(ann, Buffer.from('Founders: Ann'), 'text/plain', 'founders.txt')).json();
    const back = await api.post(resubmit, ann, {
      payload: { ...company.payload, description: 'Virtual game studio by Ann' },
      attachments: [extra.id],
    });
    expect(back.body).toMatchObject({
      status: 'pending',
      round: 2,
      changesRequested: null,
      currentStage: 'moderation',
    });
    expect(back.body.attachments).toHaveLength(3);
    expect((await api.post(resubmit, ann, { payload: company.payload })).status).toBe(409);

    // The same moderator reviews again in the new round.
    expect((await api.get('/applications/queue', mod)).body.map((a: { id: string }) => a.id)).toEqual([
      application.id,
    ]);
    const approved = await api.post(url, mod, { decision: 'approve', checklist: ALL_COMPANY_CHECKS });
    expect(approved.status).toBe(200);
    expect(approved.body.stageIndex).toBe(1);
    expect(
      approved.body.reviews.map((r: { decision: string; round: number }) => [r.decision, r.round]),
    ).toEqual([
      ['request_changes', 1],
      ['approve', 2],
    ]);
  });
});

describe('storage', () => {
  it('signs S3 requests (AWS Signature V4 test vector)', () => {
    // From the Amazon S3 documentation: "Example: GET Object".
    const auth = signV4({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: {
        range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      region: 'us-east-1',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      amzDate: '20130524T000000Z',
    });
    expect(auth).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('keeps local files inside the storage directory', async () => {
    const storage = createStorage(
      loadConfig({ DATABASE_URL: 'x', JWT_SECRET: 'x'.repeat(32), STORAGE_DIR: '/tmp/ovl-x' }),
    );
    await expect(storage.put('../escape', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'Invalid storage key',
    );
    expect(await storage.get('2026-01/missing')).toBeNull();
  });
});
