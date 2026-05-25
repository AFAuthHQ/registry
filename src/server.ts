import { serve } from '@hono/node-server';
import { Hono } from 'hono';
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
