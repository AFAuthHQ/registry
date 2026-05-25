import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { getConfig } from './lib/config.js';
import { RegistryError } from './lib/errors.js';
import { healthRoutes } from './routes/health.js';

export function createApp(): Hono {
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

  // Phase 2 routes will mount under /v1/listings
  // app.route('/v1/listings', listingRoutes);

  return app;
}

async function main(): Promise<void> {
  const cfg = getConfig();
  const app = createApp();

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
