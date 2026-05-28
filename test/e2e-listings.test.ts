/**
 * Gated test-mode endpoint that inserts a listing without the
 * challenge/proof ceremony. Used by `spec/harness/e2e/` to seed a
 * listing for the registry round-trip scenario.
 *
 * MUST 404 by default (no REGISTRY_E2E_DIRECT_INSERT). Only with the
 * flag set does the endpoint accept submissions. Submissions are
 * also gated on schema validity, but with a relaxed schema vs. the
 * public path: http:// is allowed (so docker-internal hostnames
 * work) and the public-host check is skipped.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers/app.js';
import { resetConfigForTest } from '../src/lib/config.js';

const VALID_DISCOVERY_DOC = {
  afauth_version: '0.1',
  service_did: 'did:web:localhost%3A4003',
  endpoints: {
    accounts: '/afauth/v1/accounts',
    owner_invitation: '/afauth/v1/accounts/me/owner-invitation',
    claim_page: 'http://localhost:4003/claim',
    claim_completion: '/afauth/v1/claim',
    key_rotation: '/afauth/v1/accounts/me/keys/rotate',
  },
  signature_algorithms: ['ed25519'],
  recipient_types: ['email'],
};

const VALID_BODY = {
  service_did: 'did:web:localhost%3A4003',
  discovery_url: 'http://localhost:4003/.well-known/afauth',
  discovery_doc: VALID_DISCOVERY_DOC,
  title: 'E2E reference service',
  description: 'Stand-in for the registry round-trip scenario.',
  tags: ['e2e'],
};

beforeEach(() => {
  process.env.REGISTRY_CRON_SECRET = 'test-cron-secret-1234567890';
  process.env.REGISTRY_ADMIN_SECRET = 'test-admin-secret-1234567890';
  process.env.DATABASE_URL = 'postgres://x:x@localhost:5432/x';
  process.env.REDIS_URL = 'redis://localhost:6379';
  resetConfigForTest();
});

afterEach(() => {
  delete process.env.REGISTRY_E2E_DIRECT_INSERT;
  resetConfigForTest();
});

describe('POST /admin/e2e/listings (gated test-mode insert)', () => {
  it('returns 404 when REGISTRY_E2E_DIRECT_INSERT is unset (default)', async () => {
    delete process.env.REGISTRY_E2E_DIRECT_INSERT;
    resetConfigForTest();
    const app = await makeTestApp();
    const r = await app.request('/admin/e2e/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(r.status).toBe(404);
  });

  it('returns 404 when REGISTRY_E2E_DIRECT_INSERT=0', async () => {
    process.env.REGISTRY_E2E_DIRECT_INSERT = '0';
    resetConfigForTest();
    const app = await makeTestApp();
    const r = await app.request('/admin/e2e/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(r.status).toBe(404);
  });

  it('inserts a listing when REGISTRY_E2E_DIRECT_INSERT=1', async () => {
    process.env.REGISTRY_E2E_DIRECT_INSERT = '1';
    resetConfigForTest();
    const app = await makeTestApp();
    const r = await app.request('/admin/e2e/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(r.status).toBe(201);
    expect(r.body.service_did).toBe(VALID_BODY.service_did);
    expect(r.body.discovery_url).toBe(VALID_BODY.discovery_url);
    expect(r.body.title).toBe(VALID_BODY.title);

    // The listing is now readable via the public GET endpoint.
    const lookup = await app.request(
      '/v1/listings/' + encodeURIComponent(VALID_BODY.service_did),
    );
    expect(lookup.status).toBe(200);
    expect(lookup.body.service_did).toBe(VALID_BODY.service_did);
  });

  it('also accepts REGISTRY_E2E_DIRECT_INSERT=true', async () => {
    process.env.REGISTRY_E2E_DIRECT_INSERT = 'true';
    resetConfigForTest();
    const app = await makeTestApp();
    const r = await app.request('/admin/e2e/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(r.status).toBe(201);
  });

  it('rejects bodies that are missing required fields', async () => {
    process.env.REGISTRY_E2E_DIRECT_INSERT = '1';
    resetConfigForTest();
    const app = await makeTestApp();

    // No service_did.
    const r1 = await app.request('/admin/e2e/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, service_did: undefined }),
    });
    expect(r1.status).toBe(400);

    // No discovery_doc.
    const r2 = await app.request('/admin/e2e/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, discovery_doc: undefined }),
    });
    expect(r2.status).toBe(400);
  });

  it('rejects a service_did that does not match did:(web|key):', async () => {
    process.env.REGISTRY_E2E_DIRECT_INSERT = '1';
    resetConfigForTest();
    const app = await makeTestApp();
    const r = await app.request('/admin/e2e/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_BODY, service_did: 'not-a-did' }),
    });
    expect(r.status).toBe(400);
  });

  it('is idempotent: second POST returns 200 with refreshed metadata', async () => {
    process.env.REGISTRY_E2E_DIRECT_INSERT = '1';
    resetConfigForTest();
    const app = await makeTestApp();

    const r1 = await app.request('/admin/e2e/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_BODY),
    });
    expect(r1.status).toBe(201);

    const updated = { ...VALID_BODY, title: 'Refreshed title', tags: ['v2'] };
    const r2 = await app.request('/admin/e2e/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updated),
    });
    expect(r2.status).toBe(200);
    expect(r2.body.title).toBe('Refreshed title');
    expect(r2.body.tags).toEqual(['v2']);

    // The lookup reflects the updated metadata too.
    const lookup = await app.request(
      '/v1/listings/' + encodeURIComponent(VALID_BODY.service_did),
    );
    expect(lookup.body.title).toBe('Refreshed title');
  });

  it('accepts http:// discovery_url (relaxed vs production schema)', async () => {
    process.env.REGISTRY_E2E_DIRECT_INSERT = '1';
    resetConfigForTest();
    const app = await makeTestApp();
    const r = await app.request('/admin/e2e/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...VALID_BODY,
        discovery_url: 'http://reference-server:3000/.well-known/afauth',
      }),
    });
    expect(r.status).toBe(201);
  });
});
