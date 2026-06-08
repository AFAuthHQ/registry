import { Hono } from 'hono';
import type Redis from 'ioredis';
import { clientIp, rateLimit } from '../lib/ratelimit.js';
import type { Store } from '../lib/store/index.js';

interface Deps {
  store: Store;
  redis: Redis;
}

function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'https://registry.afauth.org').replace(/\/$/, '');
}

const ROBOTS_TXT = `# registry.afauth.org — AFAuth service directory
#
# This directory exists for AI agents and tooling to discover services
# that have announced AFAuth support. Crawlers — including LLM training
# and search bots — are explicitly welcome.

# Content Signals (https://contentsignals.org): this directory exists for
# agents — every AI use is permitted. Search indexing, AI input
# (RAG/grounding), and model training are all explicitly allowed.
User-agent: *
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /
Disallow: /admin/

User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: Claude-Web
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Perplexity-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: Bytespider
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: Applebot-Extended
Allow: /

Sitemap: ${baseUrl()}/sitemap.xml
`;

const LLMS_TXT = `# registry.afauth.org — AFAuth service directory

> The canonical opt-in directory of services that have announced
> support for AFAuth (Agent-First Auth). Each listing represents a
> service whose discovery host has cryptographically proven control of
> a \`service_did\`. Membership is voluntary and informational; the
> directory is non-normative and conforming AFAuth agents and services
> are not required to interact with it.

## Sibling sites (AFAuth constellation)

AFAuth is documented across three coordinated properties. This site is
the **data plane**. For the protocol itself and the developer
documentation, follow the links below.

- **Protocol home**: https://afauth.org/llms.txt — what AFAuth is, the manifesto, install paths for the CLI and SDK.
- **Documentation**: https://docs.afauth.org/llms.txt — quickstarts, SDK reference, concepts, the §-by-§ spec walkthrough.
- **Service directory** (this site): https://registry.afauth.org/llms.txt — opt-in registry of AFAuth-enabled services, mirrorable and non-normative.

## About this site

This site implements the informational service-directory convention
from [spec/directory.md](https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md)
and [AFAP-0003](https://github.com/AFAuthHQ/spec/blob/main/proposals/0003-service-directory.md).

## How agents use this directory

The intended consumer is an AI agent (or a tool an agent uses) that
wants to discover AFAuth-enabled services in the wild without
hard-coded URLs. Typical flow:

1. \`GET /v1/listings\` — paginated, JSON, supports \`?search=\`,
   \`?tag=\`, \`?status=\`, \`?updated_since=\`, opaque \`?cursor=\`.
2. \`GET /v1/listings/{service_did}\` — one listing, fully serialized,
   including the discovery document fetched from the service's
   \`/.well-known/afauth\`.
3. The agent then talks AFAuth directly to the service's
   \`endpoints.accounts\` (etc.) — the directory is *not* part of the
   protocol's hot path.

Reads are CORS-open and cache-friendly. The directory revalidates
discovery documents on a daily cron; listings that fail three
consecutive fetches transition to \`stale\` and after a grace period
to \`deleted\`.

## Endpoints

- [Browse (HTML)](${baseUrl()}/) — human-friendly index of current listings.
- [List API](${baseUrl()}/v1/listings) — paginated JSON, primary read endpoint.
- [Operator commitment](${baseUrl()}/operator) — who runs this directory and what they may / may not do.
- [Take-down policy](${baseUrl()}/policy) — moderation policy for the canonical directory.
- [Spec](https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md) — normative directory convention.
- [AFAP-0003](https://github.com/AFAuthHQ/spec/blob/main/proposals/0003-service-directory.md) — design rationale.

## What a listing looks like

\`\`\`json
{
  "service_did": "did:web:api.example.com",
  "discovery_url": "https://api.example.com/.well-known/afauth",
  "discovery_doc": {
    "afauth_version": "0.1",
    "endpoints": { "accounts": "/v1/accounts", "owner_invitation": "/v1/owner-invitations", "claim_page": "/claim", "claim_completion": "/v1/claim/complete" },
    "features": ["key_rotation"],
    "recipient_types": ["email"],
    "signature_algorithms": ["ed25519"]
  },
  "status": "active",
  "tags": ["search", "media"],
  "first_listed_at": "2026-01-15T10:00:00Z",
  "fetched_at": "2026-05-25T06:00:00Z",
  "updated_at": "2026-05-25T06:00:00Z"
}
\`\`\`

## Federation

This is the *canonical* directory but not the *only* directory. Anyone
may host a directory implementing the same surface — see
[§8 federation](https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md#8-federation).
A consumer may aggregate across multiple directories or run a private
one.

## Contact

- Operational contact: [email protected]
- GitHub: https://github.com/AFAuthHQ/registry
- License: Apache-2.0 (code), CC-BY-4.0 (spec)
`;

export function createSeoRoutes(deps: Deps): Hono {
  const { store, redis } = deps;
  const r = new Hono();

  r.get('/robots.txt', (c) => {
    c.header('content-type', 'text/plain; charset=utf-8');
    // Short cache: robots.txt carries discovery directives (Content-Signal,
    // sitemap pointer) that gate agent-readiness. A long CDN/proxy cache
    // makes edits propagate slowly — keep it brief so changes go live fast.
    c.header('cache-control', 'public, max-age=300');
    return c.body(ROBOTS_TXT);
  });

  r.get('/llms.txt', (c) => {
    c.header('content-type', 'text/markdown; charset=utf-8');
    c.header('cache-control', 'public, max-age=3600');
    return c.body(LLMS_TXT);
  });

  // Sitemap fans out to the listings table — rate-limit so a bot that
  // ignores cache-control can't drum the DB.
  r.get(
    '/sitemap.xml',
    rateLimit({
      redis,
      limit: 60,
      windowSeconds: 60,
      key: (c) => `sitemap:${clientIp(c)}`,
    }),
    async (c) => {
    const base = baseUrl();
    const urls: { loc: string; lastmod?: string }[] = [
      { loc: `${base}/` },
      { loc: `${base}/operator` },
      { loc: `${base}/policy` },
    ];

    let cursor: string | undefined = undefined;
    let pages = 0;
    do {
      const { listings, next_cursor } = await store.list({
        limit: 100,
        cursor,
        status: 'active',
      });
      for (const rec of listings) {
        urls.push({
          loc: `${base}/listings/${encodeURIComponent(rec.service_did)}`,
          lastmod: rec.updated_at.split('T')[0],
        });
      }
      cursor = next_cursor ?? undefined;
      pages += 1;
    } while (cursor && pages < 100);

    const body =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls
        .map(({ loc, lastmod }) =>
          `  <url>\n    <loc>${escapeXml(loc)}</loc>${lastmod ? `\n    <lastmod>${lastmod}</lastmod>` : ''}\n  </url>`,
        )
        .join('\n') +
      `\n</urlset>\n`;

      c.header('content-type', 'application/xml; charset=utf-8');
      c.header('cache-control', 'public, max-age=600, s-maxage=3600');
      return c.body(body);
    },
  );

  r.get('/favicon.ico', (c) => c.redirect('https://afauth.org/favicon.svg', 301));
  r.get('/favicon.svg', (c) => c.redirect('https://afauth.org/favicon.svg', 301));

  r.get('/.well-known/security.txt', (c) => {
    // RFC 9116 §2.5.5: Expires is REQUIRED. Roll it one year out;
    // bump on each touch of this file.
    const expires = '2027-05-25T00:00:00.000Z';
    c.header('content-type', 'text/plain; charset=utf-8');
    return c.body(
      `Contact: mailto:[email protected]\n` +
        `Expires: ${expires}\n` +
        `Preferred-Languages: en\n` +
        `Canonical: ${baseUrl()}/.well-known/security.txt\n` +
        `Policy: https://github.com/AFAuthHQ/.github/blob/main/SECURITY.md\n`,
    );
  });

  return r;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
