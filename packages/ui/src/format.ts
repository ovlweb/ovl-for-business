import { OvlApiError } from '@ovl/sdk';
import { getCurrency, isCurrency } from '@ovl/shared';

/** "1234567.5" + "USD" → "1,234,567.50 USD" without losing precision. */
export function formatMoney(amount: string, currency: string, withCode = true): string {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = amount.replace('-', '').split('.');
  const decimals = isCurrency(currency) ? getCurrency(currency).decimals : fraction.length;
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const frac = decimals ? `.${fraction.padEnd(decimals, '0').slice(0, decimals)}` : '';
  return `${negative ? '−' : ''}${grouped}${frac}${withCode ? ` ${currency}` : ''}`;
}

export function formatDate(iso: string, withTime = true): string {
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString(undefined, { dateStyle: 'medium' });
}

export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} d ago`;
  return formatDate(iso, false);
}

export function shortTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function errorMessage(error: unknown): string {
  if (error instanceof OvlApiError) {
    const details = error.details as
      { path?: string; message?: string }[] | { missing?: string[] } | undefined;
    if (Array.isArray(details) && details.length) {
      return details
        .map((d) => `${d.path?.replace(/^\//, '').replace(/\//g, '.') || 'input'}: ${d.message}`)
        .join('\n');
    }
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong';
}

export function humanize(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

/** "1 operation", "3 operations"; pass `many` for irregular words. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}
