import { STYLESHEET } from './styles.js';
import { CLIENT_SCRIPT, THEME_BOOTSTRAP } from './client.js';
import type { Heading } from './markdown.js';
import type { Section } from './pages.js';

export const REPO_URL = 'https://github.com/stellar-huub/stellar-confidential';

export interface ShellOptions {
  readonly title: string;
  readonly description: string;
  /** Path prefix back to the site root: '' at the root, '../' one level down. */
  readonly base: string;
  readonly currentSlug: string;
  readonly sections: readonly Section[];
  readonly headings: readonly Heading[];
  readonly body: string;
  /** Repository-relative path this page was rendered from, for "Edit this page". */
  readonly sourcePath?: string;
  readonly siteUrl: string;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function navigation(sections: readonly Section[], current: string, base: string): string {
  return sections
    .map((section) => {
      const links = section.pages
        .map((page) => {
          const active = page.slug === current ? ' class="current"' : '';
          return `<a href="${base}${page.slug}.html"${active}>${escapeText(page.title)}</a>`;
        })
        .join('\n        ');
      return `<div class="nav-section">
        <h4>${section.name}</h4>
        ${links}
      </div>`;
    })
    .join('\n      ');
}

function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function tableOfContents(headings: readonly Heading[]): string {
  if (headings.length < 2) return '';
  const items = headings
    .map((h) => `<a class="lvl-${h.level}" href="#${h.id}">${escapeText(h.text)}</a>`)
    .join('\n        ');
  return `<aside class="toc"><h4>On this page</h4>\n        ${items}\n      </aside>`;
}

export function shell(options: ShellOptions): string {
  const { base, siteUrl } = options;
  const social = `${siteUrl}/assets/social-card.png`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeAttr(options.title)} · Confidential Stellar Infrastructure</title>
<meta name="description" content="${escapeAttr(options.description)}">
<meta property="og:title" content="${escapeAttr(options.title)} · Confidential Stellar Infrastructure">
<meta property="og:description" content="${escapeAttr(options.description)}">
<meta property="og:type" content="website">
<meta property="og:image" content="${escapeAttr(social)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="${base}assets/favicon.svg" type="image/svg+xml">
<script>${THEME_BOOTSTRAP}</script>
<style>${STYLESHEET}</style>
</head>
<body>
<header class="topbar">
  <button class="icon-button" id="nav-toggle" aria-label="Toggle navigation">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
  </button>
  <a class="brand" href="${base}index.html">
    <img src="${base}assets/logo-mark.svg" alt="" width="28" height="28">
    <span>Confidential Stellar</span>
  </a>
  <div class="spacer"></div>
  <a class="icon-button" href="${REPO_URL}" aria-label="Source on GitHub" target="_blank" rel="noopener noreferrer">
    <svg width="17" height="17" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>
  </a>
  <button class="icon-button" id="theme-toggle" aria-label="Toggle colour theme">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>
  </button>
</header>

<div class="layout">
  <nav class="sidebar">
    <div class="search-wrap">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
      <input id="search" type="search" placeholder="Search docs  /" autocomplete="off" aria-label="Search documentation">
      <div id="search-results"></div>
    </div>
    ${navigation(options.sections, options.currentSlug, base)}
  </nav>

  <main>${options.body}</main>

  ${tableOfContents(options.headings)}
</div>

<script>var BASE = ${JSON.stringify(base)};</script>
<script>${CLIENT_SCRIPT}</script>
</body>
</html>
`;
}

export function documentPage(options: {
  title: string;
  summary: string;
  html: string;
  sourcePath: string;
}): string {
  return `<div class="page-header">
    <h1>${options.title}</h1>
    <p>${options.summary}</p>
  </div>
  <div class="content">${options.html}</div>
  <div class="page-footer">
    <span>Rendered from <code>${options.sourcePath}</code></span>
    <span class="spacer"></span>
    <a href="${REPO_URL}/blob/main/${options.sourcePath}" target="_blank" rel="noopener noreferrer">Edit this page &rarr;</a>
  </div>`;
}
