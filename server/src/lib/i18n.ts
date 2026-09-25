import {
  DEFAULT_LOCALE,
  fill,
  isLocale,
  localeFromHeader,
  translate,
  type Locale,
  type TextValue,
} from '@ovl/shared';
import type { FastifyRequest } from 'fastify';

/** A value that is itself text to translate (a workflow's name), not a name or a number. */
export interface Label {
  label: string;
}
export const label = (value: string): Label => ({ label: value });
type Value = TextValue | Label;

/**
 * What the server says to people (errors, notifications, emails, chat events) is English text
 * with {0}, {1}… for values, translated with the shared catalog when it is sent: into the
 * language a request asks for (Accept-Language) or the one an account keeps (preferences.locale).
 * Names and numbers among the values stay as they are; label() marks one that is text itself.
 */
export interface LocalText {
  key: string;
  values: Value[];
}
export type Text = string | LocalText;

/** text`This invoice is already ${status}` → { key: 'This invoice is already {0}', values: [status] }. */
export function text(strings: TemplateStringsArray, ...values: Value[]): LocalText {
  return { key: strings.reduce((key, part, i) => `${key}{${i - 1}}${part}`), values };
}

const isLabel = (value: Value): value is Label => typeof value === 'object' && value !== null;

export const asLocalText = (value: Text): LocalText =>
  typeof value === 'string' ? { key: value, values: [] } : value;

/** The English text. */
export const english = (value: Text): string =>
  typeof value === 'string'
    ? value
    : fill(
        value.key,
        value.values.map((v) => (isLabel(v) ? v.label : v)),
      );

/** A value in a sentence: a label is translated, a code (partly_paid) becomes a word; names stay. */
function word(locale: Locale, value: Value): TextValue {
  if (isLabel(value)) return translate(locale, value.label);
  if (typeof value !== 'string' || !value) return value;
  if (/^[a-z]+(_[a-z]+)*$/.test(value)) {
    const label = value.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
    const translated = translate(locale, label);
    if (translated !== label) return translated.toLowerCase();
  }
  return value;
}

/** The text in a language. */
export function say(locale: Locale, value: Text): string {
  const { key, values } = asLocalText(value);
  if (locale === DEFAULT_LOCALE) return english(value);
  return translate(
    locale,
    key,
    values.map((v) => word(locale, v)),
  );
}

/** The language a request asks for. The apps send the one people picked. */
export const requestLocale = (req: FastifyRequest): Locale =>
  localeFromHeader(req.headers['accept-language']);

/** The language an account keeps (for notifications and emails, which have no request). */
export function userLocale(preferences: unknown): Locale {
  const locale = (preferences as { locale?: unknown } | null | undefined)?.locale;
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}
