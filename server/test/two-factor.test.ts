import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, timeStep } from '../src/lib/totp';
import { client, createTestApp } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
});
afterAll(() => app.close());

const code = (secret: string, offset = 0) => hotp(base32Decode(secret), timeStep() + offset);
const login = (extra: Record<string, string> = {}) =>
  api.post('/auth/login', null, { login: 'zoe', password: 'password-123', ...extra });

describe('two-factor authentication', () => {
  let zoe: Awaited<ReturnType<typeof api.register>>;
  let recovery: string[] = [];

  it('enables with an authenticator, then requires a code at sign-in', async () => {
    zoe = await api.register('zoe');
    expect((await api.get('/me/2fa', zoe)).body).toEqual({
      enabled: false,
      enabledAt: null,
      recoveryCodesLeft: 0,
    });

    const setup = await api.post('/me/2fa/setup', zoe);
    expect(setup.status).toBe(200);
    expect(setup.body.qr).toMatch(/^data:image\/png;base64,/);
    expect(setup.body.otpauthUrl).toContain('otpauth://totp/OVL%20For%20Business%3Azoe');
    const secret: string = setup.body.secret;

    expect((await api.post('/me/2fa/enable', zoe, { code: '000000' })).status).toBe(400);
    const enabled = await api.post('/me/2fa/enable', zoe, { code: code(secret) });
    expect(enabled.status).toBe(200);
    recovery = enabled.body.recoveryCodes;
    expect(recovery).toHaveLength(10);
    expect((await api.get('/me', zoe)).body.twoFactorEnabled).toBe(true);

    const noCode = await login();
    expect(noCode.status).toBe(401);
    expect(noCode.body.error).toBe('two_factor_required');
    expect((await login({ code: '123456' })).body.error).toBe('invalid_two_factor_code');

    // The next code works once; replaying it fails.
    const next = code(secret, 1);
    expect((await login({ code: next })).status).toBe(200);
    expect((await login({ code: next })).body.error).toBe('invalid_two_factor_code');

    // Recovery codes work once each, with or without the dash and in any case.
    const withRecovery = await login({ code: recovery[0]!.toUpperCase().replace('-', ' ') });
    expect(withRecovery.status).toBe(200);
    expect((await login({ code: recovery[0]! })).status).toBe(401);
    expect((await api.get('/me/2fa', zoe)).body.recoveryCodesLeft).toBe(9);
  });

  it('replaces recovery codes and turns off with the password and a code', async () => {
    const replaced = await api.post('/me/2fa/recovery-codes', zoe, { code: recovery[1]! });
    expect(replaced.status).toBe(200);
    const fresh: string[] = replaced.body.recoveryCodes;
    expect(fresh).not.toContain(recovery[2]);
    expect((await login({ code: recovery[2]! })).body.error).toBe('invalid_two_factor_code');

    expect((await api.post('/me/2fa/disable', zoe, { password: 'nope', code: fresh[0]! })).status).toBe(400);
    expect(
      (await api.post('/me/2fa/disable', zoe, { password: 'password-123', code: fresh[0]! })).status,
    ).toBe(204);
    expect((await api.get('/me', zoe)).body.twoFactorEnabled).toBe(false);
    expect((await login()).status).toBe(200);
  });
});
