/**
 * Build the static documentation site.
 *
 *   pnpm docs:build     output to site/dist
 *   SITE_URL=...        absolute origin, used only for social-card meta tags
 *
 * The output is plain static files with no runtime dependency on anything
 * external: no CDN, no framework, no server. It can be dropped on GitHub Pages,
 * Netlify, S3 or a plain nginx root unchanged.
 *
 * Every link is relative, so the site works at a domain root and under a
 * subpath -- which is what project Pages gives you -- with no configuration and
 * no rebuild. That is why each page carries a BASE and nothing is written
 * absolute.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, toPlainText } from './markdown.js';
import { buildManifest, type PageSpec } from './pages.js';
import { documentPage, shell } from './template.js';
import { homePage } from './home.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE_DIR = resolve(HERE, '..');
const REPO_ROOT = resolve(SITE_DIR, '..');
const OUT_DIR = join(SITE_DIR, 'dist');

const SITE_URL = (
  process.env['SITE_URL'] ?? 'https://stellar-huub.github.io/stellar-confidential'
).replace(/\/$/, '');

interface SearchEntry {
  /** url */ u: string;
  /** name */ n: string;
  /** summary */ s: string;
  /** text */ t: string;
}

/** How deep a slug sits, so relative links back to the root are correct. */
function baseFor(slug: string): string {
  const depth = slug.split('/').length - 1;
  return depth === 0 ? '' : '../'.repeat(depth);
}

/**
 * Tables need a scroll container of their own.
 *
 * Several of these documents carry wide tables. Without this the page itself
 * scrolls sideways on a phone, which breaks every other line of text on it.
 */
function wrapTables(html: string): string {
  return html
    .replace(/<table>/g, '<div class="table-scroll"><table>')
    .replace(/<\/table>/g, '</table></div>');
}

/** Give headings a clickable anchor, so a reader can link to a section. */
function addHeadingAnchors(html: string): string {
  return html.replace(
    /<(h[23]) id="([^"]+)">([\s\S]*?)<\/\1>/g,
    (_match, tag: string, id: string, inner: string) =>
      `<${tag} id="${id}">${inner}<a class="heading-anchor" href="#${id}" aria-label="Link to this section">#</a></${tag}>`,
  );
}

/**
 * Drop a rule that sits immediately before a section heading.
 *
 * The source documents separate sections with `---`, which is right on GitHub.
 * Here every h2 already draws its own rule, so the two together give each
 * section a doubled separator. The markup is fixed rather than the source,
 * because the source has to keep reading well on GitHub too.
 */
function dropRedundantRules(html: string): string {
  return html.replace(/<hr>\s*(?=<h2)/g, '');
}

/**
 * Drop the leading H1.
 *
 * Every source document opens with its own title, and the page header already
 * renders one. Keeping both gives every page two titles.
 */
function stripLeadingH1(html: string): string {
  return html.replace(/^\s*<h1[^>]*>[\s\S]*?<\/h1>/, '');
}

function main(): void {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const sections = buildManifest(REPO_ROOT);
  const pages: PageSpec[] = sections.flatMap((section) => [...section.pages]);

  // Every repository-relative Markdown path that has a page, so links between
  // documents can be rewritten into links between pages.
  const routes = new Map<string, string>();
  for (const page of pages) routes.set(page.source, `SITE_ROOT/${page.slug}.html`);

  const searchIndex: SearchEntry[] = [];

  for (const page of pages) {
    const base = baseFor(page.slug);
    const source = readFileSync(join(REPO_ROOT, page.source), 'utf8');

    // Resolve the placeholder now that we know how deep this page sits.
    const localRoutes = new Map<string, string>();
    for (const [from, to] of routes) localRoutes.set(from, to.replace('SITE_ROOT/', base));

    const rendered = renderMarkdown(source, { routes: localRoutes, baseDir: page.source });
    const html = addHeadingAnchors(dropRedundantRules(wrapTables(stripLeadingH1(rendered.html))));

    const body = documentPage({
      title: page.title,
      summary: page.summary,
      html,
      sourcePath: page.source,
    });

    const outPath = join(OUT_DIR, `${page.slug}.html`);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(
      outPath,
      shell({
        title: page.title,
        description: page.summary || rendered.excerpt,
        base,
        currentSlug: page.slug,
        sections,
        headings: rendered.headings,
        body,
        sourcePath: page.source,
        siteUrl: SITE_URL,
      }),
    );

    searchIndex.push({
      // Stored relative to the site root, not to this page. The index is shared
      // by every page, so a URL built from the indexed page's own depth breaks
      // the moment it is used from a page at a different depth. The client
      // prefixes BASE instead.
      u: `${page.slug}.html`,
      n: page.title,
      s: page.summary,
      t: toPlainText(source).slice(0, 12_000),
    });
    console.log(`built ${page.slug}.html`);
  }

  // Home
  writeFileSync(
    join(OUT_DIR, 'index.html'),
    shell({
      title: 'Confidential Stellar Infrastructure',
      description:
        'Open infrastructure for private, recoverable and compliant digital asset applications on Stellar.',
      base: '',
      currentSlug: 'index',
      sections,
      headings: [],
      body: homePage(''),
      siteUrl: SITE_URL,
    }),
  );
  console.log('built index.html');

  writeFileSync(join(OUT_DIR, 'search-index.json'), JSON.stringify(searchIndex));

  // Brand assets are served from the site, not hotlinked back to the repository.
  cpSync(join(REPO_ROOT, 'assets'), join(OUT_DIR, 'assets'), {
    recursive: true,
    filter: (src) => !src.endsWith('.py') && !src.endsWith('README.md'),
  });

  // Tells GitHub Pages to serve the files as-is rather than running Jekyll,
  // which would otherwise ignore any path beginning with an underscore.
  writeFileSync(join(OUT_DIR, '.nojekyll'), '');

  // A 404 that keeps the reader inside the site rather than on a blank page.
  writeFileSync(
    join(OUT_DIR, '404.html'),
    shell({
      title: 'Page not found',
      description: 'That page does not exist.',
      base: '',
      currentSlug: '',
      sections,
      headings: [],
      body: `<div class="page-header"><h1>Page not found</h1>
        <p>That page does not exist, or has moved.</p></div>
        <div class="content"><p><a href="index.html">Back to the documentation home &rarr;</a></p></div>`,
      siteUrl: SITE_URL,
    }),
  );

  console.log(`\n${pages.length + 2} pages written to site/dist`);
}

main();
