/**
 * audit #6 — clientIp must NOT trust the leftmost (client-controlled)
 * X-Forwarded-For entry. Behind a single trusted proxy it must read the
 * rightmost entry (appended by that proxy). Trusting the leftmost let an
 * attacker mint unlimited rate-limit buckets by rotating XFF.
 *
 * audit #7 — admin/cron bearer secrets must be compared in constant time.
 */

import type { Context } from 'hono';
import { afterEach, describe, expect, it } from 'vitest';
import { clientIp } from '../src/lib/ratelimit.js';
import { constantTimeEqual } from '../src/lib/tokens.js';

function ctxWith(headers: Record<string, string>): Context {
  return {
    req: { header: (k: string) => headers[k.toLowerCase()] },
  } as unknown as Context;
}

describe('clientIp — X-Forwarded-For trust (audit #6)', () => {
  const orig = process.env.REGISTRY_TRUSTED_PROXY_HOPS;
  afterEach(() => {
    if (orig === undefined) delete process.env.REGISTRY_TRUSTED_PROXY_HOPS;
    else process.env.REGISTRY_TRUSTED_PROXY_HOPS = orig;
  });

  it('ignores a forged leftmost entry and uses the proxy-appended rightmost (default 1 hop)', () => {
    const c = ctxWith({ 'x-forwarded-for': '1.2.3.4, 9.9.9.9' }); // 1.2.3.4 is client-forged
    expect(clientIp(c)).toBe('9.9.9.9');
  });

  it('handles a forged chain — only the rightmost is trusted', () => {
    const c = ctxWith({ 'x-forwarded-for': 'evil, evil2, evil3, 203.0.113.7' });
    expect(clientIp(c)).toBe('203.0.113.7');
  });

  it('single-entry XFF returns that entry', () => {
    expect(clientIp(ctxWith({ 'x-forwarded-for': '198.51.100.2' }))).toBe('198.51.100.2');
  });

  it('honours REGISTRY_TRUSTED_PROXY_HOPS for multi-proxy deployments', () => {
    process.env.REGISTRY_TRUSTED_PROXY_HOPS = '2';
    // client, edge1(appends client), edge2(appends edge1) → real client is 2nd from right
    const c = ctxWith({ 'x-forwarded-for': 'forged, 203.0.113.7, 10.0.0.1' });
    expect(clientIp(c)).toBe('203.0.113.7');
  });

  it('falls back to x-real-ip then unknown', () => {
    expect(clientIp(ctxWith({ 'x-real-ip': '5.6.7.8' }))).toBe('5.6.7.8');
    expect(clientIp(ctxWith({}))).toBe('unknown');
  });
});

describe('constantTimeEqual (audit #7)', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeEqual('s3cret-token-value', 's3cret-token-value')).toBe(true);
  });
  it('returns false for differing strings (incl. near-misses and length diffs)', () => {
    expect(constantTimeEqual('s3cret-token-value', 's3cret-token-valuX')).toBe(false);
    expect(constantTimeEqual('s3cret', 's3cret-token-value')).toBe(false);
    expect(constantTimeEqual('', 'x')).toBe(false);
  });
});
