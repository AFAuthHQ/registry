import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import type Redis from 'ioredis';
import { getConfig } from './lib/config.js';
import { RegistryError } from './lib/errors.js';
import { getLogger } from './lib/logger.js';
import { closeRedis, getRedis } from './lib/redis.js';
import { PgStore } from './lib/store/postgres.js';
import type { Store } from './lib/store/index.js';
import { startRevalidationCron } from './jobs/scheduler.js';
import { createAdminRoutes } from './routes/admin.js';
import { createBrowseRoutes } from './routes/browse.js';
import { healthRoutes } from './routes/health.js';
import { createListingRoutes } from './routes/listings.js';
import { operatorRoutes } from './routes/operator.js';
import { policyRoutes } from './routes/policy.js';
import { createReadRoutes } from './routes/read.js';
import { createSeoRoutes } from './routes/seo.js';

export interface AppDeps {
  store: Store;
  redis: Redis;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;
    // Skip access logs in test runs to keep test output readable.
    if (process.env.NODE_ENV !== 'test') {
      getLogger().info(
        {
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          status: c.res.status,
          ms,
        },
        'request',
      );
    }
  });

  // Security response headers. Applied to every response, including
  // /v1/* JSON APIs and error responses. CSP is HTML-meaningful but
  // harmless on JSON. `script-src 'self'` is real (the only client
  // script is served from /registry.js); `style-src` allows the inline
  // <style> block in views/layout.ts. img-src allows the favicon hosted
  // at https://afauth.org.
  app.use('*', async (c, next) => {
    await next();
    c.header('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
    c.header('x-content-type-options', 'nosniff');
    c.header('x-frame-options', 'DENY');
    c.header('referrer-policy', 'strict-origin-when-cross-origin');
    c.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    c.header(
      'content-security-policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' https://afauth.org data:",
        "connect-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
      ].join('; '),
    );
    // Agent-discovery hint (RFC 8288 Web Linking): advertise the
    // LLM-friendly markdown index from every response so agents — and the
    // agent-readiness probes that look for it — can find it without
    // guessing /llms.txt.
    c.header('link', '</llms.txt>; rel="alternate"; type="text/markdown"');
  });

  // Cap request bodies before they are buffered into memory. Submission
  // payloads are small (discovery docs are fetched server-side, not
  // posted), so 256 KB is generous; this blocks memory-exhaustion DoS.
  app.use(
    '*',
    bodyLimit({
      maxSize: 256 * 1024,
      onError: (c) =>
        c.json(
          { error: { code: 'payload_too_large', message: 'Request body too large' } },
          413,
        ),
    }),
  );

  // Static client assets (served same-origin so CSP can stay tight).
  app.use('/registry.js', serveStatic({ path: './public/registry.js' }));

  app.onError((err, c) => {
    if (err instanceof RegistryError) {
      return c.json(err.toEnvelope(), { status: err.status as 400 });
    }
    getLogger().error({ err }, 'unhandled error');
    return c.json(
      { error: { code: 'internal_error', message: 'Internal server error' } },
      500,
    );
  });

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Not found' } }, 404),
  );

  app.route('/', healthRoutes);
  app.route('/', createSeoRoutes(deps));
  app.route('/v1/listings', createReadRoutes(deps));
  app.route('/v1/listings', createListingRoutes(deps));
  app.route('/admin', createAdminRoutes(deps));
  app.route('/', createBrowseRoutes(deps));
  app.route('/', operatorRoutes);
  app.route('/', policyRoutes);

  return app;
}

async function main(): Promise<void> {
  const cfg = getConfig();
  const log = getLogger();

  const store = new PgStore();
  await store.init();
  log.info('postgres connected, schema applied');

  const redis = getRedis();
  // Force a ping so a misconfigured REDIS_URL fails at startup, not at first request.
  await redis.ping();
  log.info('redis connected');

  const app = createApp({ store, redis });

  const cron = startRevalidationCron({ store, redis }, cfg.REGISTRY_CRON_SCHEDULE);
  log.info({ schedule: cfg.REGISTRY_CRON_SCHEDULE }, 'revalidation cron scheduled');

  const server = serve(
    { fetch: app.fetch, port: cfg.PORT },
    (info) => {
      log.info({ port: info.port, env: cfg.NODE_ENV }, 'registry.afauth.org listening');
    },
  );

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    cron.stop();
    server.close();
    try {
      await store.close();
    } catch (err) {
      log.error({ err }, 'error closing postgres');
    }
    try {
      await closeRedis();
    } catch (err) {
      log.error({ err }, 'error closing redis');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
