import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: bool,

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_SIZE: z.coerce.number().int().min(1).default(10),
  RUN_MIGRATIONS: bool,

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(30),

  /** Comma separated list of allowed browser origins, or * */
  CORS_ORIGINS: z.string().default('*'),

  /** The single owner account is created on first start. */
  OWNER_USERNAME: z.string().default('owner'),
  OWNER_EMAIL: z.string().default('owner@example.com'),
  OWNER_PASSWORD: z.string().min(8).optional(),

  /** Council approvals needed at council stages (capped by the council size). */
  COUNCIL_QUORUM: z.coerce.number().int().min(1).default(3),

  /** Default share of every investment frozen on the company balance. */
  STOCK_FREEZE_PERCENT: z.coerce.number().min(0).max(100).default(30),
  /** Default lock period of the frozen part (3 months). Allowed range 3–6 months. */
  STOCK_LOCK_DAYS: z.coerce.number().int().default(90),
  STOCK_LOCK_DAYS_MIN: z.coerce.number().int().default(90),
  STOCK_LOCK_DAYS_MAX: z.coerce.number().int().default(183),

  /** Requests per minute for the public registry / stock API. */
  PUBLIC_RATE_LIMIT: z.coerce.number().int().default(60),
  API_KEY_RATE_LIMIT: z.coerce.number().int().default(600),
  GLOBAL_RATE_LIMIT: z.coerce.number().int().default(600),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid configuration:\n${issues}`);
  }
  const config = parsed.data;
  if (
    config.STOCK_LOCK_DAYS < config.STOCK_LOCK_DAYS_MIN ||
    config.STOCK_LOCK_DAYS > config.STOCK_LOCK_DAYS_MAX
  ) {
    throw new Error('STOCK_LOCK_DAYS must be within STOCK_LOCK_DAYS_MIN..STOCK_LOCK_DAYS_MAX');
  }
  return config;
}
