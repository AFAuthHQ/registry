import { describe, expect, it } from 'vitest';
import { mockHost, validDiscoveryDoc } from './helpers/fetch-mock.js';
import { makeTestApp, type TestApp } from './helpers/app.js';

interface ChallengeResp {
  challenge_token: string;
  proof_url: string;
  expires_at: string;
}

async function registerHost(
  app: TestApp,
  host: string,
  opts: { title?: string; tags?: string[] } = {},
): Promise<void> {
  const discoveryUrl = `https://${host}/.well-known/afauth`;
  const ch = await app.request('/v1/listings/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ discovery_url: discoveryUrl }),
  });
  const challenge = ch.body as ChallengeResp;
  mockHost(host, {
    proof: { body: challenge.challenge_token },
    discovery: { doc: validDiscoveryDoc(`did:web:${host}`) },
  });
  const res = await app.request('/v1/listings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      discovery_url: discoveryUrl,
      challenge_token: challenge.challenge_token,
      ...(opts.title ? { title: opts.title } : {}),
      ...(opts.tags ? { tags: opts.tags } : {}),
    }),
  });
  expect(res.status).toBe(201);
}

describe('GET /v1/listings/:did', () => {
  it('returns the listing for an existing service_did', async () => {
    const app = await makeTestApp();
    await registerHost(app, 'api.example.com', { title: 'Example' });
    const res = await app.request('/v1/listings/did:web:api.example.com');
    expect(res.status).toBe(200);
    expect(res.body.service_did).toBe('did:web:api.example.com');
    expect(res.body.title).toBe('Example');
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=60, s-maxage=300',
    );
  });

  it('exposes updated_at and strips internal fields', async () => {
    const app = await makeTestApp();
    await registerHost(app, 'api.example.com');
    const res = await app.request('/v1/listings/did:web:api.example.com');
    expect(res.body.updated_at).toBeTypeOf('string');
    expect(res.body.consecutive_fails).toBeUndefined();
    expect(res.body.first_failed_at).toBeUndefined();
    expect(res.body.discovery_host).toBeUndefined();
  });

  it('returns 404 for a non-existent service_did', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings/did:web:nope.example.com');
    expect(res.status).toBe(404);
  });

  it('rejects malformed service_did in path', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings/not-a-did');
    expect(res.status).toBe(400);
  });
});

describe('GET /v1/listings', () => {
  it('returns an empty array when no listings exist', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings');
    expect(res.status).toBe(200);
    expect(res.body.listings).toEqual([]);
    expect(res.body.next_cursor).toBeNull();
  });

  it('returns listed services in updated_at order', async () => {
    const app = await makeTestApp();
    await registerHost(app, 'a.example.com');
    await registerHost(app, 'b.example.com');
    await registerHost(app, 'c.example.com');
    const res = await app.request('/v1/listings');
    expect(res.status).toBe(200);
    expect(res.body.listings.map((l: any) => l.service_did)).toEqual([
      'did:web:a.example.com',
      'did:web:b.example.com',
      'did:web:c.example.com',
    ]);
  });

  it('filters by tag', async () => {
    const app = await makeTestApp();
    await registerHost(app, 'a.example.com', { tags: ['storage', 'media'] });
    await registerHost(app, 'b.example.com', { tags: ['email'] });
    const res = await app.request('/v1/listings?tag=email');
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].service_did).toBe('did:web:b.example.com');
  });

  it('filters by case-insensitive search on title and description', async () => {
    const app = await makeTestApp();
    await registerHost(app, 'a.example.com', { title: 'Photo Storage' });
    await registerHost(app, 'b.example.com', { title: 'Mail Service' });
    const res = await app.request('/v1/listings?search=photo');
    expect(res.body.listings).toHaveLength(1);
    expect(res.body.listings[0].service_did).toBe('did:web:a.example.com');
  });

  it('excludes soft-deleted listings by default', async () => {
    const app = await makeTestApp();
    await registerHost(app, 'a.example.com');
    await registerHost(app, 'b.example.com');
    await app.store.softDelete('did:web:b.example.com');
    const res = await app.request('/v1/listings');
    expect(res.body.listings.map((l: any) => l.service_did)).toEqual([
      'did:web:a.example.com',
    ]);
  });

  it('returns soft-deleted listings when include_deleted=true', async () => {
    const app = await makeTestApp();
    await registerHost(app, 'a.example.com');
    await registerHost(app, 'b.example.com');
    await app.store.softDelete('did:web:b.example.com');
    const res = await app.request('/v1/listings?include_deleted=true');
    expect(res.body.listings.map((l: any) => l.service_did).sort()).toEqual([
      'did:web:a.example.com',
      'did:web:b.example.com',
    ]);
    const deleted = res.body.listings.find(
      (l: any) => l.service_did === 'did:web:b.example.com',
    );
    expect(deleted.status).toBe('deleted');
  });

  it('paginates with opaque cursor when limit < total', async () => {
    const app = await makeTestApp();
    for (const sub of ['a', 'b', 'c', 'd', 'e']) {
      await registerHost(app, `${sub}.example.com`);
    }
    const first = await app.request('/v1/listings?limit=2');
    expect(first.body.listings).toHaveLength(2);
    expect(first.body.next_cursor).toBeTypeOf('string');

    const second = await app.request(
      `/v1/listings?limit=2&cursor=${encodeURIComponent(first.body.next_cursor)}`,
    );
    expect(second.body.listings).toHaveLength(2);

    const third = await app.request(
      `/v1/listings?limit=2&cursor=${encodeURIComponent(second.body.next_cursor)}`,
    );
    expect(third.body.listings).toHaveLength(1);
    expect(third.body.next_cursor).toBeNull();

    const allSeen = [
      ...first.body.listings,
      ...second.body.listings,
      ...third.body.listings,
    ].map((l: any) => l.service_did);
    expect(allSeen.sort()).toEqual([
      'did:web:a.example.com',
      'did:web:b.example.com',
      'did:web:c.example.com',
      'did:web:d.example.com',
      'did:web:e.example.com',
    ]);
  });

  it('filters by updated_since (RFC 3339)', async () => {
    const app = await makeTestApp();
    await registerHost(app, 'a.example.com');
    // Snapshot the boundary between the two registrations.
    const boundary = new Date(Date.now() + 1).toISOString();
    // Advance time so b.example.com's updated_at is strictly greater than boundary.
    await new Promise((r) => setTimeout(r, 5));
    await registerHost(app, 'b.example.com');

    const res = await app.request(
      `/v1/listings?updated_since=${encodeURIComponent(boundary)}`,
    );
    const dids = res.body.listings.map((l: any) => l.service_did);
    expect(dids).toContain('did:web:b.example.com');
    expect(dids).not.toContain('did:web:a.example.com');
  });

  it('rejects limit > 100', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings?limit=500');
    expect(res.status).toBe(400);
  });

  it('rejects unparseable updated_since', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings?updated_since=not-a-date');
    expect(res.status).toBe(400);
  });

  it('sets cache-control headers for mirror friendliness', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings');
    expect(res.headers.get('cache-control')).toBe(
      'public, max-age=30, s-maxage=120',
    );
  });

  it('sets permissive CORS for browser aggregators', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings', {
      headers: { origin: 'https://aggregator.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
