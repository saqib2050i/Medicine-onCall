/*!
 * minifuzz — a tiny, dependency-free fuzzy search, vendored locally so the
 * site works offline and behind the tunnel with no CDN. MIT licensed as part
 * of this repository. API loosely modelled on Fuse.js:
 *
 *   minifuzz.search(items, query, { keys: [{ name, weight }], limit })
 *     -> [{ item, score }] sorted best-first
 */
(function (global) {
  'use strict';

  function normalize(s) {
    return (s == null ? '' : String(s))
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '');
  }

  function getValue(item, name) {
    if (name == null) return item;
    var v = item;
    var parts = String(name).split('.');
    for (var i = 0; i < parts.length && v != null; i++) v = v[parts[i]];
    if (Array.isArray(v)) return v.join(' ');
    return v;
  }

  // Score one query token against one normalized string. Higher is better;
  // null means no match.
  function scoreToken(token, text) {
    if (!token || !text) return null;
    var idx = text.indexOf(token);
    if (idx !== -1) {
      var score = 100;
      if (idx === 0) score += 40; // starts the field
      else if (/[^a-z0-9]/.test(text.charAt(idx - 1))) score += 25; // word start
      score -= Math.min(idx, 30) / 3; // earlier is better
      score += Math.max(0, 15 - (text.length - token.length) / 20); // tighter field
      return score;
    }
    // Subsequence match with gap penalties (catches typo-ish queries like "hyprkal")
    var pos = 0, gaps = 0, run = 1, bestRun = 0;
    for (var i = 0; i < token.length; i++) {
      var found = text.indexOf(token.charAt(i), pos);
      if (found === -1) return null;
      if (i > 0) {
        if (found === pos) { run += 1; } else { gaps += found - pos; run = 1; }
      }
      if (run > bestRun) bestRun = run;
      pos = found + 1;
    }
    var s = 35 + bestRun * 5 - Math.min(gaps, 40) - Math.min(text.length / 40, 10);
    return s > 1 ? s : 1;
  }

  function search(items, query, opts) {
    opts = opts || {};
    var keys = opts.keys && opts.keys.length ? opts.keys : [{ name: null, weight: 1 }];
    var limit = opts.limit || 50;
    var tokens = normalize(query).split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];

    // Pre-normalize fields once per item.
    var results = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      var fields = [];
      for (var k = 0; k < keys.length; k++) {
        fields.push({
          weight: keys[k].weight || 1,
          text: normalize(getValue(item, keys[k].name)),
        });
      }
      var total = 0;
      var allTokensMatched = true;
      for (var t = 0; t < tokens.length; t++) {
        var best = null;
        for (var f = 0; f < fields.length; f++) {
          var s = scoreToken(tokens[t], fields[f].text);
          if (s != null) {
            s *= fields[f].weight;
            if (best == null || s > best) best = s;
          }
        }
        if (best == null) { allTokensMatched = false; break; }
        total += best;
      }
      if (allTokensMatched) results.push({ item: item, score: total });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, limit);
  }

  var api = { search: search, normalize: normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.minifuzz = api;
})(typeof window !== 'undefined' ? window : this);
