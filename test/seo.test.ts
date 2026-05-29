import { describe, expect, it } from 'vitest';
import { validDiscoveryDoc } from './helpers/fetch-mock.js';
import { makeTestApp, type TestApp } from './helpers/app.js';

async function seed(app: TestApp, host: string, did: string, status: 'active' | 'stale' | 'deleted' = 'active') {
  const rec = await app.store.create({
    service_did: did,
    discovery_url: `https://${host}/.well-known/afauth`,
    discovery_host: host,
    discovery_doc: validDiscoveryDoc(did),
    tags: [],
  });
  if (status !== 'active') {
    // MemoryStore doesn't expose a status setter; mutate directly via the
    // record reference — adequate for testing read paths.
    (rec as { status: string }).status = status;
  }
}

describe('GET /robots.txt', () => {
  it('serves a text/plain robots policy that points to the sitemap', async () => {
    const app = await makeTestApp();
    const res = await app.request('/robots.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const body: string = res.body;
    expect(body).toContain('User-agent: *');
    expect(body).toContain('Allow: /');
    expect(body).toContain('Disallow: /admin/');
    // AI crawlers explicitly allowed
    expect(body).toContain('GPTBot');
    expect(body).toContain('ClaudeBot');
    expect(body).toContain('PerplexityBot');
    expect(body).toContain('Google-Extended');
    // Sitemap pointer
    expect(body).toMatch(/Sitemap:\s+https?:\/\/[^\s]+\/sitemap\.xml/);
  });
});

describe('GET /llms.txt', () => {
  it('serves a markdown llms.txt with the sibling-sites cross-link block', async () => {
    const app = await makeTestApp();
    const res = await app.request('/llms.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/markdown/);
    const body: string = res.body;
    // Header + tagline
    expect(body).toContain('# registry.afauth.org');
    // Cross-link to the sibling sites
    expect(body).toContain('https://afauth.org/llms.txt');
    expect(body).toContain('https://docs.afauth.org/llms.txt');
    expect(body).toContain('https://registry.afauth.org/llms.txt');
    // Endpoints section references the canonical paths
    expect(body).toContain('/v1/listings');
  });
});

describe('GET /sitemap.xml', () => {
  it('lists static pages plus every active listing', async () => {
    const app = await makeTestApp();
    await seed(app, 'a.example.com', 'did:web:a.example.com');
    await seed(app, 'b.example.com', 'did:web:b.example.com');

    const res = await app.request('/sitemap.xml');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/xml/);
    const body: string = res.body;

    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain('<urlset');
    // Static pages
    expect(body).toMatch(/<loc>https?:\/\/[^<]+\/<\/loc>/);
    expect(body).toMatch(/<loc>https?:\/\/[^<]+\/operator<\/loc>/);
    expect(body).toMatch(/<loc>https?:\/\/[^<]+\/policy<\/loc>/);
    // Listings — service_did is URL-encoded so `:` becomes `%3A`
    expect(body).toContain('did%3Aweb%3Aa.example.com');
    expect(body).toContain('did%3Aweb%3Ab.example.com');
    // lastmod is YYYY-MM-DD
    expect(body).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  });

  it('omits soft-deleted listings', async () => {
    const app = await makeTestApp();
    await seed(app, 'active.example.com', 'did:web:active.example.com', 'active');
    await seed(app, 'gone.example.com', 'did:web:gone.example.com', 'deleted');

    const res = await app.request('/sitemap.xml');
    const body: string = res.body;
    expect(body).toContain('did%3Aweb%3Aactive.example.com');
    expect(body).not.toContain('did%3Aweb%3Agone.example.com');
  });

  it('sets a cache-control header so well-behaved bots back off', async () => {
    const app = await makeTestApp();
    const res = await app.request('/sitemap.xml');
    expect(res.headers.get('cache-control')).toMatch(/max-age=\d+/);
  });
});

describe('GET /favicon.ico and /favicon.svg', () => {
  it('redirects to the canonical AFAuth favicon', async () => {
    const app = await makeTestApp();
    const ico = await app.request('/favicon.ico');
    expect(ico.status).toBe(301);
    expect(ico.headers.get('location')).toBe('https://afauth.org/favicon.svg');

    const svg = await app.request('/favicon.svg');
    expect(svg.status).toBe(301);
    expect(svg.headers.get('location')).toBe('https://afauth.org/favicon.svg');
  });
});

describe('GET /.well-known/security.txt', () => {
  it('serves an RFC 9116-shaped security policy with a non-expired Expires', async () => {
    const app = await makeTestApp();
    const res = await app.request('/.well-known/security.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/plain/);
    const body: string = res.body;
    expect(body).toMatch(/^Contact: mailto:/m);
    expect(body).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T/m);
    expect(body).toMatch(/^Canonical: https?:\/\/[^\s]+\/\.well-known\/security\.txt/m);
    expect(body).toMatch(/^Policy: https?:\/\//m);
    // The Expires value must be in the future.
    const expiresLine = body.match(/^Expires: (.+)$/m);
    expect(expiresLine).not.toBeNull();
    const expiresValue = expiresLine?.[1]?.trim();
    expect(expiresValue).toBeTruthy();
    const expiresAt = new Date(expiresValue ?? '');
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe('Organization JSON-LD on layout-rendered pages', () => {
  it('every HTML page declares the AFAuth Organization with sameAs siblings', async () => {
    const app = await makeTestApp();
    const res = await app.request('/operator');
    const body: string = res.body;
    expect(body).toMatch(/<script type="application\/ld\+json">/);
    expect(body).toContain('"@type":"Organization"');
    expect(body).toContain('"name":"AFAuth"');
    // sameAs must reference the sibling sites
    expect(body).toContain('https://afauth.org');
    expect(body).toContain('https://docs.afauth.org');
    expect(body).toContain('https://github.com/AFAuthHQ');
  });

  it('listing detail pages keep both Organization and SoftwareApplication JSON-LD', async () => {
    const app = await makeTestApp();
    await seed(app, 'photos.example.com', 'did:web:photos.example.com');
    const res = await app.request('/listings/did:web:photos.example.com');
    const body: string = res.body;
    // Two distinct ld+json blocks
    const matches = body.match(/<script type="application\/ld\+json">/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
    expect(body).toContain('"@type":"Organization"');
    expect(body).toContain('"@type":"SoftwareApplication"');
  });

  it('every layout-rendered page links back to afauth.org and AFAuth GitHub', async () => {
    const app = await makeTestApp();
    const res = await app.request('/operator');
    const body: string = res.body;
    // Layout nav surfaces the canonical AFAuth umbrella and GitHub.
    // docs.afauth.org is cross-linked from /llms.txt (covered above),
    // not the nav — the nav matches afauth.org's own bar.
    expect(body).toMatch(/href="https:\/\/afauth\.org"/);
    expect(body).toMatch(/href="https:\/\/github\.com\/AFAuthHQ"/);
  });
});
