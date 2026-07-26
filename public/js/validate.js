/* validate.js — client-side topic schema validator, shared by the /ingest
 * page. Mirrors the checks in scripts/build-index.py: anything this passes
 * will be indexed by the build script. */
(function (global) {
  'use strict';

  var SEVERITIES = ['high', 'medium', 'low'];
  var ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  var CALLOUT_VARIANTS = ['red-flag', 'warning', 'pearl', 'info'];
  var KNOWN_BLOCKS = ['heading', 'paragraph', 'bullets', 'numbered', 'callout',
    'flowsheet', 'table', 'education', 'references', 'html'];

  function isStr(v) { return typeof v === 'string'; }
  function isStrArray(v) { return Array.isArray(v) && v.every(isStr); }

  function validateBlock(b, i, errors, warnings) {
    var at = 'blocks[' + i + ']';
    if (typeof b !== 'object' || b === null || Array.isArray(b)) {
      errors.push(at + ': must be an object with a "type"'); return;
    }
    if (!isStr(b.type)) { errors.push(at + ': missing string "type"'); return; }
    at += ' (' + b.type + ')';
    switch (b.type) {
      case 'heading':
      case 'paragraph':
        if (!isStr(b.text)) errors.push(at + ': requires string "text"');
        break;
      case 'bullets':
      case 'numbered':
        if (!isStrArray(b.items)) errors.push(at + ': requires "items" as an array of strings');
        break;
      case 'callout':
        if (CALLOUT_VARIANTS.indexOf(b.variant) === -1)
          errors.push(at + ': "variant" must be one of ' + CALLOUT_VARIANTS.join(', '));
        if (!isStr(b.title)) errors.push(at + ': requires string "title"');
        if (!isStr(b.body)) errors.push(at + ': requires string "body"');
        break;
      case 'education':
        if (!isStr(b.title)) errors.push(at + ': requires string "title"');
        if (!isStr(b.body)) errors.push(at + ': requires string "body"');
        break;
      case 'flowsheet':
        if (!Array.isArray(b.steps) || !b.steps.length) {
          errors.push(at + ': requires non-empty "steps" array');
        } else {
          b.steps.forEach(function (s, j) {
            if (typeof s !== 'object' || s === null || !isStr(s.step))
              errors.push(at + ': steps[' + j + '] requires string "step"');
            else {
              if (s.detail != null && !isStr(s.detail)) errors.push(at + ': steps[' + j + '].detail must be a string');
              if (s.branch != null && !isStr(s.branch)) errors.push(at + ': steps[' + j + '].branch must be a string or null');
            }
          });
        }
        break;
      case 'table':
        if (!isStrArray(b.headers) || !b.headers.length)
          errors.push(at + ': requires "headers" as a non-empty array of strings');
        if (!Array.isArray(b.rows) || !b.rows.every(function (r) { return isStrArray(r); }))
          errors.push(at + ': requires "rows" as an array of string arrays');
        else if (isStrArray(b.headers) && b.rows.some(function (r) { return r.length !== b.headers.length; }))
          warnings.push(at + ': some rows have a different length than "headers"');
        break;
      case 'references':
        if (!Array.isArray(b.items) || !b.items.length)
          errors.push(at + ': requires non-empty "items" array');
        else b.items.forEach(function (r, j) {
          if (typeof r !== 'object' || r === null || !isStr(r.label) || !isStr(r.url))
            errors.push(at + ': items[' + j + '] requires "label" and "url" strings');
        });
        break;
      case 'html':
        if (!isStr(b.html)) errors.push(at + ': requires string "html"');
        else warnings.push(at + ': raw HTML is rendered as-is — only use content you trust');
        break;
      default:
        warnings.push(at + ': unknown block type — it will render as a raw-JSON fallback, not crash');
    }
  }

  /** @returns {{valid: boolean, errors: string[], warnings: string[]}} */
  function validateTopic(topic) {
    var errors = [];
    var warnings = [];

    if (typeof topic !== 'object' || topic === null || Array.isArray(topic)) {
      return { valid: false, errors: ['Top level must be a JSON object'], warnings: [] };
    }

    [['id', isStr], ['title', isStr], ['category', isStr],
     ['severity', isStr], ['summary', isStr]].forEach(function (pair) {
      if (topic[pair[0]] == null) errors.push('Missing required key "' + pair[0] + '"');
      else if (!pair[1](topic[pair[0]])) errors.push('"' + pair[0] + '" must be a string');
    });
    if (!Array.isArray(topic.blocks)) errors.push('Missing required key "blocks" (array)');
    else if (!topic.blocks.length) errors.push('"blocks" must not be empty');

    if (isStr(topic.id) && !ID_RE.test(topic.id))
      errors.push('"id" must be a lowercase-hyphen slug (e.g. "acute-pulmonary-oedema")');
    if (isStr(topic.severity) && SEVERITIES.indexOf(topic.severity) === -1)
      errors.push('"severity" must be one of: ' + SEVERITIES.join(', '));
    if (topic.subcategory != null && !isStr(topic.subcategory))
      errors.push('"subcategory" must be a string if present');
    if (topic.tags != null && !isStrArray(topic.tags))
      errors.push('"tags" must be an array of strings');
    if (topic.lastUpdated == null) warnings.push('No "lastUpdated" date (recommended, YYYY-MM-DD)');
    else if (!isStr(topic.lastUpdated) || !DATE_RE.test(topic.lastUpdated))
      errors.push('"lastUpdated" must be a YYYY-MM-DD string');

    if (topic.sources == null || (Array.isArray(topic.sources) && !topic.sources.length)) {
      warnings.push('No "sources" — add at least one guideline-level source');
    } else if (!Array.isArray(topic.sources)) {
      errors.push('"sources" must be an array');
    } else {
      topic.sources.forEach(function (s, i) {
        if (typeof s !== 'object' || s === null || !isStr(s.label) || !isStr(s.url))
          errors.push('sources[' + i + '] requires "label" and "url" strings');
      });
    }

    if (Array.isArray(topic.blocks))
      topic.blocks.forEach(function (b, i) { validateBlock(b, i, errors, warnings); });

    return { valid: errors.length === 0, errors: errors, warnings: warnings };
  }

  global.OnCallValidate = { validateTopic: validateTopic };
})(window);
