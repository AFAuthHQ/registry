import { Hono } from 'hono';
import type Redis from 'ioredis';
import { getConfig } from '../lib/config.js';
import { RegistryError } from '../lib/errors.js';
import { runRevalidation } from '../jobs/revalidate.js';
import type { Store } from '../lib/store/index.js';

interface Deps {
  store: Store;
  redis: Redis;
}

export function createAdminRoutes(deps: Deps): Hono {
  const r = new Hono();

  r.post('/cron/revalidate', async (c) => {
    requireBearer(c.req.header('authorization'), getConfig().REGISTRY_CRON_SECRET);
    const result = await runRevalidation(deps);
    return c.json(result);
  });

  return r;
}

function requireBearer(header: string | undefined, expected: string): void {
  if (!header || !header.startsWith('Bearer ')) {
    throw RegistryError.unauthorized('Missing bearer token');
  }
  const provided = header.slice('Bearer '.length).trim();
  if (provided !== expected) throw RegistryError.unauthorized('Invalid bearer token');
}
