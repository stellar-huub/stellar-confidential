/**
 * The page's runtime script, inlined into every page.
 *
 * Four small jobs: theme, mobile nav, table-of-contents scrollspy, and search.
 * It is deliberately dependency-free and inlined — a documentation site should
 * render and be navigable without fetching anything from a third party, and
 * without a build artefact that can go missing.
 */
export const CLIENT_SCRIPT = String.raw`
(function () {
  var root = document.documentElement;

  // -------------------------------------------------------------- theme
  // The stored choice is applied by a blocking snippet in <head>, before first
  // paint, so the page never flashes the wrong theme. This only handles toggling.
  var toggle = document.getElementById('theme-toggle');
  function current() {
    return root.getAttribute('data-theme') ||
      (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  }
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) { /* private mode */ }
    });
  }

  // --------------------------------------------------------- mobile nav
  var navToggle = document.getElementById('nav-toggle');
  var sidebar = document.querySelector('.sidebar');
  if (navToggle && sidebar) {
    navToggle.addEventListener('click', function () { sidebar.classList.toggle('open'); });
  }

  // ---------------------------------------------------------- scrollspy
  var links = Array.prototype.slice.call(document.querySelectorAll('.toc a'));
  if (links.length) {
    var targets = links
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);

    var spy = function () {
      var best = 0;
      for (var i = 0; i < targets.length; i++) {
        if (targets[i].getBoundingClientRect().top <= 96) best = i;
      }
      links.forEach(function (a, i) { a.classList.toggle('active', i === best); });
    };
    var queued = false;
    window.addEventListener('scroll', function () {
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () { spy(); queued = false; });
    }, { passive: true });
    spy();
  }

  // ------------------------------------------------------------- search
  var input = document.getElementById('search');
  var results = document.getElementById('search-results');
  if (!input || !results) return;

  var index = null;
  var loading = false;
  function load() {
    if (index || loading) return;
    loading = true;
    fetch(BASE + 'search-index.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { index = data; loading = false; render(input.value); })
      .catch(function () { loading = false; });
  }
  input.addEventListener('focus', load);

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(query) {
    var q = query.trim().toLowerCase();
    if (q.length < 2) { results.classList.remove('open'); results.innerHTML = ''; return; }
    if (!index) { load(); return; }

    var hits = [];
    for (var i = 0; i < index.length && hits.length < 12; i++) {
      var entry = index[i];
      var haystack = entry.t.toLowerCase();
      var at = haystack.indexOf(q);
      // A title match is worth more than a body match, so it sorts first.
      var titleHit = entry.n.toLowerCase().indexOf(q) !== -1;
      if (at === -1 && !titleHit) continue;
      var context = at === -1 ? entry.s :
        entry.t.slice(Math.max(0, at - 45), Math.min(entry.t.length, at + 75));
      hits.push({ entry: entry, score: titleHit ? 0 : 1, context: context });
    }
    hits.sort(function (a, b) { return a.score - b.score; });

    if (!hits.length) {
      results.innerHTML = '<div class="empty">No matches for &ldquo;' + escapeHtml(query) + '&rdquo;</div>';
      results.classList.add('open');
      return;
    }

    results.innerHTML = hits.map(function (h) {
      return '<a href="' + BASE + h.entry.u + '">' +
        '<div class="r-title">' + escapeHtml(h.entry.n) + '</div>' +
        '<div class="r-context">' + escapeHtml(h.context.trim()) + '&hellip;</div></a>';
    }).join('');
    results.classList.add('open');
  }

  input.addEventListener('input', function () { render(input.value); });
  input.addEventListener('keydown', function (event) {
    var open = results.querySelectorAll('a');
    if (event.key === 'Escape') { results.classList.remove('open'); input.blur(); return; }
    if (event.key === 'Enter' && open.length) { window.location.href = open[0].getAttribute('href'); }
  });
  document.addEventListener('click', function (event) {
    if (!results.contains(event.target) && event.target !== input) results.classList.remove('open');
  });

  // "/" focuses search, the convention every docs site shares.
  document.addEventListener('keydown', function (event) {
    if (event.key === '/' && document.activeElement !== input) {
      event.preventDefault();
      input.focus();
    }
  });
})();
`;

/**
 * Applied before first paint so a dark-mode reader never sees a white flash.
 * Wrapped in try/catch because storage throws outright in some privacy modes.
 */
export const THEME_BOOTSTRAP = String.raw`
try {
  var stored = localStorage.getItem('theme');
  if (stored === 'dark' || stored === 'light') {
    document.documentElement.setAttribute('data-theme', stored);
  }
} catch (e) {}
`;
