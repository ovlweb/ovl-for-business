import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { client, createTestApp, type Session } from './helpers';

let app: FastifyInstance;
let api: ReturnType<typeof client>;
let owner: Session;
let alice: Session;
let bob: Session;
let carol: Session;
let moderator: Session;
let council: Session;

beforeAll(async () => {
  app = await createTestApp();
  api = client(app);
  owner = await api.owner();
  alice = await api.register('alice');
  bob = await api.register('bob');
  carol = await api.register('carol');
  moderator = await api.withRole('mod', 'moderator');
  council = await api.withRole('elder', 'council');
});
afterAll(() => app.close());

describe('direct chats and groups', () => {
  it('opens one direct chat per pair and delivers messages', async () => {
    const first = await api.post('/chats/direct', alice, { userId: bob.id });
    const again = await api.post('/chats/direct', bob, { userId: alice.id });
    expect(first.body.id).toBe(again.body.id);
    expect(first.body.peer.username).toBe('bob');

    const sent = await api.post(`/chats/${first.body.id}/messages`, alice, { body: 'Hi Bob!' });
    expect(sent.status).toBe(201);
    const bobChats = await api.get('/chats', bob);
    expect(bobChats.body[0]).toMatchObject({ unreadCount: 1, title: 'Alice' });
    await api.post(`/chats/${first.body.id}/read`, bob, { messageId: sent.body.id });
    expect((await api.get('/chats', bob)).body[0].unreadCount).toBe(0);
    expect((await api.get(`/chats/${first.body.id}/messages`, carol)).status).toBe(403);
  });

  it('only lets you invite people from your contacts', async () => {
    const denied = await api.post('/chats/groups', alice, { title: 'Team', memberIds: [bob.id] });
    expect(denied.status).toBe(400);
    await api.post('/contacts', alice, { username: 'bob' });
    const group = await api.post('/chats/groups', alice, { title: 'Team', memberIds: [bob.id] });
    expect(group.status).toBe(201);
    expect(group.body).toMatchObject({ type: 'group', memberCount: 2, myRole: 'owner' });

    expect((await api.post(`/chats/${group.body.id}/members`, alice, { userIds: [carol.id] })).status).toBe(
      400,
    );
    await api.post('/contacts', alice, { username: 'carol' });
    const invited = await api.post(`/chats/${group.body.id}/members`, alice, { userIds: [carol.id] });
    expect(invited.body.memberCount).toBe(3);
    expect((await api.post(`/chats/${group.body.id}/members`, bob, { userIds: [carol.id] })).status).toBe(
      403,
    );
  });

  it('shows staff badges on profiles', async () => {
    await api.post('/contacts', alice, { username: 'elder' });
    const contacts = await api.get('/contacts', alice);
    const elder = contacts.body.find((c: { username: string }) => c.username === 'elder');
    expect(elder.badges).toEqual(['council']);
  });
});

describe('message actions and membership', () => {
  it('supports replies, editing your own messages and deleting (sender or group admin)', async () => {
    await api.post('/contacts', alice, { username: 'carol' });
    const group = await api.post('/chats/groups', alice, { title: 'Ops', memberIds: [bob.id, carol.id] });
    const id = group.body.id;
    const first = await api.post(`/chats/${id}/messages`, bob, { body: 'Budget is ready' });
    const reply = await api.post(`/chats/${id}/messages`, carol, {
      body: 'Great, thanks',
      replyToId: first.body.id,
    });
    expect(reply.body.replyToId).toBe(first.body.id);

    expect(
      (await api.patch(`/chats/${id}/messages/${first.body.id}`, carol, { body: 'hacked' })).status,
    ).toBe(404);
    const edited = await api.patch(`/chats/${id}/messages/${first.body.id}`, bob, {
      body: 'Budget v2 is ready',
    });
    expect(edited.body).toMatchObject({ body: 'Budget v2 is ready' });
    expect(edited.body.editedAt).not.toBeNull();

    expect((await api.del(`/chats/${id}/messages/${first.body.id}`, carol)).status).toBe(403);
    expect((await api.del(`/chats/${id}/messages/${reply.body.id}`, alice)).status).toBe(204);
    const history = await api.get(`/chats/${id}/messages`, bob);
    const deleted = history.body.find((m: { id: number }) => m.id === reply.body.id);
    expect(deleted).toMatchObject({ deleted: true, body: '' });
  });

  it('announces leaving and removals in groups', async () => {
    const group = await api.post('/chats/groups', alice, { title: 'Temp', memberIds: [bob.id, carol.id] });
    const id = group.body.id;
    expect((await api.del(`/chats/${id}/members/${carol.id}`, bob)).status).toBe(403);
    expect((await api.del(`/chats/${id}/members/${bob.id}`, bob)).status).toBe(204);
    expect((await api.del(`/chats/${id}/members/${carol.id}`, alice)).status).toBe(204);
    const history = await api.get(`/chats/${id}/messages`, alice);
    const bodies = history.body.map((m: { body: string }) => m.body);
    expect(bodies).toContain('Bob left the group');
    expect(bodies).toContain('Alice removed Carol');
    expect((await api.get(`/chats/${id}/messages`, bob)).status).toBe(403);
  });
});

describe('news channels', () => {
  it('can only be created by moderation and only admins can post', async () => {
    const payload = { title: 'Official News', handle: 'official', description: 'Platform news' };
    expect((await api.post('/chats/channels', alice, payload)).status).toBe(403);
    const channel = await api.post('/chats/channels', moderator, payload);
    expect(channel.status).toBe(201);

    const discovered = await api.get('/channels?q=official', alice);
    expect(discovered.body[0].id).toBe(channel.body.id);
    await api.post(`/chats/${channel.body.id}/join`, alice);
    expect((await api.post(`/chats/${channel.body.id}/messages`, alice, { body: 'hello' })).status).toBe(403);
    expect(
      (await api.post(`/chats/${channel.body.id}/messages`, moderator, { body: 'Welcome!' })).status,
    ).toBe(201);
    const feed = await api.get(`/chats/${channel.body.id}/messages`, alice);
    expect(feed.body[0].body).toBe('Welcome!');
  });
});

describe('tech support', () => {
  it('moderators and the owner answer with badges; council cannot', async () => {
    const ticket = await api.post('/support/tickets', alice, {
      subject: 'Cannot deposit',
      body: 'Help please',
    });
    expect(ticket.status).toBe(201);
    const id = ticket.body.id;

    const desk = await api.get('/support/desk', moderator);
    expect(desk.body.map((c: { id: string }) => c.id)).toContain(id);
    expect((await api.get('/support/desk', council)).status).toBe(403);
    expect((await api.post(`/chats/${id}/messages`, council, { body: 'I am council' })).status).toBe(403);

    const reply = await api.post(`/chats/${id}/messages`, moderator, { body: 'We are on it' });
    expect(reply.body.meta.staffBadge).toBe('support');
    const ownerReply = await api.post(`/chats/${id}/messages`, owner, { body: 'Fixed personally' });
    expect(ownerReply.body.meta.staffBadge).toBe('owner');

    // Support tickets are a separate section, not in the staff member's chat list.
    expect((await api.get('/chats', moderator)).body.some((c: { id: string }) => c.id === id)).toBe(false);

    const closed = await api.post(`/support/tickets/${id}/status`, moderator, { status: 'closed' });
    expect(closed.body.support.status).toBe('closed');
    await api.post(`/chats/${id}/messages`, alice, { body: 'Still broken' });
    const mine = await api.get('/support/tickets', alice);
    expect(mine.body[0].support.status).toBe('open');
  });
});

describe('service stories', () => {
  it('only council, admins and the owner can publish', async () => {
    expect((await api.post('/stories', alice, { text: 'hi' })).status).toBe(403);
    expect((await api.post('/stories', moderator, { text: 'hi' })).status).toBe(403);
    const story = await api.post('/stories', council, {
      text: 'Council meeting on Friday',
      durationHours: 12,
    });
    expect(story.status).toBe(201);
    await api.post(`/stories/${story.body.id}/view`, alice);
    const list = await api.get('/stories', alice);
    expect(list.body[0]).toMatchObject({ text: 'Council meeting on Friday', viewed: true, viewsCount: 1 });
  });
});

describe('realtime', () => {
  it('pushes new messages over the WebSocket', async () => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address() as { port: number };
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/realtime?token=${bob.token}`);
    const events: { type: string; message?: { body: string } }[] = [];
    await new Promise<void>((resolve, reject) => {
      socket.on('message', (data) => {
        const event = JSON.parse(data.toString());
        events.push(event);
        if (event.type === 'ready') resolve();
      });
      socket.on('error', reject);
    });

    const chat = await api.post('/chats/direct', alice, { userId: bob.id });
    await api.post(`/chats/${chat.body.id}/messages`, alice, { body: 'Live!' });
    await new Promise((r) => setTimeout(r, 100));
    expect(events.find((e) => e.type === 'message.created')?.message?.body).toBe('Live!');
    socket.close();

    const rejected = new WebSocket(`ws://127.0.0.1:${address.port}/api/v1/realtime?token=bad`);
    const code = await new Promise<number>((resolve) => rejected.on('close', (c) => resolve(c)));
    expect(code).toBe(4401);
  });
});
