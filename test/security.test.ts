/**
 * Pre-public hardening:
 *   - security response headers applied to every response (CSP, HSTS,
 *     nosniff, frame-options, referrer/permissions policy)
 *   - request body-size limit (memory-exhaustion DoS guard)
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers/app.js';
import { resetConfigForTest } from '../src/lib/config.js';

// The cron handler calls getConfig() (for REGISTRY_CRON_SECRET), so the
// required env must be present in this process for that route to run.
beforeAll(() => {
  process.env.DATABASE_URL = 'postgres://x:x@localhost:5432/x';
  process.env.REDIS_URL = 'redis://localhost:6379';
  process.env.REGISTRY_CRON_SECRET = 'c7f3a9e1b5d28406c9a1f4e7b2d6803a5c9e1f4b';
  process.env.REGISTRY_ADMIN_SECRET = '9b2e4f7a1c8d05369e7b3a1f6c4d8092b5e1a7f3';
  resetConfigForTest();
});

describe('security response headers', () => {
  it('sets the hardening headers on a normal response', async () => {
    const app = await makeTestApp();
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);
    const h = res.headers;
    expect(h.get('strict-transport-security')).toMatch(/max-age=\d+/);
    expect(h.get('x-content-type-options')).toBe('nosniff');
    expect(h.get('x-frame-options')).toBe('DENY');
    expect(h.get('referrer-policy')).toBeTruthy();
    expect(h.get('permissions-policy')).toBeTruthy();
    const csp = h.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // script-src must not allow inline execution (the copy helper is
    // served from /registry.js, not inlined).
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it('also applies headers to error responses (404)', async () => {
    const app = await makeTestApp();
    const res = await app.request('/no-such-path');
    expect(res.status).toBe(404);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });
});

describe('request body-size limit', () => {
  it('rejects an oversized request body with 413', async () => {
    const app = await makeTestApp();
    const huge = 'a'.repeat(300 * 1024); // ~300 KB, over the 256 KB cap
    const res = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discovery_url: `https://example.com/${huge}` }),
    });
    expect(res.status).toBe(413);
  });

  it('still accepts a normally-sized request body', async () => {
    const app = await makeTestApp();
    // Invalid URL on purpose — we only assert it is NOT rejected as 413;
    // a small body reaches the handler and fails validation (400) instead.
    const res = await app.request('/v1/listings/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ discovery_url: 'not-a-url' }),
    });
    expect(res.status).not.toBe(413);
  });
});

describe('rate limiting', () => {
  const CRON_LIMIT = 30; // keep in sync with createAdminRoutes
  const BROWSE_LIMIT = 120; // keep in sync with createBrowseRoutes

  it('rate-limits POST /admin/cron/revalidate before auth (429 after the cap)', async () => {
    const app = await makeTestApp();
    let last = 0;
    for (let i = 0; i < CRON_LIMIT + 1; i++) {
      // No bearer: the limiter runs first, so over the cap it's 429 not 401.
      const r = await app.request('/admin/cron/revalidate', { method: 'POST' });
      last = r.status;
    }
    expect(last).toBe(429);
  });

  it('rate-limits the unauthenticated browse page GET / (429 after the cap)', async () => {
    const app = await makeTestApp();
    let last = 0;
    for (let i = 0; i < BROWSE_LIMIT + 1; i++) {
      const r = await app.request('/');
      last = r.status;
    }
    expect(last).toBe(429);
  });
});
