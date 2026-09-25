import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueRegistryEntry, licenceExpiry } from '../src/modules/registry';
import { client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let ann: Session;
let ben: Session;
let countryId: string;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  owner = await api.owner();
  ann = await api.register('ann');
  ben = await api.register('ben');
  const entry = await issueRegistryEntry(app.db, {
    kind: 'virtual_country',
    licenseType: 'virtual_country',
    title: 'Republic of Helios',
    description: 'A virtual country',
    holder: { type: 'user', id: ann.id },
    expiresAt: licenceExpiry(app.config),
  });
  countryId = entry.id;
});
afterAll(() => app.close());

const annWallet = async () =>
  (await api.get('/wallets', ann)).body.find((w: { currency: string }) => w.currency === 'HLX') as {
    id: string;
    balance: string;
  };

describe('virtual-country currencies', () => {
  it('the holder of a virtual country issues a currency with a non-ISO code', async () => {
    const make = (as: Session, body: Record<string, unknown>) =>
      api.post(`/registry/${countryId}/currency`, as, body);
    expect((await make(ben, { code: 'HLX', name: 'Helios lira' })).status).toBe(403);
    expect((await make(ann, { code: 'USD', name: 'Fake dollar' })).status).toBe(400);
    const created = await make(ann, { code: 'hlx', name: 'Helios lira', decimals: 2 });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: 'HLX',
      name: 'Helios lira',
      decimals: 2,
      status: 'active',
      country: 'Republic of Helios',
      supply: '0.00',
    });
    expect(created.body.issuerWalletId).not.toBeNull();
    expect((await make(ann, { code: 'HLY', name: 'Second' })).status).toBe(409);

    const all = await api.get('/currencies', null);
    expect(all.body.find((c: { code: string }) => c.code === 'HLX')).toEqual({
      code: 'HLX',
      name: 'Helios lira',
      decimals: 2,
      virtual: true,
      issuer: {
        registryNumber: expect.stringMatching(/^OVL-VC-/),
        country: 'Republic of Helios',
        status: 'active',
      },
    });
    expect(all.body.find((c: { code: string }) => c.code === 'EUR')).toMatchObject({
      virtual: false,
      issuer: null,
    });
    expect((await api.get(`/registry/${countryId}`, null)).body.currency).toBe('HLX');
  });

  it('issued money circulates like any other currency', async () => {
    const issued = await api.post('/virtual-currencies/HLX/issue', ann, { amount: '1000', note: 'Founding' });
    expect(issued.status).toBe(200);
    expect(issued.body.supply).toBe('1000.00');
    const wallet = await annWallet();
    expect(wallet.balance).toBe('1000.00');
    const entries = await api.get(`/wallets/${wallet.id}/entries`, ann);
    expect(entries.body.items[0]).toMatchObject({
      kind: 'issuance',
      amount: '1000.00',
      description: 'Issued by Republic of Helios — Founding',
    });

    expect((await api.post('/wallets', ben, { currency: 'HLX' })).status).toBe(201);
    const sent = await api.post('/wallets/transfer', ann, {
      fromWalletId: wallet.id,
      to: { type: 'user', username: 'ben' },
      amount: '250.5',
    });
    expect(sent.status).toBe(200);
    expect((await api.get('/virtual-currencies/HLX', null)).body).toMatchObject({
      supply: '1000.00',
      holders: 2,
    });
    expect((await api.post('/virtual-currencies/HLX/issue', ben, { amount: '5' })).status).toBe(403);
    expect((await api.post('/virtual-currencies/HLX/issue', ann, { amount: '0.001' })).status).toBe(400);
  });

  it('redeeming takes money out of circulation, up to what the holder has', async () => {
    const redeemed = await api.post('/virtual-currencies/HLX/redeem', ann, { amount: '100' });
    expect(redeemed.body.supply).toBe('900.00');
    expect((await annWallet()).balance).toBe('649.50');
    expect((await api.post('/virtual-currencies/HLX/redeem', ann, { amount: '5000' })).status).toBe(409);
  });

  it('staff can suspend issuing; a revoked country cannot issue either', async () => {
    const suspended = await api.patch('/admin/virtual-currencies/HLX', owner, { status: 'suspended' });
    expect(suspended.body.status).toBe('suspended');
    expect((await api.post('/virtual-currencies/HLX/issue', ann, { amount: '1' })).status).toBe(409);
    // Balances keep working.
    const wallet = await annWallet();
    const sent = await api.post('/wallets/transfer', ann, {
      fromWalletId: wallet.id,
      to: { type: 'user', username: 'ben' },
      amount: '1',
    });
    expect(sent.status).toBe(200);
    await api.patch('/admin/virtual-currencies/HLX', owner, { status: 'active' });
    await app.db.execute(sql`update registry_entries set status = 'revoked' where id = ${countryId}`);
    expect((await api.post('/virtual-currencies/HLX/issue', ann, { amount: '1' })).status).toBe(409);
  });
});
