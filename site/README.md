# Documentation site

The hosted documentation for Confidential Stellar Infrastructure.

```bash
pnpm docs:build     # -> site/dist
pnpm docs:serve     # preview on http://localhost:4173
```

Output is plain static files: no framework, no server, no CDN. Drop `site/dist` on GitHub Pages, Netlify, Cloudflare Pages, S3 or an nginx root and it works unchanged.

---

## It renders the repository, it does not copy it

Every documentation page is generated from a Markdown file that already exists in the repo — `README.md`, `MILESTONES.md`, `CONTRIBUTING.md`, `docs/*.md` and every ADR.

A docs site that keeps its own copy of the content is a docs site that goes stale. The repository stays the single source of truth; [`src/pages.ts`](src/pages.ts) only decides ordering and titles. ADRs are discovered from `docs/adr/` rather than listed, because they are append-only and a manual list is one someone will forget to update.

The one hand-written page is the landing page ([`src/home.ts`](src/home.ts)). It states only things that change slowly and links out for anything detailed, so there is nothing on it to drift.

Links between documents are rewritten at build time: `docs/events.md` becomes `events.html` when a page exists for it, and falls back to a GitHub blob URL when one does not. The Markdown stays correct read on GitHub _and_ correct read on the site, without being edited into something that only works in one place.

---

## Structure

| File              | Role                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `src/build.ts`    | Entry point. Renders pages, writes the search index, copies assets. |
| `src/pages.ts`    | Page manifest and ADR discovery.                                    |
| `src/markdown.ts` | Markdown rendering, heading ids, link rewriting.                    |
| `src/template.ts` | Page shell: nav, table of contents, metadata.                       |
| `src/home.ts`     | The landing page.                                                   |
| `src/styles.ts`   | The stylesheet, as one string.                                      |
| `src/client.ts`   | Runtime script: theme, nav, scrollspy, search.                      |
| `src/serve.ts`    | Static file server for local preview.                               |

Two build-time dependencies, `markdown-it` and `highlight.js`. Highlighting runs during the build, so published pages are static HTML with no runtime script and no third-party request — a docs site for an infrastructure project should not need to fetch a syntax highlighter from someone else's server to be readable.

---

## Things worth knowing

**Search needs to be served over HTTP.** The index is fetched at runtime, and `fetch` is blocked on `file://` by CORS. Opening `site/dist/index.html` directly works for everything except search; use `pnpm docs:serve`.

**Every link is relative.** The site works at a domain root and under a subpath — which is what project Pages gives you — with no configuration and no rebuild. Each page carries a `BASE` for that reason; nothing is written absolute. `SITE_URL` is used only for absolute social-card URLs in the meta tags.

**Theme is applied before first paint.** A small blocking snippet in `<head>` reads the stored preference so a dark-mode reader never gets a white flash. The choice persists in `localStorage`, falls back to `prefers-color-scheme`, and is wrapped in `try/catch` because storage throws outright in some privacy modes.

**Wide tables scroll inside their own container.** Several of these documents carry wide tables; without that the page itself scrolls sideways on a phone and breaks every other line of text.

---

## Publishing

[`.github/workflows/docs.yml`](../.github/workflows/docs.yml) builds and deploys to GitHub Pages on every push to `main` that touches the site, the assets or any rendered document. It can also be run by hand from the Actions tab.

Enable it once, in **Settings → Pages → Build and deployment → Source: GitHub Actions**. Until that is switched on, the workflow builds successfully and the deploy step fails.

For any other host, `pnpm docs:build` and publish `site/dist`.
