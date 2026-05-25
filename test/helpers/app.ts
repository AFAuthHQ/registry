import RedisMock from 'ioredis-mock';
import type Redis from 'ioredis';
import { createApp } from '../../src/server.js';
import { MemoryStore } from '../../src/lib/store/memory.js';

export interface TestApp {
  app: ReturnType<typeof createApp>;
  store: MemoryStore;
  redis: Redis;
  request: (
    path: string,
    init?: RequestInit,
  ) => Promise<{ status: number; body: any; headers: Headers }>;
}

export async function makeTestApp(): Promise<TestApp> {
  const store = new MemoryStore();
  await store.init();
  // ioredis-mock implements the same interface as ioredis; cast for type compatibility.
  // ioredis-mock instances share state by default, so flushall() to isolate tests.
  const redis = new RedisMock() as unknown as Redis;
  await redis.flushall();
  const app = createApp({ store, redis });

  async function request(
    path: string,
    init: RequestInit = {},
  ): Promise<{ status: number; body: any; headers: Headers }> {
    const res = await app.request(path, init);
    const text = await res.text();
    let body: any = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { status: res.status, body, headers: res.headers };
  }

  return { app, store, redis, request };
}
