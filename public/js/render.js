/* render.js — turns a topic object into DOM. Every block type degrades
 * gracefully: unknown types render a labelled raw-JSON fallback. */
(function (global) {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var CALLOUT_ICONS = {
    'red-flag': '&#9873;',   // flag
    'warning': '&#9888;',    // warning sign
    'pearl': '&#10022;',     // sparkle
    'info': '&#9432;'        // info
  };
  var CALLOUT_LABELS = { 'red-flag': 'Red flag', warning: 'Warning', pearl: 'Pearl', info: 'Info' };

  var blockRenderers = {
    heading: function (b) {
      return '<h2 class="blk-heading">' + esc(b.text) + '</h2>';
    },
    paragraph: function (b) {
      return '<p class="blk-paragraph">' + esc(b.text) + '</p>';
    },
    bullets: function (b) {
      return '<ul class="blk-bullets">' +
        (b.items || []).map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') +
        '</ul>';
    },
    numbered: function (b) {
      return '<ol class="blk-numbered">' +
        (b.items || []).map(function (i) { return '<li>' + esc(i) + '</li>'; }).join('') +
        '</ol>';
    },
    callout: function (b) {
      var variant = CALLOUT_ICONS.hasOwnProperty(b.variant) ? b.variant : 'info';
      return '<section class="callout callout--' + variant + '" role="note" aria-label="' +
        esc(CALLOUT_LABELS[variant]) + ': ' + esc(b.title) + '">' +
        '<div class="callout-head"><span class="callout-icon" aria-hidden="true">' +
        CALLOUT_ICONS[variant] + '</span><span class="callout-title">' + esc(b.title) + '</span></div>' +
        '<div class="callout-body">' + esc(b.body) + '</div>' +
        '</section>';
    },
    education: function (b) {
      return '<section class="education"><div class="education-label">Teaching point</div>' +
        '<h3 class="education-title">' + esc(b.title) + '</h3>' +
        '<p class="education-body">' + esc(b.body) + '</p></section>';
    },
    flowsheet: function (b) {
      var steps = (b.steps || []).map(function (s, i) {
        return '<li class="fs-step">' +
          '<div class="fs-num" aria-hidden="true">' + (i + 1) + '</div>' +
          '<div class="fs-body">' +
          '<div class="fs-title">' + esc(s.step) + '</div>' +
          (s.detail ? '<div class="fs-detail">' + esc(s.detail) + '</div>' : '') +
          (s.branch ? '<div class="fs-branch"><span class="fs-branch-icon" aria-hidden="true">&#8618;</span> ' + esc(s.branch) + '</div>' : '') +
          '</div></li>';
      }).join('');
      return '<section class="flowsheet">' +
        (b.title ? '<h3 class="flowsheet-title">' + esc(b.title) + '</h3>' : '') +
        '<ol class="fs-steps">' + steps + '</ol></section>';
    },
    table: function (b) {
      var head = '<tr>' + (b.headers || []).map(function (h) {
        return '<th scope="col">' + esc(h) + '</th>';
      }).join('') + '</tr>';
      var rows = (b.rows || []).map(function (r) {
        return '<tr>' + (r || []).map(function (c) { return '<td>' + esc(c) + '</td>'; }).join('') + '</tr>';
      }).join('');
      return '<div class="table-wrap"><table class="blk-table"><thead>' + head +
        '</thead><tbody>' + rows + '</tbody></table></div>';
    },
    references: function (b) {
      return '<section class="references"><h3 class="references-title">References</h3><ul class="references-list">' +
        (b.items || []).map(function (r) {
          return '<li><a href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' +
            esc(r.label) + '<span class="ext-icon" aria-hidden="true">&#8599;</span></a>' +
            '<span class="ref-url">' + esc(r.url) + '</span></li>';
        }).join('') + '</ul></section>';
    },
    html: function (b) {
      // Escape hatch: raw HTML from the content author (trusted content only).
      return '<div class="blk-html">' + (b.html || '') + '</div>';
    }
  };

  function renderBlock(b) {
    if (!b || typeof b !== 'object' || !b.type || !blockRenderers[b.type]) {
      return '<details class="blk-unknown"><summary>Unsupported block' +
        (b && b.type ? ': <code>' + esc(b.type) + '</code>' : '') +
        ' (shown as raw data)</summary><pre>' + esc(JSON.stringify(b, null, 2)) + '</pre></details>';
    }
    try {
      return blockRenderers[b.type](b);
    } catch (e) {
      return '<details class="blk-unknown"><summary>Block failed to render: <code>' +
        esc(b.type) + '</code></summary><pre>' + esc(String(e)) + '</pre></details>';
    }
  }

  /** Full topic page body (header handled separately so it can be sticky). */
  function renderTopicBody(topic) {
    var html = (topic.blocks || []).map(renderBlock).join('');
    var meta = '';
    if (topic.sources && topic.sources.length) {
      meta += '<section class="topic-sources"><h3>Sources</h3><ul>' +
        topic.sources.map(function (s) {
          return '<li><a href="' + esc(s.url) + '" target="_blank" rel="noopener noreferrer">' +
            esc(s.label) + '<span class="ext-icon" aria-hidden="true">&#8599;</span></a></li>';
        }).join('') + '</ul></section>';
    }
    meta += '<p class="topic-disclaimer">Decision-support / educational aid only — not a substitute for ' +
      'clinical judgement or local policy. Verify all doses and steps against current local and national ' +
      'guidelines before acting.</p>';
    return '<div class="topic-blocks">' + html + meta + '</div>';
  }

  function severityBadge(sev) {
    var label = { high: 'High acuity', medium: 'Medium acuity', low: 'Low acuity' }[sev] || esc(sev);
    return '<span class="sev-badge sev-badge--' + esc(sev) + '">' + label + '</span>';
  }

  function renderTopicHeader(topic, opts) {
    opts = opts || {};
    return '<div class="topic-head sev-border--' + esc(topic.severity) + '">' +
      '<div class="topic-head-row">' +
      '<h1 class="topic-title">' + esc(topic.title) + '</h1>' +
      severityBadge(topic.severity) +
      (opts.printButton === false ? '' :
        '<button type="button" class="btn btn-ghost print-btn" onclick="window.print()" aria-label="Print this topic">&#128424; Print</button>') +
      '</div>' +
      '<p class="topic-summary">' + esc(topic.summary) + '</p>' +
      '<div class="topic-meta">' +
      '<span class="topic-crumb">' + esc(topic.category) +
      (topic.subcategory ? ' &rsaquo; ' + esc(topic.subcategory) : '') + '</span>' +
      (topic.lastUpdated ? '<span class="topic-updated">Updated ' + esc(topic.lastUpdated) + '</span>' : '') +
      '</div></div>';
  }

  global.OnCallRender = {
    esc: esc,
    renderBlock: renderBlock,
    renderTopicBody: renderTopicBody,
    renderTopicHeader: renderTopicHeader,
    severityBadge: severityBadge
  };
})(window);
