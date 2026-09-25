/**
 * Fills a running server with realistic demo data through the public API — the same
 * calls the apps make, so every approval goes through the real workflows.
 *
 *   OVL_API_URL=http://localhost:4000 OWNER_PASSWORD=… pnpm --filter @ovl/server seed:demo
 *
 * Demo accounts all use the password "demo-password-1".
 *
 * With DATABASE_URL set (it is, when run from server/ with a .env), the data is also spread
 * over the last two weeks so charts and timelines look lived-in. Set SEED_BACKDATE=0 to skip.
 */
import { OvlApiError, OvlClient } from '@ovl/sdk';
import type { Application, Me } from '@ovl/shared';
import postgres from 'postgres';

const API = process.env.OVL_API_URL ?? 'http://localhost:4000';
const OWNER = {
  login: process.env.OWNER_USERNAME ?? 'owner',
  password: process.env.OWNER_PASSWORD ?? 'change-me-please',
};
const PASSWORD = 'demo-password-1';

const COMPANY_CHECKS = ['identity', 'company', 'business_plan', 'license', 'listing'];
const LICENSE_CHECKS = ['holder', 'content', 'virtual_only'];

interface Person {
  username: string;
  displayName: string;
  bio: string;
  role?: 'moderator' | 'manager' | 'council' | 'admin';
  theme?: string;
}

const PEOPLE: Person[] = [
  {
    username: 'elena',
    displayName: 'Elena Marković',
    bio: 'Council member · governance and licensing',
    role: 'council',
    theme: 'midnight',
  },
  {
    username: 'viktor',
    displayName: 'Viktor Hale',
    bio: 'Council member · capital markets',
    role: 'council',
  },
  {
    username: 'arjun',
    displayName: 'Arjun Mehta',
    bio: 'Moderation team lead',
    role: 'moderator',
    theme: 'graphite',
  },
  {
    username: 'sofia',
    displayName: 'Sofia Lindqvist',
    bio: 'Finance desk manager',
    role: 'manager',
    theme: 'emerald',
  },
  {
    username: 'maria',
    displayName: 'Maria Petrova',
    bio: 'Founder of Aurora Media Group',
    theme: 'daylight',
  },
  {
    username: 'ivan',
    displayName: 'Ivan Sokolov',
    bio: 'Angel investor · games and media',
    theme: 'obsidian',
  },
  { username: 'chen', displayName: 'Chen Wei', bio: 'CEO at Northwind Studio', theme: 'aurora' },
  {
    username: 'amara',
    displayName: 'Amara Okafor',
    bio: 'Builds virtual cities at Helios Works',
    theme: 'ivory',
  },
];

async function signIn(login: string, password: string): Promise<{ client: OvlClient; me: Me }> {
  const client = new OvlClient({ baseUrl: API });
  const me = await client.auth.login({ login, password });
  return { client, me };
}

/** Without SMTP the development server keeps emails in /dev/outbox: follow the confirmation link. */
async function confirmEmail(client: OvlClient, email: string) {
  const res = await fetch(`${API}/api/v1/dev/outbox`);
  if (!res.ok) return;
  const mails = (await res.json()) as { to: string; text: string }[];
  const token = mails.find((m) => m.to === email)?.text.match(/verify-email\?token=([\w-]+)/)?.[1];
  if (token) await client.auth.verifyEmail(token);
}

async function person(p: Person): Promise<{ client: OvlClient; me: Me }> {
  const client = new OvlClient({ baseUrl: API });
  try {
    const me = await client.auth.register({
      username: p.username,
      email: `${p.username}@demo.ovl`,
      password: PASSWORD,
      displayName: p.displayName,
    });
    await confirmEmail(client, `${p.username}@demo.ovl`);
    await client.me.update({ bio: p.bio });
    await client.me.updatePreferences({
      onboardingCompleted: true,
      theme: p.theme ?? 'system',
      goals: ['invest', 'chat'],
    });
    return { client, me };
  } catch (error) {
    if (error instanceof OvlApiError && error.status === 409) return signIn(p.username, PASSWORD);
    throw error;
  }
}

async function approveAll(app: Application, reviewers: OvlClient[], checklist: Record<string, string[]>) {
  let current = app;
  for (const reviewer of reviewers) {
    if (current.status !== 'pending') break;
    const stage = current.currentStage ?? '';
    current = await reviewer.applications
      .review(current.id, { decision: 'approve', checklist: checklist[stage] ?? [] })
      .catch((e: unknown) => {
        if (e instanceof OvlApiError && (e.status === 403 || e.status === 409)) return current;
        throw e;
      });
  }
  return current;
}

async function main() {
  console.log(`Seeding demo data into ${API}`);
  const owner = await signIn(OWNER.login, OWNER.password);
  await owner.client.me.updatePreferences({ onboardingCompleted: true, theme: 'midnight' });

  const users = new Map<string, { client: OvlClient; me: Me }>();
  for (const p of PEOPLE) {
    const u = await person(p);
    users.set(p.username, u);
    if (p.role && u.me.role !== p.role) await owner.client.admin.updateUser(u.me.id, { role: p.role });
  }
  const u = (name: string) => users.get(name)!;
  const reviewers = [u('arjun').client, u('elena').client, u('viktor').client, owner.client];

  // --- Cash desk deposits (finance manager) -------------------------------------------
  const sofia = u('sofia').client;
  const deposits: [string, string, string][] = [
    ['maria', 'EUR', '48500'],
    ['maria', 'USD', '12000'],
    ['ivan', 'EUR', '95000'],
    ['ivan', 'USD', '40000'],
    ['chen', 'USD', '26000'],
    ['amara', 'GBP', '18750'],
    ['amara', 'EUR', '9000'],
    ['elena', 'CHF', '7200'],
  ];
  for (const [name, currency, amount] of deposits) {
    const done = await sofia.admin.cashOperation({
      ownerType: 'user',
      ownerId: u(name).me.id,
      currency,
      amount,
      type: 'deposit',
      method: Number(amount) > 20000 ? 'manager_transfer' : 'physical_cash',
      reference: `DEMO-${name.toUpperCase()}-${currency}`,
    });
    // Large amounts wait for a second finance manager ("four eyes"): the owner confirms.
    if ('kind' in done) await owner.client.admin.approveCash(done.id);
  }

  // --- Exchange rates (what one unit is worth in USD) -----------------------------------
  await sofia.admin.setExchange({
    base: 'USD',
    feePercent: '0.5',
    rates: [
      { currency: 'EUR', rate: '1.08' },
      { currency: 'GBP', rate: '1.27' },
      { currency: 'CHF', rate: '1.12' },
      { currency: 'JPY', rate: '0.0067' },
      { currency: 'CNY', rate: '0.138' },
    ],
  });

  // --- Companies through the full approval workflow -----------------------------------
  const companies = [
    {
      founder: 'maria',
      ticker: 'AURA',
      name: 'Aurora Media Group',
      currency: 'EUR',
      price: '12.50',
      shares: 200000,
      description: 'Virtual media holding: TV, radio and web projects with a combined audience of 2.4M.',
      plan: 'Advertising, sponsorships and licensed content across our virtual channels.',
      prices: ['11.20', '11.85', '11.40', '12.10', '12.95', '12.60', '13.40', '14.05'],
    },
    {
      founder: 'chen',
      ticker: 'NWS',
      name: 'Northwind Studio',
      currency: 'USD',
      price: '5.00',
      shares: 500000,
      description: 'Independent game studio making strategy and simulation games.',
      plan: 'Premium games, expansions and a creator marketplace.',
      prices: ['5.20', '4.95', '5.60', '6.10', '5.85', '6.40'],
    },
    {
      founder: 'amara',
      ticker: 'HLX',
      name: 'Helios Works',
      currency: 'GBP',
      price: '2.40',
      shares: 1000000,
      description: 'Designs and runs virtual cities and districts for communities.',
      plan: 'District leases, city services and infrastructure licensing.',
      prices: ['2.55', '2.70', '2.62', '2.88', '3.05'],
    },
  ];
  for (const c of companies) {
    const founder = u(c.founder).client;
    const mine = await founder.organizations.mine();
    if (mine.some((o) => o.name === c.name)) continue;
    const app = await founder.applications.submit({
      type: 'company',
      payload: {
        name: c.name,
        description: c.description,
        baseCurrency: c.currency,
        businessPlan: c.plan,
        website: `https://${c.ticker.toLowerCase()}.example.com`,
        listOnExchange: true,
        listing: { ticker: c.ticker, sharePrice: c.price, totalShares: c.shares },
      },
    });
    await approveAll(app, reviewers, { moderation: COMPANY_CHECKS });
    const listing = await owner.client.stock.listing(c.ticker);
    for (const price of c.prices) await owner.client.admin.updateListing(listing.id, { sharePrice: price });
  }

  const maria = u('maria').client;

  // --- Investments ---------------------------------------------------------------------
  const invest: [string, string, string][] = [
    ['ivan', 'AURA', '25000'],
    ['ivan', 'NWS', '12000'],
    ['elena', 'AURA', '1400'],
    ['maria', 'NWS', '3500'],
    ['chen', 'AURA', '4200'],
    ['ivan', 'HLX', '0'],
  ];
  for (const [name, ticker, amount] of invest) {
    if (amount === '0') continue;
    await u(name)
      .client.stock.invest(ticker, amount)
      .catch(() => undefined);
  }

  // --- Multi-signature: Aurora's large payments need two people ------------------------------
  const aurora = (await maria.organizations.mine()).find((o) => o.name === 'Aurora Media Group');
  if (aurora) {
    const members = await maria.organizations.members(aurora.id);
    if (!members.some((m) => m.user.username === 'ivan'))
      await maria.organizations.addMember(aurora.id, 'ivan', 'director');
    if (!aurora.approvalLimit) await maria.organizations.update(aurora.id, { approvalLimit: '5000' });
    const waiting = await maria.organizations.paymentApprovals(aurora.id, 'pending');
    const eur = (await maria.organizations.wallets(aurora.id)).find((w) => w.currency === 'EUR');
    if (!waiting.length && eur && Number(eur.available) > 6000)
      await maria.wallets.transfer({
        fromWalletId: eur.id,
        to: { type: 'organization', slug: 'helios-works' },
        amount: '6000',
        note: 'Studio lease, Q4',
      });
  }

  // --- Payroll and a recurring invoice ---------------------------------------------------
  if (aurora) {
    const eur = (await maria.organizations.wallets(aurora.id)).find((w) => w.currency === 'EUR');
    const runs = await maria.organizations.payroll(aurora.id);
    if (eur && !runs.length && Number(eur.available) > 2500)
      await maria.organizations.runPayroll(aurora.id, {
        walletId: eur.id,
        title: 'Freelance fees — September',
        items: [
          { username: 'elena', amount: '1200', note: 'Editorial board' },
          { username: 'chen', amount: '900', note: 'Game trailer' },
        ],
      });
  }
  const amara = u('amara').client;
  const helios = (await amara.organizations.mine()).find((o) => o.name === 'Helios Works');
  if (helios && !(await amara.invoices.schedules()).length)
    await amara.invoices.createSchedule({
      from: { type: 'organization', organizationId: helios.id },
      to: { type: 'organization', slug: 'aurora-media-group' },
      currency: 'EUR',
      interval: 'monthly',
      startDate: new Date().toISOString().slice(0, 10),
      dueDays: 14,
      items: [{ description: 'Studio lease, Helios district 4', quantity: 1, unitPrice: '750' }],
      note: 'Monthly lease as agreed.',
    });

  // --- Licenses -------------------------------------------------------------------------
  const licenses = [
    {
      who: 'maria',
      licenseType: 'tv_channel' as const,
      title: 'Aurora TV',
      description: '24/7 virtual business news channel.',
    },
    {
      who: 'amara',
      licenseType: 'virtual_country' as const,
      title: 'Republic of Helios',
      description: 'A virtual country with its own districts and citizens.',
    },
    {
      who: 'chen',
      licenseType: 'game' as const,
      title: 'Northwind Online',
      description: 'Persistent strategy game world.',
    },
    {
      who: 'ivan',
      licenseType: 'verified_website' as const,
      title: 'sokolov.capital',
      description: 'Verified website of Ivan Sokolov’s fund.',
    },
  ];
  const existing = await owner.client.registry.search({ limit: 100 });
  for (const l of licenses) {
    if (existing.items.some((e) => e.title === l.title)) continue;
    const app = await u(l.who).client.applications.submit({ type: 'license', payload: l });
    await approveAll(app, reviewers, { moderation: LICENSE_CHECKS });
  }
  // The Republic of Helios issues its own currency and pays Maria in it.
  const country = (await u('amara').client.me.licences()).find((l) => l.kind === 'virtual_country');
  if (country && !country.currency) {
    await u('amara').client.virtualCurrencies.create(country.id, {
      code: 'HEL',
      name: 'Helios crown',
      decimals: 2,
    });
    await u('amara').client.virtualCurrencies.issue('HEL', '50000', 'Founding issue');
    const hel = (await u('amara').client.wallets.list()).find((w) => w.currency === 'HEL');
    if (hel)
      await u('amara').client.wallets.transfer({
        fromWalletId: hel.id,
        to: { type: 'user', username: 'maria' },
        amount: '1200',
        note: 'District 4 media rights',
      });
  }

  // One application still waiting for the council, for the review queue.
  const pending = await u('ivan').client.applications.mine();
  if (!pending.some((a) => a.status === 'pending')) {
    const app = await u('ivan').client.applications.submit({
      type: 'license',
      payload: {
        licenseType: 'radio_channel',
        title: 'Capital FM',
        description: 'Radio about markets and startups.',
      },
    });
    await u('arjun').client.applications.review(app.id, { decision: 'approve', checklist: LICENSE_CHECKS });
  }

  // --- Contacts, chats, a group and a news channel --------------------------------------
  for (const name of ['ivan', 'chen', 'amara', 'elena'])
    await maria.contacts.add(name).catch(() => undefined);
  await u('ivan')
    .client.contacts.add('maria')
    .catch(() => undefined);

  const direct = await maria.chats.direct(u('ivan').me.id);
  const history = await maria.chats.messages(direct.id, { limit: 5 });
  if (history.length === 0) {
    const script: [OvlClient, string][] = [
      [maria, 'Hi Ivan! The Q3 numbers for Aurora are ready.'],
      [u('ivan').client, 'Great — send them over. How did the TV launch go?'],
      [maria, 'Audience up 38% since the license was approved 🎉'],
      [u('ivan').client, 'Impressive. I topped up my AURA position this morning.'],
      [maria, 'Thank you! The frozen part unlocks in December, we plan to use it for the radio studio.'],
    ];
    for (const [client, body] of script) await client.chats.send(direct.id, body);
  }

  const chats = await maria.chats.list();
  if (!chats.some((c) => c.title === 'Board — Aurora Media')) {
    const group = await maria.chats.createGroup({
      title: 'Board — Aurora Media',
      memberIds: [u('ivan').me.id, u('chen').me.id, u('elena').me.id],
    });
    await maria.chats.send(group.id, 'Agenda for Friday: Q3 results, radio license, hiring plan.');
    await u('chen').client.chats.send(group.id, 'I can present the cross-promotion with Northwind.');
    await u('elena').client.chats.send(group.id, 'Council will review the radio license on Thursday.');
  }

  const channels = await owner.client.chats.discoverChannels('ovl_news');
  if (channels.length === 0) {
    const channel = await u('arjun').client.chats.createChannel({
      title: 'OVL Platform News',
      handle: 'ovl_news',
      description: 'Official announcements from the OVL team.',
    });
    await u('arjun').client.chats.send(
      channel.id,
      'The stock exchange now shows price history for every listing.',
    );
    await u('arjun').client.chats.send(
      channel.id,
      'New: themes, multi-account and native apps for every platform.',
    );
    for (const name of ['maria', 'ivan', 'chen', 'amara']) await u(name).client.chats.join(channel.id);
  }

  // --- Service stories -------------------------------------------------------------------
  const stories = await owner.client.stories.list();
  if (stories.length === 0) {
    await owner.client.stories.publish({
      text: 'Welcome to OVL For Business 2.0 — native apps are here!',
      background: '#2563EB',
    });
    await u('elena').client.stories.publish({
      text: 'Council session on Thursday: 3 licenses on the agenda.',
      background: '#7C3AED',
    });
    await owner.client.stories.publish({
      text: 'Exchange tip: 30% of each investment is frozen for 90 days.',
      background: '#047857',
    });
  }

  // --- Tech support -------------------------------------------------------------------------
  const tickets = await u('amara').client.support.mine();
  if (tickets.length === 0) {
    const ticket = await u('amara').client.support.create(
      'Deposit in GBP',
      'Can I deposit GBP at the cash desk?',
    );
    await u('arjun').client.chats.send(
      ticket.id,
      'Yes — any currency. Bring your ID and the reference from your wallet page.',
    );
    await owner.client.chats.send(ticket.id, 'We also added GBP to the exchange, enjoy!');
  }

  console.log(
    'Demo data ready. Accounts: ' + PEOPLE.map((p) => p.username).join(', ') + ` (password "${PASSWORD}")`,
  );
}

/**
 * Everything above happened within a minute. Spread it over the last `days` days, keeping the
 * order of rows, with more activity towards today. Demo databases only.
 */
async function backdate(url: string, days = 13) {
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    for (const table of ['users', 'messages', 'applications', 'stock_price_history']) {
      await sql.unsafe(`
        with ranked as (
          select id,
                 (row_number() over (order by created_at desc, id desc) - 1)::float
                   / greatest(count(*) over () - 1, 1) as age
          from ${table}
        )
        update ${table} t
        set created_at = now() - interval '${days} days' * power(ranked.age, 1.6) - interval '3 minutes'
        from ranked
        where t.id = ranked.id`);
    }
    console.log(`Spread the demo activity over the last ${days} days.`);
  } finally {
    await sql.end();
  }
}

main()
  .then(async () => {
    if (process.env.DATABASE_URL && process.env.SEED_BACKDATE !== '0')
      await backdate(process.env.DATABASE_URL);
  })
  .catch((error) => {
    console.error(error instanceof OvlApiError ? `${error.status} ${error.code}: ${error.message}` : error);
    process.exit(1);
  });
