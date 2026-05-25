import { beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers/app.js';
import { mockHost, validDiscoveryDoc } from './helpers/fetch-mock.js';

// Tests rely on the REGISTRY_CRON_SECRET set by .env / process.env. The
// app.ts helper boots with the same default; here we set a known value
// so we can authenticate against the admin route.
const CRON_SECRET = 'test-cron-secret-1234567890';

beforeEach(() => {
  process.env.REGISTRY_CRON_SECRET = CRON_SECRET;
  process.env.REGISTRY_ADMIN_SECRET = 'test-admin-secret-1234567890';
  process.env.DATABASE_URL = 'postgres://x:x@localhost:5432/x';
  process.env.REDIS_URL = 'redis://localhost:6379';
});

describe('POST /admin/cron/revalidate', () => {
  it('rejects requests without a bearer token', async () => {
    const app = await makeTestApp();
    const res = await app.request('/admin/cron/revalidate', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rejects requests with the wrong bearer token', async () => {
    const app = await makeTestApp();
    const res = await app.request('/admin/cron/revalidate', {
      method: 'POST',
      headers: { authorization: 'Bearer not-the-right-secret' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts requests with the cron secret and runs a tick', async () => {
    const app = await makeTestApp();

    // Seed one due-for-revalidation listing.
    const longAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const rec = await app.store.create({
      service_did: 'did:web:api.example.com',
      discovery_url: 'https://api.example.com/.well-known/afauth',
      discovery_host: 'api.example.com',
      discovery_doc: validDiscoveryDoc('did:web:api.example.com'),
    });
    (rec as any).fetched_at = longAgo.toISOString();

    mockHost('api.example.com', {
      discovery: { doc: validDiscoveryDoc('did:web:api.example.com') },
    });

    const res = await app.request('/admin/cron/revalidate', {
      method: 'POST',
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    });
    expect(res.status).toBe(200);
    expect(res.body.scheduled).toBe(1);
    expect(res.body.succeeded).toBe(1);
  });
});
