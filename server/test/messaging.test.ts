import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let ann: Session;
let bob: Session;
let cat: Session;
let dan: Session;
let mod: Session;
let direct: string;
let group: string;

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const upload = async (s: Session, name = 'photo.png') => {
  const res = await app.inject({
    method: 'POST',
    url: `/api/v1/files?name=${encodeURIComponent(name)}`,
    headers: { authorization: `Bearer ${s.token}`, 'content-type': 'image/png' },
    payload: PNG,
  });
  return JSON.parse(res.body) as { id: string; url: string };
};
const send = (s: Session, chatId: string, body: Record<string, unknown>) =>
  api.post(`/chats/${chatId}/messages`, s, body);
const chatOf = async (s: Session, chatId: string) =>
  (await api.get('/chats', s)).body.find((c: { id: string }) => c.id === chatId);

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  ann = await api.register('ann');
  bob = await api.register('bob');
  cat = await api.register('cat');
  dan = await api.register('dan');
  mod = await api.withRole('mod', 'moderator');
  direct = (await api.post('/chats/direct', ann, { userId: bob.id })).body.id;
  await api.post('/contacts', ann, { username: 'bob' });
  await api.post('/contacts', ann, { username: 'cat' });
  group = (await api.post('/chats/groups', ann, { title: 'Team', memberIds: [bob.id, cat.id] })).body.id;
});
afterAll(() => app.close());

describe('attachments', () => {
  it('sends files with a message, readable by the chat only', async () => {
    const photo = await upload(ann);
    expect((await send(ann, direct, { body: '' })).status).toBe(400);
    const sent = await send(ann, direct, { body: '', fileIds: [photo.id] });
    expect(sent.status).toBe(201);
    expect(sent.body.attachments).toMatchObject([
      { id: photo.id, name: 'photo.png', contentType: 'image/png' },
    ]);

    const [seen] = (await api.get(`/chats/${direct}/messages`, bob)).body;
    expect(seen.attachments[0].id).toBe(photo.id);
    const asBob = await app.inject({ method: 'GET', url: seen.attachments[0].url });
    expect(asBob.statusCode).toBe(200);
    const asCat = await app.inject({
      method: 'GET',
      url: `/api/v1/files/${photo.id}`,
      headers: { authorization: `Bearer ${cat.token}` },
    });
    expect(asCat.statusCode).toBe(404);

    // A file goes with one message only, and only its uploader can attach it.
    expect((await send(ann, group, { body: 'again', fileIds: [photo.id] })).status).toBe(400);
    const bobs = await upload(bob);
    expect((await send(ann, group, { body: 'not mine', fileIds: [bobs.id] })).status).toBe(400);

    // Deleting the message hides its attachments.
    await api.del(`/chats/${direct}/messages/${sent.body.id}`, ann);
    const [gone] = (await api.get(`/chats/${direct}/messages`, bob)).body;
    expect(gone).toMatchObject({ deleted: true, attachments: [] });
  });
});

describe('search', () => {
  it('finds messages in your own chats by word prefixes', async () => {
    await send(ann, group, { body: 'The quarterly invoice report is ready' });
    await send(bob, direct, { body: 'Did you see the invoice?' });
    const other = (await api.post('/chats/direct', cat, { userId: dan.id })).body.id;
    await send(cat, other, { body: 'Secret invoice between cat and dan' });

    const found = await api.get('/chats/search?q=invoice', ann);
    expect(found.status).toBe(200);
    expect(found.body.map((r: { message: { body: string } }) => r.message.body)).toEqual([
      'Did you see the invoice?',
      'The quarterly invoice report is ready',
    ]);
    expect(found.body[1].chat).toMatchObject({ id: group, type: 'group', title: 'Team' });
    expect(found.body[0].chat).toMatchObject({ id: direct, title: 'Bob' });

    const prefix = await api.get('/chats/search?q=QUART%20rep', ann);
    expect(prefix.body).toHaveLength(1);
    const one = await api.get(`/chats/search?q=invoice&chatId=${group}`, ann);
    expect(one.body).toHaveLength(1);
    expect((await api.get('/chats/search?q=%26%7C!', ann)).body).toEqual([]);
    expect((await api.get('/chats/search?q=x', ann)).status).toBe(400);
  });
});

describe('mentions', () => {
  it('records mentioned members and counts unread mentions', async () => {
    const sent = await send(ann, group, { body: 'Hey @Bob and @dan, see @ann' });
    // Dan is not in the group and people do not mention themselves.
    expect(sent.body.mentions).toEqual([bob.id]);
    expect(await chatOf(bob, group)).toMatchObject({ unreadMentions: 1 });
    expect(await chatOf(cat, group)).toMatchObject({ unreadMentions: 0 });
    await api.post(`/chats/${group}/read`, bob, { messageId: sent.body.id });
    expect(await chatOf(bob, group)).toMatchObject({ unreadMentions: 0, unreadCount: 0 });

    const edited = await api.patch(`/chats/${group}/messages/${sent.body.id}`, ann, { body: 'Sorry @cat' });
    expect(edited.body.mentions).toEqual([cat.id]);
  });
});

describe('reactions', () => {
  it('adds and removes emoji reactions', async () => {
    const message = (await send(bob, group, { body: 'Shipped!' })).body;
    const url = `/chats/${group}/messages/${message.id}/reactions`;
    const liked = await api.post(url, ann, { emoji: '👍' });
    expect(liked.body.reactions).toEqual([{ emoji: '👍', count: 1, mine: true }]);
    await api.post(url, ann, { emoji: '👍' });
    await api.post(url, cat, { emoji: '👍' });
    const party = await api.post(url, cat, { emoji: '🎉' });
    expect(party.body.reactions).toEqual([
      { emoji: '👍', count: 2, mine: true },
      { emoji: '🎉', count: 1, mine: true },
    ]);
    const [asBob] = (await api.get(`/chats/${group}/messages`, bob)).body;
    expect(asBob.reactions).toEqual([
      { emoji: '👍', count: 2, mine: false },
      { emoji: '🎉', count: 1, mine: false },
    ]);

    expect((await api.post(url, ann, { emoji: 'lol' })).status).toBe(400);
    expect((await api.post(url, dan, { emoji: '👍' })).status).toBe(403);
    const removed = await api.del(`${url}?emoji=${encodeURIComponent('👍')}`, ann);
    expect(removed.body.reactions).toEqual([
      { emoji: '👍', count: 1, mine: false },
      { emoji: '🎉', count: 1, mine: false },
    ]);
  });
});

describe('read receipts', () => {
  it('shows how far others read, unless someone hides receipts', async () => {
    const sent = (await send(ann, direct, { body: 'Read me' })).body;
    expect((await chatOf(ann, direct)).peerReadMessageId).toBeLessThan(sent.id);
    await api.post(`/chats/${direct}/read`, bob, { messageId: sent.id });
    expect((await chatOf(ann, direct)).peerReadMessageId).toBe(sent.id);

    const last = (await send(ann, group, { body: 'Everyone?' })).body;
    await api.post(`/chats/${group}/read`, cat, { messageId: last.id });
    const receipts = await api.get(`/chats/${group}/receipts`, ann);
    expect(receipts.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user: expect.objectContaining({ username: 'cat' }),
          lastReadMessageId: last.id,
        }),
        expect.objectContaining({ user: expect.objectContaining({ username: 'bob' }) }),
      ]),
    );

    await api.patch('/me/preferences', bob, { readReceipts: false });
    expect((await chatOf(ann, direct)).peerReadMessageId).toBeNull();
    expect((await api.get(`/chats/${group}/receipts`, ann)).body).toHaveLength(1);
    // Hiding your own also hides everyone else's from you.
    expect((await chatOf(bob, direct)).peerReadMessageId).toBeNull();
    expect((await api.get(`/chats/${group}/receipts`, bob)).body).toEqual([]);
  });
});

describe('channel comments', () => {
  it('lets subscribers comment on posts', async () => {
    const channel = (
      await api.post('/chats/channels', mod, { title: 'Platform news', handle: 'platform', description: '' })
    ).body;
    expect(channel.commentsEnabled).toBe(true);
    const post = (await send(mod, channel.id, { body: 'Version 0.2 is out' })).body;
    const comments = `/chats/${channel.id}/messages/${post.id}/comments`;
    expect((await api.post(comments, ann, { body: 'Nice' })).status).toBe(403);
    await api.post(`/chats/${channel.id}/join`, ann);
    await api.post(`/chats/${channel.id}/join`, bob);
    await api.post(`/chats/${channel.id}/read`, bob, { messageId: post.id });

    const comment = await api.post(comments, ann, { body: 'Nice, thanks @mod' });
    expect(comment.status).toBe(201);
    expect(comment.body).toMatchObject({ threadId: post.id, mentions: [mod.id] });
    await api.post(comments, bob, { body: 'Agreed' });
    // Comments stay out of the channel feed and the unread count.
    const feed = (await api.get(`/chats/${channel.id}/messages`, bob)).body;
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ id: post.id, commentCount: 2 });
    expect(await chatOf(bob, channel.id)).toMatchObject({ unreadCount: 0 });
    expect((await api.get(comments, bob)).body.map((c: { body: string }) => c.body)).toEqual([
      'Agreed',
      'Nice, thanks @mod',
    ]);
    expect(
      (await api.post(`/chats/${channel.id}/messages/${comment.body.id}/comments`, bob, { body: 'x' }))
        .status,
    ).toBe(400);

    await api.del(`/chats/${channel.id}/messages/${comment.body.id}`, mod);
    expect((await api.get(`/chats/${channel.id}/messages`, bob)).body[0].commentCount).toBe(1);

    expect((await api.patch(`/chats/${channel.id}`, ann, { commentsEnabled: false })).status).toBe(403);
    const off = await api.patch(`/chats/${channel.id}`, mod, { commentsEnabled: false });
    expect(off.body.commentsEnabled).toBe(false);
    expect((await api.post(comments, bob, { body: 'Still here?' })).status).toBe(403);
    expect((await api.post(`/chats/${group}/messages/1/comments`, ann, { body: 'x' })).status).toBe(400);
    expect((await api.patch(`/chats/${group}`, ann, { commentsEnabled: false })).status).toBe(400);
  });
});
