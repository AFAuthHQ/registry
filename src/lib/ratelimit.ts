import type { Context, MiddlewareHandler } from 'hono';
import type Redis from 'ioredis';
import { RegistryError } from './errors.js';

export interface RateLimitOpts {
  redis: Redis;
  /** Max requests per window. */
  limit: number;
  /** Window in seconds. */
  windowSeconds: number;
  /** Bucket key derived from the request context. */
  key: (c: Context) => string;
}

export function rateLimit(opts: RateLimitOpts): MiddlewareHandler {
  return async (c, next) => {
    const k = `ratelimit:${opts.key(c)}`;
    const count = await opts.redis.incr(k);
    if (count === 1) {
      await opts.redis.expire(k, opts.windowSeconds);
    }
    if (count > opts.limit) {
      const ttl = await opts.redis.ttl(k);
      c.header('retry-after', String(Math.max(ttl, 0)));
      throw RegistryError.rateLimited(
        `Rate limit exceeded: ${opts.limit} per ${opts.windowSeconds}s`,
      );
    }
    await next();
  };
}

/**
 * Returns the client IP. Behind a trusted proxy (Railway, Cloudflare),
 * X-Forwarded-For is the source of truth; falls back to X-Real-IP, then
 * a sentinel. Use only for rate-limit bucketing — not for any
 * authorization decision.
 */
export function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = c.req.header('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}
