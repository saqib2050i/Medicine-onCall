/* app.js — router, views, navigation tree, command palette, theme, SW. */
(function () {
  'use strict';

  var R = window.OnCallRender;
  var esc = R.esc;

  var App = {
    manifest: null,
    topicCache: {},
    view: document.getElementById('view')
  };
  window.OnCallApp = App;

  var SEV_ORDER = { high: 0, medium: 1, low: 2 };

  // ---------------------------------------------------------------- theme
  var themeToggle = document.getElementById('theme-toggle');
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeToggle.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    themeToggle.innerHTML = theme === 'dark' ? '&#9788;' : '&#9789;';
    themeToggle.title = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  }
  (function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem('oncall-theme'); } catch (e) {}
    var theme = saved || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(theme);
  })();
  themeToggle.addEventListener('click', function () {
    var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('oncall-theme', next); } catch (e) {}
    applyTheme(next);
  });

  // ---------------------------------------------------------------- data
  function loadManifest() {
    return fetch('/manifest.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('manifest HTTP ' + r.status); return r.json(); })
      .then(function (m) { App.manifest = m; return m; });
  }

  function loadTopic(id) {
    if (App.topicCache[id]) return Promise.resolve(App.topicCache[id]);
    return fetch('/content/' + encodeURIComponent(id) + '.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('topic HTTP ' + r.status); return r.json(); })
      .then(function (t) { App.topicCache[id] = t; return t; });
  }

  // ---------------------------------------------------------------- router
  function navigate(path, replace) {
    if (replace) history.replaceState(null, '', path);
    else history.pushState(null, '', path);
    route();
  }
  App.navigate = navigate;

  document.addEventListener('click', function (e) {
    var a = e.target.closest ? e.target.closest('a[data-link]') : null;
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    closeDrawer();
    navigate(a.getAttribute('href'));
  });
  window.addEventListener('popstate', route);

  function setView(html, focusHeading) {
    App.view.innerHTML = html;
    window.scrollTo(0, 0);
    if (focusHeading !== false) App.view.focus({ preventScroll: true });
  }

  function route() {
    var path = location.pathname.replace(/\/+$/, '') || '/';
    document.body.classList.remove('is-topic-page');
    var mTopic = path.match(/^\/topic\/([a-z0-9-]+)$/);
    var mCat = path.match(/^\/category\/([^/]+)$/);
    if (path === '/') renderHome();
    else if (mTopic) renderTopic(mTopic[1]);
    else if (mCat) renderCategory(decodeURIComponent(mCat[1]));
    else if (path === '/ingest') window.OnCallIngest.render(App);
    else renderNotFound(path);
  }

  // ---------------------------------------------------------------- helpers
  function catSlug(name) { return encodeURIComponent(name); }

  function topicCard(t) {
    return '<a class="topic-card sev-border--' + esc(t.severity) + '" data-link href="/topic/' + esc(t.id) + '">' +
      '<div class="topic-card-row"><span class="topic-card-title">' + esc(t.title) + '</span>' +
      R.severityBadge(t.severity) + '</div>' +
      '<span class="topic-card-summary">' + esc(t.summary) + '</span>' +
      '<span class="topic-card-meta">' + esc(t.category) +
      (t.lastUpdated ? ' &middot; updated ' + esc(t.lastUpdated) : '') + '</span></a>';
  }

  function groupByCategory(topics) {
    var cats = {};
    topics.forEach(function (t) {
      (cats[t.category] = cats[t.category] || []).push(t);
    });
    return Object.keys(cats).sort().map(function (name) {
      var ts = cats[name].slice().sort(function (a, b) {
        return (SEV_ORDER[a.severity] - SEV_ORDER[b.severity]) || a.title.localeCompare(b.title);
      });
      return { name: name, topics: ts };
    });
  }

  // ---------------------------------------------------------------- views
  function renderHome() {
    var m = App.manifest;
    if (!m) return;
    var topics = m.topics;
    var high = topics.filter(function (t) { return t.severity === 'high'; });
    var recent = topics.slice().sort(function (a, b) {
      return String(b.lastUpdated || '').localeCompare(String(a.lastUpdated || ''));
    }).slice(0, 5);
    var cats = groupByCategory(topics);

    var html =
      '<div class="home">' +
      '<section class="hero">' +
      '<h1 class="hero-title">On-call emergency guidelines</h1>' +
      '<p class="hero-sub">Fast, structured reference for the medical registrar. ' + topics.length + ' topics.</p>' +
      '<button type="button" class="home-search" id="home-search" aria-label="Search all topics">' +
      '<span class="home-search-icon" aria-hidden="true">&#128269;</span>' +
      '<span class="home-search-hint">Search topics, tags, drugs&hellip;</span>' +
      '<kbd class="kbd">&#8984;K</kbd></button>' +
      '</section>' +

      (high.length ?
        '<section class="home-section" aria-labelledby="hh"><h2 id="hh" class="home-h">&#9873; High acuity — quick access</h2>' +
        '<div class="chip-row">' + high.map(function (t) {
          return '<a class="chip chip--high" data-link href="/topic/' + esc(t.id) + '">' + esc(t.title) + '</a>';
        }).join('') + '</div></section>' : '') +

      '<section class="home-section" aria-labelledby="ch"><h2 id="ch" class="home-h">Browse by category</h2>' +
      '<div class="tile-grid">' + cats.map(function (c) {
        var sevDots = c.topics.map(function (t) {
          return '<span class="sev-dot sev-dot--' + esc(t.severity) + '" aria-hidden="true"></span>';
        }).join('');
        return '<a class="tile" data-link href="/category/' + catSlug(c.name) + '">' +
          '<span class="tile-name">' + esc(c.name) + '</span>' +
          '<span class="tile-count">' + c.topics.length + ' topic' + (c.topics.length === 1 ? '' : 's') + '</span>' +
          '<span class="tile-dots">' + sevDots + '</span></a>';
      }).join('') + '</div></section>' +

      '<section class="home-section" aria-labelledby="rh"><h2 id="rh" class="home-h">Recently updated</h2>' +
      '<div class="card-list">' + recent.map(topicCard).join('') + '</div></section>' +
      '</div>';
    setView(html);
    document.getElementById('home-search').addEventListener('click', function () { openPalette(); });
  }

  function renderCategory(name) {
    var m = App.manifest;
    var topics = m.topics.filter(function (t) { return t.category === name; });
    if (!topics.length) return renderNotFound('/category/' + name);
    var subs = {};
    var noSub = [];
    topics.forEach(function (t) {
      if (t.subcategory) (subs[t.subcategory] = subs[t.subcategory] || []).push(t);
      else noSub.push(t);
    });
    var html = '<div class="category-page">' +
      '<nav class="breadcrumbs" aria-label="Breadcrumb"><a data-link href="/">Home</a> &rsaquo; <span>' + esc(name) + '</span></nav>' +
      '<h1>' + esc(name) + '</h1>';
    if (noSub.length) html += '<div class="card-list">' + noSub.map(topicCard).join('') + '</div>';
    Object.keys(subs).sort().forEach(function (s) {
      html += '<h2 class="subcat-h">' + esc(s) + '</h2><div class="card-list">' +
        subs[s].map(topicCard).join('') + '</div>';
    });
    html += '</div>';
    setView(html);
  }

  function renderTopic(id) {
    setView('<div class="loading" role="status">Loading&hellip;</div>', false);
    loadTopic(id).then(function (topic) {
      document.body.classList.add('is-topic-page');
      document.title = topic.title + ' — OnCall';
      var meta = (App.manifest && App.manifest.topics.filter(function (t) { return t.id === id; })[0]) || topic;
      setView(
        '<article class="topic-page">' +
        '<nav class="breadcrumbs" aria-label="Breadcrumb"><a data-link href="/">Home</a> &rsaquo; ' +
        '<a data-link href="/category/' + catSlug(meta.category) + '">' + esc(meta.category) + '</a> &rsaquo; ' +
        '<span>' + esc(topic.title) + '</span></nav>' +
        R.renderTopicHeader(topic) +
        R.renderTopicBody(topic) +
        '</article>');
    }).catch(function () {
      renderNotFound('/topic/' + id);
    });
  }

  function renderNotFound(path) {
    document.title = 'Not found — OnCall';
    setView('<div class="notfound"><h1>Not found</h1>' +
      '<p><code>' + esc(path) + '</code> doesn&rsquo;t match any page or topic. ' +
      'It may not be indexed yet — new content appears after a container restart.</p>' +
      '<p><a class="btn" data-link href="/">Back to home</a></p></div>');
  }

  // ---------------------------------------------------------------- nav drawer
  var drawer = document.getElementById('nav-drawer');
  var backdrop = document.getElementById('drawer-backdrop');
  var navToggle = document.getElementById('nav-toggle');

  function buildNav() {
    var cats = groupByCategory(App.manifest.topics);
    var html = '<div class="drawer-head">Browse topics</div>' + cats.map(function (c) {
      var subs = {};
      var noSub = [];
      c.topics.forEach(function (t) {
        if (t.subcategory) (subs[t.subcategory] = subs[t.subcategory] || []).push(t);
        else noSub.push(t);
      });
      function link(t) {
        return '<li><a data-link href="/topic/' + esc(t.id) + '">' +
          '<span class="sev-dot sev-dot--' + esc(t.severity) + '" aria-hidden="true"></span>' +
          esc(t.title) + '</a></li>';
      }
      var inner = '';
      if (noSub.length) inner += '<ul class="nav-topics">' + noSub.map(link).join('') + '</ul>';
      Object.keys(subs).sort().forEach(function (s) {
        inner += '<details class="nav-sub" open><summary>' + esc(s) + '</summary>' +
          '<ul class="nav-topics">' + subs[s].map(link).join('') + '</ul></details>';
      });
      return '<details class="nav-cat" open><summary>' + esc(c.name) +
        '<span class="nav-count">' + c.topics.length + '</span></summary>' + inner + '</details>';
    }).join('');
    html += '<div class="drawer-foot"><a data-link href="/ingest" class="drawer-ingest">&#43; Add content (/ingest)</a></div>';
    drawer.innerHTML = html;
  }

  function openDrawer() {
    drawer.classList.add('open');
    backdrop.hidden = false;
    navToggle.setAttribute('aria-expanded', 'true');
  }
  function closeDrawer() {
    drawer.classList.remove('open');
    backdrop.hidden = true;
    navToggle.setAttribute('aria-expanded', 'false');
  }
  navToggle.addEventListener('click', function () {
    drawer.classList.contains('open') ? closeDrawer() : openDrawer();
  });
  backdrop.addEventListener('click', closeDrawer);

  // ---------------------------------------------------------------- palette
  var palette = document.getElementById('palette');
  var paletteInput = document.getElementById('palette-input');
  var paletteResults = document.getElementById('palette-results');
  var paletteSel = 0;
  var lastFocus = null;

  function openPalette(prefill) {
    lastFocus = document.activeElement;
    palette.hidden = false;
    document.body.classList.add('palette-open');
    paletteInput.value = prefill || '';
    paletteInput.focus();
    runSearch();
  }
  function closePalette() {
    palette.hidden = true;
    document.body.classList.remove('palette-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  App.openPalette = openPalette;

  function runSearch() {
    var q = paletteInput.value.trim();
    paletteSel = 0;
    if (!App.manifest) { paletteResults.innerHTML = ''; return; }
    var items;
    if (!q) {
      items = App.manifest.topics.slice()
        .sort(function (a, b) { return SEV_ORDER[a.severity] - SEV_ORDER[b.severity] || a.title.localeCompare(b.title); })
        .slice(0, 8);
    } else {
      items = window.minifuzz.search(App.manifest.topics, q, {
        keys: [
          { name: 'title', weight: 3 },
          { name: 'tags', weight: 2 },
          { name: 'summary', weight: 1.5 },
          { name: 'searchText', weight: 1 }
        ],
        limit: 12
      }).map(function (r) { return r.item; });
    }
    if (!items.length) {
      paletteResults.innerHTML = '<li class="palette-empty" aria-disabled="true">No matches for &ldquo;' + esc(q) + '&rdquo;</li>';
      return;
    }
    paletteResults.innerHTML = items.map(function (t, i) {
      return '<li id="pal-opt-' + i + '" role="option" aria-selected="' + (i === paletteSel) + '"' +
        ' class="palette-item' + (i === paletteSel ? ' selected' : '') + '" data-id="' + esc(t.id) + '">' +
        '<span class="sev-dot sev-dot--' + esc(t.severity) + '" aria-hidden="true"></span>' +
        '<span class="palette-item-main"><span class="palette-item-title">' + esc(t.title) + '</span>' +
        '<span class="palette-item-sub">' + esc(t.category) + (t.subcategory ? ' &rsaquo; ' + esc(t.subcategory) : '') + '</span></span>' +
        '</li>';
    }).join('');
    paletteInput.setAttribute('aria-activedescendant', 'pal-opt-' + paletteSel);
  }

  function moveSel(delta) {
    var opts = paletteResults.querySelectorAll('.palette-item');
    if (!opts.length) return;
    paletteSel = (paletteSel + delta + opts.length) % opts.length;
    opts.forEach(function (el, i) {
      el.classList.toggle('selected', i === paletteSel);
      el.setAttribute('aria-selected', String(i === paletteSel));
    });
    opts[paletteSel].scrollIntoView({ block: 'nearest' });
    paletteInput.setAttribute('aria-activedescendant', 'pal-opt-' + paletteSel);
  }

  function chooseSel() {
    var opts = paletteResults.querySelectorAll('.palette-item');
    if (!opts.length) return;
    var id = opts[paletteSel].getAttribute('data-id');
    closePalette();
    navigate('/topic/' + id);
  }

  paletteInput.addEventListener('input', runSearch);
  paletteInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSel(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSel(-1); }
    else if (e.key === 'Enter') { e.preventDefault(); chooseSel(); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  });
  paletteResults.addEventListener('click', function (e) {
    var li = e.target.closest ? e.target.closest('.palette-item') : null;
    if (!li) return;
    closePalette();
    navigate('/topic/' + li.getAttribute('data-id'));
  });
  palette.addEventListener('click', function (e) { if (e.target === palette) closePalette(); });

  document.getElementById('search-trigger').addEventListener('click', function () { openPalette(); });
  document.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      palette.hidden ? openPalette() : closePalette();
    } else if (e.key === 'Escape' && !palette.hidden) {
      closePalette();
    } else if (e.key === '/' && palette.hidden &&
               !/^(input|textarea|select)$/i.test(document.activeElement.tagName) &&
               !document.activeElement.isContentEditable) {
      e.preventDefault();
      openPalette();
    }
  });

  // ---------------------------------------------------------------- boot
  loadManifest().then(function () {
    buildNav();
    route();
  }).catch(function (e) {
    setView('<div class="notfound"><h1>Content unavailable</h1>' +
      '<p>Could not load <code>manifest.json</code> (' + esc(e.message) + '). ' +
      'If you are offline, previously viewed topics may still work from the cache once the manifest loads.</p></div>');
  });

  if ('serviceWorker' in navigator &&
      (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').catch(function () { /* offline support unavailable */ });
    });
  }
})();
