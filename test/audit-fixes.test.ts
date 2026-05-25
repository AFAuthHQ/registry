/**
 * Regression tests for audit findings applied in Phase 7:
 *   #1 delete-then-patch must not corrupt the deleted record
 *   #5 proof without Content-Type must be rejected
 *   #6 empty PATCH body must be rejected
 *   #7 challenge must survive validation failures (retryable)
 *   #2 outbound fetch must reject redirects
 */
import { describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { fetchMock, mockHost, validDiscoveryDoc } from './helpers/fetch-mock.js';
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

async function register(app: TestApp, host: string, title = 'Initial'): Promise<SubmitResp> {
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
      title,
    }),
  });
  expect(res.status).toBe(201);
  return res.body as SubmitResp;
}

describe('audit #1 — delete-then-patch must not mutate deleted record', () => {
  it('rejects PATCH with 404 and leaves updated_at unchanged', async () => {
    const app = await makeTestApp();
    const submit = await register(app, 'api.example.com', 'Original Title');

    // Soft-delete
    const del = await app.request(`/v1/listings/${submit.service_did}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${submit.session_token}` },
    });
    expect(del.status).toBe(204);

    const afterDelete = await app.store.getByDid(submit.service_did);
    expect(afterDelete?.status).toBe('deleted');
    const deleteUpdatedAt = afterDelete!.updated_at;

    // Wait briefly so any (incorrect) update would bump updated_at to a later value
    await new Promise((r) => setTimeout(r, 5));

    // PATCH with the same still-valid session
    const patch = await app.request(`/v1/listings/${submit.service_did}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submit.session_token}`,
      },
      body: JSON.stringify({ title: 'Attempted Overwrite' }),
    });
    expect(patch.status).toBe(404);

    // Critical: the deleted record's title and updated_at must be unchanged.
    const afterPatch = await app.store.getByDid(submit.service_did);
    expect(afterPatch?.title).toBe('Original Title');
    expect(afterPatch?.updated_at).toBe(deleteUpdatedAt);
  });
});

describe('audit #5 — proof Content-Type must be text/plain (no header or wrong header both reject)', () => {
  it('fails proof_fetch_failed when proof endpoint returns the wrong Content-Type', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const ch = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discovery_url: discoveryUrl }),
    });
    const challenge = ch.body as ChallengeResp;

    // Proof served as application/octet-stream — common default for a
    // misconfigured static host. The spec mandates text/plain.
    fetchMock.use(
      http.get('https://api.example.com/.well-known/afauth-registry-proof', () =>
        new HttpResponse(challenge.challenge_token, {
          status: 200,
          headers: { 'content-type': 'application/octet-stream' },
        }),
      ),
      http.get('https://api.example.com/.well-known/afauth', () =>
        HttpResponse.json(validDiscoveryDoc('did:web:api.example.com')),
      ),
    );

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
    expect(res.body.error.message.toLowerCase()).toContain('text/plain');
  });
});

describe('audit #6 — empty PATCH must be rejected', () => {
  it('returns 400 invalid_request when PATCH body has no writeable fields', async () => {
    const app = await makeTestApp();
    const submit = await register(app, 'api.example.com');

    const res = await app.request(`/v1/listings/${submit.service_did}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${submit.session_token}`,
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');

    // updated_at must not have bumped
    const before = await app.store.getByDid(submit.service_did);
    const beforeUpdatedAt = before!.updated_at;
    await new Promise((r) => setTimeout(r, 5));
    const after = await app.store.getByDid(submit.service_did);
    expect(after?.updated_at).toBe(beforeUpdatedAt);
  });
});

describe('audit #7 — challenge survives validation failures', () => {
  it('keeps the challenge alive when discovery doc fails schema validation, so the controller can retry', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const ch = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discovery_url: discoveryUrl }),
    });
    const challenge = ch.body as ChallengeResp;

    // First attempt: discovery doc is malformed
    mockHost('api.example.com', {
      proof: { body: challenge.challenge_token },
      discovery: { doc: { not: 'a valid discovery doc' } },
    });
    const first = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
      }),
    });
    expect(first.status).toBe(400);
    expect(first.body.error.code).toBe('discovery_invalid');

    // Second attempt with the SAME challenge after fixing the doc must succeed.
    mockHost('api.example.com', {
      proof: { body: challenge.challenge_token },
      discovery: { doc: validDiscoveryDoc('did:web:api.example.com') },
    });
    const second = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
      }),
    });
    expect(second.status).toBe(201);
  });

  it('still rejects challenge reuse after a successful submission', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const ch = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discovery_url: discoveryUrl }),
    });
    const challenge = ch.body as ChallengeResp;
    mockHost('api.example.com', {
      proof: { body: challenge.challenge_token },
      discovery: { doc: validDiscoveryDoc('did:web:api.example.com') },
    });

    const first = await app.request('/v1/listings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        discovery_url: discoveryUrl,
        challenge_token: challenge.challenge_token,
      }),
    });
    expect(first.status).toBe(201);

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

describe('audit #2 — outbound fetch must not follow redirects', () => {
  it('treats a 302 redirect on proof_url as proof_fetch_failed', async () => {
    const app = await makeTestApp();
    const discoveryUrl = 'https://api.example.com/.well-known/afauth';
    const ch = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discovery_url: discoveryUrl }),
    });
    const challenge = ch.body as ChallengeResp;

    fetchMock.use(
      http.get('https://api.example.com/.well-known/afauth-registry-proof', () =>
        new HttpResponse(null, {
          status: 302,
          headers: { location: 'https://elsewhere.example.com/proof' },
        }),
      ),
      http.get('https://api.example.com/.well-known/afauth', () =>
        HttpResponse.json(validDiscoveryDoc('did:web:api.example.com')),
      ),
    );

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
});

describe('audit #3 — submitting a private/loopback discovery_url is rejected at validation time', () => {
  it('rejects literal IPv4 private IPs at challenge endpoint', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discovery_url: 'https://10.0.0.5/.well-known/afauth' }),
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_request');
  });

  it('rejects localhost at challenge endpoint', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discovery_url: 'https://localhost/.well-known/afauth' }),
    });
    expect(res.status).toBe(400);
  });

  it('rejects IPv6 loopback at challenge endpoint', async () => {
    const app = await makeTestApp();
    const res = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discovery_url: 'https://[::1]/.well-known/afauth' }),
    });
    expect(res.status).toBe(400);
  });
});
