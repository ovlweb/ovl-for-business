import { expect, test, type Page } from '@playwright/test';
import { ADMIN_URL, OWNER_PASSWORD } from '../constants';
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
    await admin.getByRole('heading', { name: 'Dashboard' }).waitFor();
    await admin.getByRole('link', { name: 'Cash desk' }).click();
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

  test('company application: moderation checklist, approval, registry and exchange', async () => {
    await maria.goto('./#/applications?new=company');
    await maria.getByLabel('Company name').fill('Northwind Studio');
    await maria.getByLabel('Description').fill('Virtual game studio making strategy games.');
    await maria.getByLabel('Business plan').fill('Sell games and sponsorships in virtual worlds.');
    await maria.getByText('List the company on the stock exchange').click();
    await maria.getByLabel('Ticker').fill('NWS');
    await maria.getByLabel('Share price (USD)').fill('5');
    await maria.getByLabel('Total shares').fill('1000');
    await maria.getByRole('button', { name: 'Submit application' }).click();
    await maria.getByRole('heading', { name: 'Your applications' }).waitFor();

    await owner.goto('./#/review');
    await owner.getByText('Northwind Studio').first().click();
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
    await maria.getByRole('button', { name: 'Sign in' }).click();
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
    await maria.getByRole('button', { name: 'Sign in' }).click();
    await greeting(maria, 'Maria').waitFor();
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
