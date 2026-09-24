import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived download links ("<payload>.<mac>", base64url) for apps that hand a file to the
 * system browser and cannot send an Authorization header. The format is deliberately not a JWT,
 * so a link can never be mistaken for an access token, and the key is derived separately.
 */
function linkKey(serverSecret: string): Buffer {
  return Buffer.from(hkdfSync('sha256', serverSecret, 'ovl-for-business', 'download-links-v1', 32));
}

export function signLink(payload: Record<string, unknown>, serverSecret: string, ttlMs: number): string {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlMs })).toString('base64url');
  const mac = createHmac('sha256', linkKey(serverSecret)).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** The payload of a valid, unexpired link, or null. */
export function openLink<T extends Record<string, unknown>>(link: string, serverSecret: string): T | null {
  const [body, mac, extra] = link.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = createHmac('sha256', linkKey(serverSecret)).update(body).digest();
  const given = Buffer.from(mac, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let payload: T & { exp?: unknown };
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
  return payload;
}
