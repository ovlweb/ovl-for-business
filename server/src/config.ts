import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

/** A true/false setting with a default. */
const flag = (fallback: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(fallback ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1');

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

  /** Trust X-Forwarded-For (client IPs for rate limits and audit). Disable if the API is exposed directly. */
  TRUST_PROXY: bool,

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

  /** Where people open the web client; used for links in emails. */
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  /** Where staff open the admin panel (a passkey origin). */
  PUBLIC_ADMIN_URL: z.string().url().default('http://localhost:5174'),
  /** Passkeys: the relying-party ID (defaults to the web client's host name). */
  WEBAUTHN_RP_ID: z.string().optional(),
  /** Passkeys: comma-separated origins allowed to use them (defaults to the web and admin URLs). */
  WEBAUTHN_ORIGINS: z.string().optional(),
  /** smtp://user:pass@host:587 (or smtps://…). Without it, emails are written to the log. */
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('OVL For Business <no-reply@localhost>'),

  /** Staff (moderators and up) must turn on two-step verification before using staff tools. */
  REQUIRE_2FA_FOR_STAFF: flag(true),
  /** Company owners, directors and accountants must turn it on before moving company money. */
  REQUIRE_2FA_FOR_COMPANY_FINANCE: flag(true),
  /** Applications (companies, licenses, roles) need a confirmed email address. */
  REQUIRE_VERIFIED_EMAIL: flag(true),

  /** Uploaded files: a directory (local) or an S3-compatible bucket (s3: AWS, MinIO, R2…). */
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('data/uploads'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  /** MinIO and most self-hosted stores want bucket-in-path URLs. */
  S3_FORCE_PATH_STYLE: flag(true),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(100).default(10),

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
