import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import type Redis from 'ioredis';
import { getConfig } from './lib/config.js';
import { RegistryError } from './lib/errors.js';
import { getRedis } from './lib/redis.js';
import { PgStore } from './lib/store/postgres.js';
import type { Store } from './lib/store/index.js';
import { healthRoutes } from './routes/health.js';
import { createListingRoutes } from './routes/listings.js';
import { createReadRoutes } from './routes/read.js';

export interface AppDeps {
  store: Store;
  redis: Redis;
}

export function createApp(deps: AppDeps): Hono {
  const app = new Hono();
  app.use('*', logger());

  app.onError((err, c) => {
    if (err instanceof RegistryError) {
      return c.json(err.toEnvelope(), { status: err.status as 400 });
    }
    console.error('Unhandled error:', err);
    return c.json(
      { error: { code: 'internal_error', message: 'Internal server error' } },
      500,
    );
  });

  app.notFound((c) =>
    c.json({ error: { code: 'not_found', message: 'Not found' } }, 404),
  );

  app.route('/', healthRoutes);
  // Read routes mount first so the CORS preflight handler answers OPTIONS
  // before the write router. Method matching means GET-handlers in read
  // don't shadow POST/PATCH/DELETE in listings.
  app.route('/v1/listings', createReadRoutes(deps));
  app.route('/v1/listings', createListingRoutes(deps));

  return app;
}

async function main(): Promise<void> {
  const cfg = getConfig();
  const store = new PgStore();
  await store.init();
  const redis = getRedis();
  const app = createApp({ store, redis });

  serve(
    { fetch: app.fetch, port: cfg.PORT },
    (info) => {
      console.log(`registry.afauth.org listening on :${info.port} [${cfg.NODE_ENV}]`);
    },
  );
}

const isEntry = import.meta.url === `file://${process.argv[1]}`;
if (isEntry) {
  main().catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
