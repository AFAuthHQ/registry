/**
 * Pre-public hardening:
 *   - security response headers applied to every response (CSP, HSTS,
 *     nosniff, frame-options, referrer/permissions policy)
 *   - request body-size limit (memory-exhaustion DoS guard)
 */
import { describe, expect, it } from 'vitest';
import { makeTestApp } from './helpers/app.js';

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
