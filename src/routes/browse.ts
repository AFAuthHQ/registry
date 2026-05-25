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
    const page = layout({
      title: 'AFAuth Service Directory',
      description:
        'Browse services that have announced AFAuth support — opt-in, cryptographically host-proven, machine-readable at /v1/listings.',
      path: '/',
      jsonLd: collectionLd,
      body: html`
        <h1>AFAuth Service Directory</h1>
        <p>
          Services that have voluntarily announced AFAuth support, by
          proving control of their discovery host. Membership is opt-in
          and independent of conformance: a listing means a service has
          claimed AFAuth support, not that it has been audited.
        </p>
        <p>
          Submission is via the <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md#4-listing-protocol">§4 listing protocol</a>;
          consumers fetch <code>/v1/listings</code>.
        </p>
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
  return html`
    <table class="listings">
      <thead>
        <tr>
          <th>Service</th>
          <th>Identity</th>
          <th>Tags</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${raw(listings.map(renderRow).join(''))}
      </tbody>
    </table>
  `;
}

function renderRow(rec: ListingRecord): string {
  const host = hostFromUrl(rec.discovery_url);
  const isKey = rec.service_did.startsWith('did:key:');
  const titleText = rec.title ?? host;
  const detailHref = `/listings/${encodeURI(rec.service_did)}`;
  const jsonHref = `/v1/listings/${encodeURI(rec.service_did)}`;

  const titleHtml = `<a href="${detailHref}">${escapeHtml(titleText)}</a>`;
  const descHtml = rec.description
    ? `<div style="color:var(--muted);font-size:13px;margin-top:4px;">${escapeHtml(rec.description)}</div>`
    : '';

  const features = (rec.discovery_doc.features ?? []) as string[];
  const recipients = (rec.discovery_doc.recipient_types ?? []) as string[];
  const capPills = [
    ...features.map((f) => `<span class="cap-pill feat">${escapeHtml(f)}</span>`),
    ...recipients.map((rt) => `<span class="cap-pill">${escapeHtml(rt)}</span>`),
  ].join('');
  const capsHtml = capPills ? `<div style="margin-top:6px;">${capPills}</div>` : '';

  const versionBadge = rec.discovery_doc.afauth_version
    ? `<span class="version-badge">v${escapeHtml(rec.discovery_doc.afauth_version)}</span>`
    : '';
  const discoveryUrlHtml = `<div class="row-meta"><a href="${escapeHtml(rec.discovery_url)}" target="_blank" rel="noopener">${escapeHtml(rec.discovery_url)}</a></div>`;

  const tagsHtml = rec.tags.length
    ? rec.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')
    : '<span class="tag" style="opacity:0.5">—</span>';

  const didCell = isKey
    ? `<span class="mono">${escapeHtml(rec.service_did)}</span>${versionBadge}
       <span class="didkey-warn" title="did:key carries no DNS+TLS anchor — see spec §3">⚠ no domain anchor</span>
       <div class="mono" style="color:var(--muted);margin-top:4px;">via ${escapeHtml(host)}</div>
       ${discoveryUrlHtml}`
    : `<span class="mono">${escapeHtml(rec.service_did)}</span>${versionBadge}
       ${discoveryUrlHtml}`;

  const statusClass = rec.status === 'active' ? 'active' : rec.status === 'stale' ? 'stale' : '';
  const updatedHtml = `<span class="updated" title="${escapeHtml(rec.updated_at)}">${escapeHtml(relativeTime(rec.updated_at))}</span>`;
  const jsonLinkHtml = `<a class="json-link" href="${jsonHref}">JSON</a>`;

  return `<tr>
    <td class="name">${titleHtml}${descHtml}${capsHtml}</td>
    <td class="did">${didCell}</td>
    <td>${tagsHtml}</td>
    <td class="status ${statusClass}">${escapeHtml(rec.status)}${updatedHtml}${jsonLinkHtml}</td>
  </tr>`;
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
