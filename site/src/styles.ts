/**
 * The site stylesheet.
 *
 * Kept as one string rather than a CSS file so the palette stays in step with
 * assets/generate.py by sitting next to the code that uses it, and so the build
 * has no asset pipeline to go wrong.
 *
 * Themes are CSS custom properties on :root, redefined under a
 * [data-theme="dark"] attribute and under prefers-color-scheme. The attribute
 * wins in both directions, so an explicit choice survives a system change.
 */
export const STYLESHEET = `
:root {
  --accent-from: #5B8DEF;
  --accent-to: #2ED3B7;
  --accent: #2C7BE5;
  --bg: #FFFFFF;
  --bg-soft: #F8FAFC;
  --bg-raised: #FFFFFF;
  --text: #0B1220;
  --text-muted: #64748B;
  --border: #E2E8F0;
  --code-bg: #F8FAFC;
  --shadow: 0 1px 2px rgba(15, 23, 42, .06), 0 8px 24px rgba(15, 23, 42, .06);
  --sidebar: 268px;
  --toc: 216px;
  color-scheme: light;
}
:root[data-theme="dark"] {
  --accent: #5FD4C4;
  --bg: #0B1220;
  --bg-soft: #0E1729;
  --bg-raised: #111A2E;
  --text: #E8EEF9;
  --text-muted: #94A3B8;
  --border: #1E293B;
  --code-bg: #0E1729;
  --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 24px rgba(0, 0, 0, .3);
  color-scheme: dark;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --accent: #5FD4C4;
    --bg: #0B1220;
    --bg-soft: #0E1729;
    --bg-raised: #111A2E;
    --text: #E8EEF9;
    --text-muted: #94A3B8;
    --border: #1E293B;
    --code-bg: #0E1729;
    --shadow: 0 1px 2px rgba(0, 0, 0, .4), 0 8px 24px rgba(0, 0, 0, .3);
    color-scheme: dark;
  }
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; scroll-padding-top: 84px; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 16px/1.7 Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }

/* ---------------------------------------------------------------- chrome */
.topbar {
  position: sticky; top: 0; z-index: 40;
  display: flex; align-items: center; gap: 12px;
  height: 60px; padding: 0 20px;
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid var(--border);
}
.topbar .brand { display: flex; align-items: center; gap: 10px; font-weight: 700; color: var(--text); }
.topbar .brand img { width: 28px; height: 28px; }
.topbar .brand span { letter-spacing: -.2px; }
.topbar .spacer { flex: 1; }
.icon-button {
  display: inline-flex; align-items: center; justify-content: center;
  width: 36px; height: 36px; border-radius: 9px;
  border: 1px solid var(--border); background: var(--bg-raised);
  color: var(--text-muted); cursor: pointer; padding: 0;
}
.icon-button:hover { color: var(--text); border-color: var(--accent); }
#nav-toggle { display: none; }

.layout {
  display: grid;
  grid-template-columns: var(--sidebar) minmax(0, 1fr) var(--toc);
  gap: 40px;
  max-width: 1440px;
  margin: 0 auto;
  padding: 0 24px;
  align-items: start;
}

/* --------------------------------------------------------------- sidebar */
.sidebar {
  position: sticky; top: 60px;
  max-height: calc(100vh - 60px);
  overflow-y: auto;
  padding: 28px 0 48px;
}
.search-wrap { position: relative; margin-bottom: 22px; }
#search {
  width: 100%; padding: 9px 12px 9px 34px;
  border: 1px solid var(--border); border-radius: 9px;
  background: var(--bg-soft); color: var(--text); font: inherit; font-size: 14px;
}
#search:focus { outline: none; border-color: var(--accent); }
.search-wrap svg { position: absolute; left: 11px; top: 11px; color: var(--text-muted); }
#search-results {
  position: absolute; left: 0; right: 0; top: 42px; z-index: 30;
  background: var(--bg-raised); border: 1px solid var(--border);
  border-radius: 10px; box-shadow: var(--shadow);
  max-height: 320px; overflow-y: auto; padding: 6px; display: none;
}
#search-results.open { display: block; }
#search-results a { display: block; padding: 8px 10px; border-radius: 7px; color: var(--text); font-size: 14px; }
#search-results a:hover, #search-results a.active { background: var(--bg-soft); text-decoration: none; }
#search-results .r-title { font-weight: 600; }
#search-results .r-context { color: var(--text-muted); font-size: 12.5px; }
#search-results .empty { padding: 10px; color: var(--text-muted); font-size: 14px; }

.nav-section { margin-bottom: 22px; }
.nav-section h4 {
  margin: 0 0 8px; padding: 0 10px;
  font-size: 11px; font-weight: 700; letter-spacing: 1.1px;
  text-transform: uppercase; color: var(--text-muted);
}
.nav-section a {
  display: block; padding: 6px 10px; border-radius: 7px;
  color: var(--text-muted); font-size: 14.5px;
}
.nav-section a:hover { background: var(--bg-soft); color: var(--text); text-decoration: none; }
.nav-section a.current {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent); font-weight: 600;
}

/* ------------------------------------------------------------------ main */
main { padding: 36px 0 96px; min-width: 0; }
.page-header { margin-bottom: 28px; padding-bottom: 22px; border-bottom: 1px solid var(--border); }
.page-header h1 { margin: 0 0 8px; font-size: 40px; line-height: 1.15; letter-spacing: -1px; }
.page-header p { margin: 0; color: var(--text-muted); font-size: 17px; }

.content h2 {
  margin: 44px 0 14px; padding-top: 10px;
  font-size: 27px; letter-spacing: -.5px;
  border-top: 1px solid var(--border);
}
.content h3 { margin: 30px 0 10px; font-size: 20px; }
.content h4 { margin: 22px 0 8px; font-size: 16.5px; }
.content p, .content li { color: var(--text); }
.content ul, .content ol { padding-left: 22px; }
.content li { margin: 5px 0; }
.content hr { border: 0; border-top: 1px solid var(--border); margin: 34px 0; }
.content blockquote {
  margin: 20px 0; padding: 12px 18px;
  border-left: 3px solid var(--accent);
  background: var(--bg-soft); border-radius: 0 8px 8px 0;
  color: var(--text-muted);
}
.content blockquote p { margin: 0; }
.content img { max-width: 100%; }

.content code {
  font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: .885em;
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 5px; padding: .12em .38em;
}
.content pre {
  background: var(--code-bg); border: 1px solid var(--border);
  border-radius: 10px; padding: 16px 18px; overflow-x: auto; line-height: 1.6;
}
.content pre code { background: none; border: 0; padding: 0; font-size: 13.5px; }

/* Wide content scrolls inside its own box; the page itself never does. */
.table-scroll { overflow-x: auto; margin: 20px 0; }
.content table { border-collapse: collapse; width: 100%; font-size: 14.5px; }
.content th, .content td {
  border: 1px solid var(--border); padding: 9px 13px; text-align: left; vertical-align: top;
}
.content th { background: var(--bg-soft); font-weight: 650; }

.heading-anchor {
  margin-left: 8px; color: var(--text-muted); opacity: 0;
  font-weight: 400; text-decoration: none;
}
h2:hover .heading-anchor, h3:hover .heading-anchor { opacity: .7; }

.page-footer {
  margin-top: 56px; padding-top: 20px; border-top: 1px solid var(--border);
  display: flex; flex-wrap: wrap; gap: 14px; align-items: center;
  color: var(--text-muted); font-size: 14px;
}
.page-footer .spacer { flex: 1; }

/* ------------------------------------------------------------------- toc */
.toc { position: sticky; top: 60px; max-height: calc(100vh - 60px); overflow-y: auto; padding: 36px 0 48px; }
.toc h4 {
  margin: 0 0 10px; font-size: 11px; font-weight: 700;
  letter-spacing: 1.1px; text-transform: uppercase; color: var(--text-muted);
}
.toc a {
  display: block; padding: 4px 0 4px 12px;
  border-left: 2px solid var(--border);
  color: var(--text-muted); font-size: 13.5px; line-height: 1.45;
}
.toc a:hover { color: var(--text); text-decoration: none; }
.toc a.active { color: var(--accent); border-left-color: var(--accent); }
.toc a.lvl-3 { padding-left: 24px; font-size: 13px; }

/* ---------------------------------------------------------------- home */
.hero { padding: 60px 0 40px; }
.hero img.banner { width: 100%; max-width: 860px; border-radius: 14px; }
.hero h1 { font-size: 46px; line-height: 1.1; letter-spacing: -1.4px; margin: 26px 0 14px; max-width: 20ch; }
.hero .accent {
  background: linear-gradient(120deg, var(--accent-from), var(--accent-to));
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero p.lede { font-size: 19px; color: var(--text-muted); max-width: 62ch; margin: 0 0 26px; }
.cta { display: flex; flex-wrap: wrap; gap: 12px; }
.button {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 11px 20px; border-radius: 10px; font-weight: 600; font-size: 15px;
  border: 1px solid var(--border); color: var(--text); background: var(--bg-raised);
}
.button:hover { text-decoration: none; border-color: var(--accent); }
.button.primary {
  background: linear-gradient(120deg, var(--accent-from), var(--accent-to));
  color: #06131f; border-color: transparent;
}
.card-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(248px, 1fr)); gap: 18px; margin: 26px 0; }
.card {
  border: 1px solid var(--border); border-radius: 13px; padding: 20px;
  background: var(--bg-raised); box-shadow: var(--shadow);
}
.card h3 { margin: 0 0 6px; font-size: 17px; }
.card p { margin: 0; color: var(--text-muted); font-size: 14.5px; }
.card .status { font-size: 12px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
.card .status.built { color: var(--accent); }
.card .status.planned { color: var(--text-muted); }
.note {
  border: 1px solid var(--border); border-left: 3px solid var(--accent);
  border-radius: 0 10px 10px 0; padding: 16px 20px; margin: 26px 0;
  background: var(--bg-soft);
}
.note strong { display: block; margin-bottom: 4px; }
.note p { margin: 0; color: var(--text-muted); font-size: 15px; }

/* --------------------------------------------------------------- mobile */
@media (max-width: 1180px) {
  .layout { grid-template-columns: var(--sidebar) minmax(0, 1fr); }
  .toc { display: none; }
}
@media (max-width: 860px) {
  #nav-toggle { display: inline-flex; }
  .layout { grid-template-columns: minmax(0, 1fr); padding: 0 18px; }
  .sidebar {
    display: none; position: fixed; inset: 60px 0 auto 0; z-index: 35;
    max-height: calc(100vh - 60px); padding: 20px;
    background: var(--bg); border-bottom: 1px solid var(--border);
  }
  .sidebar.open { display: block; }
  .page-header h1 { font-size: 32px; }
  .hero h1 { font-size: 34px; }
}

/* Syntax highlighting, themed from the same variables as everything else. */
.hljs-comment, .hljs-quote { color: var(--text-muted); font-style: italic; }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-type { color: #C084FC; }
.hljs-string, .hljs-meta .hljs-string { color: #34D399; }
.hljs-number, .hljs-symbol { color: #FBBF24; }
.hljs-title, .hljs-title.function_, .hljs-section { color: #60A5FA; }
.hljs-attr, .hljs-attribute, .hljs-variable, .hljs-template-variable { color: #38BDF8; }
.hljs-built_in, .hljs-class .hljs-title { color: #2DD4BF; }
.hljs-meta, .hljs-deletion { color: var(--text-muted); }
:root:not([data-theme="dark"]) .hljs-keyword { color: #7C3AED; }
:root:not([data-theme="dark"]) .hljs-string { color: #047857; }
:root:not([data-theme="dark"]) .hljs-number { color: #B45309; }
:root:not([data-theme="dark"]) .hljs-title { color: #1D4ED8; }
:root:not([data-theme="dark"]) .hljs-built_in { color: #0F766E; }
`;
