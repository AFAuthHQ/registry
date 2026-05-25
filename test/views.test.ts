import { describe, expect, it } from 'vitest';
import type { DiscoveryDoc } from '../src/lib/schemas.js';
import { makeTestApp, type TestApp } from './helpers/app.js';
import { mockHost, validDiscoveryDoc } from './helpers/fetch-mock.js';

interface ChallengeResp {
  challenge_token: string;
  proof_url: string;
  expires_at: string;
}

async function register(
  app: TestApp,
  host: string,
  did: string,
  opts: { title?: string; tags?: string[]; description?: string } = {},
): Promise<void> {
  const discoveryUrl = `https://${host}/.well-known/afauth`;
  const chRes = await app.request('/v1/listings/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ discovery_url: discoveryUrl }),
  });
  const challenge = chRes.body as ChallengeResp;
  mockHost(host, {
    proof: { body: challenge.challenge_token },
    discovery: { doc: validDiscoveryDoc(did) },
  });
  await app.request('/v1/listings', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      discovery_url: discoveryUrl,
      challenge_token: challenge.challenge_token,
      ...opts,
    }),
  });
}

async function registerDirect(
  app: TestApp,
  host: string,
  did: string,
  opts: {
    title?: string;
    description?: string;
    tags?: string[];
    doc?: Partial<DiscoveryDoc>;
  } = {},
): Promise<void> {
  const baseDoc = validDiscoveryDoc(did);
  const doc: DiscoveryDoc = { ...baseDoc, ...opts.doc };
  await app.store.create({
    service_did: did,
    discovery_url: `https://${host}/.well-known/afauth`,
    discovery_host: host,
    discovery_doc: doc,
    title: opts.title,
    description: opts.description,
    tags: opts.tags ?? [],
  });
}

describe('GET / (browse)', () => {
  it('renders an empty-state message when no listings exist', async () => {
    const app = await makeTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body: string = res.body;
    expect(body).toContain('AFAuth Service Directory');
    expect(body).toContain('No services listed yet');
  });

  it('renders the listings table', async () => {
    const app = await makeTestApp();
    await register(app, 'api.example.com', 'did:web:api.example.com', {
      title: 'Example Photos',
      tags: ['photos', 'storage'],
    });
    const res = await app.request('/');
    const body: string = res.body;
    expect(body).toContain('Example Photos');
    expect(body).toContain('did:web:api.example.com');
    expect(body).toContain('photos');
    expect(body).toContain('storage');
  });

  it('marks did:key listings with a no-domain-anchor indicator', async () => {
    const app = await makeTestApp();
    await register(app, 'api.example.com', 'did:key:z6MkfTestKey', {
      title: 'Niche service',
    });
    const res = await app.request('/');
    const body: string = res.body;
    expect(body).toContain('did:key:z6MkfTestKey');
    expect(body).toContain('no domain anchor');
    // The discovery host should also be visible per §3.
    expect(body).toContain('api.example.com');
  });

  it('HTML-escapes user-supplied fields to prevent injection', async () => {
    const app = await makeTestApp();
    await register(app, 'api.example.com', 'did:web:api.example.com', {
      title: '<script>alert(1)</script>',
      description: 'I <3 AFAuth & "directories"',
    });
    const res = await app.request('/');
    const body: string = res.body;
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).toContain('I &lt;3 AFAuth &amp; &quot;directories&quot;');
  });

  it('exposes discovery URL, afauth_version, capability pills, and JSON link per row', async () => {
    const app = await makeTestApp();
    await registerDirect(app, 'api.example.com', 'did:web:api.example.com', {
      title: 'Example',
      doc: {
        afauth_version: '0.1',
        features: ['key_rotation'],
        recipient_types: ['email', 'phone'],
      },
    });
    const res = await app.request('/');
    const body: string = res.body;
    // discovery_url surfaced (Tier 1 #1)
    expect(body).toContain('https://api.example.com/.well-known/afauth');
    // afauth_version badge (Tier 1 #2)
    expect(body).toContain('v0.1');
    // features + recipient_types pills (Tier 1 #4)
    expect(body).toContain('key_rotation');
    expect(body).toContain('email');
    expect(body).toContain('phone');
    // JSON link to API (Tier 1 #5)
    expect(body).toMatch(
      /href="\/v1\/listings\/did(?::|%3A)web(?::|%3A)api\.example\.com"/i,
    );
  });

  it('links each service title to its detail page', async () => {
    const app = await makeTestApp();
    await registerDirect(app, 'api.example.com', 'did:web:api.example.com', {
      title: 'Example',
    });
    const res = await app.request('/');
    const body: string = res.body;
    expect(body).toMatch(
      /href="\/listings\/did(?::|%3A)web(?::|%3A)api\.example\.com"/i,
    );
  });
});

describe('GET /listings/:did (detail page)', () => {
  it('returns an HTML detail page for an existing listing', async () => {
    const app = await makeTestApp();
    await registerDirect(app, 'api.example.com', 'did:web:api.example.com', {
      title: 'Example Photos',
      description: 'Personal photo storage.',
      tags: ['photos', 'storage'],
      doc: {
        afauth_version: '0.1',
        features: ['key_rotation', 'attestation'],
        recipient_types: ['email'],
        limits: {
          unclaimed_ttl_seconds: 2592000,
          unclaimed_rate_limit_per_hour: 10,
        },
      },
    });
    const res = await app.request('/listings/did:web:api.example.com');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body: string = res.body;

    expect(body).toContain('Example Photos');
    expect(body).toContain('Personal photo storage.');
    expect(body).toContain('did:web:api.example.com');
    expect(body).toContain('https://api.example.com/.well-known/afauth');
    expect(body).toContain('api.example.com');

    expect(body).toContain('v0.1');
    expect(body).toContain('key_rotation');
    expect(body).toContain('attestation');
    expect(body).toContain('email');
    expect(body).toContain('ed25519');

    expect(body).toContain('/v1/accounts');
    expect(body).toContain('/v1/owner-invitation');
    expect(body).toContain('https://api.example.com/claim');
    expect(body).toContain('/v1/claim');

    expect(body).toContain('2592000');
    expect(body).toContain('photos');
    expect(body).toContain('storage');
  });

  it('embeds the full listing as application/json for scrapers', async () => {
    const app = await makeTestApp();
    await registerDirect(app, 'api.example.com', 'did:web:api.example.com', {
      title: 'Example',
    });
    const res = await app.request('/listings/did:web:api.example.com');
    const body: string = res.body;
    expect(body).toMatch(/<script[^>]*type="application\/json"[^>]*id="listing-data"/);
    expect(body).toContain('"service_did":"did:web:api.example.com"');
  });

  it('flags did:key listings with the no-domain-anchor warning', async () => {
    const app = await makeTestApp();
    await registerDirect(app, 'api.example.com', 'did:key:z6MkfTestKey');
    const res = await app.request('/listings/did:key:z6MkfTestKey');
    expect(res.status).toBe(200);
    const body: string = res.body;
    expect(body).toContain('did:key:z6MkfTestKey');
    expect(body).toContain('no domain anchor');
  });

  it('returns a 404 HTML page for an unknown service_did', async () => {
    const app = await makeTestApp();
    const res = await app.request('/listings/did:web:nope.example.com');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    const body: string = res.body;
    expect(body).toContain('Listing not found');
  });

  it('returns 400 for a malformed service_did in the path', async () => {
    const app = await makeTestApp();
    const res = await app.request('/listings/not-a-did');
    expect(res.status).toBe(400);
  });

  it('HTML-escapes user-supplied fields on the detail page', async () => {
    const app = await makeTestApp();
    await registerDirect(app, 'api.example.com', 'did:web:api.example.com', {
      title: '<script>alert(1)</script>',
      description: 'A & B',
    });
    const res = await app.request('/listings/did:web:api.example.com');
    const body: string = res.body;
    expect(body).not.toContain('<script>alert(1)</script>');
    expect(body).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(body).toContain('A &amp; B');
  });

  it('links to the JSON API counterpart', async () => {
    const app = await makeTestApp();
    await registerDirect(app, 'api.example.com', 'did:web:api.example.com');
    const res = await app.request('/listings/did:web:api.example.com');
    const body: string = res.body;
    expect(body).toMatch(
      /href="\/v1\/listings\/did(?::|%3A)web(?::|%3A)api\.example\.com"/i,
    );
  });
});

describe('GET /operator', () => {
  it('serves the operator commitment with the required sections', async () => {
    const app = await makeTestApp();
    const res = await app.request('/operator');
    expect(res.status).toBe(200);
    const body: string = res.body;
    expect(body).toContain('Operator commitment');
    expect(body).toContain('AFAuthHQ');
    expect(body).toContain('Actions the operator MAY take unilaterally');
    expect(body).toContain('Actions the operator MUST NOT take unilaterally');
    expect(body).toContain('Federation');
  });
});

describe('GET /policy', () => {
  it('serves the take-down policy with the §10 categories', async () => {
    const app = await makeTestApp();
    const res = await app.request('/policy');
    expect(res.status).toBe(200);
    const body: string = res.body;
    expect(body).toContain('Take-down policy');
    expect(body).toContain('illegal content');
    expect(body).toContain('malware');
    expect(body).toContain('spam');
    expect(body).toContain('fraudulent claims');
    expect(body).toContain('Hard-erase');
  });
});
