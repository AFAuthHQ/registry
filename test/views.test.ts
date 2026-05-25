import { describe, expect, it } from 'vitest';
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
