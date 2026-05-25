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
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::' || lower === '::1') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7 ULA
    if (lower.startsWith('fe80')) return true;                          // link-local
    if (lower.startsWith('::ffff:')) {
      // IPv4-mapped IPv6 — recurse on the embedded v4
      const v4 = lower.slice('::ffff:'.length);
      if (isIP(v4) === 4) return isPrivateIp(v4);
    }
    return false;
  }
  return false;
}

export interface HostCheckResult {
  ok: boolean;
  reason?: string;
}

/**
 * Async host check. Use this immediately before an outbound fetch.
 * Resolves the hostname and rejects if it points at a private/loopback
 * range. Literal IPs are rejected outright (the spec anchors identity
 * in DNS names, not IPs).
 */
export async function isPublicHost(host: string): Promise<HostCheckResult> {
  const stripped = host.replace(/^\[|\]$/g, '');
  if (isPrivateLiteralOrHostname(host)) {
    return { ok: false, reason: `private or loopback host: ${host}` };
  }
  if (isIP(stripped) > 0) {
    return { ok: false, reason: `literal IP address not allowed: ${host}` };
  }
  try {
    const { address } = await dnsLookup(stripped);
    if (isPrivateIp(address)) {
      return { ok: false, reason: `host ${host} resolves to private IP ${address}` };
    }
  } catch (err) {
    return {
      ok: false,
      reason: `DNS resolution failed for ${host}: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
  return { ok: true };
}
