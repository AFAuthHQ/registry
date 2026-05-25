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
    | 'too_large'
    | 'non_https'
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': 'registry.afauth.org/0.1 (+https://afauth.org)' },
    });

    if (!res.ok) {
      return {
        ok: false,
        reason: 'non_2xx',
        status: res.status,
        message: `Upstream returned ${res.status}`,
      };
    }

    const contentType = res.headers.get('content-type');
    if (opts.expectContentType && contentType && !contentType.startsWith(opts.expectContentType)) {
      return {
        ok: false,
        reason: 'invalid_content_type',
        message: `Expected ${opts.expectContentType}, got ${contentType}`,
      };
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
