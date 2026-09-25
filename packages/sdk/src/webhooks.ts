/**
 * Check that a webhook delivery really comes from OVL For Business: the X-OVL-Signature header is
 * "t=<unix seconds>,v1=<hex HMAC-SHA256 of '<t>.<raw body>' with your endpoint secret>".
 * Pass the raw request body (before JSON parsing). Works in Node 18+, Deno, Bun and browsers.
 */
export async function verifyWebhookSignature(
  secret: string,
  signatureHeader: string | null | undefined,
  rawBody: string,
  toleranceSeconds = 300,
): Promise<boolean> {
  const match = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(signatureHeader ?? '');
  if (!match) return false;
  const timestamp = Number(match[1]);
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(
    await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`)),
  );
  const expected = [...mac].map((b) => b.toString(16).padStart(2, '0')).join('');
  // Constant-time comparison.
  let diff = expected.length ^ match[2]!.length;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ match[2]!.charCodeAt(i);
  return diff === 0;
}
