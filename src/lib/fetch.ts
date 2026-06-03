import { Agent } from 'undici';
import { resolveVettedHost } from './host-validation.js';

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 64 * 1024;

export interface FetchTextResult {
  ok: true;
  status: number;
  body: string;
  contentType: string | null;
}

export interface FetchFail {
  ok: false;
  reason:
    | 'timeout'
    | 'network'
    | 'non_2xx'
    | 'redirect_not_allowed'
    | 'too_large'
    | 'non_https'
    | 'non_public_host'
    | 'invalid_content_type';
  status?: number;
  message: string;
}

export type FetchResult = FetchTextResult | FetchFail;

export async function fetchText(
  url: string,
  opts: { timeoutMs?: number; expectContentType?: string } = {},
): Promise<FetchResult> {
  if (!url.startsWith('https://')) {
    return { ok: false, reason: 'non_https', message: 'URL must be https://' };
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: 'network', message: 'malformed URL' };
  }

  // Resolve + vet the host ONCE, and capture the exact IP we will connect
  // to. The connection is then pinned to this IP (below), so undici cannot
  // re-resolve the hostname to a rebound private address between the check
  // and the connect (audit #1 — DNS rebinding).
  const vetted = await resolveVettedHost(parsed.hostname);
  if (!vetted.ok) {
    return { ok: false, reason: 'non_public_host', message: vetted.reason };
  }

  // Pin the connection: undici's connector calls this `lookup` instead of
  // DNS, so it connects to exactly the vetted IP. TLS SNI / certificate
  // validation still use the original hostname (undici derives servername
  // from the URL), so legitimate certificates keep validating.
  const agent = new Agent({
    connect: {
      lookup: ((_hostname: string, _options: unknown, cb: (err: Error | null, addresses: Array<{ address: string; family: number }>) => void) => {
        cb(null, [{ address: vetted.ip, family: vetted.family }]);
      }) as never,
    },
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  // `dispatcher` is an undici extension to RequestInit not present in the
  // DOM lib types; attach it without tripping excess-property checks.
  const init: RequestInit = {
    method: 'GET',
    // Reject redirects entirely. Following them would re-introduce the
    // SSRF the IP-pin closes (a 302 to an internal address) and breaks the
    // spec's host-anchored proof. Combined with the pin, there is no path
    // to a second, unvetted resolution.
    redirect: 'manual',
    signal: controller.signal,
    headers: { 'user-agent': 'registry.afauth.org/0.1 (+https://afauth.org)' },
  };
  (init as { dispatcher?: unknown }).dispatcher = agent;

  try {
    const res = await fetch(url, init);

    // Hono / undici 'manual' redirect returns an opaqueredirect-ish response
    // with status 0 in some runtimes, or the raw 3xx in Node fetch. Treat
    // either as failure.
    if (res.status >= 300 && res.status < 400) {
      return {
        ok: false,
        reason: 'redirect_not_allowed',
        status: res.status,
        message: `Upstream issued ${res.status} redirect; redirects are not followed`,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        reason: 'non_2xx',
        status: res.status,
        message: `Upstream returned ${res.status}`,
      };
    }

    const contentType = res.headers.get('content-type');
    if (opts.expectContentType) {
      if (!contentType || !contentType.startsWith(opts.expectContentType)) {
        return {
          ok: false,
          reason: 'invalid_content_type',
          message: `Expected ${opts.expectContentType}, got ${contentType ?? '(none)'}`,
        };
      }
    }

    const reader = res.body?.getReader();
    if (!reader) {
      return { ok: true, status: res.status, body: '', contentType };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        reader.cancel();
        return {
          ok: false,
          reason: 'too_large',
          message: `Response exceeded ${MAX_BODY_BYTES} bytes`,
        };
      }
      chunks.push(value);
    }

    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
    return { ok: true, status: res.status, body: buf.toString('utf8'), contentType };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, reason: 'timeout', message: 'Request timed out' };
    }
    return {
      ok: false,
      reason: 'network',
      message: err instanceof Error ? err.message : 'Unknown network error',
    };
  } finally {
    clearTimeout(timeout);
    // Release the pinned connection pool; ignore close errors.
    void agent.close().catch(() => {});
  }
}

export function hostFromUrl(url: string): string {
  return new URL(url).host;
}
