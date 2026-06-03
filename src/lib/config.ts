import 'dotenv/config';
import { z } from 'zod';

const ConfigSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  REGISTRY_CRON_SECRET: z.string().min(16),
  REGISTRY_ADMIN_SECRET: z.string().min(16),
  PUBLIC_BASE_URL: z.string().url().default('https://registry.afauth.org'),
  REGISTRY_CRON_SCHEDULE: z.string().default('0 6 * * *'),

  /**
   * Number of trusted reverse proxies between the public internet and
   * this service. Used to pick the real client IP from the RIGHT of
   * X-Forwarded-For for rate-limit bucketing (see lib/ratelimit.ts).
   * Default 1 (a single edge proxy such as Railway/Cloudflare). It MUST
   * NOT exceed the real proxy depth, or a client-forged left entry would
   * become trusted (audit #6). Read directly from env in ratelimit.ts;
   * declared here for validation + documentation.
   */
  REGISTRY_TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).default(1),

  /**
   * E2E-test escape hatch. When set to `1` or `true`, enables
   * `POST /admin/e2e/listings` — an unauthenticated endpoint that
   * inserts a listing directly from a caller-supplied
   * (discovery_url, discovery_doc) pair, bypassing the
   * challenge/proof ceremony and the HTTPS/public-host validation
   * that production submissions enforce. Used exclusively by
   * `spec/harness/e2e/` so the harness can seed a listing without
   * having to publish a proof file on a real public host.
   *
   * MUST be unset (or `0`/`false`) in production.
   */
  REGISTRY_E2E_DIRECT_INSERT: z
    .string()
    .default('')
    .transform((v) => v === '1' || v === 'true'),
}).superRefine((cfg, ctx) => {
  // Hard guard: refuse to boot in production with the e2e escape
  // hatch enabled. A "MUST NOT in production" comment is not an
  // enforcement; this is. See REGISTRY_E2E_DIRECT_INSERT's doc
  // above for why this matters (it bypasses the challenge/proof
  // ceremony and the HTTPS/public-host validation).
  if (cfg.NODE_ENV === 'production' && cfg.REGISTRY_E2E_DIRECT_INSERT) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['REGISTRY_E2E_DIRECT_INSERT'],
      message:
        'REGISTRY_E2E_DIRECT_INSERT must not be enabled when NODE_ENV=production',
    });
  }
});

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | undefined;

export function getConfig(): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test-only: reset the cached config so env mutations take effect. */
export function resetConfigForTest(): void {
  cached = undefined;
}
