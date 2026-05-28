import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type Redis from 'ioredis';
import { z } from 'zod';
import { RegistryError } from '../lib/errors.js';
import { clientIp, rateLimit } from '../lib/ratelimit.js';
import { ServiceDidSchema } from '../lib/schemas.js';
import { toPublicListing } from '../lib/serialize.js';
import type { ListQuery, Store } from '../lib/store/index.js';

const CACHE_LIST_HEADER = 'public, max-age=30, s-maxage=120';
const CACHE_SINGLE_HEADER = 'public, max-age=60, s-maxage=300';

const ListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  search: z.string().max(200).optional(),
  tag: z.string().max(40).optional(),
  updated_since: z.string().datetime().optional(),
  status: z.enum(['active', 'stale', 'deleted']).optional(),
  include_deleted: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((v) => v === true || v === 'true')
    .optional(),
});

interface Deps {
  store: Store;
  redis: Redis;
}

export function createReadRoutes(deps: Deps): Hono {
  const { store, redis } = deps;
  const r = new Hono();

  r.use('*', cors({ origin: '*', allowMethods: ['GET', 'OPTIONS'] }));
  r.use(
    '*',
    rateLimit({
      redis,
      limit: 600,
      windowSeconds: 60,
      key: (c) => `read:${clientIp(c)}`,
    }),
  );

  r.get('/', async (c) => {
    const raw = Object.fromEntries(new URL(c.req.url).searchParams.entries());
    const parsed = ListQuerySchema.safeParse(raw);
    if (!parsed.success) {
      throw RegistryError.invalidRequest('Invalid query parameters', {
        issues: parsed.error.issues,
      });
    }
    const query: ListQuery = parsed.data;
    const result = await store.list(query);

    c.header('cache-control', CACHE_LIST_HEADER);
    return c.json({
      listings: result.listings.map(toPublicListing),
      next_cursor: result.next_cursor,
    });
  });

  r.get('/:did{.+}', async (c) => {
    // Hono already URL-decodes the matched param once. Re-decoding
    // here turns canonical did:web identifiers with port (e.g.
    // `did:web:localhost%3A4003`) into the wrong key (`did:web:
    // localhost:4003`) and breaks the store lookup.
    const did = c.req.param('did');
    if (!ServiceDidSchema.safeParse(did).success) {
      throw RegistryError.invalidRequest('Invalid service_did in path');
    }
    const rec = await store.getByDid(did);
    if (!rec) throw RegistryError.notFound('Listing not found');
    c.header('cache-control', CACHE_SINGLE_HEADER);
    return c.json(toPublicListing(rec));
  });

  return r;
}
