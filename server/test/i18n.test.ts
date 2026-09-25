import { localeFromHeader, pluralize, translate } from '@ovl/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conflict, notFound } from '../src/lib/errors';
import { label, say, text } from '../src/lib/i18n';
import { client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let ann: Session;
let bob: Session;

const asRussian = (method: 'GET' | 'POST', url: string, body?: unknown, session?: Session) =>
  app.inject({
    method,
    url: `/api/v1${url}`,
    headers: {
      'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8',
      ...(session ? { authorization: `Bearer ${session.token}` } : {}),
    },
    payload: body as never,
  });

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  ann = await api.register('ann');
  bob = await api.register('bob');
  await api.deposit(ann, 'USD', '100');
});

afterAll(async () => {
  await app.close();
});

describe('the shared catalog', () => {
  it('translates, falls back to English and fills values', () => {
    expect(translate('ru', 'Chats')).toBe('Чаты');
    expect(translate('en', 'Chats')).toBe('Chats');
    expect(translate('ru', 'Not in the catalog')).toBe('Not in the catalog');
    expect(translate('ru', 'Invoice {0}', ['INV-7'])).toBe('Счёт INV-7');
  });

  it('knows Russian plural forms', () => {
    expect(pluralize('ru', 1, 'share')).toBe('1 акция');
    expect(pluralize('ru', 3, 'share')).toBe('3 акции');
    expect(pluralize('ru', 5, 'share')).toBe('5 акций');
    expect(pluralize('ru', 11, 'share')).toBe('11 акций');
    expect(pluralize('ru', 21, 'share')).toBe('21 акция');
    expect(pluralize('ru', 24, 'share')).toBe('24 акции');
    expect(pluralize('en', 1, 'share')).toBe('1 share');
    expect(pluralize('en', 2, 'person', 'people')).toBe('2 people');
  });

  it('reads Accept-Language', () => {
    expect(localeFromHeader('ru-RU,ru;q=0.9,en;q=0.8')).toBe('ru');
    expect(localeFromHeader('de-DE,de;q=0.9,ru;q=0.5')).toBe('ru');
    expect(localeFromHeader('en-US,ru;q=0.5')).toBe('en');
    expect(localeFromHeader('ru;q=0, en')).toBe('en');
    expect(localeFromHeader(undefined)).toBe('en');
  });
});

describe('server text', () => {
  it('keeps values out of the key and shows codes as words', () => {
    const error = conflict(text`This invoice is already ${'paid'}`);
    expect(error.message).toBe('This invoice is already paid');
    expect(error.text).toEqual({ key: 'This invoice is already {0}', values: ['paid'] });
    expect(say('ru', error.text)).toBe('Статус счёта уже: оплачен');
    expect(say('ru', notFound('Invoice').text)).toBe('Счёт не найден');
    // Names stay as they are, even when they read like text; label() marks text.
    expect(say('ru', text`${'Chats'} closed the ticket`)).toBe('Chats закрыл(а) обращение');
    expect(say('ru', text`Your application was approved: ${label('Company registration')}`)).toBe(
      'Ваша заявка одобрена: Регистрация компании',
    );
    expect(say('en', text`Your application was approved: ${label('Company registration')}`)).toBe(
      'Your application was approved: Company registration',
    );
  });

  it('answers errors in the language the app asks for', async () => {
    const wrong = await asRussian('POST', '/auth/login', { login: 'ann', password: 'not-the-password' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().message).toBe('Неверное имя пользователя / почта или пароль');

    const english = await api.post('/auth/login', null, { login: 'ann', password: 'not-the-password' });
    expect(english.body.message).toBe('Wrong username / email or password');

    const missing = await asRussian('GET', '/invoices/00000000-0000-4000-8000-000000000000', undefined, ann);
    expect(missing.json()).toMatchObject({ error: 'not_found', message: 'Счёт не найден' });

    const invalid = await asRussian('POST', '/auth/register', { username: 'x' });
    expect(invalid.json().message).toBe('Запрос не прошёл проверку');
  });

  it('writes notifications in the language each person keeps', async () => {
    expect((await api.patch('/me/preferences', bob, { locale: 'ru' })).status).toBe(200);
    const res = await api.post('/wallets/transfer', ann, {
      fromWalletId: (await api.get('/wallets', ann)).body.find(
        (w: { currency: string }) => w.currency === 'USD',
      ).id,
      to: { type: 'user', username: 'bob' },
      amount: '12.50',
    });
    expect(res.status).toBe(200);
    const inbox = (await api.get('/notifications', bob)).body;
    expect(inbox.items[0].title).toBe('Получены деньги: 12.50 USD');
  });

  it('keeps chat events translatable for every member', async () => {
    await api.post('/contacts', ann, { username: 'bob' });
    const group = await api.post('/chats/groups', ann, { title: 'Team', memberIds: [bob.id] });
    expect(group.status).toBe(201);
    const messages = (await api.get(`/chats/${group.body.id}/messages`, bob)).body;
    const created = (messages.items ?? messages).find((m: { kind: string }) => m.kind === 'system');
    expect(created.body).toBe('Ann created the group "Team"');
    expect(created.meta.text).toEqual({ key: '{0} created the group "{1}"', values: ['Ann', 'Team'] });
    expect(translate('ru', created.meta.text.key, created.meta.text.values)).toBe(
      'Ann создал(а) группу «Team»',
    );
  });
});
