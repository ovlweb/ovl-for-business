import { ru, ruPlurals } from './locales/ru';

/**
 * Languages. The English text is the key: translate('ru', 'Send money'), with {0}, {1}… for
 * values. A missing translation falls back to English, so nobody ever sees a key. The web client,
 * the admin panel and the server (errors, notifications) share this catalog; the native apps get a
 * generated copy (scripts/i18n/build-catalog.ts).
 */
export const LOCALES = ['en', 'ru'] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', ru: 'Русский' };
export const DEFAULT_LOCALE: Locale = 'en';

export const isLocale = (value: unknown): value is Locale => (LOCALES as readonly unknown[]).includes(value);

export type TextValue = string | number | bigint | null | undefined;

const catalogs: Record<Locale, Record<string, string>> = { en: {}, ru };
/** Plural forms of nouns counted with plural(): English "one" → [one, few, many]. */
const pluralForms: Record<Locale, Record<string, readonly [string, string, string]>> = {
  en: {},
  ru: ruPlurals,
};

/** Text defined outside a component (a table of labels): marked here, translated with t() where shown. */
export const msg = <T extends string>(source: T): T => source;

/** BCP 47 tag for Intl (dates, numbers); English follows the runtime's region. */
export const intlTag = (locale: Locale): string | undefined => (locale === 'ru' ? 'ru-RU' : undefined);

/** Replace {0}, {1}… with the values. */
export function fill(text: string, values: readonly TextValue[]): string {
  return values.length ? text.replace(/\{(\d+)\}/g, (_, i: string) => String(values[Number(i)] ?? '')) : text;
}

export function translate(locale: Locale, source: string, values: readonly TextValue[] = []): string {
  return fill(catalogs[locale][source] ?? source, values);
}

/** Which of [one, few, many] a count takes. */
export function pluralIndex(locale: Locale, count: number): 0 | 1 | 2 {
  if (locale === 'ru') {
    const n = Math.abs(count) % 100;
    const last = n % 10;
    if (n >= 11 && n <= 14) return 2;
    if (last === 1) return 0;
    if (last >= 2 && last <= 4) return 1;
    return 2;
  }
  return count === 1 ? 0 : 2;
}

/** "1 operation", "3 operations" (in Russian: "1 операция", "3 операции", "5 операций"). */
export function pluralize(locale: Locale, count: number, one: string, many = `${one}s`): string {
  const forms = pluralForms[locale][one];
  const number = count.toLocaleString(intlTag(locale));
  if (forms) return `${number} ${forms[pluralIndex(locale, count)]}`;
  return `${number} ${translate(locale, count === 1 ? one : many)}`;
}

/** The best language for an Accept-Language header ("ru-RU,ru;q=0.9,en;q=0.8" → ru); English otherwise. */
export function localeFromHeader(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => /^\s*q=([\d.]+)/.exec(p)?.[1]).find(Boolean);
      return { base: tag.toLowerCase().split('-')[0], q: q === undefined ? 1 : Number(q), index };
    })
    .filter((e) => e.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return (ranked.find((e) => isLocale(e.base))?.base as Locale | undefined) ?? DEFAULT_LOCALE;
}
