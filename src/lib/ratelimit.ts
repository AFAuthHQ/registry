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
 * Returns the client IP for rate-limit bucketing ONLY (never for any
 * authorization decision).
 *
 * X-Forwarded-For is a client-APPENDED list: a request arrives as
 * `clientForged, ..., seenByProxyN` where each trusted proxy appends the
 * address IT observed on the RIGHT. The leftmost entries are fully
 * attacker-controlled. We therefore trust only the entry
 * `REGISTRY_TRUSTED_PROXY_HOPS` from the right (default 1, matching a
 * single edge proxy such as Railway/Cloudflare). Trusting the leftmost
 * value let an attacker rotate XFF to mint unlimited buckets and defeat
 * every IP rate limit (audit #6).
 *
 * Set REGISTRY_TRUSTED_PROXY_HOPS to the number of proxies between the
 * public internet and this service. It MUST NOT exceed the real depth, or
 * a forged left entry becomes trusted.
 */
export function clientIp(c: Context): string {
  const parsed = Number(process.env.REGISTRY_TRUSTED_PROXY_HOPS ?? '1');
  const hops = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((p) => p.trim()).filter(Boolean);
    if (parts.length > 0) {
      const idx = Math.min(parts.length - 1, Math.max(0, parts.length - hops));
      const pick = parts[idx];
      if (pick) return pick;
    }
  }
  const realIp = c.req.header('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}
