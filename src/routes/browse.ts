import { Hono } from 'hono';
import { html, raw } from 'hono/html';
import { hostFromUrl } from '../lib/fetch.js';
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
    const page = layout({
      title: 'AFAuth Service Directory',
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
  const titleHtml = escapeHtml(rec.title ?? host);
  const descHtml = rec.description
    ? `<div style="color:var(--muted);font-size:13px;margin-top:4px;">${escapeHtml(rec.description)}</div>`
    : '';
  const tagsHtml = rec.tags.length
    ? rec.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')
    : '<span class="tag" style="opacity:0.5">—</span>';
  const didCell = isKey
    ? `<span class="mono">${escapeHtml(rec.service_did)}</span>
       <span class="didkey-warn" title="did:key carries no DNS+TLS anchor — see spec §3">⚠ no domain anchor</span>
       <div class="mono" style="color:var(--muted);margin-top:4px;">via ${escapeHtml(host)}</div>`
    : `<span class="mono">${escapeHtml(rec.service_did)}</span>`;
  const statusClass = rec.status === 'active' ? 'active' : rec.status === 'stale' ? 'stale' : '';

  return `<tr>
    <td class="name">${titleHtml}${descHtml}</td>
    <td class="did">${didCell}</td>
    <td>${tagsHtml}</td>
    <td class="status ${statusClass}">${escapeHtml(rec.status)}</td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
