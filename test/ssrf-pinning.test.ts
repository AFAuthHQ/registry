/**
 * SSRF defenses (audit #1 + #8).
 *
 * #1 DNS rebinding: the host check must resolve once, reject any private
 *    resolved IP, and PIN the outbound connection to the vetted IP so the
 *    fetch cannot re-resolve to a rebound (private) address. We assert the
 *    vetting/reject logic directly via an injected resolver (DI) — the
 *    production path is the same logic, exercised here without real DNS.
 * #8 H-1: isPrivateIp must classify IPv4-mapped/-compat IPv6 as private.
 * #8 C-2: there is no env kill-switch; the reject path is the only path.
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  __setHostResolverForTests,
  isPrivateIp,
  resolveVettedHost,
} from '../src/lib/host-validation.js';
import { fetchText } from '../src/lib/fetch.js';

afterEach(() => __setHostResolverForTests(null));

describe('isPrivateIp — IPv4-mapped / -compat IPv6 (audit #8 H-1)', () => {
  it.each([
    '::ffff:169.254.169.254', // metadata, mapped dotted
    '::ffff:127.0.0.1', // loopback, mapped dotted
    '::ffff:10.0.0.1', // RFC1918, mapped dotted
    '::ffff:a9fe:a9fe', // metadata, mapped hex
    '::ffff:7f00:1', // loopback, mapped hex
  ])('classifies %s as private', (ip) => {
    expect(isPrivateIp(ip)).toBe(true);
  });

  it('still classifies genuine public addresses as public', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false); // cloudflare v6
  });

  it('classifies loopback/ULA/link-local/multicast v6 as private', () => {
    for (const ip of ['::1', 'fd00::1', 'fe80::1', 'ff02::1']) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
});

describe('resolveVettedHost — rebinding & private-resolution (audit #1)', () => {
  it('rejects a public hostname that resolves to a private IP', async () => {
    __setHostResolverForTests(async () => [{ address: '169.254.169.254', family: 4 }]);
    const r = await resolveVettedHost('rebind.attacker.example');
    expect(r.ok).toBe(false);
  });

  it('rejects when ANY of several resolved records is private (multi-record dodge)', async () => {
    __setHostResolverForTests(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '10.0.0.5', family: 4 },
    ]);
    const r = await resolveVettedHost('multi.attacker.example');
    expect(r.ok).toBe(false);
  });

  it('rejects a public host that resolves to a mapped-IPv6 private address', async () => {
    __setHostResolverForTests(async () => [{ address: '::ffff:169.254.169.254', family: 6 }]);
    const r = await resolveVettedHost('mapped.attacker.example');
    expect(r.ok).toBe(false);
  });

  it('rejects literal IPs and private hostnames synchronously (before resolution)', async () => {
    __setHostResolverForTests(async () => {
      throw new Error('resolver must not be called for synchronous rejections');
    });
    expect((await resolveVettedHost('93.184.216.34')).ok).toBe(false); // literal IP
    expect((await resolveVettedHost('localhost')).ok).toBe(false);
    expect((await resolveVettedHost('foo.internal')).ok).toBe(false);
  });

  it('returns a vetted IP to pin for a public host', async () => {
    __setHostResolverForTests(async () => [{ address: '93.184.216.34', family: 4 }]);
    const r = await resolveVettedHost('good.example');
    expect(r).toMatchObject({ ok: true, ip: '93.184.216.34', family: 4 });
  });
});

describe('fetchText — refuses to connect when the host vets private (audit #1)', () => {
  it('returns non_public_host without attempting a fetch', async () => {
    __setHostResolverForTests(async () => [{ address: '169.254.169.254', family: 4 }]);
    const r = await fetchText('https://rebind.attacker.example/.well-known/afauth');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('non_public_host');
  });

  it('rejects non-https before any resolution', async () => {
    const r = await fetchText('http://good.example/.well-known/afauth');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('non_https');
  });
});
