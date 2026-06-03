import { Hono } from 'hono';
import type Redis from 'ioredis';
import { z } from 'zod';
import { getConfig } from '../lib/config.js';
import { RegistryError } from '../lib/errors.js';
import { runRevalidation } from '../jobs/revalidate.js';
import {
  DiscoveryDocSchema,
  ServiceDidSchema,
} from '../lib/schemas.js';
import { toPublicListing } from '../lib/serialize.js';
import { constantTimeEqual } from '../lib/tokens.js';
import type { Store } from '../lib/store/index.js';

interface Deps {
  store: Store;
  redis: Redis;
}

// Relaxed vs. DiscoveryUrlSchema: accepts http://, accepts private/
// internal hostnames. Used ONLY by the test-mode insert endpoint.
const E2EDiscoveryUrlSchema = z.string().url();

const E2EListingSchema = z.object({
  service_did: ServiceDidSchema,
  discovery_url: E2EDiscoveryUrlSchema,
  discovery_doc: DiscoveryDocSchema,
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
});

export function createAdminRoutes(deps: Deps): Hono {
  const { store } = deps;
  const r = new Hono();

  r.post('/cron/revalidate', async (c) => {
    requireBearer(c.req.header('authorization'), getConfig().REGISTRY_CRON_SECRET);
    const result = await runRevalidation(deps);
    return c.json(result);
  });

  // Test-mode direct-insert. Gated behind REGISTRY_E2E_DIRECT_INSERT=1.
  // 404s in any deployment where the flag is unset. See lib/config.ts
  // for the rationale; see spec/harness/e2e/ for the consumer.
  r.post('/e2e/listings', async (c) => {
    const cfg = getConfig();
    if (!cfg.REGISTRY_E2E_DIRECT_INSERT) {
      return c.json({ error: { code: 'not_found', message: 'Not found' } }, 404);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = E2EListingSchema.safeParse(body);
    if (!parsed.success) {
      throw RegistryError.invalidRequest('Invalid e2e listing body', {
        issues: parsed.error.issues,
      });
    }
    const { service_did, discovery_url, discovery_doc, title, description, tags } = parsed.data;
    const host = new URL(discovery_url).host;

    // Idempotent upsert: if a listing already exists for this DID
    // (e.g. left over from a previous harness run against a
    // long-lived stack), refresh the mutable metadata via update()
    // and return it. discovery_url/discovery_doc are immutable in
    // the registry's data model and not refreshed here — tear the
    // stack down with `down.sh -v` if those need to change.
    const existing = await store.getByDid(service_did);
    if (existing) {
      const updated = await store.update(service_did, { title, description, tags });
      return c.json(toPublicListing(updated ?? existing), 200);
    }

    const rec = await store.create({
      service_did,
      discovery_url,
      discovery_host: host,
      discovery_doc,
      title,
      description,
      tags,
    });
    return c.json(toPublicListing(rec), 201);
  });

  return r;
}

function requireBearer(header: string | undefined, expected: string): void {
  if (!header || !header.startsWith('Bearer ')) {
    throw RegistryError.unauthorized('Missing bearer token');
  }
  const provided = header.slice('Bearer '.length).trim();
  // Constant-time compare so the admin/cron secret can't be recovered via
  // a timing side-channel on this internet-reachable endpoint (audit #7).
  if (!constantTimeEqual(provided, expected)) {
    throw RegistryError.unauthorized('Invalid bearer token');
  }
}
