/* Service worker: app shell cached up-front (cache-first); manifest.json and
 * topic JSON network-first with cache fallback, so previously viewed topics
 * keep working offline while fresh content wins when online. */
'use strict';

var CACHE = 'oncall-v2';
var SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/render.js',
  '/js/validate.js',
  '/js/ingest.js',
  '/vendor/minifuzz.js',
  '/icons/icon.svg',
  '/app.webmanifest'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(SHELL.map(function (url) {
        return cache.add(url).catch(function () { /* tolerate individual misses */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) {
        return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

function networkFirst(req) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req).then(function (hit) {
      return hit || new Response('Offline and not cached', { status: 503, statusText: 'Offline' });
    });
  });
}

function cacheFirst(req) {
  return caches.match(req).then(function (hit) {
    if (hit) return hit;
    return fetch(req).then(function (res) {
      if (res && res.ok) {
        var copy = res.clone();
        caches.open(CACHE).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  // Never intercept the public auth surface — let it hit the network directly
  // so login, logout and the auth check always reflect real session state.
  if (url.pathname === '/login' || url.pathname === '/login.js' ||
      url.pathname.indexOf('/auth/') === 0) {
    return;
  }

  if (req.mode === 'navigate') {
    // SPA shell, but only when the session is valid. When logged out the origin
    // serves the login page in place (marked with X-OnCall-Login) — show it, but
    // never cache it as the app shell. On error, fall back to any cached shell.
    e.respondWith(
      fetch('/index.html').then(function (res) {
        if (res.headers.get('X-OnCall-Login')) return res;   // logged out: login page, don't cache
        if (res.ok && !res.redirected) {
          var copy = res.clone();
          caches.open(CACHE).then(function (cache) { cache.put('/index.html', copy); });
          return res;
        }
        return caches.match('/index.html').then(function (hit) { return hit || res; });
      }).catch(function () {
        return caches.match('/index.html');
      })
    );
    return;
  }

  if (url.pathname === '/manifest.json' || url.pathname.indexOf('/content/') === 0) {
    e.respondWith(networkFirst(req));
    return;
  }

  e.respondWith(cacheFirst(req));
});
