import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { hostFromUrl } from '../lib/fetch.js';
import { ServiceDidSchema } from '../lib/schemas.js';
import { toPublicListing } from '../lib/serialize.js';
import type { ListingRecord, Store } from '../lib/store/index.js';
import { layout } from '../views/layout.js';

interface Deps {
  store: Store;
}

export function createBrowseRoutes(deps: Deps): Hono {
  const { store } = deps;
  const r = new Hono();

  r.get('/', async (c) => {
    const { listings } = await store.list({ limit: 100 });
    const collectionLd = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'AFAuth Service Directory',
      description:
        'The canonical opt-in directory of services that have announced AFAuth (Agent-First Auth) support.',
      url: `${siteBase()}/`,
      isPartOf: {
        '@type': 'WebSite',
        name: 'registry.afauth.org',
        url: siteBase(),
      },
      numberOfItems: listings.length,
    };
    const count = listings.length;
    const page = layout({
      title: 'AFAuth Service Directory',
      description:
        'Browse services that have announced AFAuth support — opt-in, cryptographically host-proven, machine-readable at /v1/listings.',
      path: '/',
      jsonLd: collectionLd,
      body: html`
        <h1 style="font-size: 32px; line-height: 1.12; margin: 0 0 14px;">
          AFAuth-ready services, in one place.
        </h1>
        <p class="lede" style="font-size: 17px; max-width: 62ch; margin: 0;">
          Services that have announced AFAuth support. Browse to find one your
          agent can sign up to — or follow the listing protocol to announce yours.
        </p>

        <div class="action-cards">
          <div class="action-card">
            <div class="action-eyebrow">For agents</div>
            <p style="margin: 0 0 10px;">Pull the directory programmatically:</p>
            <div class="action-snippet copyable">
              <code>curl https://registry.afauth.org/v1/listings</code>
              <button type="button" class="copy-btn" data-copy="curl https://registry.afauth.org/v1/listings" aria-label="Copy command">
                <span data-copy-label>Copy</span>
              </button>
            </div>
            <p style="margin: 10px 0 0; font-size: 14px; color: var(--muted);">Or scroll to browse below.</p>
          </div>
          <div class="action-card">
            <div class="action-eyebrow">For services</div>
            <p style="margin: 0;">Serve <code>/.well-known/afauth</code> and prove host control. Three steps, no account.</p>
          </div>
        </div>

        <section style="margin-top: 36px;">
          <h2 id="consume" style="margin: 0 0 12px;">Consume the directory</h2>
          <p>Any client can read the directory anonymously. CORS-open, cursor-paginated.</p>
          <pre class="action-snippet"><code>GET https://registry.afauth.org/v1/listings</code></pre>
          <p style="font-size: 14px; color: var(--muted); margin-top: 10px;">
            Paginate with <code>?cursor=…</code>. Filter by tag with <code>?tag=…</code>.
            The per-service endpoint is <code>/v1/listings/:service_did</code>.
          </p>
        </section>

        <section style="margin-top: 36px; padding-top: 28px; border-top: 1px solid var(--line);">
          <h2 id="announce" style="margin: 0 0 12px;">Announce a service</h2>
          <p>Three moves. No account.</p>
          <ol class="announce-steps">
            <li>Serve <code>/.well-known/afauth</code> on your service host with the discovery JSON.</li>
            <li><code>POST /v1/listings/challenge</code> — we issue a one-time token you serve on your host.</li>
            <li><code>POST /v1/listings</code> — we fetch your discovery doc, verify host control, and list you.</li>
          </ol>
          <p style="font-size: 14px; color: var(--muted);">
            Normative protocol: <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md#4-listing-protocol" target="_blank" rel="noopener">spec/directory.md §4</a>.
          </p>
        </section>

        <h2 id="directory" style="margin: 48px 0 14px; padding-top: 28px; border-top: 1px solid var(--line); display: flex; align-items: baseline; gap: 10px;">
          Directory
          <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; font-weight: 400; color: var(--muted); letter-spacing: 0;">${count} service${count === 1 ? '' : 's'}</span>
        </h2>
        ${renderListings(listings)}
      `,
    });
    return c.html(page);
  });

  r.get('/listings/:did{.+}', async (c) => {
    const did = decodeURIComponent(c.req.param('did'));
    if (!ServiceDidSchema.safeParse(did).success) {
      return c.html(
        layout({
          title: 'Invalid request · registry.afauth.org',
          body: renderInvalidDid(did),
        }),
        400,
      );
    }
    const rec = await store.getByDid(did);
    if (!rec) {
      return c.html(
        layout({
          title: 'Listing not found · registry.afauth.org',
          body: renderNotFound(did),
        }),
        404,
      );
    }
    const title = rec.title ?? hostFromUrl(rec.discovery_url);
    const descriptionText =
      rec.description ??
      `AFAuth-enabled service ${title} (${rec.service_did}) — discovery at ${rec.discovery_url}.`;
    const pathForDid = `/listings/${encodeURIComponent(rec.service_did)}`;
    return c.html(
      layout({
        title: `${title} · registry.afauth.org`,
        description: descriptionText,
        path: pathForDid,
        jsonLd: buildListingJsonLd(rec, title),
        body: renderDetail(rec),
      }),
    );
  });

  return r;
}

function renderListings(listings: ListingRecord[]) {
  if (listings.length === 0) {
    return html`<p class="empty">No services listed yet. Be the first — see
      <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md#41-initial-registration">§4.1 initial registration</a>.</p>`;
  }
  return html`<div class="listings-list">${raw(listings.map(renderRow).join(''))}</div>`;
}

function renderRow(rec: ListingRecord): string {
  const host = hostFromUrl(rec.discovery_url);
  const isKey = rec.service_did.startsWith('did:key:');
  const titleText = rec.title ?? host;
  const detailHref = `/listings/${encodeURI(rec.service_did)}`;
  const jsonHref = `/v1/listings/${encodeURI(rec.service_did)}`;

  const features = (rec.discovery_doc.features ?? []) as string[];
  const recipients = (rec.discovery_doc.recipient_types ?? []) as string[];
  const pills = [
    ...features.map((f) => `<span class="cap-pill feat">${escapeHtml(f)}</span>`),
    ...recipients.map((rt) => `<span class="cap-pill">${escapeHtml(rt)}</span>`),
    ...rec.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`),
  ].join('');

  const versionBadge = rec.discovery_doc.afauth_version
    ? `<span class="version-badge">v${escapeHtml(rec.discovery_doc.afauth_version)}</span>`
    : '';
  const didkeyWarn = isKey
    ? `<span class="didkey-warn" title="did:key carries no DNS+TLS anchor — see spec §3">⚠ no domain anchor</span>`
    : '';
  const viaHost = isKey
    ? `<span class="listing-meta-sep">·</span><span>via ${escapeHtml(host)}</span>`
    : '';

  const statusClass = rec.status === 'active' ? 'active' : rec.status === 'stale' ? 'stale' : '';

  return `<article class="listing-row">
    <div class="listing-row-head">
      <a href="${detailHref}" class="listing-title">${escapeHtml(titleText)}</a>
      <span class="listing-status ${statusClass}">${escapeHtml(rec.status)}</span>
    </div>
    ${rec.description ? `<p class="listing-desc">${escapeHtml(rec.description)}</p>` : ''}
    <div class="listing-meta">
      <span class="mono">${escapeHtml(rec.service_did)}</span>${versionBadge}${didkeyWarn}${viaHost}
      <span class="listing-meta-sep">·</span>
      <span title="${escapeHtml(rec.updated_at)}">${escapeHtml(relativeTime(rec.updated_at))}</span>
      <span class="listing-meta-sep">·</span>
      <a href="${jsonHref}" class="json-link">json &rarr;</a>
    </div>
    ${pills ? `<div class="listing-pills">${pills}</div>` : ''}
  </article>`;
}

function renderDetail(rec: ListingRecord) {
  const host = hostFromUrl(rec.discovery_url);
  const isKey = rec.service_did.startsWith('did:key:');
  const titleText = rec.title ?? host;
  const jsonHref = `/v1/listings/${encodeURI(rec.service_did)}`;
  const publicListing = toPublicListing(rec);
  const doc = rec.discovery_doc;

  const headerBlock = html`
    <p class="breadcrumb"><a href="/">Directory</a> / <span>${rec.service_did}</span></p>
    <h1>${titleText}</h1>
    ${rec.description ? html`<p class="lede">${rec.description}</p>` : ''}
  `;

  const identityRows = [
    kvRow('service_did', html`<span class="mono">${rec.service_did}</span>${isKey ? html` <span class="didkey-warn" title="did:key carries no DNS+TLS anchor — see spec §3">⚠ no domain anchor</span>` : ''}`, true),
    kvRow('discovery_url', html`<a href="${rec.discovery_url}" target="_blank" rel="noopener">${rec.discovery_url}</a>`, true),
    kvRow('discovery_host', html`<span class="mono">${host}</span>`, true),
    kvRow('afauth_version', html`<span class="mono">v${doc.afauth_version}</span>`, true),
    kvRow('status', html`<span class="mono">${rec.status}</span>`, true),
  ];

  const features = (doc.features ?? []) as string[];
  const recipients = (doc.recipient_types ?? []) as string[];
  const sigAlgs = (doc.signature_algorithms ?? []) as string[];
  const capabilitiesRows = [
    kvRow(
      'features',
      features.length
        ? html`${raw(features.map((f) => `<span class="cap-pill feat">${escapeHtml(f)}</span>`).join(''))}`
        : noneTag(),
      false,
    ),
    kvRow(
      'recipient_types',
      recipients.length
        ? html`${raw(recipients.map((r) => `<span class="cap-pill">${escapeHtml(r)}</span>`).join(''))}`
        : noneTag(),
      false,
    ),
    kvRow(
      'signature_algorithms',
      sigAlgs.length
        ? html`${raw(sigAlgs.map((s) => `<span class="cap-pill">${escapeHtml(s)}</span>`).join(''))}`
        : noneTag(),
      false,
    ),
  ];

  const endpointRows = Object.entries(doc.endpoints ?? {}).map(([k, v]) => {
    const value = typeof v === 'string' ? v : JSON.stringify(v);
    const isAbsolute = typeof v === 'string' && /^https?:\/\//.test(value);
    return kvRow(
      k,
      isAbsolute
        ? html`<a href="${value}" target="_blank" rel="noopener">${value}</a>`
        : html`<span class="mono">${value}</span>`,
      true,
    );
  });

  const limitsObj = (doc.limits ?? {}) as Record<string, unknown>;
  const limitsRows = Object.keys(limitsObj).length
    ? Object.entries(limitsObj).map(([k, v]) =>
        kvRow(k, html`<span class="mono">${String(v)}</span>`, true),
      )
    : null;

  const billingObj = doc.billing as Record<string, unknown> | undefined;
  const billingRows = billingObj
    ? Object.entries(billingObj).map(([k, v]) =>
        kvRow(
          k,
          html`<span class="mono">${typeof v === 'string' ? v : JSON.stringify(v)}</span>`,
          true,
        ),
      )
    : null;

  const x402Obj = doc.x402 as Record<string, unknown> | undefined;
  const x402Rows = x402Obj
    ? Object.entries(x402Obj).map(([k, v]) =>
        kvRow(
          k,
          html`<span class="mono">${typeof v === 'string' ? v : JSON.stringify(v)}</span>`,
          true,
        ),
      )
    : null;

  const tagsHtml = rec.tags.length
    ? rec.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')
    : '';

  const timestampRows = [
    kvRow('first_listed_at', html`<span class="mono">${rec.first_listed_at}</span>`, true),
    kvRow('fetched_at', html`<span class="mono">${rec.fetched_at}</span> <span class="updated">(${relativeTime(rec.fetched_at)})</span>`, true),
    kvRow('updated_at', html`<span class="mono">${rec.updated_at}</span> <span class="updated">(${relativeTime(rec.updated_at)})</span>`, true),
  ];

  const rawDocJsonPretty = JSON.stringify(publicListing, null, 2);
  const rawDocJsonCompact = JSON.stringify(publicListing);

  return html`
    ${headerBlock}

    <section class="detail">
      <h2>Identity &amp; trust</h2>
      <dl>${raw(identityRows.join(''))}</dl>
    </section>

    <section class="detail">
      <h2>Capabilities</h2>
      <dl>${raw(capabilitiesRows.join(''))}</dl>
    </section>

    <section class="detail">
      <h2>Endpoints</h2>
      <dl>${endpointRows.length ? raw(endpointRows.join('')) : html`<dd><span class="none">No endpoints declared.</span></dd>`}</dl>
    </section>

    ${limitsRows
      ? html`<section class="detail"><h2>Limits</h2><dl>${raw(limitsRows.join(''))}</dl></section>`
      : ''}

    ${billingRows
      ? html`<section class="detail"><h2>Billing</h2><dl>${raw(billingRows.join(''))}</dl></section>`
      : ''}

    ${x402Rows
      ? html`<section class="detail"><h2>x402</h2><dl>${raw(x402Rows.join(''))}</dl></section>`
      : ''}

    ${tagsHtml
      ? html`<section class="detail"><h2>Tags</h2><div>${raw(tagsHtml)}</div></section>`
      : ''}

    <section class="detail">
      <h2>Timestamps</h2>
      <dl>${raw(timestampRows.join(''))}</dl>
    </section>

    <section class="detail">
      <h2>Raw discovery</h2>
      <details class="raw">
        <summary>Show JSON</summary>
        <pre class="raw-doc"><code>${rawDocJsonPretty}</code></pre>
      </details>
      <p style="margin-top:12px;">
        Machine-readable: <a href="${jsonHref}"><code>${jsonHref}</code></a>
      </p>
    </section>

    <script type="application/json" id="listing-data">${raw(escapeForScript(rawDocJsonCompact))}</script>
  `;
}

function renderNotFound(did: string) {
  return html`
    <h1>Listing not found</h1>
    <p>
      No listing exists for <code>${did}</code>. Listings are removed when
      services are soft-deleted or have never been registered.
    </p>
    <p><a href="/">Back to directory</a></p>
  `;
}

function renderInvalidDid(did: string) {
  return html`
    <h1>Invalid service_did</h1>
    <p>
      <code>${did}</code> is not a valid AFAuth service identifier.
      Identifiers must match <code>did:web:</code> or <code>did:key:</code>.
    </p>
    <p><a href="/">Back to directory</a></p>
  `;
}

function kvRow(key: string, value: unknown, mono: boolean): string {
  const valHtml = value instanceof Object && 'toString' in value ? String(value) : escapeHtml(String(value));
  const ddClass = mono ? 'mono' : '';
  return `<dt>${escapeHtml(key)}</dt><dd${ddClass ? ` class="${ddClass}"` : ''}>${valHtml}</dd>`;
}

function noneTag(): string {
  return '<span class="none">not declared</span>';
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const deltaMs = Date.now() - then;
  const sec = Math.round(deltaMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 24) return `${mo}mo ago`;
  return `${Math.round(mo / 12)}y ago`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeForScript(s: string): string {
  return s.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

function siteBase(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'https://registry.afauth.org').replace(/\/$/, '');
}

function buildListingJsonLd(rec: ListingRecord, displayTitle: string): object {
  const host = hostFromUrl(rec.discovery_url);
  const detailUrl = `${siteBase()}/listings/${encodeURIComponent(rec.service_did)}`;
  const doc = rec.discovery_doc as Record<string, unknown>;
  const features = Array.isArray(doc.features) ? (doc.features as string[]) : [];
  const recipients = Array.isArray(doc.recipient_types) ? (doc.recipient_types as string[]) : [];

  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: displayTitle,
    alternateName: rec.service_did,
    identifier: rec.service_did,
    description:
      rec.description ??
      `AFAuth-enabled service at ${host}. Discovery: ${rec.discovery_url}.`,
    url: rec.discovery_url,
    sameAs: [detailUrl, `${siteBase()}/v1/listings/${encodeURIComponent(rec.service_did)}`],
    applicationCategory: 'WebApplication',
    applicationSubCategory: 'AFAuth-enabled API',
    operatingSystem: 'Cross-platform',
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    keywords: [...rec.tags, ...features, ...recipients].join(', ') || undefined,
    dateCreated: rec.first_listed_at,
    dateModified: rec.updated_at,
    isAccessibleForFree: true,
    publisher: {
      '@type': 'Organization',
      name: host,
      url: `https://${host}`,
    },
  };
}
