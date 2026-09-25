import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestApp } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
});
afterAll(() => app.close());

/** The token of the newest email to `to` whose link goes to `path`. */
const tokenFrom = (to: string, path: string) => {
  const mail = app.mailer.outbox.find((m) => m.to === to && m.text.includes(path));
  return mail?.text.match(new RegExp(`${path}\\?token=([\\w-]+)`))?.[1];
};

describe('email confirmation', () => {
  it('sends a link at sign-up that confirms the address once', async () => {
    const ann = await api.register('ann');
    expect((await api.get('/me', ann)).body.emailVerified).toBe(false);
    const mail = app.mailer.outbox[0]!;
    expect(mail).toMatchObject({ to: 'ann@example.test', subject: 'Confirm your email address' });
    expect(mail.html).toContain('Confirm email');
    const token = tokenFrom('ann@example.test', 'verify-email')!;
    expect(token).toBeTruthy();

    expect((await api.post('/auth/verify-email', null, { token: 'x'.repeat(40) })).status).toBe(400);
    const ok = await api.post('/auth/verify-email', null, { token });
    expect(ok.body).toEqual({ email: 'ann@example.test' });
    expect((await api.get('/me', ann)).body.emailVerified).toBe(true);
    expect((await api.post('/auth/verify-email', null, { token })).body.error).toBe('invalid_link');
    expect((await api.post('/me/email/verification', ann)).status).toBe(409);
  });

  it('changing the email needs the password, warns the old address and asks to confirm the new one', async () => {
    const ben = await api.register('ben');
    const firstLink = tokenFrom('ben@example.test', 'verify-email')!;
    expect(
      (await api.post('/me/email', ben, { email: 'ann@example.test', password: 'password-123' })).status,
    ).toBe(409);
    expect((await api.post('/me/email', ben, { email: 'ben@work.test', password: 'nope' })).status).toBe(400);
    const changed = await api.post('/me/email', ben, { email: 'Ben@Work.test', password: 'password-123' });
    expect(changed.body).toMatchObject({ email: 'ben@work.test', emailVerified: false });
    expect(app.mailer.outbox.some((m) => m.to === 'ben@example.test' && m.subject.includes('changed'))).toBe(
      true,
    );
    // The link sent to the old address no longer confirms anything.
    expect((await api.post('/auth/verify-email', null, { token: firstLink })).status).toBe(400);
    const token = tokenFrom('ben@work.test', 'verify-email')!;
    expect((await api.post('/auth/verify-email', null, { token })).status).toBe(200);
    expect(
      (await api.post('/auth/login', null, { login: 'ben@work.test', password: 'password-123' })).status,
    ).toBe(200);
  });
});

describe('password reset', () => {
  it('emails a one-hour link that sets a new password and signs out every device', async () => {
    const cat = await api.register('cat');
    const before = app.mailer.outbox.length;
    expect((await api.post('/auth/password/forgot', null, { email: 'nobody@example.test' })).status).toBe(
      202,
    );
    expect(app.mailer.outbox.length).toBe(before);

    expect((await api.post('/auth/password/forgot', null, { email: 'CAT@example.test' })).status).toBe(202);
    const token = tokenFrom('cat@example.test', 'reset-password')!;
    expect(token).toBeTruthy();
    // Only the newest link works.
    await api.post('/auth/password/forgot', null, { email: 'cat@example.test' });
    const newest = tokenFrom('cat@example.test', 'reset-password')!;
    expect(newest).not.toBe(token);
    expect((await api.post('/auth/password/reset', null, { token, password: 'brand-new-pass' })).status).toBe(
      400,
    );

    expect(
      (await api.post('/auth/password/reset', null, { token: newest, password: 'brand-new-pass' })).status,
    ).toBe(204);
    expect((await api.get('/me', cat)).status).toBe(401);
    expect((await api.post('/auth/login', null, { login: 'cat', password: 'password-123' })).status).toBe(
      401,
    );
    const signedIn = await api.login('cat', 'brand-new-pass');
    // Opening the emailed link also proves the address.
    expect((await api.get('/me', signedIn)).body.emailVerified).toBe(true);
    expect(app.mailer.outbox[0]).toMatchObject({
      to: 'cat@example.test',
      subject: 'Your password was changed',
    });
    expect(
      (await api.post('/auth/password/reset', null, { token: newest, password: 'another-pass-1' })).status,
    ).toBe(400);
  });
});
