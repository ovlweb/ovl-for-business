import type { FastifyBaseLogger } from 'fastify';
import nodemailer from 'nodemailer';
import type { Locale } from '@ovl/shared';
import type { Config } from '../config';
import { say, type Text } from './i18n';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
  /** The latest messages when no SMTP server is configured (development and tests). */
  readonly outbox: MailMessage[];
}

const OUTBOX_SIZE = 50;

/**
 * SMTP when SMTP_URL is set; otherwise messages are kept in a small in-memory outbox and
 * logged, so sign-up and password reset work on a laptop without a mail server.
 */
export function createMailer(config: Config, log: FastifyBaseLogger): Mailer {
  const outbox: MailMessage[] = [];
  if (config.SMTP_URL) {
    const transport = nodemailer.createTransport(config.SMTP_URL);
    return {
      outbox,
      async send(message) {
        await transport.sendMail({ from: config.MAIL_FROM, ...message });
      },
    };
  }
  return {
    outbox,
    async send(message) {
      outbox.unshift(message);
      outbox.length = Math.min(outbox.length, OUTBOX_SIZE);
      if (config.NODE_ENV === 'production') {
        log.warn({ to: message.to, subject: message.subject }, 'SMTP_URL is not set; email not delivered');
      } else {
        log.info(
          { to: message.to, subject: message.subject, text: message.text },
          'email (not sent: no SMTP_URL)',
        );
      }
    },
  };
}

const escape = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A plain, readable email with one call-to-action button, in the recipient's language. */
export function actionEmail(email: {
  to: string;
  /** The recipient's language (userLocale(user.preferences)); English by default. */
  locale?: Locale;
  subject: Text;
  greeting: Text;
  lines: Text[];
  action?: { label: Text; url: string };
  /** Extra links listed under the text (e.g. one download per document). */
  links?: { label: string; url: string }[];
  footer?: Text;
}): MailMessage {
  const locale = email.locale ?? 'en';
  const opts = {
    subject: say(locale, email.subject),
    greeting: say(locale, email.greeting),
    lines: email.lines.map((l) => say(locale, l)),
    action: email.action && { label: say(locale, email.action.label), url: email.action.url },
    links: email.links,
    footer: email.footer === undefined ? undefined : say(locale, email.footer),
  };
  const text = [
    opts.greeting,
    '',
    ...opts.lines,
    ...(opts.links?.length ? ['', ...opts.links.map((l) => `${l.label}: ${l.url}`)] : []),
    ...(opts.action ? ['', `${opts.action.label}: ${opts.action.url}`] : []),
    ...(opts.footer ? ['', opts.footer] : []),
    '',
    '— OVL For Business',
  ].join('\n');
  const button = opts.action
    ? `<p style="margin:24px 0"><a href="${escape(opts.action.url)}" style="background:#2563eb;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">${escape(opts.action.label)}</a></p>
       <p style="color:#64748b;font-size:13px">${escape(say(locale, 'Or open this link:'))} <br><a href="${escape(opts.action.url)}" style="color:#2563eb;word-break:break-all">${escape(opts.action.url)}</a></p>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Inter,system-ui,sans-serif;color:#0f172a">
  <div style="max-width:520px;margin:32px auto;background:#fff;border:1px solid #e3e8f0;border-radius:16px;padding:28px">
    <div style="font-weight:800;font-size:18px;margin-bottom:18px">OVL For Business</div>
    <p>${escape(opts.greeting)}</p>
    ${opts.lines.map((l) => `<p style="line-height:1.5">${escape(l)}</p>`).join('')}
    ${
      opts.links?.length
        ? `<ul style="padding-left:18px;line-height:1.8">${opts.links
            .map((l) => `<li><a href="${escape(l.url)}" style="color:#2563eb">${escape(l.label)}</a></li>`)
            .join('')}</ul>`
        : ''
    }
    ${button}
    ${opts.footer ? `<p style="color:#64748b;font-size:13px">${escape(opts.footer)}</p>` : ''}
  </div></body></html>`;
  return { to: email.to, subject: opts.subject, text, html };
}
