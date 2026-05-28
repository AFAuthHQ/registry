import { html, raw } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';

const STYLE = `
  :root {
    --fg: #1c1816;
    --muted: #5e564f;
    --bg: #f7f3ec;
    --paper: #ffffff;
    --line: #d8cfc3;
    --accent: #8b5a2b;
    --warn: #c25420;
    --code: #f0eadf;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: ui-serif, Georgia, 'Times New Roman', Times, serif;
    color: var(--fg);
    background: var(--bg);
    line-height: 1.55;
    font-size: 17px;
  }
  header.site {
    border-bottom: 1px solid rgba(20, 16, 8, 0.10);
    background: rgba(245, 239, 228, 0.78);
    backdrop-filter: blur(16px) saturate(120%);
    -webkit-backdrop-filter: blur(16px) saturate(120%);
    position: sticky;
    top: 0;
    z-index: 30;
  }
  header.site nav {
    max-width: 1248px;
    margin: 0 auto;
    padding: 14px 24px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  header.site .brand {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    color: #15110A;
    text-decoration: none;
  }
  header.site .brand svg { display: block; height: 24px; width: 24px; }
  header.site .brand .wordmark {
    font-family: 'IBM Plex Sans', ui-sans-serif, system-ui, -apple-system, sans-serif;
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.015em;
    color: #15110A;
  }
  header.site .brand .surface {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
    color: #5C5247;
    padding-left: 10px;
    margin-left: 4px;
    border-left: 1px solid rgba(20, 16, 8, 0.18);
  }
  header.site .brand:hover .wordmark,
  header.site .brand:hover .surface { color: #B83227; }
  header.site .links {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.18em;
  }
  header.site .links a {
    padding: 6px 12px;
    color: #3F362D;
    text-decoration: none;
  }
  header.site .links a:hover { color: #B83227; }
  header.site .links a.ext { display: inline-flex; align-items: center; gap: 6px; }
  header.site .links a.ext svg { height: 14px; width: 14px; }
  @media (max-width: 640px) {
    header.site .links a.hide-sm { display: none; }
    header.site .brand .surface { display: none; }
  }
  main {
    max-width: 880px;
    margin: 0 auto;
    padding: 32px 24px 64px;
  }
  h1 { font-size: 28px; margin: 0 0 16px; }
  h2 { font-size: 20px; margin: 32px 0 12px; }
  h3 { font-size: 16px; margin: 24px 0 8px; }
  p { margin: 0 0 14px; }
  ul, ol { padding-left: 24px; }
  code, .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 0.92em;
    background: var(--code);
    padding: 1px 6px;
    border-radius: 3px;
  }
  a { color: var(--accent); }
  footer.site {
    max-width: 880px;
    margin: 32px auto 0;
    padding: 16px 24px 32px;
    border-top: 1px solid var(--line);
    font-size: 14px;
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }

  table.listings {
    width: 100%;
    border-collapse: collapse;
    margin-top: 16px;
    font-size: 15px;
  }
  table.listings th, table.listings td {
    text-align: left;
    padding: 10px 12px;
    border-bottom: 1px solid var(--line);
    vertical-align: top;
  }
  table.listings th {
    font-weight: 600;
    color: var(--muted);
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  table.listings td.name { font-weight: 600; }
  table.listings td.did, table.listings td.host { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 13px; color: var(--muted); }
  table.listings td.status {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    text-transform: uppercase;
    color: var(--muted);
  }
  table.listings td.status.active { color: var(--accent); }
  table.listings td.status.stale  { color: var(--warn); }
  .tag {
    display: inline-block;
    background: var(--code);
    padding: 1px 8px;
    border-radius: 12px;
    font-size: 12px;
    margin-right: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--muted);
  }
  .didkey-warn {
    display: inline-block;
    color: var(--warn);
    font-size: 12px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    margin-left: 8px;
  }
  .empty { color: var(--muted); font-style: italic; padding: 24px 0; }

  .version-badge {
    display: inline-block;
    background: var(--code);
    color: var(--accent);
    padding: 1px 6px;
    border-radius: 3px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    margin-left: 6px;
    vertical-align: middle;
  }
  .cap-pill {
    display: inline-block;
    background: transparent;
    border: 1px solid var(--line);
    color: var(--fg);
    padding: 0 6px;
    border-radius: 3px;
    font-size: 11px;
    margin-right: 4px;
    margin-top: 4px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  .cap-pill.feat { border-color: var(--accent); color: var(--accent); }
  .row-meta {
    margin-top: 6px;
    font-size: 12px;
    color: var(--muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    word-break: break-all;
  }
  .row-meta a { color: var(--muted); }
  .row-meta a:hover { color: var(--accent); }
  .json-link {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    margin-top: 6px;
    display: inline-block;
  }
  .updated {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: var(--muted);
    margin-top: 4px;
    display: block;
  }

  section.detail { margin-top: 28px; }
  section.detail h2 { font-size: 16px; margin: 0 0 8px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  section.detail dl { display: grid; grid-template-columns: 220px 1fr; gap: 4px 16px; margin: 0; }
  section.detail dt {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    color: var(--muted);
    padding: 6px 0;
  }
  section.detail dd {
    margin: 0;
    padding: 6px 0;
    font-size: 14px;
    word-break: break-all;
  }
  section.detail dd.mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
  }
  section.detail dd .none { color: var(--muted); font-style: italic; font-size: 13px; }
  pre.raw-doc {
    background: var(--code);
    border: 1px solid var(--line);
    padding: 12px 14px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 12px;
    line-height: 1.5;
    margin: 8px 0 0;
  }
  details.raw > summary {
    cursor: pointer;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    color: var(--accent);
    padding: 4px 0;
  }
  .breadcrumb {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px;
    color: var(--muted);
    margin: 0 0 8px;
  }
  .breadcrumb a { color: var(--muted); }
  .breadcrumb a:hover { color: var(--accent); }
  .lede {
    font-size: 15px;
    color: var(--muted);
    margin: 0 0 16px;
  }
  @media (max-width: 640px) {
    section.detail dl { grid-template-columns: 1fr; gap: 0 0; }
    section.detail dt { padding-top: 10px; padding-bottom: 0; }
    section.detail dd { padding-top: 2px; }
  }

  /* Two-column action cards above the directory */
  .action-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    margin: 26px 0 0;
  }
  .action-card {
    background: var(--paper);
    border: 1px solid var(--line);
    border-radius: 6px;
    padding: 16px 18px;
  }
  .action-eyebrow {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .action-card p { margin: 0; font-size: 15px; }
  .action-snippet {
    background: var(--code);
    border: 1px solid var(--line);
    padding: 8px 12px;
    border-radius: 4px;
    overflow-x: auto;
    font-size: 12px;
    margin: 8px 0 0;
  }
  .action-snippet.copyable {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    overflow: hidden;
  }
  .action-snippet.copyable > code {
    background: transparent;
    padding: 0;
    overflow-x: auto;
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
  }
  .copy-btn {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 3px;
    padding: 2px 8px;
    cursor: pointer;
    transition: color 180ms, border-color 180ms, background 180ms;
    flex-shrink: 0;
  }
  .copy-btn:hover {
    color: var(--accent);
    border-color: var(--line);
    background: rgba(255, 255, 255, 0.4);
  }
  .copy-btn.copied {
    color: #4a6e35;
    border-color: #c5d9b5;
  }
  @media (max-width: 640px) {
    .action-cards { grid-template-columns: 1fr; }
  }

  /* Directory list — replaces table.listings */
  .listings-list { margin: 0; }
  .listing-row {
    padding: 18px 0;
    border-bottom: 1px solid var(--line);
  }
  .listing-row:first-child { border-top: 1px solid var(--line); }
  .listing-row-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 16px;
  }
  .listing-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--fg);
    text-decoration: none;
  }
  .listing-title:hover { color: var(--accent); }
  .listing-status {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--muted);
    padding: 2px 8px;
    border-radius: 10px;
    background: var(--code);
    flex-shrink: 0;
  }
  .listing-status.active { background: #e8f0e3; color: #4a6e35; }
  .listing-status.stale  { background: #f5e3df; color: var(--warn); }
  .listing-desc {
    margin: 6px 0 0;
    color: var(--fg);
    font-size: 15px;
  }
  .listing-meta {
    margin-top: 8px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 12px;
    color: var(--muted);
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }
  .listing-meta .mono { background: transparent; padding: 0; color: var(--fg); }
  .listing-meta-sep { color: var(--line); }
  .listing-meta .json-link {
    color: var(--accent);
    text-decoration: none;
  }
  .listing-meta .json-link:hover { text-decoration: underline; }
  .listing-pills { margin-top: 10px; }

  /* Announce-section ordered list */
  ol.announce-steps {
    margin: 0 0 12px;
    padding-left: 22px;
  }
  ol.announce-steps li { padding: 4px 0; }
`;

const DEFAULT_DESCRIPTION =
  'The canonical AFAuth service directory — services that have voluntarily announced AFAuth support by proving control of their discovery host. Informational, non-normative; conforming agents and services have no obligation to interact with it.';

function baseUrl(): string {
  return (process.env.PUBLIC_BASE_URL ?? 'https://registry.afauth.org').replace(/\/$/, '');
}

/**
 * Always-emitted top-level Organization JSON-LD. Declares that
 * registry.afauth.org is one of three sibling properties under the
 * AFAuth umbrella (along with afauth.org and docs.afauth.org), so
 * search engines and LLM crawlers can consolidate link-equity and
 * understand the relationship without parsing prose.
 */
const ORGANIZATION_JSONLD = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'AFAuth',
  alternateName: 'Agent-First Auth',
  url: 'https://afauth.org',
  logo: 'https://afauth.org/favicon.svg',
  sameAs: [
    'https://afauth.org',
    'https://docs.afauth.org',
    'https://registry.afauth.org',
    'https://github.com/AFAuthHQ',
    'https://www.npmjs.com/org/afauthhq',
  ],
};

export interface LayoutOpts {
  title: string;
  body: HtmlEscapedString | Promise<HtmlEscapedString>;
  /** Optional meta description; falls back to the directory's default. */
  description?: string;
  /** Request pathname (e.g. "/listings/did:web:example.com") for canonical URL. */
  path?: string;
  /** One or more schema.org JSON-LD payloads to inline into <head>. */
  jsonLd?: object | object[];
}

export function layout(opts: LayoutOpts): HtmlEscapedString | Promise<HtmlEscapedString> {
  const description = opts.description ?? DEFAULT_DESCRIPTION;
  const canonical = `${baseUrl()}${opts.path ?? ''}`;
  const extraJsonLd = opts.jsonLd
    ? Array.isArray(opts.jsonLd)
      ? opts.jsonLd
      : [opts.jsonLd]
    : [];
  // Organization first so the parent-entity declaration leads.
  const jsonLdArr: object[] = [ORGANIZATION_JSONLD, ...extraJsonLd];
  const jsonLdHtml = jsonLdArr
    .map(
      (obj) =>
        `<script type="application/ld+json">${JSON.stringify(obj)
          .replace(/</g, '\\u003c')
          .replace(/>/g, '\\u003e')
          .replace(/&/g, '\\u0026')}</script>`,
    )
    .join('\n');

  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<meta name="description" content="${description}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="registry.afauth.org">
<meta property="og:title" content="${opts.title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonical}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${opts.title}">
<meta name="twitter:description" content="${description}">
<link rel="icon" type="image/svg+xml" href="https://afauth.org/favicon.svg">
<link rel="alternate" type="text/markdown" title="LLM-friendly site summary" href="/llms.txt">
<link rel="sitemap" type="application/xml" href="/sitemap.xml">
<style>${raw(STYLE)}</style>
${raw(jsonLdHtml)}
</head>
<body>
<header class="site"><nav>
  <a class="brand" href="/" aria-label="AFAuth service registry — home">
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <path d="M14 46 L32 14 L50 46 Z" fill="none" stroke="#B83227" stroke-width="5" stroke-linejoin="round"/>
      <circle cx="32" cy="36" r="3.5" fill="#B83227"/>
    </svg>
    <span class="wordmark">AFAuth</span>
    <span class="surface">Registry</span>
  </a>
  <div class="links">
    <a class="hide-sm" href="/">Browse</a>
    <a class="hide-sm" href="/operator">Operator</a>
    <a class="hide-sm" href="/policy">Policy</a>
    <a href="https://afauth.org" rel="noopener">afauth.org</a>
    <a class="ext" href="https://github.com/AFAuthHQ" target="_blank" rel="noopener" aria-label="AFAuth on GitHub">
      <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
        <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
      </svg>
      <span class="hide-sm">GitHub</span>
    </a>
  </div>
</nav></header>
<main>${opts.body}</main>
<footer class="site">
  Informational, non-normative. See
  <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md" target="_blank" rel="noopener">spec/directory.md</a>
  and
  <a href="https://github.com/AFAuthHQ/spec/blob/main/proposals/0003-service-directory.md" target="_blank" rel="noopener">AFAP-0003</a>.
</footer>
<script>
(function () {
  document.querySelectorAll('button[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy') || '';
      var label = btn.querySelector('[data-copy-label]');
      var original = label ? label.textContent : 'Copy';
      var done = function () {
        if (!label) return;
        label.textContent = 'Copied';
        btn.classList.add('copied');
        setTimeout(function () {
          label.textContent = original;
          btn.classList.remove('copied');
        }, 1600);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
      } else {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        done();
      }
    });
  });
})();
</script>
</body>
</html>`;
}
