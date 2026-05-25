import { describe, expect, it } from 'vitest';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { runRevalidation } from '../src/jobs/revalidate.js';
import { MemoryStore } from '../src/lib/store/memory.js';
import type { DiscoveryDoc } from '../src/lib/schemas.js';
import { mockHost, validDiscoveryDoc, fetchMock, http, HttpResponse } from './helpers/fetch-mock.js';

interface Fixture {
  store: MemoryStore;
  redis: Redis;
}

async function setup(): Promise<Fixture> {
  const store = new MemoryStore();
  await store.init();
  const redis = new RedisMock() as unknown as Redis;
  await redis.flushall();
  return { store, redis };
}

async function seed(
  store: MemoryStore,
  host: string,
  opts: { fetchedAt?: Date; doc?: DiscoveryDoc } = {},
): Promise<string> {
  const did = `did:web:${host}`;
  const rec = await store.create({
    service_did: did,
    discovery_url: `https://${host}/.well-known/afauth`,
    discovery_host: host,
    discovery_doc: opts.doc ?? validDiscoveryDoc(did),
  });
  if (opts.fetchedAt) {
    // backdate fetched_at so the listing is due for revalidation
    (rec as any).fetched_at = opts.fetchedAt.toISOString();
  }
  return did;
}

describe('runRevalidation — success path', () => {
  it('refreshes fetched_at and discovery_doc on a 200 response', async () => {
    const { store, redis } = await setup();
    const longAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const did = await seed(store, 'api.example.com', { fetchedAt: longAgo });

    mockHost('api.example.com', { discovery: { doc: validDiscoveryDoc(did) } });

    const result = await runRevalidation({ store, redis }, { useLock: false });
    expect(result.scheduled).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    const after = await store.getByDid(did);
    expect(after?.status).toBe('active');
    expect(after?.consecutive_fails).toBe(0);
    expect(after?.first_failed_at).toBeNull();
    expect(new Date(after!.fetched_at).getTime()).toBeGreaterThan(longAgo.getTime());
  });
});

describe('runRevalidation — failure path', () => {
  it('counts a 5xx as a failure', async () => {
    const { store, redis } = await setup();
    const longAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const did = await seed(store, 'api.example.com', { fetchedAt: longAgo });

    fetchMock.use(
      http.get('https://api.example.com/.well-known/afauth', () =>
        HttpResponse.text('Internal Server Error', { status: 503 }),
      ),
    );

    const result = await runRevalidation({ store, redis }, { useLock: false });
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(1);

    const after = await store.getByDid(did);
    expect(after?.consecutive_fails).toBe(1);
    expect(after?.status).toBe('active'); // still active after 1 failure
  });

  it('requires three consecutive failures to transition to stale', async () => {
    const { store, redis } = await setup();
    const longAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const did = await seed(store, 'api.example.com', { fetchedAt: longAgo });

    fetchMock.use(
      http.get('https://api.example.com/.well-known/afauth', () =>
        HttpResponse.text('gone', { status: 503 }),
      ),
    );

    for (let i = 0; i < 2; i++) {
      // Re-backdate each time so the listing remains eligible for revalidation.
      const rec = await store.getByDid(did);
      (rec as any).fetched_at = longAgo.toISOString();
      await runRevalidation({ store, redis }, { useLock: false });
    }
    const beforeThird = await store.getByDid(did);
    expect(beforeThird?.status).toBe('active');
    expect(beforeThird?.consecutive_fails).toBe(2);

    const rec = await store.getByDid(did);
    (rec as any).fetched_at = longAgo.toISOString();
    await runRevalidation({ store, redis }, { useLock: false });

    const afterThird = await store.getByDid(did);
    expect(afterThird?.status).toBe('stale');
    expect(afterThird?.consecutive_fails).toBe(3);
    expect(afterThird?.first_failed_at).not.toBeNull();
  });

  it('a service_did mismatch in the fresh doc counts as a failure', async () => {
    const { store, redis } = await setup();
    const longAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const did = await seed(store, 'api.example.com', { fetchedAt: longAgo });

    // Host now declares a different DID — possible misconfig or hijack.
    mockHost('api.example.com', {
      discovery: { doc: validDiscoveryDoc('did:web:other.example.com') },
    });

    const result = await runRevalidation({ store, redis }, { useLock: false });
    expect(result.failed).toBe(1);
    const after = await store.getByDid(did);
    expect(after?.consecutive_fails).toBe(1);
  });

  it('a malformed discovery doc counts as a failure', async () => {
    const { store, redis } = await setup();
    const longAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const did = await seed(store, 'api.example.com', { fetchedAt: longAgo });

    fetchMock.use(
      http.get('https://api.example.com/.well-known/afauth', () =>
        HttpResponse.json({ not: 'a discovery doc' }),
      ),
    );

    const result = await runRevalidation({ store, redis }, { useLock: false });
    expect(result.failed).toBe(1);
    const after = await store.getByDid(did);
    expect(after?.consecutive_fails).toBe(1);
  });
});

describe('runRevalidation — grace period and deletion', () => {
  it('transitions stale → deleted after the grace period', async () => {
    const { store, redis } = await setup();
    const did = await seed(store, 'api.example.com');

    // Drive the listing into stale state.
    for (let i = 0; i < 3; i++) {
      await store.markRevalidationFailure(did, new Date(Date.now() - 35 * 24 * 60 * 60 * 1000));
    }
    const beforeSweep = await store.getByDid(did);
    expect(beforeSweep?.status).toBe('stale');

    // No fresh-fetch candidates (we keep fetched_at recent so it's not picked up).
    const rec = await store.getByDid(did);
    (rec as any).fetched_at = new Date().toISOString();

    const result = await runRevalidation(
      { store, redis },
      {
        useLock: false,
        gracePeriodMs: 30 * 24 * 60 * 60 * 1000,
      },
    );
    expect(result.graceExpired).toBe(1);

    const after = await store.getByDid(did);
    expect(after?.status).toBe('deleted');
  });

  it('does not delete stale listings still within the grace window', async () => {
    const { store, redis } = await setup();
    const did = await seed(store, 'api.example.com');

    // Mark just barely stale: failures happened 1 hour ago, not 30 days.
    for (let i = 0; i < 3; i++) {
      await store.markRevalidationFailure(did, new Date(Date.now() - 60 * 60 * 1000));
    }
    expect((await store.getByDid(did))?.status).toBe('stale');

    const result = await runRevalidation({ store, redis }, { useLock: false });
    expect(result.graceExpired).toBe(0);

    expect((await store.getByDid(did))?.status).toBe('stale');
  });
});

describe('runRevalidation — concurrency', () => {
  it('a second concurrent run reports lockHeldByOther without doing work', async () => {
    const { store, redis } = await setup();
    const longAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await seed(store, 'a.example.com', { fetchedAt: longAgo });

    mockHost('a.example.com', { discovery: { doc: validDiscoveryDoc('did:web:a.example.com') } });

    // Pre-acquire the lock as if another replica is mid-run.
    await redis.set('revalidate:lock', 'someone-else', 'EX', 60);

    const result = await runRevalidation({ store, redis }, { useLock: true });
    expect(result.lockHeldByOther).toBe(true);
    expect(result.scheduled).toBe(0);
  });

  it('releases the lock at the end of a successful run', async () => {
    const { store, redis } = await setup();
    const result = await runRevalidation({ store, redis }, { useLock: true });
    expect(result.lockHeldByOther).toBe(false);
    const stillHeld = await redis.get('revalidate:lock');
    expect(stillHeld).toBeNull();
  });
});

describe('runRevalidation — batch behaviour', () => {
  it('respects batchSize and lists are picked in oldest-fetched_at order', async () => {
    const { store, redis } = await setup();
    const baseTime = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 5; i++) {
      const host = `s${i}.example.com`;
      await seed(store, host, {
        fetchedAt: new Date(baseTime - i * 1000), // s0 newest, s4 oldest
      });
      mockHost(host, { discovery: { doc: validDiscoveryDoc(`did:web:${host}`) } });
    }

    const result = await runRevalidation(
      { store, redis },
      { useLock: false, batchSize: 3 },
    );
    expect(result.scheduled).toBe(3);
    expect(result.succeeded).toBe(3);
    // Three oldest should have been refreshed (s4, s3, s2).
    const s4 = await store.getByDid('did:web:s4.example.com');
    const s3 = await store.getByDid('did:web:s3.example.com');
    const s0 = await store.getByDid('did:web:s0.example.com');
    expect(new Date(s4!.fetched_at).getTime()).toBeGreaterThan(baseTime);
    expect(new Date(s3!.fetched_at).getTime()).toBeGreaterThan(baseTime);
    // s0 has the newest seed fetched_at (= baseTime exactly) and was outside
    // the batch of 3 oldest, so its fetched_at must be unchanged.
    expect(new Date(s0!.fetched_at).getTime()).toBe(baseTime);
  });
});
