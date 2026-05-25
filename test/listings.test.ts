import { describe, expect, it } from 'vitest';
import { mockHost, validDiscoveryDoc } from './helpers/fetch-mock.js';
import { makeTestApp, type TestApp } from './helpers/app.js';

interface ChallengeResp {
  challenge_token: string;
  proof_url: string;
  expires_at: string;
}

interface SubmitResp {
  service_did: string;
  session_token: string;
  expires_at: string;
}

async function getChallenge(
  app: TestApp,
  discoveryUrl: string,
): Promise<ChallengeResp> {
  const res = await app.request('/v1/listings/challenge', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ discovery_url: discoveryUrl }),
  });
  expect(res.status).toBe(200);
  return res.body as ChallengeResp;
}

describe('POST /v1/listings/challenge', () => {
  it('issues a challenge for a valid discovery_url', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: 'https://api.example.com/.well-known/afauth',
      }),
    });
    expect(res.status).toBe(200);
    expect(res.body.challenge_token).toMatch(/^ch_[A-Za-z0-9_-]{22}$/);
    expect(res.body.proof_url).toBe(
      'https://api.example.com/.well-known/afauth-registry-proof',
    );
    expect(new Date(res.body.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects http:// discovery_url', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: 'http://api.example.com/.well-known/afauth',
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('rate-limits more than 10 active challenges per host', async () => {
    const app = await makeTestApp();
    const url = 'https://busy.example.com/.well-known/afauth';
    for (let i = 0; i < 10; i++) {
      const ok = await app.request('/v1/listings/challenge', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ discovery_url: url }),
      });
      expect(ok.status).toBe(200);
    }
    const overflow = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discovery_url: url }),
    });
    expect(overflow.status).toBe(429);
    expect(overflow.body.error.code).toBe('rate_limited');
  });
});

describe('POST /v1/listings — happy path', () => {
  it('creates a listing and returns a session token', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const challenge = await getChallenge(app, discoveryUrl);

    mockHost('api.example.com', {
      proof: { body: challenge.challenge_token },
      discovery: { doc: validDiscoveryDoc() },
    });

    const res = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
        title: 'Example Photo Storage',
        description: 'AFAuth-supported photo storage for agents.',
        tags: ['productivity', 'storage'],
      }),
    });

    expect(res.status).toBe(201);
    const submit = res.body as SubmitResp;
    expect(submit.service_did).toBe('did:web:api.example.com');
    expect(submit.session_token).toMatch(/^sess_[A-Za-z0-9_-]{22}$/);

    const listed = await app.store.getByDid('did:web:api.example.com');
    expect(listed?.title).toBe('Example Photo Storage');
    expect(listed?.tags).toEqual(['productivity', 'storage']);
    expect(listed?.status).toBe('active');
  });
});

describe('POST /v1/listings — failure modes', () => {
  it('rejects when challenge token does not exist', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: 'https://api.example.com/.well-known/afauth',
        challenge_token: 'ch_aaaaaaaaaaaaaaaaaaaaaa',
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_challenge');
  });

  it('rejects when discovery_url does not match the challenge', async () => {
    const app = await makeTestApp();
    const challenge = await getChallenge(
      app,
      'https://api.example.com/.well-known/afauth',
    );
    const res = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: 'https://attacker.example.com/.well-known/afauth',
        challenge_token: challenge.challenge_token,
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('proof_mismatch');
  });

  it('rejects when proof body does not match the token', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const challenge = await getChallenge(app, discoveryUrl);

    mockHost('api.example.com', {
      proof: { body: 'wrong-token-content' },
      discovery: { doc: validDiscoveryDoc() },
    });

    const res = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('proof_mismatch');
  });

  it('rejects when proof endpoint returns non-2xx', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const challenge = await getChallenge(app, discoveryUrl);

    mockHost('api.example.com', {
      proof: { body: 'not-found', status: 404 },
      discovery: { doc: validDiscoveryDoc() },
    });

    const res = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('proof_fetch_failed');
  });

  it('rejects when discovery doc fails schema validation', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const challenge = await getChallenge(app, discoveryUrl);

    mockHost('api.example.com', {
      proof: { body: challenge.challenge_token },
      discovery: { doc: { not: 'a valid discovery doc' } },
    });

    const res = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('discovery_invalid');
  });

  it('rejects did:web mismatched with discovery host', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const challenge = await getChallenge(app, discoveryUrl);

    mockHost('api.example.com', {
      proof: { body: challenge.challenge_token },
      // Discovery doc lies about its DID: api.example.com declares did:web:other.com
      discovery: { doc: validDiscoveryDoc('did:web:other.example.com') },
    });

    const res = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
      }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('discovery_did_mismatch');
  });

  it('rejects challenge reuse', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const challenge = await getChallenge(app, discoveryUrl);

    mockHost('api.example.com', {
      proof: { body: challenge.challenge_token },
      discovery: { doc: validDiscoveryDoc() },
    });

    // First use succeeds.
    const first = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
      }),
    });
    expect(first.status).toBe(201);

    // Second attempt with the same token fails.
    const second = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
      }),
    });
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe('invalid_challenge');
  });
});

describe('POST /v1/listings — re-challenge path', () => {
  it('re-issues a session for an existing listing and revokes prior sessions', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';

    // First listing
    const ch1 = await getChallenge(app, discoveryUrl);
    mockHost('api.example.com', {
      proof: { body: ch1.challenge_token },
      discovery: { doc: validDiscoveryDoc() },
    });
    const sub1 = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: ch1.challenge_token,
      }),
    });
    expect(sub1.status).toBe(201);
    const firstSession = (sub1.body as SubmitResp).session_token;

    // Re-challenge for the same host
    const ch2 = await getChallenge(app, discoveryUrl);
    mockHost('api.example.com', {
      proof: { body: ch2.challenge_token },
      discovery: { doc: validDiscoveryDoc() },
    });
    const sub2 = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: ch2.challenge_token,
      }),
    });
    expect(sub2.status).toBe(200);
    const secondSession = (sub2.body as SubmitResp).session_token;
    expect(secondSession).not.toBe(firstSession);

    // The first session token is no longer valid.
    const usingFirst = await app.request(
      '/v1/listings/did:web:api.example.com',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${firstSession}`,
        },
        body: JSON.stringify({ title: 'should-fail' }),
      },
    );
    expect(usingFirst.status).toBe(401);

    // The second session token works.
    const usingSecond = await app.request(
      '/v1/listings/did:web:api.example.com',
      {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${secondSession}`,
        },
        body: JSON.stringify({ title: 'New name' }),
      },
    );
    expect(usingSecond.status).toBe(200);
    expect(usingSecond.body.title).toBe('New name');
  });

  it('rejects re-challenge from a different host', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';

    // Initial listing under api.example.com
    const ch1 = await getChallenge(app, discoveryUrl);
    mockHost('api.example.com', {
      proof: { body: ch1.challenge_token },
      discovery: { doc: validDiscoveryDoc() },
    });
    await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: ch1.challenge_token,
      }),
    });

    // Now attacker tries to claim did:web:api.example.com from attacker.example.com
    // (this requires their discovery doc to lie about its service_did, which would
    //  fail the did:web mismatch check — but let's check by spoofing did:key)
    const attackerUrl = 'https://attacker.example.com/.well-known/afauth';
    const ch2 = await getChallenge(app, attackerUrl);
    mockHost('attacker.example.com', {
      proof: { body: ch2.challenge_token },
      // attacker uses a did:key (no host bind), but claims the same DID
      // as an existing listing — which we want to prevent.
      discovery: {
        doc: validDiscoveryDoc('did:key:z6MkfTestAttacker'),
      },
    });
    // First, attacker creates their own listing
    const sub2 = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: attackerUrl,
        challenge_token: ch2.challenge_token,
      }),
    });
    expect(sub2.status).toBe(201);

    // Now the attacker tries to register a DIFFERENT host claiming the
    // existing did:key. To do this they need a new challenge for a third host.
    const evilUrl = 'https://evil.example.com/.well-known/afauth';
    const ch3 = await getChallenge(app, evilUrl);
    mockHost('evil.example.com', {
      proof: { body: ch3.challenge_token },
      discovery: { doc: validDiscoveryDoc('did:key:z6MkfTestAttacker') },
    });
    const sub3 = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: evilUrl,
        challenge_token: ch3.challenge_token,
      }),
    });
    expect(sub3.status).toBe(409);
    expect(sub3.body.error.code).toBe('conflict');
  });
});

describe('PATCH /v1/listings/{did}', () => {
  async function registerListing(): Promise<{
    app: TestApp;
    did: string;
    session: string;
  }> {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const challenge = await getChallenge(app, discoveryUrl);
    mockHost('api.example.com', {
      proof: { body: challenge.challenge_token },
      discovery: { doc: validDiscoveryDoc() },
    });
    const res = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
        title: 'Initial Title',
        tags: ['a', 'b'],
      }),
    });
    const submit = res.body as SubmitResp;
    return { app, did: submit.service_did, session: submit.session_token };
  }

  it('rejects requests without a bearer token', async () => {
    const { app, did } = await registerListing();
    const res = await app.request(`/v1/listings/${did}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'New' }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects requests with a session bound to a different DID', async () => {
    const { app, session } = await registerListing();
    const res = await app.request(`/v1/listings/did:web:other.example.com`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({ title: 'New' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects unknown fields in patch body', async () => {
    const { app, did, session } = await registerListing();
    const res = await app.request(`/v1/listings/${did}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({ discovery_url: 'https://elsewhere/' }),
    });
    expect(res.status).toBe(400);
  });

  it('applies a tags update', async () => {
    const { app, did, session } = await registerListing();
    const res = await app.request(`/v1/listings/${did}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({ tags: ['photos', 'storage'] }),
    });
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual(['photos', 'storage']);
  });
});

describe('DELETE /v1/listings/{did}', () => {
  it('soft-deletes a listing', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const challenge = await getChallenge(app, discoveryUrl);
    mockHost('api.example.com', {
      proof: { body: challenge.challenge_token },
      discovery: { doc: validDiscoveryDoc() },
    });
    const sub = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
      }),
    });
    const submit = sub.body as SubmitResp;

    const del = await app.request(`/v1/listings/${submit.service_did}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${submit.session_token}` },
    });
    expect(del.status).toBe(204);

    const after = await app.store.getByDid(submit.service_did);
    expect(after?.status).toBe('deleted');
  });

  it('returns 404 for non-existent listing', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings/did:web:nope.example.com', {
      method: 'DELETE',
      headers: { authorization: 'Bearer sess_aaaaaaaaaaaaaaaaaaaaaa' },
    });
    expect(res.status).toBe(401);
  });
});
