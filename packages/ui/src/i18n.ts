import { intlTag, isLocale, LOCALES, pluralize, translate, type Locale, type TextValue } from '@ovl/shared';
import { useSyncExternalStore } from 'react';

/**
 * The language of this browser tab. `t('Send money')`, `t('Bought {0} shares', n)`; the catalog
 * and the rules live in @ovl/shared, so the server speaks the same language (errors,
 * notifications). The account keeps the choice (preferences.locale) for every device.
 */
export { LOCALE_NAMES, LOCALES, msg, type Locale } from '@ovl/shared';

const STORAGE_KEY = 'ovl.locale';

function detect(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  const browser = typeof navigator === 'undefined' ? 'en' : navigator.language.toLowerCase();
  return browser.startsWith('ru') ? 'ru' : 'en';
}

let current: Locale = detect();
const listeners = new Set<() => void>();
if (typeof document !== 'undefined') document.documentElement.lang = current;

export const getLocale = (): Locale => current;

/** BCP 47 tag for Intl (dates, numbers); English follows the browser's region. */
export const intlLocale = (): string | undefined => intlTag(current);

export function setLocale(locale: Locale) {
  if (!(LOCALES as readonly string[]).includes(locale) || locale === current) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    /* storage unavailable */
  }
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const l of listeners) l();
}

/** The current language; components that use it re-render when it changes. */
export function useLocale(): Locale {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
    () => current,
  );
}

/** Translate English UI text; `{0}`, `{1}`… are replaced by the values. */
export function t(source: string, ...values: TextValue[]): string {
  return translate(current, source, values);
}

/** "1 operation", "3 operations" (in Russian: "1 операция", "3 операции", "5 операций"). */
export function plural(count: number, one: string, many = `${one}s`): string {
  return pluralize(current, count, one, many);
}

/** Follow the language saved in an account (from any device), unless this one already shows it. */
export function syncLocale(locale: string | undefined | null) {
  if (isLocale(locale) && locale !== current) setLocale(locale);
}

/**
 * A message's text: system lines from the server ("Maria added Oleg") in the reader's language.
 * Names stay as they are; values the server marks as { label } are translated too.
 */
export function messageBody(message: { body: string; meta?: Record<string, unknown> }): string {
  const text = message.meta?.text as { key?: unknown; values?: unknown } | undefined;
  if (!text || typeof text.key !== 'string' || !Array.isArray(text.values)) return message.body;
  return t(
    text.key,
    ...text.values.map((v) =>
      v && typeof v === 'object' && typeof (v as { label?: unknown }).label === 'string'
        ? t((v as { label: string }).label)
        : (v as TextValue),
    ),
  );
}
