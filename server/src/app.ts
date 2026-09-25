import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { MoneyError, PLATFORM_NAME } from '@ovl/shared';
import { sql } from 'drizzle-orm';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { Config } from './config';
import { createDatabase, type Database } from './db/client';
import { HttpError, isUniqueViolation } from './lib/errors';
import { createMailer, type Mailer } from './lib/mailer';
import { createStorage, type Storage } from './lib/storage';
import { ipAllowlist } from './lib/ip-allowlist';
import { adminRoutes } from './modules/admin';
import { apiKeyRoutes } from './modules/api-keys';
import { applicationRoutes } from './modules/applications/routes';
import { authRoutes } from './modules/auth';
import { emailRoutes } from './modules/email';
import { passkeyRoutes } from './modules/passkeys';
import { ssoRoutes } from './modules/sso';
import { fileRoutes } from './modules/files';
import { identityRoutes } from './modules/identity';
import { cashRoutes } from './modules/cash';
import { cashApprovalRoutes } from './modules/cash-approvals';
import { invoiceRoutes } from './modules/invoices';
import { exchangeRoutes } from './modules/exchange';
import { orgPaymentRoutes } from './modules/org-payments';
import { invoiceScheduleRoutes } from './modules/invoice-schedules';
import { payrollRoutes } from './modules/payroll';
import { sessionRoutes } from './modules/sessions';
import { twoFactorRoutes } from './modules/two-factor';
import { chatRoutes } from './modules/chats/routes';
import { metaRoutes } from './modules/meta';
import { organizationRoutes } from './modules/organizations';
import { registryRoutes } from './modules/registry';
import { stockRoutes } from './modules/stock/routes';
import { storyRoutes } from './modules/stories';
import { supportRoutes } from './modules/chats/support';
import { userRoutes } from './modules/users';
import { walletRoutes } from './modules/wallets/routes';
import { registerAuth } from './plugins/auth';
import { realtimeRoutes } from './realtime/routes';
import { RealtimeHub } from './realtime/hub';
import { Scheduler } from './lib/scheduler';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Database;
    hub: RealtimeHub;
    mailer: Mailer;
    scheduler: Scheduler;
    storage: Storage;
  }
}

export const API_PREFIX = '/api/v1';

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const { db, client } = createDatabase(config.DATABASE_URL, config.DATABASE_POOL_SIZE);

  const app = Fastify({
    logger:
      config.LOG_LEVEL === 'silent'
        ? false
        : {
            level: config.LOG_LEVEL,
            transport: config.LOG_PRETTY ? { target: 'pino-pretty' } : undefined,
            redact: ['req.headers.authorization', 'req.headers["x-api-key"]'],
            serializers: {
              // The realtime socket carries the access token in its query string: never log it.
              req: (req: { method: string; url: string; hostname?: string; ip?: string }) => ({
                method: req.method,
                url: req.url.replace(/([?&]token=)[^&]*/, '$1[redacted]'),
                hostname: req.hostname,
                remoteAddress: req.ip,
              }),
            },
          },
    // Only trust X-Forwarded-* when running behind the reverse proxy.
    trustProxy: config.TRUST_PROXY ?? true,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('hub', new RealtimeHub());
  app.decorate('mailer', createMailer(config, app.log));
  app.decorate('storage', createStorage(config));
  app.decorate('scheduler', new Scheduler(app.log));

  if (config.SCHEDULER_ENABLED) app.addHook('onReady', async () => app.scheduler.start());
  app.addHook('onClose', async () => {
    await app.scheduler.stop();
    app.hub.closeAll();
    await client.end({ timeout: 5 });
  });

  app.setErrorHandler((error, req, reply) => {
    if (error instanceof HttpError) {
      return reply
        .status(error.statusCode)
        .send({ error: error.code, message: error.message, details: error.details });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: 'validation_error',
        message: 'Request validation failed',
        details: error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
      });
    }
    if (error instanceof MoneyError) {
      return reply.status(400).send({ error: 'invalid_amount', message: error.message });
    }
    if (isUniqueViolation(error)) {
      return reply.status(409).send({ error: 'conflict', message: 'This value is already taken' });
    }
    if (isResponseSerializationError(error)) {
      req.log.error({ err: error, issues: error.cause.issues }, 'response serialization failed');
      return reply.status(500).send({ error: 'internal_error', message: 'Something went wrong' });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      const e = error as { code?: string; message: string };
      return reply.status(status).send({ error: e.code?.toLowerCase() ?? 'error', message: e.message });
    }
    req.log.error({ err: error }, 'unhandled error');
    return reply.status(500).send({ error: 'internal_error', message: 'Something went wrong' });
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  const origins = config.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  await app.register(cors, {
    origin: origins.includes('*') ? true : origins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  await app.register(rateLimit, {
    max: config.GLOBAL_RATE_LIMIT,
    timeWindow: '1 minute',
    allowList: () => config.NODE_ENV === 'test',
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: `${PLATFORM_NAME} API`,
        version: '1.0.0',
        description:
          'Cross-platform API used by the web, mobile and desktop clients, the admin panel and third-party services. ' +
          'Authenticate with `Authorization: Bearer <accessToken>`. Public registry and stock endpoints also accept ' +
          'an `X-API-Key` developer key for higher rate limits.',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          apiKey: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
        },
      },
      security: [{ bearerAuth: [] }],
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });
  await app.register(websocket, { options: { maxPayload: 64 * 1024 } });

  registerAuth(app);

  // The admin API answers only from the allowed networks (when a list is configured).
  const adminAllowed = ipAllowlist(config.ADMIN_IP_ALLOWLIST);
  if (adminAllowed) {
    app.addHook('onRequest', async (req) => {
      if (req.url.startsWith('/api/v1/admin/') && !adminAllowed(req.ip))
        throw new HttpError(403, 'ip_not_allowed', 'The admin API is not available from this network');
    });
  }

  app.get('/health', { schema: { hide: true } }, async () => {
    await db.execute(sql`select 1`);
    return { status: 'ok', online: app.hub.onlineCount };
  });

  await app.register(
    async (api) => {
      await api.register(metaRoutes);
      await api.register(authRoutes);
      await api.register(emailRoutes);
      await api.register(passkeyRoutes);
      await api.register(ssoRoutes);
      await api.register(fileRoutes);
      await api.register(identityRoutes);
      await api.register(sessionRoutes);
      await api.register(twoFactorRoutes);
      await api.register(userRoutes);
      await api.register(walletRoutes);
      await api.register(cashRoutes);
      await api.register(cashApprovalRoutes);
      await api.register(invoiceRoutes);
      await api.register(exchangeRoutes);
      await api.register(orgPaymentRoutes);
      await api.register(invoiceScheduleRoutes);
      await api.register(payrollRoutes);
      await api.register(organizationRoutes);
      await api.register(applicationRoutes);
      await api.register(registryRoutes);
      await api.register(stockRoutes);
      await api.register(chatRoutes);
      await api.register(supportRoutes);
      await api.register(storyRoutes);
      await api.register(apiKeyRoutes);
      await api.register(adminRoutes);
      await api.register(realtimeRoutes);
    },
    { prefix: API_PREFIX },
  );

  return app;
}
