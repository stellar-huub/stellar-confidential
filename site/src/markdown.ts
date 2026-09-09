import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';

/**
 * Markdown rendering.
 *
 * Highlighting runs at build time, so the published pages are static HTML with
 * no runtime script and no CDN dependency. A docs site for an infrastructure
 * project should not need to fetch a syntax highlighter from someone else's
 * server to be readable.
 */

export interface Heading {
  readonly level: number;
  readonly id: string;
  readonly text: string;
}

export interface RenderedPage {
  readonly html: string;
  readonly headings: readonly Heading[];
  /** First paragraph, used for the meta description when a page has no summary. */
  readonly excerpt: string;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 80);
}

function createRenderer(): MarkdownIt {
  return new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    highlight(code, language) {
      if (language && hljs.getLanguage(language)) {
        try {
          return hljs.highlight(code, { language, ignoreIllegals: true }).value;
        } catch {
          // Fall through to the escaped-plaintext path below.
        }
      }
      return '';
    },
  });
}

/**
 * Rewrite links between repository files into links between site pages.
 *
 * The Markdown is written to be read on GitHub, where `docs/events.md` and
 * `../README.md` are correct. Published as a site those would 404, so they are
 * translated here rather than by editing the source into something that only
 * works in one of the two places.
 */
function rewriteHref(href: string, routes: ReadonlyMap<string, string>): string {
  if (/^(https?:|mailto:|#|\/)/.test(href)) return href;

  const [pathPart, hash = ''] = href.split('#');
  const normalised = (pathPart ?? '').replace(/^\.\//, '').replace(/^(\.\.\/)+/, '');
  if (normalised === '') return href;

  const target = routes.get(normalised);
  if (target !== undefined) return hash ? `${target}#${hash}` : target;

  // Not a page: point at the file on GitHub so the link still resolves.
  return `https://github.com/stellar-huub/stellar-confidential/blob/main/${normalised}${
    hash ? `#${hash}` : ''
  }`;
}

export function renderMarkdown(
  source: string,
  options: { routes: ReadonlyMap<string, string>; baseDir: string },
): RenderedPage {
  const md = createRenderer();
  const headings: Heading[] = [];
  const seen = new Map<string, number>();

  const tokens = md.parse(source, {});

  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined) continue;

    // Give every heading a stable id, and collect the ones worth a table of
    // contents. h1 is the page title and is rendered separately.
    if (token.type === 'heading_open') {
      const inline = tokens[i + 1];
      const text = inline?.content ?? '';
      const base = slugify(text) || 'section';
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count}`;
      token.attrSet('id', id);

      const level = Number(token.tag.slice(1));
      if (level >= 2 && level <= 3) {
        // The heading text here is still raw Markdown, so `code` spans would
        // otherwise reach the table of contents with their backticks showing.
        headings.push({ level, id, text: text.replace(/`/g, '') });
      }
    }

    if (token.type === 'inline' && token.children) {
      for (const child of token.children) {
        if (child.type !== 'link_open') continue;
        const href = child.attrGet('href');
        if (href === null) continue;
        const rewritten = rewriteHref(href, options.routes);
        child.attrSet('href', rewritten);
        if (/^https?:/.test(rewritten)) {
          child.attrSet('target', '_blank');
          child.attrSet('rel', 'noopener noreferrer');
        }
      }
    }
  }

  const html = md.renderer.render(tokens, md.options, {});

  const firstParagraph = tokens.findIndex((t) => t.type === 'paragraph_open');
  const excerpt =
    firstParagraph === -1 ? '' : (tokens[firstParagraph + 1]?.content ?? '').replace(/\s+/g, ' ');

  return { html, headings, excerpt: excerpt.slice(0, 200) };
}

/** Strip Markdown to plain text, for the search index. */
export function toPlainText(source: string): string {
  return source
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^[>\-*+#|]+/gm, ' ')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
