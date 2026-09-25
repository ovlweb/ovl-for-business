import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  hotp,
  openSecret,
  otpauthUrl,
  sealSecret,
  verifyTotp,
} from '../src/lib/totp';

// RFC 6238 appendix B uses the ASCII secret "12345678901234567890" for SHA-1.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('totp', () => {
  it('matches the RFC 6238 test vectors', () => {
    const secret = Buffer.from('12345678901234567890');
    expect(hotp(secret, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(secret, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(secret, Math.floor(2000000000 / 30), 8)).toBe('69279037');
  });

  it('accepts the current code and one step of drift, nothing else', () => {
    const at = 1_700_000_000_000;
    const step = Math.floor(at / 30_000);
    const code = hotp(base32Decode(RFC_SECRET), step);
    expect(verifyTotp(RFC_SECRET, code, at)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, at + 30_000)).toBe(step);
    expect(verifyTotp(RFC_SECRET, code, at + 90_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', at)).toBeNull();
  });

  it('round-trips base32 and sealed secrets', () => {
    const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(bytes))).toEqual(bytes);
    const sealed = sealSecret(RFC_SECRET, 'server-secret-server-secret-123456');
    expect(sealed).not.toContain(RFC_SECRET);
    expect(openSecret(sealed, 'server-secret-server-secret-123456')).toBe(RFC_SECRET);
    expect(() => openSecret(sealed, 'another-secret-another-secret-9999')).toThrow();
  });

  it('builds authenticator links and unique recovery codes', () => {
    expect(otpauthUrl('ABC', 'maria', 'OVL For Business')).toBe(
      'otpauth://totp/OVL%20For%20Business%3Amaria?secret=ABC&issuer=OVL+For+Business&algorithm=SHA1&digits=6&period=30',
    );
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{5}-[a-z2-9]{5}$/);
  });
});
