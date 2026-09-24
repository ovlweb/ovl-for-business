import { contactSchema, userProfileSchema, userSummarySchema, usernameSchema } from '@ovl/shared';
import { and, asc, desc, eq, ilike, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { contacts, users } from '../db/schema';
import { badRequest, notFound } from '../lib/errors';
import { iso, summaryColumns, toUserSummary } from '../lib/mappers';
import { currentUser } from '../plugins/auth';

export async function findUserByUsername(app: FastifyInstance, username: string) {
  const [user] = await app.db.select().from(users).where(eq(users.username, username.toLowerCase()));
  return user ?? null;
}

export async function userRoutes(fastify: FastifyInstance) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', app.authenticate);

  app.get(
    '/users/search',
    {
      schema: {
        tags: ['users'],
        querystring: z.object({ q: z.string().trim().min(1).max(64) }),
        response: { 200: z.array(userSummarySchema) },
      },
    },
    async (req) => {
      const pattern = `%${req.query.q.replace(/[%_\\]/g, '\\$&')}%`;
      const rows = await app.db
        .select(summaryColumns(users))
        .from(users)
        .where(
          and(
            eq(users.status, 'active'),
            or(ilike(users.username, pattern), ilike(users.displayName, pattern)),
          ),
        )
        .orderBy(asc(users.username))
        .limit(20);
      return rows.map(toUserSummary);
    },
  );

  app.get(
    '/users/:username',
    {
      schema: {
        tags: ['users'],
        params: z.object({ username: z.string() }),
        response: { 200: userProfileSchema },
      },
    },
    async (req) => {
      const user = await findUserByUsername(app, req.params.username);
      if (!user) throw notFound('User');
      const [contact] = await app.db
        .select({ id: contacts.contactId })
        .from(contacts)
        .where(and(eq(contacts.ownerId, currentUser(req).id), eq(contacts.contactId, user.id)));
      return { ...toUserSummary(user), bio: user.bio, createdAt: iso(user.createdAt), isContact: !!contact };
    },
  );

  app.get(
    '/contacts',
    { schema: { tags: ['contacts'], response: { 200: z.array(contactSchema) } } },
    async (req) => {
      const rows = await app.db
        .select({ ...summaryColumns(users), addedAt: contacts.createdAt })
        .from(contacts)
        .innerJoin(users, eq(users.id, contacts.contactId))
        .where(eq(contacts.ownerId, currentUser(req).id))
        .orderBy(desc(contacts.createdAt));
      return rows.map((r) => ({ ...toUserSummary(r), addedAt: iso(r.addedAt) }));
    },
  );

  app.post(
    '/contacts',
    {
      schema: {
        tags: ['contacts'],
        body: z.object({ username: usernameSchema }),
        response: { 201: contactSchema },
      },
    },
    async (req, reply) => {
      const me = currentUser(req);
      const user = await findUserByUsername(app, req.body.username);
      if (!user || user.status !== 'active') throw notFound('User');
      if (user.id === me.id) throw badRequest('You cannot add yourself to contacts');
      const [row] = await app.db
        .insert(contacts)
        .values({ ownerId: me.id, contactId: user.id })
        .onConflictDoUpdate({ target: [contacts.ownerId, contacts.contactId], set: { ownerId: me.id } })
        .returning();
      return reply.status(201).send({ ...toUserSummary(user), addedAt: iso(row!.createdAt) });
    },
  );

  app.delete(
    '/contacts/:userId',
    { schema: { tags: ['contacts'], params: z.object({ userId: z.uuid() }), response: { 204: z.null() } } },
    async (req, reply) => {
      await app.db
        .delete(contacts)
        .where(and(eq(contacts.ownerId, currentUser(req).id), eq(contacts.contactId, req.params.userId)));
      return reply.status(204).send(null);
    },
  );
}
