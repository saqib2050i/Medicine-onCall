/* ingest.js — the /ingest view: how-to workflow, live JSON validator +
 * preview + download, and the two copy-able example prompts. */
(function (global) {
  'use strict';

  var PROMPT_A = 'Create a single JSON file for my on-call emergency guideline site about [TOPIC]. Output only valid JSON, no markdown fences, no commentary. Conform exactly to this schema: top-level keys `id` (lowercase-hyphen slug), `title`, `category`, `subcategory` (optional), `tags` (array), `severity` ("high"|"medium"|"low"), `summary` (one line), `lastUpdated` (YYYY-MM-DD, today), `sources` (array of {label,url}), and `blocks` (array). Allowed block types: `heading` {text}, `paragraph` {text}, `bullets` {items[]}, `numbered` {items[]}, `callout` {variant:"red-flag"|"warning"|"pearl"|"info", title, body}, `education` {title, body}, `references` {items:[{label,url}]}. Keep it concise and action-oriented for a reg on call. Use only widely accepted guideline-level content and include real reference URLs in `sources` and `references`. Flag anything dose-specific as "verify against local policy."';

  var PROMPT_B = 'Create a single JSON file for my on-call emergency guideline site about [TOPIC]. Output only valid JSON, no markdown fences, no commentary. Use the same schema as before and additionally these block types: `flowsheet` {title, steps:[{step, detail, branch}]} for the management algorithm, `table` {headers[], rows[[]]}, and `html` {html} only if a custom flow chart is truly needed. Structure it as: a `red-flag` callout up top → immediate assessment (`bullets`) → a `flowsheet` management algorithm with clear drug/dose/route/timing in each step’s `detail` → a `table` for severity or dosing → one short `education` block → `references`. Set `severity` appropriately. Base every clinical statement on established national/international guidelines, cite them in `sources`/`references` with real URLs, and mark doses "verify against local policy." Output only the JSON.';

  var esc = null; // set on render from OnCallRender

  function promptCard(title, sub, text, idx) {
    return '<div class="prompt-card">' +
      '<div class="prompt-card-head"><div><h3>' + title + '</h3><p class="prompt-sub">' + sub + '</p></div>' +
      '<button type="button" class="btn copy-btn" data-copy-idx="' + idx + '">Copy</button></div>' +
      '<pre class="prompt-text" tabindex="0">' + esc(text) + '</pre></div>';
  }

  function render(App) {
    esc = window.OnCallRender.esc;
    document.title = 'Add content — OnCall';

    var html =
      '<div class="ingest">' +
      '<h1>Add content</h1>' +
      '<p class="ingest-lead">Every topic is one JSON file in <code>content/</code>. ' +
      'Nothing else to edit — navigation, search and the homepage are generated from the content.</p>' +

      '<section class="ingest-section"><h2>Workflow</h2><ol class="ingest-steps">' +
      '<li><strong>Generate</strong> a topic file with Claude using one of the prompts below (replace <code>[TOPIC]</code>).</li>' +
      '<li><strong>Validate</strong> it here — paste the JSON into the validator, check the preview, fix any errors, then <em>Download</em> (the file is named from its <code>id</code>).</li>' +
      '<li><strong>Deploy</strong> it one of two ways:<ul>' +
      '<li>Commit the file to <code>content/</code> and push — CI rebuilds the image; then <code>docker compose pull &amp;&amp; docker compose up -d</code> on the server.</li>' +
      '<li>Or drop the file straight into the mounted volume on Unraid (<code>/mnt/user/appdata/oncall-guide/content/</code>) and restart the container — no rebuild needed.</li>' +
      '</ul></li>' +
      '<li><strong>Review</strong> the rendered page clinically before relying on it. AI-drafted content is a starting template, not a checked guideline.</li>' +
      '</ol></section>' +

      '<section class="ingest-section"><h2>Validate &amp; preview</h2>' +
      '<label class="ingest-label" for="ingest-input">Paste topic JSON</label>' +
      '<textarea id="ingest-input" class="ingest-textarea" rows="14" spellcheck="false" ' +
      'placeholder=\'{ "id": "my-topic", "title": "My Topic", ... }\'></textarea>' +
      '<div class="ingest-actions">' +
      '<button type="button" class="btn btn-primary" id="ingest-validate">Validate &amp; preview</button>' +
      '<button type="button" class="btn" id="ingest-download" disabled>Download .json</button>' +
      '</div>' +
      '<div id="ingest-report" class="ingest-report" role="status" aria-live="polite"></div>' +
      '<div id="ingest-preview" class="ingest-preview" hidden>' +
      '<div class="ingest-preview-label">Live preview</div>' +
      '<div id="ingest-preview-body"></div></div>' +
      '</section>' +

      '<section class="ingest-section"><h2>Example prompts</h2>' +
      promptCard('Prompt A — simple topic', 'Bullets, callouts, education and references. Good default.', PROMPT_A, 0) +
      promptCard('Prompt B — complex topic with a flow sheet', 'Adds flowsheet, table and the html escape hatch for full management algorithms.', PROMPT_B, 1) +
      '</section>' +
      '</div>';

    App.view.innerHTML = html;
    window.scrollTo(0, 0);
    wire();
  }

  function wire() {
    var input = document.getElementById('ingest-input');
    var report = document.getElementById('ingest-report');
    var preview = document.getElementById('ingest-preview');
    var previewBody = document.getElementById('ingest-preview-body');
    var downloadBtn = document.getElementById('ingest-download');
    var validateBtn = document.getElementById('ingest-validate');
    var lastValid = null;

    function run() {
      var raw = input.value.trim();
      lastValid = null;
      downloadBtn.disabled = true;
      preview.hidden = true;
      if (!raw) { report.innerHTML = ''; return; }

      var topic;
      try {
        topic = JSON.parse(raw);
      } catch (e) {
        report.innerHTML = '<div class="report report--fail"><strong>&#10007; Not valid JSON</strong>' +
          '<ul><li>' + window.OnCallRender.esc(String(e.message)) + '</li></ul>' +
          '<p class="report-hint">Tip: the file must be pure JSON — no markdown fences, no trailing commas, no comments.</p></div>';
        return;
      }

      var res = window.OnCallValidate.validateTopic(topic);
      var eschtml = window.OnCallRender.esc;
      var html = '';
      if (res.valid) {
        html += '<div class="report report--pass"><strong>&#10003; Valid</strong> — schema checks passed.' +
          (res.warnings.length ? '<ul class="report-warnings">' + res.warnings.map(function (w) {
            return '<li>&#9888; ' + eschtml(w) + '</li>';
          }).join('') + '</ul>' : '') + '</div>';
        lastValid = topic;
        downloadBtn.disabled = false;
        previewBody.innerHTML =
          window.OnCallRender.renderTopicHeader(topic, { printButton: false }) +
          window.OnCallRender.renderTopicBody(topic);
        preview.hidden = false;
      } else {
        html += '<div class="report report--fail"><strong>&#10007; ' + res.errors.length +
          ' error' + (res.errors.length === 1 ? '' : 's') + '</strong><ul>' +
          res.errors.map(function (er) { return '<li>' + eschtml(er) + '</li>'; }).join('') + '</ul>' +
          (res.warnings.length ? '<ul class="report-warnings">' + res.warnings.map(function (w) {
            return '<li>&#9888; ' + eschtml(w) + '</li>';
          }).join('') + '</ul>' : '') + '</div>';
      }
      report.innerHTML = html;
    }

    validateBtn.addEventListener('click', run);
    var debounce = null;
    input.addEventListener('input', function () {
      clearTimeout(debounce);
      debounce = setTimeout(run, 400);
    });

    downloadBtn.addEventListener('click', function () {
      if (!lastValid) return;
      var blob = new Blob([JSON.stringify(lastValid, null, 2) + '\n'], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = lastValid.id + '.json';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });

    var prompts = [PROMPT_A, PROMPT_B];
    document.querySelectorAll('.copy-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var text = prompts[Number(btn.getAttribute('data-copy-idx'))];
        function done(ok) {
          btn.textContent = ok ? 'Copied!' : 'Copy failed';
          setTimeout(function () { btn.textContent = 'Copy'; }, 1600);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback(text)); });
        } else {
          done(fallback(text));
        }
        function fallback(t) {
          var ta = document.createElement('textarea');
          ta.value = t;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          var ok = false;
          try { ok = document.execCommand('copy'); } catch (e) {}
          ta.remove();
          return ok;
        }
      });
    });
  }

  global.OnCallIngest = { render: render };
})(window);
