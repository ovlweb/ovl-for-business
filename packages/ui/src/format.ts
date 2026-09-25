import { OvlApiError } from '@ovl/sdk';
import { getCurrency, isCurrency } from '@ovl/shared';
import { getLocale, intlLocale, t } from './i18n';

/** "1234567.5" + "USD" → "1,234,567.50 USD" without losing precision. */
export function formatMoney(amount: string, currency: string, withCode = true): string {
  const negative = amount.startsWith('-');
  const [whole = '0', fraction = ''] = amount.replace('-', '').split('.');
  const decimals = isCurrency(currency) ? getCurrency(currency).decimals : fraction.length;
  // 1,234.50 in English; 1 234,50 in Russian.
  const [group, point] = getLocale() === 'ru' ? ['\u00a0', ','] : [',', '.'];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, group);
  const frac = decimals ? `${point}${fraction.padEnd(decimals, '0').slice(0, decimals)}` : '';
  return `${negative ? '−' : ''}${grouped}${frac}${withCode ? ` ${currency}` : ''}`;
}

export function formatDate(iso: string, withTime = true): string {
  const d = new Date(iso);
  return withTime
    ? d.toLocaleString(intlLocale(), { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString(intlLocale(), { dateStyle: 'medium' });
}

export function timeAgo(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return t('just now');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{0} min ago', minutes);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return t('{0} h ago', hours);
  const days = Math.round(hours / 24);
  if (days < 30) return t('{0} d ago', days);
  return formatDate(iso, false);
}

export function shortTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString(intlLocale(), { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(intlLocale(), { day: 'numeric', month: 'short' });
}

export function errorMessage(error: unknown): string {
  if (error instanceof OvlApiError) {
    const details = error.details as
      { path?: string; message?: string }[] | { missing?: string[] } | undefined;
    if (Array.isArray(details) && details.length) {
      return details
        .map((d) => `${d.path?.replace(/^\//, '').replace(/\//g, '.') || 'input'}: ${t(d.message ?? '')}`)
        .join('\n');
    }
    return t(error.message);
  }
  if (error instanceof Error) return t(error.message);
  return t('Something went wrong');
}

/** "changes_requested" → "Changes requested" (translated). */
export function humanize(key: string): string {
  return t(
    key
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .replace(/_/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase()),
  );
}
