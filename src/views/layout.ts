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
    border-bottom: 1px solid var(--line);
    background: var(--paper);
  }
  header.site nav {
    max-width: 880px;
    margin: 0 auto;
    padding: 14px 24px;
    display: flex;
    gap: 24px;
    align-items: baseline;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 14px;
  }
  header.site nav strong { color: var(--accent); }
  header.site nav a { color: var(--fg); text-decoration: none; }
  header.site nav a:hover { color: var(--accent); }
  header.site nav .spacer { flex: 1; }
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
`;

export interface LayoutOpts {
  title: string;
  body: HtmlEscapedString | Promise<HtmlEscapedString>;
}

export function layout(opts: LayoutOpts): HtmlEscapedString | Promise<HtmlEscapedString> {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${opts.title}</title>
<style>${raw(STYLE)}</style>
</head>
<body>
<header class="site"><nav>
  <strong>registry.afauth.org</strong>
  <a href="/">Browse</a>
  <a href="/operator">Operator</a>
  <a href="/policy">Policy</a>
  <span class="spacer"></span>
  <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md" target="_blank" rel="noopener">Spec</a>
</nav></header>
<main>${opts.body}</main>
<footer class="site">
  Informational, non-normative. See
  <a href="https://github.com/AFAuthHQ/spec/blob/main/spec/directory.md" target="_blank" rel="noopener">spec/directory.md</a>
  and
  <a href="https://github.com/AFAuthHQ/spec/blob/main/proposals/0003-service-directory.md" target="_blank" rel="noopener">AFAP-0003</a>.
</footer>
</body>
</html>`;
}
