/* login.js — public (unauthenticated) helper for the login page. Kept as an
 * external file so the site's Content-Security-Policy can forbid inline JS
 * (script-src 'self'). Handles error messages, carries the "next" path, and
 * purges the offline cache on logout. */
(function () {
  'use strict';
  var params = new URLSearchParams(location.search);
  var box = document.getElementById('error');

  var err = params.get('error');
  if (err === 'locked') {
    box.textContent = 'Too many attempts. Please wait a few minutes and try again.';
    box.hidden = false;
  } else if (err) {
    box.textContent = 'Incorrect username or password.';
    box.hidden = false;
  }

  // Post-login redirect target: an explicit ?next wins; otherwise, because the
  // login page is now served in place at the requested URL, use the current
  // path so a deep link returns you where you were. Sanitised to a same-site
  // path so it cannot become an open redirect.
  var nxt = params.get('next');
  if (!nxt) {
    var p = location.pathname;
    nxt = (p && p !== '/login') ? p + location.search : '/';
  }
  if (!/^\/(?![\/\\])/.test(nxt)) nxt = '/';   // same-site path only (blocks // and /\)
  document.getElementById('next').value = nxt;

  // On logout, purge the offline cache + service worker so previously viewed
  // topics are not readable after signing out.
  if (params.get('loggedout') === '1') {
    box.textContent = 'You have been signed out.';
    box.style.background = 'transparent';
    box.hidden = false;
    if (window.caches && caches.keys) {
      caches.keys().then(function (ks) { ks.forEach(function (k) { caches.delete(k); }); });
    }
    if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
      navigator.serviceWorker.getRegistrations().then(function (rs) {
        rs.forEach(function (r) { r.unregister(); });
      });
    }
  }
})();
