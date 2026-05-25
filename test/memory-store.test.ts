import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStore } from '../src/lib/store/memory.js';
import type { DiscoveryDoc } from '../src/lib/schemas.js';

const doc: DiscoveryDoc = {
  afauth_version: '0.1',
  service_did: 'did:web:api.example.com',
  endpoints: {
    accounts: '/v1/accounts',
    owner_invitation: '/v1/owner-invitation',
    claim_page: 'https://api.example.com/claim',
    claim_completion: '/v1/claim',
  },
  signature_algorithms: ['ed25519'],
};

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(async () => {
    store = new MemoryStore();
    await store.init();
  });

  it('creates and reads a listing', async () => {
    const rec = await store.create({
      service_did: 'did:web:api.example.com',
      discovery_url: 'https://api.example.com/.well-known/afauth',
      discovery_host: 'api.example.com',
      discovery_doc: doc,
      title: 'Example',
      tags: ['storage'],
    });

    expect(rec.status).toBe('active');
    expect(rec.consecutive_fails).toBe(0);

    const fetched = await store.getByDid('did:web:api.example.com');
    expect(fetched?.title).toBe('Example');

    const byHost = await store.getByHost('api.example.com');
    expect(byHost?.service_did).toBe('did:web:api.example.com');
  });

  it('rejects duplicate host', async () => {
    await store.create({
      service_did: 'did:web:api.example.com',
      discovery_url: 'https://api.example.com/.well-known/afauth',
      discovery_host: 'api.example.com',
      discovery_doc: doc,
    });
    await expect(
      store.create({
        service_did: 'did:web:other.example.com',
        discovery_url: 'https://api.example.com/.well-known/afauth',
        discovery_host: 'api.example.com',
        discovery_doc: doc,
      }),
    ).rejects.toThrow();
  });

  it('transitions to stale after 3 consecutive failures', async () => {
    await store.create({
      service_did: 'did:web:api.example.com',
      discovery_url: 'https://api.example.com/.well-known/afauth',
      discovery_host: 'api.example.com',
      discovery_doc: doc,
    });

    const r1 = await store.markRevalidationFailure('did:web:api.example.com', new Date());
    expect(r1?.status).toBe('active');
    expect(r1?.consecutive_fails).toBe(1);

    const r2 = await store.markRevalidationFailure('did:web:api.example.com', new Date());
    expect(r2?.status).toBe('active');
    expect(r2?.consecutive_fails).toBe(2);

    const r3 = await store.markRevalidationFailure('did:web:api.example.com', new Date());
    expect(r3?.status).toBe('stale');
    expect(r3?.consecutive_fails).toBe(3);
  });

  it('resets failure state on success', async () => {
    await store.create({
      service_did: 'did:web:api.example.com',
      discovery_url: 'https://api.example.com/.well-known/afauth',
      discovery_host: 'api.example.com',
      discovery_doc: doc,
    });
    await store.markRevalidationFailure('did:web:api.example.com', new Date());
    await store.markRevalidationFailure('did:web:api.example.com', new Date());
    const ok = await store.markRevalidationSuccess(
      'did:web:api.example.com',
      doc,
      new Date(),
    );
    expect(ok?.status).toBe('active');
    expect(ok?.consecutive_fails).toBe(0);
    expect(ok?.first_failed_at).toBeNull();
  });

  it('soft-delete sets status=deleted but preserves the record', async () => {
    await store.create({
      service_did: 'did:web:api.example.com',
      discovery_url: 'https://api.example.com/.well-known/afauth',
      discovery_host: 'api.example.com',
      discovery_doc: doc,
    });
    const deleted = await store.softDelete('did:web:api.example.com');
    expect(deleted?.status).toBe('deleted');
    const fetched = await store.getByDid('did:web:api.example.com');
    expect(fetched?.status).toBe('deleted');
  });

  it('list defaults exclude deleted; include_deleted returns them', async () => {
    await store.create({
      service_did: 'did:web:a.example.com',
      discovery_url: 'https://a.example.com/.well-known/afauth',
      discovery_host: 'a.example.com',
      discovery_doc: doc,
    });
    await store.create({
      service_did: 'did:web:b.example.com',
      discovery_url: 'https://b.example.com/.well-known/afauth',
      discovery_host: 'b.example.com',
      discovery_doc: doc,
    });
    await store.softDelete('did:web:b.example.com');

    const visible = await store.list({});
    expect(visible.listings.map((l) => l.service_did)).toEqual(['did:web:a.example.com']);

    const all = await store.list({ include_deleted: true });
    expect(all.listings.map((l) => l.service_did).sort()).toEqual([
      'did:web:a.example.com',
      'did:web:b.example.com',
    ]);
  });
});
