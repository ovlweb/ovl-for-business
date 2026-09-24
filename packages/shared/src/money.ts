import { getCurrency } from './currencies';

/**
 * Money is stored as integer minor units (e.g. cents) in a bigint and exchanged
 * over the API as decimal strings ("1250.50") together with a currency code.
 */

const AMOUNT_RE = /^(\d{1,24})(?:\.(\d+))?$/;

export class MoneyError extends Error {}

/** Parse a positive decimal string into minor units for the given currency. */
export function parseAmount(input: string, currency: string): bigint {
  const { decimals } = getCurrency(currency);
  const match = AMOUNT_RE.exec(input.trim());
  if (!match) throw new MoneyError('Amount must be a positive decimal number like "100" or "99.95"');
  const whole = match[1]!;
  const fraction = match[2] ?? '';
  if (fraction.length > decimals) {
    throw new MoneyError(`${currency} supports at most ${decimals} decimal places`);
  }
  return BigInt(whole + fraction.padEnd(decimals, '0'));
}

/** Format minor units as a plain decimal string ("-12.50"). */
export function formatAmount(minor: bigint | string | number, currency: string): string {
  const { decimals } = getCurrency(currency);
  let value = BigInt(minor);
  const negative = value < 0n;
  if (negative) value = -value;
  const digits = value.toString().padStart(decimals + 1, '0');
  const whole = decimals ? digits.slice(0, -decimals) : digits;
  const fraction = decimals ? digits.slice(-decimals) : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Take `basisPoints` / 10000 of an amount, rounding down. */
export function percentOf(amount: bigint, basisPoints: number): bigint {
  return (amount * BigInt(basisPoints)) / 10000n;
}
