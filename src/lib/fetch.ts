import { isPublicHost } from './host-validation.js';

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

  const parsed = new URL(url);
  const hostCheck = await isPublicHost(parsed.hostname);
  if (!hostCheck.ok) {
    return {
      ok: false,
      reason: 'non_public_host',
      message: hostCheck.reason ?? 'host is not publicly reachable',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      // Reject redirects entirely. Allowing them would let an attacker
      // submit a discovery_url that 302s to an internal address — SSRF.
      // The spec anchors proof on the host in the URL, not the redirect
      // target, so a redirect breaks the anchor in any case.
      redirect: 'manual',
      signal: controller.signal,
      headers: { 'user-agent': 'registry.afauth.org/0.1 (+https://afauth.org)' },
    });

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
  }
}

export function hostFromUrl(url: string): string {
  return new URL(url).host;
}
