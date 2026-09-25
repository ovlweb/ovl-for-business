import { createHash } from 'node:crypto';
import { lt, sql } from 'drizzle-orm';
import type { Database } from '../db/client';
import { rateLimits } from '../db/schema';

type Callback = (error: Error | null, result?: { current: number; ttl: number }) => void;
/** What the plugin passes for a route with its own limit (routeInfo at runtime). */
interface RouteOptions {
  routeInfo?: { method: string; url: string };
  url?: string;
}

/** Keys stay short enough for the column; long ones are hashed. */
const keyOf = (prefix: string, key: string) => {
  const full = `${prefix}${key}`;
  return full.length <= 280 ? full : `${prefix}#${createHash('sha256').update(key).digest('base64url')}`;
};

/**
 * A @fastify/rate-limit store in Postgres, so every instance counts the same requests: one upsert
 * per request that starts a new window when the old one has passed.
 */
export function postgresRateLimitStore(db: Database) {
  return class PostgresRateLimitStore {
    constructor(
      _options?: unknown,
      private readonly prefix = 'global-',
    ) {}

    incr(key: string, callback: Callback, timeWindow: number) {
      db.execute<{ count: number; ttl: number }>(
        sql`
        insert into rate_limits (key, count, reset_at)
        values (${keyOf(this.prefix, key)}, 1, now() + make_interval(secs => ${timeWindow / 1000}))
        on conflict (key) do update set
          count = case when rate_limits.reset_at <= now() then 1 else rate_limits.count + 1 end,
          reset_at = case when rate_limits.reset_at <= now() then excluded.reset_at else rate_limits.reset_at end
        returning count, greatest(0, ceil(extract(epoch from reset_at - now()) * 1000))::int as ttl`,
      )
        .then((rows) => {
          const [row] = [...rows];
          callback(null, { current: Number(row!.count), ttl: Number(row!.ttl) });
        })
        .catch((error: Error) => callback(error));
    }

    read(key: string, callback: Callback) {
      db.execute<{ count: number; ttl: number }>(
        sql`
        select count, greatest(0, ceil(extract(epoch from reset_at - now()) * 1000))::int as ttl
        from rate_limits where key = ${keyOf(this.prefix, key)} and reset_at > now()`,
      )
        .then((rows) => {
          const [row] = [...rows];
          callback(null, row ? { current: Number(row.count), ttl: Number(row.ttl) } : { current: 0, ttl: 0 });
        })
        .catch((error: Error) => callback(error));
    }

    child(routeOptions: RouteOptions): PostgresRateLimitStore {
      const route = routeOptions.routeInfo
        ? `${routeOptions.routeInfo.method}${routeOptions.routeInfo.url}`
        : (routeOptions.url ?? 'route');
      return new PostgresRateLimitStore(undefined, `${this.prefix}${route}-`);
    }
  };
}

/** Drop windows that are over (the scheduler runs this). */
export async function cleanRateLimits(db: Database) {
  await db.delete(rateLimits).where(lt(rateLimits.resetAt, sql`now() - interval '1 minute'`));
}
