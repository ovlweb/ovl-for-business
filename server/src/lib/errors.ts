import { asLocalText, english, type LocalText, type Text } from './i18n';

/** An error people see: `text` is translated for them when it is sent (see lib/i18n). */
export class HttpError extends Error {
  readonly text: LocalText;
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: Text,
    public readonly details?: unknown,
  ) {
    super(english(message));
    this.text = asLocalText(message);
  }
}

export const badRequest = (message: Text, details?: unknown) =>
  new HttpError(400, 'bad_request', message, details);
export const unauthorized = (message: Text = 'Authentication required') =>
  new HttpError(401, 'unauthorized', message);
export const forbidden = (message: Text = 'You do not have permission to do this') =>
  new HttpError(403, 'forbidden', message);
/** notFound('Invoice') → "Invoice not found". */
export const notFound = (what = 'Resource') => new HttpError(404, 'not_found', `${what} not found`);
export const conflict = (message: Text) => new HttpError(409, 'conflict', message);
export const insufficientFunds = (message: Text = 'Insufficient available funds') =>
  new HttpError(409, 'insufficient_funds', message);

/** Postgres unique violation. */
export function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === '23505' || e?.cause?.code === '23505';
}
