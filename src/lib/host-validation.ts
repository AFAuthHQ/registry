import { isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

/**
 * Hosts that resolve only inside the local environment. Rejected to
 * prevent the directory from acting as an SSRF proxy against internal
 * services (see audit finding #3).
 */
const PRIVATE_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'localhost.localdomain',
]);

const PRIVATE_HOSTNAME_SUFFIXES = ['.localhost', '.local', '.internal'];

export function isPrivateLiteralOrHostname(host: string): boolean {
  // Node's URL.hostname keeps IPv6 brackets — strip them so isIP() recognises ::1
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (PRIVATE_HOSTNAMES.has(h)) return true;
  if (PRIVATE_HOSTNAME_SUFFIXES.some((s) => h.endsWith(s))) return true;
  if (isIP(h) > 0) return isPrivateIp(h);
  return false;
}

/**
 * Decode an IPv4-mapped (`::ffff:…`) or IPv4-compatible (`::…`) IPv6
 * address to its embedded dotted-quad IPv4, accepting BOTH notations
 * Node's resolver may emit:
 *   ::ffff:169.254.169.254  (dotted tail)
 *   ::ffff:a9fe:a9fe        (hex tail, two 16-bit groups)
 * Returns null when `ip` is not a `::`-prefixed mapped/compat form.
 *
 * Without this, `::ffff:169.254.169.254` (a valid AAAA an attacker can
 * publish) was classified as PUBLIC and slipped past the SSRF guard
 * (audit #8 H-1).
 */
function embeddedIpv4(ip: string): string | null {
  const lower = ip.toLowerCase();
  const m = /^::(?:ffff:)?([0-9a-f.:]+)$/.exec(lower);
  if (!m) return null;
  const tail = m[1]!;
  if (isIP(tail) === 4) return tail; // dotted form
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
  if (hex) {
    const hi = parseInt(hex[1]!, 16);
    const lo = parseInt(hex[2]!, 16);
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }
  return null;
}

export function isPrivateIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const parts = ip.split('.').map((p) => Number(p));
    const a = parts[0] ?? -1;
    const b = parts[1] ?? -1;
    if (a === 0) return true;                  // 0.0.0.0/8
    if (a === 10) return true;                 // 10.0.0.0/8
    if (a === 127) return true;                // loopback
    if (a === 169 && b === 254) return true;   // 169.254.0.0/16 link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true;   // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true;                 // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true; // unspecified + loopback
    // IPv4-mapped / -compat: classify on the embedded IPv4 so a private
    // address can't hide behind the `::ffff:` (or bare `::`) prefix.
    const mapped = embeddedIpv4(lower);
    if (mapped && isIP(mapped) === 4) return isPrivateIp(mapped);
    // NAT64 (64:ff9b::/96 well-known + 64:ff9b:1::/48 local, RFC 8215) and
    // 6to4 (2002::/16, deprecated) embed an IPv4 destination that a
    // DNS64/NAT64 or 6to4 gateway translates to — including internal and
    // metadata addresses. The registry only ever needs ordinary public web
    // servers, so reject these transition prefixes outright (audit M-1).
    if (lower.startsWith('64:ff9b:')) return true;
    if (lower.startsWith('2002:')) return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
    if (/^fe[89ab]/.test(lower)) return true;  // fe80::/10 link-local
    if (lower.startsWith('ff')) return true;   // ff00::/8 multicast
    if (lower.startsWith('2001:db8')) return true; // 2001:db8::/32 documentation
    return false;
  }
  return false;
}

export type HostCheckResult = { ok: false; reason: string };
export type VettedHost = { ok: true; ip: string; family: 4 | 6 };

/** Resolver shape: returns every A/AAAA record for a host. */
export type HostResolver = (
  host: string,
) => Promise<ReadonlyArray<{ address: string; family: number }>>;

const realResolver: HostResolver = (host) => dnsLookup(host, { all: true });
let activeResolver: HostResolver = realResolver;

/**
 * TEST SEAM. Overrides the DNS resolver used by {@link resolveVettedHost}.
 * Production never calls this — the resolver defaults to `node:dns`. Tests
 * inject a deterministic resolver so the real vetting/reject logic runs
 * offline, instead of the previous env kill-switch (`REGISTRY_SKIP_DNS_CHECK`
 * / `NODE_ENV==='test'`) that disabled the check entirely and left the
 * production path untested (audit #8 C-2). Pass `null` to restore the
 * real resolver.
 */
export function __setHostResolverForTests(fn: HostResolver | null): void {
  activeResolver = fn ?? realResolver;
}

/**
 * Resolve `host`, reject if it is a literal IP, a private hostname, or
 * resolves to ANY private/reserved IP, and return a single vetted IP to
 * PIN the outbound connection to.
 *
 * Pinning the connection to this exact IP (see `fetch.ts`) is what
 * defeats DNS rebinding (audit #1): the address vetted here is the
 * address connected to, with no second resolution in between. Resolving
 * with `{ all: true }` and rejecting if any record is private also closes
 * the multi-record dodge where only one of several answers is private.
 */
export async function resolveVettedHost(
  host: string,
): Promise<VettedHost | HostCheckResult> {
  const stripped = host.replace(/^\[|\]$/g, '');
  if (isPrivateLiteralOrHostname(host)) {
    return { ok: false, reason: `private or loopback host: ${host}` };
  }
  // Literal IPs are rejected outright — the spec anchors identity in DNS
  // names, not IPs, and a literal can't be re-vetted across records.
  if (isIP(stripped) > 0) {
    return { ok: false, reason: `literal IP address not allowed: ${host}` };
  }
  let addrs: ReadonlyArray<{ address: string; family: number }>;
  try {
    addrs = await activeResolver(stripped);
  } catch (err) {
    return {
      ok: false,
      reason: `DNS resolution failed for ${host}: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
  if (!addrs || addrs.length === 0) {
    return { ok: false, reason: `no DNS records for ${host}` };
  }
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      return { ok: false, reason: `host ${host} resolves to private IP ${a.address}` };
    }
  }
  const first = addrs[0]!;
  return { ok: true, ip: first.address, family: isIP(first.address) === 6 ? 6 : 4 };
}
