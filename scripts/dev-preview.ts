/**
 * Local preview harness — boots the app with MemoryStore + RedisMock
 * and seeds a couple of listings so the browse / operator / policy
 * pages can be inspected in a browser without a Postgres + Redis
 * dependency. Not for production.
 */
import { serve } from '@hono/node-server';
import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';

process.env.DATABASE_URL ??= 'postgres://dev:dev@localhost:5432/dev';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.REGISTRY_CRON_SECRET ??= 'dev-cron-secret-1234567890';
process.env.REGISTRY_ADMIN_SECRET ??= 'dev-admin-secret-1234567890';
process.env.NODE_ENV ??= 'development';

const { createApp } = await import('../src/server.js');
const { MemoryStore } = await import('../src/lib/store/memory.js');
const { DiscoveryDocSchema } = await import('../src/lib/schemas.js');

function seedDoc(did: string) {
  return DiscoveryDocSchema.parse({
    afauth_version: '0.1',
    service_did: did,
    endpoints: {
      accounts: '/v1/accounts',
      owner_invitation: '/v1/owner-invitation',
      claim_page: `https://${did.split(':').pop()}/claim`,
      claim_completion: '/v1/claim',
    },
    signature_algorithms: ['ed25519'],
  });
}

const store = new MemoryStore();
await store.init();
const redis = new RedisMock() as unknown as Redis;

await store.create({
  service_did: 'did:web:photos.example.com',
  discovery_url: 'https://photos.example.com/.well-known/afauth',
  discovery_host: 'photos.example.com',
  discovery_doc: seedDoc('did:web:photos.example.com'),
  title: 'Example Photo Storage',
  description: 'AFAuth-supported photo storage for agents.',
  tags: ['productivity', 'storage', 'photos'],
});

await store.create({
  service_did: 'did:web:mail.example.com',
  discovery_url: 'https://mail.example.com/.well-known/afauth',
  discovery_host: 'mail.example.com',
  discovery_doc: seedDoc('did:web:mail.example.com'),
  title: 'Example Mail',
  description: 'AFAuth-supported mail service.',
  tags: ['email', 'communication'],
});

await store.create({
  service_did: 'did:key:z6MkfV6ExampleAgent4InternalUse',
  discovery_url: 'https://internal.mesh.example.com/.well-known/afauth',
  discovery_host: 'internal.mesh.example.com',
  discovery_doc: seedDoc('did:key:z6MkfV6ExampleAgent4InternalUse'),
  title: 'Internal Service Mesh Node',
  description: 'A did:key-anchored service used in a service mesh.',
  tags: ['mesh', 'internal'],
});

const app = createApp({ store, redis });
serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`preview running on http://localhost:${info.port}`);
  console.log(`  http://localhost:${info.port}/`);
  console.log(`  http://localhost:${info.port}/operator`);
  console.log(`  http://localhost:${info.port}/policy`);
});
