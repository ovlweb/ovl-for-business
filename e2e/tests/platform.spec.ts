import { expect, test, type Page } from '@playwright/test';
import { ADMIN_URL, API_URL, OWNER_PASSWORD } from '../constants';
import {
  bubble,
  greeting,
  login,
  newPage,
  openChat,
  PASSWORD,
  register,
  send,
  skipOnboarding,
  totp,
} from './helpers';

/**
 * One realistic story across the web client and the admin panel, run in order:
 * two people meet, chat, get money from the cash desk, found a company that is
 * approved by the owner, invest in it, ask tech support, and use message tools.
 */
test.describe.serial('OVL For Business end to end', () => {
  const errors: string[] = [];
  let maria: Page;
  let ivan: Page;
  let owner: Page;
  let admin: Page;

  test.beforeAll(async ({ browser }) => {
    maria = await newPage(browser, errors, 'maria');
    ivan = await newPage(browser, errors, 'ivan');
    owner = await newPage(browser, errors, 'owner');
    admin = await newPage(browser, errors, 'admin');
  });

  test.afterAll(() => {
    expect(errors, 'browser console errors').toEqual([]);
  });

  test('people register and the owner signs in', async () => {
    await register(maria, 'Maria Petrova', 'maria');
    await register(ivan, 'Ivan Sokolov', 'ivan');
    await login(owner, 'owner', OWNER_PASSWORD);
    await skipOnboarding(owner, 'Owner');
  });

  test('first sign-in: the setup tour picks a theme that follows the account', async ({ browser }) => {
    const chen = await newPage(browser, errors, 'chen');
    await chen.goto('./');
    await chen.getByRole('tab', { name: 'Create account' }).click();
    await chen.getByLabel('Display name').fill('Chen Wei');
    await chen.getByLabel('Username').fill('chen');
    await chen.getByLabel('Email').fill('chen@example.test');
    await chen.getByLabel('Password').fill(PASSWORD);
    await chen.getByRole('button', { name: 'Create account' }).click();

    await chen.getByRole('button', { name: 'Get started' }).click();
    await chen.getByRole('radio', { name: 'Emerald' }).click();
    await expect(chen.locator('html')).toHaveAttribute('data-theme', 'emerald');
    await chen.getByRole('button', { name: 'Continue' }).click();
    await chen.getByLabel('About you (optional)').fill('CEO at Northwind Studio');
    await chen.getByRole('button', { name: 'Continue' }).click();
    await chen.getByRole('button', { name: /Invest in companies/ }).click();
    await chen.getByRole('button', { name: 'Continue' }).click();
    await chen.getByRole('button', { name: 'Maybe later' }).click();
    await chen.getByRole('button', { name: 'Open the exchange' }).click();
    await chen.getByRole('heading', { name: 'Stock exchange' }).waitFor();

    // Another device: the account brings its theme along and skips the tour.
    const laptop = await newPage(browser, errors, 'chen-laptop');
    await login(laptop, 'chen');
    await greeting(laptop, 'Chen').waitFor();
    await expect(laptop.locator('html')).toHaveAttribute('data-theme', 'emerald');
    await laptop.context().close();
    await chen.context().close();
  });

  test('contacts and a live direct chat', async () => {
    await maria.goto('./#/contacts');
    await maria.getByPlaceholder('Search by name or username').fill('ivan');
    await maria.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(maria.getByText('In contacts')).toBeVisible();
    await maria.getByRole('button', { name: 'Message' }).click();
    await send(maria, 'Hi Ivan! Ready to register our company?');

    await openChat(ivan, 'Maria Petrova');
    await expect(bubble(ivan, 'Ready to register our company?')).toBeVisible();
    await send(ivan, 'Yes, let us do it today.');
    await expect(bubble(maria, 'Yes, let us do it today.')).toBeVisible();
  });

  test('groups can only include contacts', async () => {
    await maria.goto('./#/chats');
    await maria.getByRole('button', { name: 'New' }).click();
    await maria.getByRole('tab', { name: 'New group' }).click();
    await maria.getByLabel('Group name').fill('Founders');
    await maria.getByRole('dialog').getByText('Ivan Sokolov').click();
    await maria.getByRole('button', { name: 'Create group' }).click();
    await expect(maria.locator('.system-message', { hasText: 'created the group "Founders"' })).toBeVisible();
    await ivan.goto('./#/chats');
    await expect(ivan.locator('.chat-item', { hasText: 'Founders' })).toBeVisible();
  });

  test('regular users cannot use the admin panel', async () => {
    await login(admin, 'maria', undefined, ADMIN_URL);
    await expect(admin.getByText('This account has no access to the admin panel.')).toBeVisible();
  });

  test('the owner deposits cash in the admin panel; the wallet updates live', async () => {
    await maria.goto('./#/wallet');
    await login(admin, 'owner', OWNER_PASSWORD, ADMIN_URL);
    await greeting(admin, 'Owner').waitFor();
    await expect(admin.getByText('Platform activity')).toBeVisible();
    await admin.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'Cash desk' }).click();
    await admin.getByPlaceholder('Search a person or a company').fill('maria');
    await admin.getByText('Maria Petrova').click();
    await admin.getByLabel('Amount').fill('500');
    await admin.getByLabel('Reference').fill('DESK-0001');
    await admin.getByRole('button', { name: 'Review operation' }).click();
    await admin.getByRole('button', { name: 'Confirm operation' }).click();
    await expect(admin.locator('td', { hasText: 'DESK-0001' })).toBeVisible();

    await expect(maria.getByText('Available: 500.00 USD')).toBeVisible();
  });

  test('money transfer between people', async () => {
    await maria.getByRole('button', { name: 'Send money' }).click();
    await maria.getByLabel('Username').fill('ivan');
    await maria.getByLabel('Amount (USD)').fill('120');
    await maria.getByLabel('Note (optional)').fill('Share of the registration fee');
    await maria.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(maria.getByText('Available: 380.00 USD')).toBeVisible();
    await ivan.goto('./#/wallet');
    await expect(ivan.getByText('Transfer from @maria — Share of the registration fee')).toBeVisible();
  });

  test('a payout request holds the money until the cash desk pays it out; statement export', async () => {
    await ivan.getByRole('button', { name: 'Withdraw' }).click();
    await ivan.getByLabel('Amount (USD)').fill('20');
    await ivan.getByLabel('Note for the finance manager (optional)').fill('IBAN DE02 1203 0000 0000 2020 51');
    await ivan.getByRole('button', { name: 'Request payout' }).click();
    await expect(ivan.getByText('20.00 frozen')).toBeVisible();
    await expect(ivan.getByText('Available: 100.00 USD')).toBeVisible();
    await expect(ivan.getByText('Waiting for a finance manager · amount held')).toBeVisible();

    await admin.reload();
    const request = admin.locator('tr', { hasText: 'Ivan Sokolov' });
    await request.getByRole('button', { name: 'Pay out' }).click();
    await admin.getByLabel('Reference').fill('SEPA-0077');
    await admin.getByRole('button', { name: 'Confirm payout' }).click();
    await expect(admin.getByText('Nothing is waiting')).toBeVisible();

    // The person sees the outcome live.
    await expect(ivan.getByText('Done by Owner · ref. SEPA-0077')).toBeVisible();
    await expect(ivan.getByText('20.00 frozen')).toBeHidden();
    await expect(ivan.locator('.bank-card').getByText('Available: 100.00 USD')).toBeVisible();

    await ivan.getByRole('button', { name: 'Export', exact: true }).click();
    await ivan.getByRole('tab', { name: 'All time' }).click();
    const [download] = await Promise.all([
      ivan.waitForEvent('download'),
      ivan.getByRole('button', { name: 'Download CSV' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^ovl-statement-usd-\d{4}-\d{2}-\d{2}\.csv$/);
    const csv = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(csv).toString('utf8');
    expect(text).toContain('Date,Operation,Description,Amount,Balance after,Currency,Entry');
    expect(text).toContain('Withdrawal via manager transfer (ref. SEPA-0077),-20.00,100.00,USD');
  });

  test('company application: moderation checklist, approval, registry and exchange', async () => {
    await maria.goto('./#/applications?new=company');
    await maria.getByLabel('Company name').fill('Northwind Studio');
    await maria.getByLabel('Description').fill('Virtual game studio making strategy games.');
    await maria.getByLabel('Business plan').fill('Sell games and sponsorships in virtual worlds.');
    await maria.getByText('List the company on the stock exchange').click();
    await maria.getByLabel('Ticker').fill('NWS');
    await maria.getByLabel('Share price (USD)').fill('5');
    await maria.getByLabel('Total shares').fill('1000');
    await maria.locator('input[type=file]').setInputFiles({
      name: 'business-plan.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 Northwind business plan'),
    });
    await expect(maria.getByText('business-plan.pdf')).toBeVisible();
    await maria.getByRole('button', { name: 'Submit application' }).click();
    await maria.getByRole('heading', { name: 'Your applications' }).waitFor();

    // A first round: the reviewer reads the attached document and asks for one more detail.
    await owner.goto('./#/review');
    await owner.getByText('Northwind Studio').first().click();
    await expect(owner.getByRole('link', { name: /business-plan\.pdf/ })).toBeVisible();
    await owner.getByLabel(/^Comment/).fill('Please add a contact email for investors.');
    await owner.getByRole('button', { name: 'Request changes' }).click();
    await expect(owner.getByText('Changes requested', { exact: true }).first()).toBeVisible();

    await expect(
      maria.getByText('Changes requested: Please add a contact email for investors.'),
    ).toBeVisible();
    await maria.getByRole('button', { name: 'Edit and resubmit' }).click();
    await maria.getByLabel('Contact email (optional)').fill('invest@northwind.example');
    await maria.getByRole('button', { name: 'Send the changes' }).click();
    await expect(maria.getByText('Changes requested:')).toBeHidden();

    await owner.goto('./#/review');
    await owner.getByText('Northwind Studio').first().click();
    await expect(owner.getByText('invest@northwind.example')).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Approve' })).toBeDisabled();
    for (const item of [
      'Applicant identity',
      'Company name, description',
      'Business plan and activity',
      'Requested business license',
      'Stock listing parameters',
    ]) {
      await owner.getByText(item, { exact: false }).click();
    }
    await owner.getByRole('button', { name: 'Approve' }).click();
    await expect(owner.getByText('Current stage: Council or administration approval')).toBeVisible();
    await owner.getByRole('button', { name: 'Approve' }).click();
    await expect(owner.getByText('Approved', { exact: true }).first()).toBeVisible();

    await expect(maria.getByText('Open company')).toBeVisible();
    await ivan.goto('./#/registry');
    await expect(ivan.getByText('Northwind Studio — business license')).toBeVisible();
  });

  test('investing freezes 30% on the company balance', async () => {
    await ivan.goto('./#/exchange');
    await ivan.getByText('NWS').first().click();
    await ivan.getByLabel('Amount (USD)').fill('100');
    await ivan.getByRole('button', { name: 'Invest', exact: true }).click();
    await expect(ivan.getByText('Bought 20 shares')).toBeVisible();
    await maria.goto('./#/companies/northwind-studio');
    await expect(maria.getByText('30.00 frozen')).toBeVisible();
    await expect(maria.getByText('Available: 70.00 USD')).toBeVisible();
  });

  test('invoices: a person bills a company, which pays from its business balance', async () => {
    await ivan.goto('./#/invoices');
    await ivan.getByRole('button', { name: 'New invoice' }).click();
    await ivan.getByLabel('Recipient', { exact: true }).fill('northwind-studio');
    await ivan.getByLabel('Line 1 description').fill('Logo design');
    await ivan.getByLabel('Line 1 unit price').fill('20');
    await ivan.getByRole('button', { name: 'Add line' }).click();
    await ivan.getByLabel('Line 2 description').fill('Business cards');
    await ivan.getByLabel('Line 2 quantity').fill('2');
    await ivan.getByLabel('Line 2 unit price').fill('2.50');
    await expect(ivan.getByText('25.00 USD')).toBeVisible();
    await ivan.getByRole('button', { name: 'Send invoice' }).click();
    const invoice = ivan.locator('.invoice-doc');
    await expect(invoice.getByText(/^INV-\d{4}-0001$/)).toBeVisible();
    await expect(invoice.getByText('Northwind Studio')).toBeVisible();

    // The company's owner sees it waiting in the sidebar and pays it.
    await maria.goto('./#/invoices');
    await expect(maria.getByRole('link', { name: /Invoices\s*1/ })).toBeVisible();
    await maria.locator('tr', { hasText: 'Ivan Sokolov' }).click();
    await expect(maria.getByLabel('Pay from')).toContainText('Northwind Studio USD');
    await maria.getByRole('button', { name: 'Pay 25.00 USD' }).click();
    await expect(maria.getByText('Paid 25.00 USD to Ivan Sokolov')).toBeVisible();

    // Ivan's open invoice turns paid live.
    await expect(invoice.getByText(/^Paid on .* by Maria Petrova\.$/)).toBeVisible();
    await ivan.goto('./#/wallet');
    await expect(ivan.getByText('Invoice INV-', { exact: false }).first()).toBeVisible();
  });

  test('identity: the owner is verified and the company shows the verified business badge', async () => {
    await maria.goto('./#/settings?section=identity');
    await maria.getByLabel(/^Full legal name/).fill('Maria Petrova');
    await maria.getByLabel('Date of birth').fill('1991-03-02');
    await maria.getByLabel('Country or virtual country').fill('Estonia');
    await maria.getByLabel('Document number').fill('EE 1234 5678');
    await maria
      .locator('input[type=file]')
      .first()
      .setInputFiles({ name: 'passport.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('jpeg passport') });
    await expect(maria.getByText('passport.jpg')).toBeVisible();
    await maria.getByRole('button', { name: 'Send for checking' }).click();
    await expect(maria.getByText(/Passport ending in 5678/)).toBeVisible();

    await admin
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: /Identity checks/ })
      .click();
    const check = admin.locator('.identity-check', { hasText: 'Maria Petrova' });
    await expect(check.getByText('@maria')).toBeVisible();
    await check.getByRole('button', { name: 'Verify' }).click();
    await expect(admin.getByText('Maria Petrova is verified')).toBeVisible();

    await expect(maria.getByText('Verified', { exact: false }).first()).toBeVisible();
    await maria.goto('./#/companies/northwind-studio');
    await expect(maria.getByText('Verified business')).toBeVisible();
  });

  test('tech support: the owner answers with the owner badge', async () => {
    await ivan.goto('./#/support');
    await ivan.getByRole('button', { name: 'Ticket' }).click();
    await ivan.getByLabel('Subject').fill('When is my frozen part unlocked?');
    await ivan.getByLabel('How can we help?').fill('I invested in NWS today.');
    await ivan.getByRole('button', { name: 'Open ticket' }).click();
    await owner.goto('./#/support');
    await owner.getByText('When is my frozen part unlocked?').first().click();
    await owner.getByPlaceholder('Answer as support…').fill('After 90 days — the date is in your portfolio.');
    await owner.keyboard.press('Enter');
    const answer = bubble(ivan, 'After 90 days');
    await expect(answer).toBeVisible();
    await expect(answer.locator('.badge.owner')).toBeVisible();
  });

  test('chat details: rename the group', async () => {
    await openChat(maria, 'Founders');
    await maria.getByRole('button', { name: 'Chat details' }).click();
    const dialog = maria.getByRole('dialog');
    await expect(dialog.getByText('Ivan Sokolov')).toBeVisible();
    await dialog.getByLabel('Title').fill('Founders Club');
    await dialog.getByRole('button', { name: 'Save details' }).click();
    await expect(dialog.getByText('Saved')).toBeVisible();
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expect(maria.locator('.conversation-header', { hasText: 'Founders Club' })).toBeVisible();
  });

  test('reply, typing indicator, edit and delete', async () => {
    await openChat(ivan, 'Founders Club');
    await send(maria, 'Please review the budget tonight');
    await bubble(ivan, 'Please review the budget tonight').click();
    await ivan.getByRole('button', { name: 'Reply' }).click();
    await expect(ivan.getByText('Reply to Maria Petrova')).toBeVisible();
    await send(ivan, 'Will do after dinner');
    await expect(bubble(maria, 'Will do after dinner').locator('.reply-quote')).toContainText(
      'Please review',
    );

    await ivan.getByPlaceholder('Write a message…').fill('typing something');
    await expect(maria.getByText('Someone is typing…')).toBeVisible();
    await ivan.keyboard.press('Enter');
    await expect(bubble(maria, 'typing something')).toBeVisible();
    await expect(maria.locator('.typing')).toHaveText('');

    await bubble(maria, 'Please review the budget tonight').click();
    await maria.getByRole('button', { name: 'Edit' }).click();
    await maria.getByPlaceholder('Write a message…').fill('Please review the budget by 9pm');
    await maria.keyboard.press('Enter');
    await expect(bubble(ivan, 'Please review the budget by 9pm').getByText('edited')).toBeVisible();

    await send(maria, 'oops wrong chat');
    await expect(bubble(ivan, 'oops wrong chat')).toBeVisible();
    maria.once('dialog', (d) => d.accept());
    await bubble(maria, 'oops wrong chat').click();
    await maria.getByRole('button', { name: 'Delete' }).click();
    await expect(bubble(ivan, 'Message deleted')).toBeVisible();
  });

  test('unread title and background notifications', async () => {
    await ivan.goto('./#/wallet');
    await ivan.evaluate(() => {
      localStorage.setItem('ovl.notify', 'on');
      (window as unknown as { __hidden: boolean }).__hidden = true;
    });
    await send(maria, 'Are you there?');
    await expect(ivan).toHaveTitle(/^\(\d+\) OVL For Business$/);
    const notes = await ivan.evaluate(
      () => (window as unknown as { __notes: { title: string; body?: string }[] }).__notes,
    );
    expect(notes).toContainEqual({ title: 'Maria Petrova · Founders Club', body: 'Are you there?' });
    await ivan.evaluate(() => ((window as unknown as { __hidden: boolean }).__hidden = false));
  });

  test('leaving a group is announced to the others', async () => {
    await openChat(ivan, 'Founders Club');
    await ivan.getByRole('button', { name: 'Chat details' }).click();
    ivan.once('dialog', (d) => d.accept());
    await ivan.getByRole('button', { name: 'Leave group' }).click();
    await expect(ivan.getByText('Select a chat')).toBeVisible();
    await expect(maria.locator('.system-message', { hasText: 'Ivan Sokolov left the group' })).toBeVisible();
  });

  test('company owners edit the company profile', async () => {
    await maria.goto('./#/companies/northwind-studio');
    await maria.getByRole('button', { name: 'Edit profile' }).click();
    await maria.getByLabel('Website').fill('https://northwind.example.com');
    await maria.getByRole('button', { name: 'Save' }).click();
    await expect(maria.getByRole('link', { name: 'https://northwind.example.com' })).toBeVisible();
  });

  test('money: staff publish exchange rates and people convert between balances', async () => {
    await admin
      .getByRole('navigation', { name: 'Admin' })
      .getByRole('link', { name: 'Exchange rates' })
      .click();
    await admin.getByLabel('Currency to add').selectOption('EUR');
    await admin.getByRole('button', { name: 'Add currency' }).click();
    await admin.getByLabel('EUR rate').fill('1.08');
    await admin.getByRole('button', { name: 'Save rates' }).click();
    await expect(admin.getByText('Exchange rates saved')).toBeVisible();

    await maria.goto('./#/wallet');
    await maria.getByRole('button', { name: 'Convert' }).click();
    const dialog = maria.getByRole('dialog');
    await dialog.getByLabel('Amount (USD)').fill('100');
    await dialog.getByLabel('Into').selectOption('EUR');
    await expect(dialog.getByText('1 USD = 0.925925 EUR')).toBeVisible();
    await expect(dialog.getByText('92.12 EUR')).toBeVisible();
    await dialog.getByRole('button', { name: 'Convert' }).click();
    await expect(maria.getByText('Converted to 92.12 EUR')).toBeVisible();
    await expect(maria.locator('.bank-card', { hasText: 'EUR' })).toContainText('92.12');
  });

  test('multi-signature: a company payment above the limit waits for a second finance member', async () => {
    await maria.goto('./#/companies/northwind-studio');
    await maria.getByLabel('Username to add').fill('ivan');
    await maria.getByLabel('Role', { exact: true }).selectOption('accountant');
    await maria.getByRole('button', { name: 'Add / change role' }).click();
    await expect(maria.locator('.list-item', { hasText: 'Ivan Sokolov' })).toContainText('Accountant');
    await maria.getByRole('button', { name: 'Edit profile' }).click();
    await maria.getByLabel('Approval limit (USD)').fill('20');
    await maria.getByRole('button', { name: 'Save' }).click();
    await expect(maria.getByText(/Payments of 20\.00 USD or more need a second/)).toBeVisible();

    await maria.getByRole('button', { name: 'Send money' }).click();
    const dialog = maria.getByRole('dialog');
    await dialog.getByLabel('Username').fill('ivan');
    await dialog.getByLabel('Amount (USD)').fill('30');
    await dialog.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(maria.getByText(/another finance member has to approve/)).toBeVisible();
    const waiting = (page: Page) => page.locator('.list-item', { hasText: 'Transfer 30.00 USD to @ivan' });
    await expect(waiting(maria)).toContainText('Pending');
    // The investment's frozen 30.00 plus the 30.00 set aside for the payment.
    await expect(maria.getByText('60.00 frozen')).toBeVisible();

    await ivan.goto('./#/companies/northwind-studio');
    await waiting(ivan).getByRole('button', { name: 'Approve' }).click();
    await expect(ivan.getByText('Approved: Transfer 30.00 USD to @ivan')).toBeVisible();
    // Maria's page follows live: nothing waits and the money has left.
    await expect(maria.getByText('Nothing is waiting.')).toBeVisible();
    await expect(maria.getByText('30.00 frozen')).toBeVisible();
    await expect(maria.locator('.bank-card')).toContainText('45.00');
  });

  test('billing: pay an invoice in parts, recurring invoices and a payroll run', async () => {
    await ivan.goto('./#/invoices');
    await ivan.getByRole('button', { name: 'New invoice' }).click();
    // Ivan is Northwind's accountant by now; this one is personal.
    await ivan.getByLabel('From', { exact: true }).selectOption('me');
    await ivan.getByLabel('Recipient type').selectOption('user');
    await ivan.getByLabel('Recipient', { exact: true }).fill('maria');
    await ivan.getByLabel('Line 1 description').fill('Consulting retainer');
    await ivan.getByLabel('Line 1 unit price').fill('40');
    await ivan.getByLabel('Repeat').selectOption('monthly');
    await ivan.getByRole('button', { name: 'Set up recurring invoice' }).click();
    await expect(ivan.getByText(/^First invoice sent to Maria Petrova; the next goes out on/)).toBeVisible();

    // Maria pays part now and the rest later.
    await maria.goto('./#/invoices');
    await maria.locator('tr', { hasText: 'Ivan Sokolov' }).first().click();
    const dialog = maria.getByRole('dialog');
    await expect(dialog.getByText('Recurring invoice · every month')).toBeVisible();
    await dialog.getByRole('button', { name: 'Pay part of it' }).click();
    await dialog.getByLabel(/^Amount to pay now/).fill('15');
    await dialog.getByRole('button', { name: 'Pay 15.00 USD' }).click();
    await expect(maria.getByText('Paid 15.00 USD to Ivan Sokolov')).toBeVisible();
    await expect(dialog.getByText('Partly paid')).toBeVisible();
    await expect(dialog.getByText('Still due')).toBeVisible();
    await dialog.getByRole('button', { name: 'Pay 25.00 USD' }).click();
    await expect(maria.getByText('Paid 25.00 USD to Ivan Sokolov')).toBeVisible();
    await expect(dialog.locator('.invoice-doc').getByText('Paid', { exact: true })).toBeVisible();
    await maria.keyboard.press('Escape');

    // Ivan manages the recurring invoice (behind the first invoice, which opened when it was sent).
    await ivan.keyboard.press('Escape');
    await ivan.getByRole('tab', { name: 'Recurring' }).click();
    const schedule = ivan.locator('tr', { hasText: 'Maria Petrova' });
    await expect(schedule).toContainText('Every month');
    await expect(schedule).toContainText('1 invoice sent');
    await schedule.getByRole('button', { name: 'Pause' }).click();
    await expect(ivan.getByText('Recurring invoice paused')).toBeVisible();
    await expect(schedule).toContainText('Paused');

    // Northwind pays Ivan through payroll.
    await maria.goto('./#/companies/northwind-studio');
    await maria.getByRole('button', { name: 'New payroll run' }).click();
    const payroll = maria.getByRole('dialog');
    await payroll.getByLabel('Title').fill('Freelance fees');
    await payroll.getByLabel('Person 1', { exact: true }).fill('ivan');
    await payroll.getByLabel('Person 1 amount').fill('10');
    await payroll.getByLabel('Person 1 note').fill('Logo revisions');
    await expect(payroll.getByText('10.00 USD')).toBeVisible();
    await payroll.getByRole('button', { name: 'Pay 1 person' }).click();
    await expect(maria.getByText('Paid 10.00 USD to 1 person')).toBeVisible();
    await expect(maria.locator('.list-item', { hasText: 'Freelance fees' })).toContainText('Paid');
    await ivan.goto('./#/wallet');
    await expect(ivan.getByText('Northwind Studio: Freelance fees — Logo revisions')).toBeVisible();
  });

  test('documents: PDF statements and a registry certificate that verifies publicly', async ({ browser }) => {
    await maria.goto('./#/wallet');
    await maria.getByRole('button', { name: 'Export', exact: true }).click();
    const dialog = maria.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'PDF' }).click();
    await dialog.getByRole('tab', { name: 'All time' }).click();
    const [download] = await Promise.all([
      maria.waitForEvent('download'),
      dialog.getByRole('button', { name: 'Download PDF' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^ovl-statement-[a-z]{3}-\d{4}-\d{2}-\d{2}\.pdf$/);
    const pdf = Buffer.concat(await (await download.createReadStream()).toArray());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    await expect(maria.getByRole('heading', { name: 'Monthly statements' })).toBeVisible();

    // The registry links each entry to its certificate and verification page.
    await maria.goto('./#/registry');
    await maria.getByText('Northwind Studio').first().click();
    const entry = maria.getByRole('dialog');
    const certificate = entry.getByRole('link', { name: 'Certificate (PDF)' });
    const href = await certificate.getAttribute('href');
    expect(href).toMatch(/\/api\/v1\/registry\/OVL-(ORG|LIC)-\d{6}\/certificate\.pdf$/);
    const res = await maria.request.get(new URL(href!, maria.url()).toString());
    expect(res.headers()['content-type']).toBe('application/pdf');
    const number = href!.match(/OVL-(ORG|LIC)-\d{6}/)![0];

    // Anyone can check it, signed in or not.
    const strangerErrors: string[] = [];
    const stranger = await newPage(browser, strangerErrors, 'stranger');
    await stranger.goto(`./#/verify/${number}`);
    await expect(stranger.getByText('Valid', { exact: true })).toBeVisible();
    await expect(stranger.getByText(number)).toBeVisible();
    await stranger.goto('./#/verify/OVL-LIC-999999');
    await expect(stranger.getByRole('heading', { name: 'Not in the registry' })).toBeVisible();
    // The unknown number's 404 is the only thing the browser may complain about.
    expect(strangerErrors.filter((e) => !e.includes('status of 404'))).toEqual([]);
    await stranger.context().close();
  });

  test('settings: switching the theme applies instantly and is saved', async () => {
    await maria.goto('./#/settings?section=appearance');
    await maria.getByRole('radio', { name: 'Midnight' }).click();
    await expect(maria.locator('html')).toHaveAttribute('data-theme', 'midnight');
    await expect(maria.getByText('Midnight theme applied')).toBeVisible();
    await maria.reload();
    await expect(maria.locator('html')).toHaveAttribute('data-theme', 'midnight');
    await maria.getByRole('radio', { name: 'Daylight' }).click();
    await expect(maria.locator('html')).toHaveAttribute('data-theme', 'daylight');
  });

  test('multi-account: add a second account and switch between them', async () => {
    await maria
      .getByRole('button', { name: /Maria Petrova/ })
      .first()
      .click();
    await maria.getByRole('button', { name: 'Add another account' }).click();
    await expect(maria.getByRole('heading', { name: 'Add another account' })).toBeVisible();
    await maria.getByLabel('Username or email').fill('ivan');
    await maria.getByLabel('Password').fill(PASSWORD);
    await maria.getByRole('button', { name: 'Sign in', exact: true }).click();
    await greeting(maria, 'Ivan').waitFor();

    await maria
      .getByRole('button', { name: /Ivan Sokolov/ })
      .first()
      .click();
    await maria
      .getByRole('menu')
      .getByRole('button', { name: /Maria Petrova/ })
      .click();
    await greeting(maria, 'Maria').waitFor();

    // Signing out of one account falls back to the other one still signed in.
    await maria
      .getByRole('button', { name: /Maria Petrova/ })
      .first()
      .click();
    await maria.getByRole('button', { name: 'Sign out' }).click();
    await greeting(maria, 'Ivan').waitFor();
    await maria
      .getByRole('button', { name: /Ivan Sokolov/ })
      .first()
      .click();
    await maria.getByRole('button', { name: 'Add another account' }).click();
    await maria.getByLabel('Username or email').fill('maria');
    await maria.getByLabel('Password').fill(PASSWORD);
    await maria.getByRole('button', { name: 'Sign in', exact: true }).click();
    await greeting(maria, 'Maria').waitFor();
  });

  test('security: signed-in devices can be signed out remotely', async ({ browser }) => {
    // The laptop's own console will show the expected 401s after it is signed out.
    const laptop = await newPage(browser, [], 'maria-laptop');
    await login(laptop, 'maria');
    await greeting(laptop, 'Maria').waitFor();

    await maria.goto('./#/settings?section=security');
    await expect(maria.getByRole('heading', { name: 'Signed-in devices' })).toBeVisible();
    await expect(maria.getByText('This device')).toBeVisible();
    await maria.getByRole('button', { name: 'Sign out all other devices' }).click();
    await expect(maria.getByText(/Signed out \d+ other devices?/)).toBeVisible();

    // The live connection is closed and the laptop lands on the sign-in screen by itself.
    await expect(laptop.getByLabel('Username or email')).toBeVisible({ timeout: 15_000 });
    await expect(maria.getByRole('button', { name: 'Sign out all other devices' })).toHaveCount(0);
    await laptop.context().close();
  });

  test('security: two-step verification with an authenticator app', async ({ browser }) => {
    const kim = await newPage(browser, errors, 'kim');
    await register(kim, 'Kim Park', 'kim');
    await kim.goto('./#/settings?section=security');
    await kim.getByRole('button', { name: 'Turn on' }).click();
    const dialog = kim.getByRole('dialog', { name: 'Turn on two-step verification' });
    await expect(dialog.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
    const secret = (await dialog.locator('code.secret').innerText()).replace(/\s/g, '');
    await dialog.getByLabel('Code from the app').fill(await totp(secret));
    await dialog.getByRole('button', { name: 'Turn on' }).click();
    const saved = kim.getByRole('dialog', { name: 'Save your recovery codes' });
    await expect(saved.locator('.recovery-grid code')).toHaveCount(10);
    const recovery = await saved.locator('.recovery-grid code').first().innerText();
    await saved.getByRole('button', { name: 'I saved them' }).click();
    await expect(kim.getByText('10 recovery codes left')).toBeVisible();
    await kim.context().close();

    // Signing in on a new device now asks for the code (its console shows the expected 401s).
    const laptop = await newPage(browser, [], 'kim-laptop');
    await login(laptop, 'kim');
    await expect(laptop.getByText('Two-step verification')).toBeVisible();
    await laptop.getByLabel('Authentication code').fill('000000');
    await laptop.getByRole('button', { name: 'Verify' }).click();
    await expect(laptop.getByText('That code is not valid')).toBeVisible();
    await laptop.getByLabel('Authentication code').fill(await totp(secret, 1));
    await laptop.getByRole('button', { name: 'Verify' }).click();
    await greeting(laptop, 'Kim').waitFor();
    await laptop.context().close();

    // The admin panel asks for it too (then refuses: Kim is not staff). A recovery code works.
    const panel = await newPage(browser, [], 'kim-admin');
    await login(panel, 'kim', undefined, ADMIN_URL);
    await panel.getByRole('button', { name: 'Use a recovery code' }).click();
    await panel.getByLabel('Recovery code').fill(recovery);
    await panel.getByRole('button', { name: 'Verify' }).click();
    await expect(panel.getByText('This account has no access to the admin panel.')).toBeVisible();
    await panel.context().close();
  });

  test('account: confirm the email and reset a forgotten password through emailed links', async ({
    browser,
  }) => {
    const nina = await newPage(browser, errors, 'nina');
    await register(nina, 'Nina Park', 'nina');
    await expect(nina.getByText('Confirm your email address: we sent a link to')).toBeVisible();
    const link = async (to: string, path: string) => {
      const mails = (await (await fetch(`${API_URL}dev/outbox`)).json()) as { to: string; text: string }[];
      return mails.find((m) => m.to === to && m.text.includes(path))!.text.match(/https?:\S+/)![0];
    };
    await nina.goto(await link('nina@example.test', 'verify-email'));
    await expect(nina.getByRole('heading', { name: 'Email confirmed' })).toBeVisible();
    await nina.getByRole('button', { name: 'Continue' }).click();
    await greeting(nina, 'Nina').waitFor();
    await expect(nina.getByText('Confirm your email address: we sent a link to')).toBeHidden();
    const outbox = await link('nina@example.test', 'verify-email');
    expect(outbox).toContain('/#/verify-email?token=');
    // The reset below signs out every device, this one included.
    await nina.context().close();

    const guest = await newPage(browser, errors, 'guest');
    await guest.goto('./');
    await guest.getByRole('button', { name: 'Forgot password?' }).click();
    await guest.getByLabel('Email').fill('nina@example.test');
    await guest.getByRole('button', { name: 'Send reset link' }).click();
    await expect(guest.getByText('Check your inbox')).toBeVisible();
    await guest.goto(await link('nina@example.test', 'reset-password'));
    await guest.getByLabel(/^New password/).fill('a-brand-new-password');
    await guest.getByLabel('Repeat the new password').fill('a-brand-new-password');
    await guest.getByRole('button', { name: 'Set new password' }).click();
    await expect(guest.getByRole('heading', { name: 'Password changed' })).toBeVisible();
    await guest.getByRole('button', { name: 'Sign in', exact: true }).click();
    await login(guest, 'nina', 'a-brand-new-password');
    await greeting(guest, 'Nina').waitFor();
  });

  test('security: add a passkey and sign in with it', async ({ browser }) => {
    const omar = await newPage(browser, errors, 'omar');
    // Chrome's virtual authenticator stands in for Touch ID, Windows Hello or a phone.
    const cdp = await omar.context().newCDPSession(omar);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    await register(omar, 'Omar Haddad', 'omar');
    await omar.goto('./#/settings?section=security');
    await omar.getByLabel('Passkey name').fill('Work laptop');
    await omar.getByRole('button', { name: 'Add a passkey' }).click();
    await expect(omar.getByText('Passkey "Work laptop" added')).toBeVisible();
    await expect(omar.getByText('not used yet')).toBeVisible();

    // Forget the account on this device, then come back with the passkey alone.
    await omar.evaluate(() => localStorage.clear());
    await omar.goto('./');
    await omar.reload();
    await omar.getByRole('button', { name: 'Sign in with a passkey' }).click();
    await greeting(omar, 'Omar').waitFor();
    await omar.goto('./#/settings?section=security');
    await expect(omar.getByText(/last used/)).toBeVisible();
    await omar.context().close();
  });

  test('phone layout: bottom bar with a More sheet', async ({ browser }) => {
    const phone = await newPage(browser, errors, 'phone', true);
    await login(phone, 'maria');
    await greeting(phone, 'Maria').waitFor();
    await expect(phone.locator('.sidebar .nav-link:visible')).toHaveCount(5);
    await phone.getByRole('button', { name: 'More' }).click();
    await phone.getByRole('dialog', { name: 'More' }).getByText('Registry').click();
    await expect(phone.getByRole('heading', { name: 'Public registry' })).toBeVisible();
    await phone.close();
  });
});
