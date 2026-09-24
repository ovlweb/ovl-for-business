import type { Browser, Page } from '@playwright/test';

export const PASSWORD = 'password-123';

/** Records notifications instead of showing them, and lets a test pretend the tab is hidden. */
function notificationStub() {
  const w = window as unknown as {
    __notes: { title: string; body?: string }[];
    __hidden: boolean;
    Notification: unknown;
  };
  w.__notes = [];
  w.__hidden = false;
  Object.defineProperty(document, 'hidden', { get: () => w.__hidden });
  function FakeNotification(title: string, options?: { body?: string }) {
    w.__notes.push({ title, body: options?.body });
    return { close() {}, onclick: null };
  }
  FakeNotification.permission = 'granted';
  FakeNotification.requestPermission = async () => 'granted';
  w.Notification = FakeNotification;
}

export async function newPage(
  browser: Browser,
  errors: string[],
  label: string,
  mobile = false,
): Promise<Page> {
  const context = await browser.newContext(
    mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : {},
  );
  await context.addInitScript(notificationStub);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`[${label}] ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && errors.push(`[${label}] ${m.text()}`));
  return page;
}

/** The home screen greets people by their first name. */
export function greeting(page: Page, firstName: string) {
  return page.getByRole('heading', {
    name: new RegExp(`^Good (morning|afternoon|evening|night), ${firstName}$`),
  });
}

export async function register(page: Page, displayName: string, username: string) {
  await page.goto('./');
  await page.getByRole('tab', { name: 'Create account' }).click();
  await page.getByLabel('Display name').fill(displayName);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Email').fill(`${username}@example.test`);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
  await skipOnboarding(page, displayName.split(' ')[0]!);
}

/** First sign-in shows the setup tour; tests that are not about it skip it. */
export async function skipOnboarding(page: Page, firstName: string) {
  await page.getByRole('button', { name: 'Skip setup' }).click();
  await greeting(page, firstName).waitFor();
}

export async function login(page: Page, username: string, password = PASSWORD, url = './') {
  await page.goto(url);
  await page.getByLabel('Username or email').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function openChat(page: Page, title: string) {
  await page.goto('./#/chats');
  await page.locator('.chat-item', { hasText: title }).first().click();
  await page.getByPlaceholder('Write a message…').waitFor();
}

export async function send(page: Page, text: string) {
  await page.getByPlaceholder('Write a message…').fill(text);
  await page.keyboard.press('Enter');
  await bubble(page, text).waitFor();
}

export function bubble(page: Page, text: string) {
  return page.locator('.bubble', { hasText: text }).first();
}

/** The current authenticator code for a base32 secret (RFC 6238), like a phone app would show. */
export async function totp(secretBase32: string, offsetSteps = 0): Promise<string> {
  const { createHmac } = await import('node:crypto');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secretBase32.replace(/\s/g, '')) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  return ((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}
