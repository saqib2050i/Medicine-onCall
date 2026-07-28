# OnCall — Emergency Guideline Reference

A fast, mobile-first, self-extending reference site for handling on-call medical
emergencies as a medical registrar. **Adding a topic = dropping one JSON file
into `content/`** — navigation, search, the homepage and the category tree are
all generated from the content, so the site grows with zero code changes.

Ships as a small `nginx:alpine` Docker image published to GHCR by GitHub
Actions, designed to run on Unraid behind NGINX Proxy Manager + a Cloudflare
Tunnel (plain HTTP port, no in-container TLS).

> **Clinical disclaimer** — this site is a decision-support / educational aid
> only. It is **not** a substitute for clinical judgement, senior advice, or
> local policy. Verify all doses, thresholds and steps against current local
> and national guidelines before use. Seed content is a structural template to
> be reviewed and corrected by a clinician.

---

## How it works

```
content/*.json              one file per topic (the only thing you ever edit)
        │
        ▼
scripts/build-index.py      scans + validates content, writes:
        │                     public/manifest.json   (metadata + search text)
        │                     public/content/*.json  (validated topic files)
        ▼
public/                     static app (vanilla JS) fetches manifest.json,
                            builds nav/search/homepage, renders topic pages
```

The index script runs **twice**:

1. **At image build** — seed content is baked in, so the image works standalone.
2. **At every container start** (via `/docker-entrypoint.d/`) — it merges the
   baked seeds with anything mounted at `/content` (mounted files with the same
   filename win) and regenerates the manifest. So: drop a JSON on the Unraid
   volume → restart the container → new topic is live. No rebuild.

Set `ONCALL_DISABLE_SEEDS=true` on the container to serve *only* mounted content.

## Features

- **Mobile-first** clinical UI, big tap targets, light + dark mode, offline
  support via a service worker (previously viewed topics keep working).
- **Search** — vendored fuzzy search (`public/vendor/minifuzz.js`, no CDN)
  over title / tags / summary / body, with a **Cmd/Ctrl-K** command palette
  (arrow keys + Enter; `/` also opens it).
- **Severity colour-coding** (`high` / `medium` / `low`) across nav, cards,
  badges and the topic header, plus a high-acuity quick-access row on the home
  page.
- **Ten block types**: `heading`, `paragraph`, `bullets`, `numbered`,
  `callout` (red-flag / warning / pearl / info), `flowsheet`, `table`,
  `education`, `references`, `html` (escape hatch). Unknown types render as a
  collapsed raw-JSON fallback — never a crash.
- **`/ingest` page** — the workflow for adding content: paste JSON → live
  validation with specific errors → live preview → download a correctly named
  file, plus two copy-able Claude prompts that produce schema-compatible JSON.
- **Print stylesheet** — the Print button on a topic produces a clean
  single-topic flow sheet.

## Security & authentication

Login is enforced **in front of the static files**, by an auth service inside
the container that nginx consults on every request (`auth_request`). Requests
without a valid session get 401 — so fetching `/manifest.json` or
`/content/<id>.json` directly returns nothing. (A login implemented only in
client-side JS would be bypassable; this is not.)

- **Passwords** are stored only as PBKDF2-HMAC-SHA256 hashes (600k iterations,
  per-user salt) in `/data/users.json` — never plaintext, never in the image.
  Manage them with `scripts/manage-users.py` (see below).
- **Sessions** are HMAC-SHA256-signed tokens in an HttpOnly, SameSite=Lax cookie
  with an expiry (`SESSION_TTL_HOURS`, default 12). Stateless, so no session
  store; a forged/tampered cookie fails the signature check. The `Secure` flag
  is set automatically when the request arrived over HTTPS (via the tunnel/proxy
  `X-Forwarded-Proto`), so login works over the HTTPS tunnel *and* over plain-HTTP
  LAN access; override with `COOKIE_SECURE=always|never` if needed.
- **Login is rate-limited** per username and per client IP (lockout after
  repeated failures), with constant-time comparisons and generic error text.
- **Logout** clears the cookie *and* purges the offline cache + service worker,
  so previously viewed topics aren't readable after signing out.
- **Hardening headers** on every response: a strict Content-Security-Policy
  (`script-src 'self'` — blocks injected/inline JS, including inside a topic's
  `html` block), plus `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy`,
  `Permissions-Policy` and COOP/CORP.

Only `/login`, its script, the `/auth/*` endpoints and `/healthz` are public.

### Managing users

No accounts exist until you create one. Run the CLI inside the container (where
the `/data` volume is mounted):

```bash
docker exec -it oncall-guide python3 /app/manage-users.py add alice     # create
docker exec -it oncall-guide python3 /app/manage-users.py passwd alice  # change password
docker exec -it oncall-guide python3 /app/manage-users.py list          # list usernames
docker exec -it oncall-guide python3 /app/manage-users.py remove alice  # delete
```

The password is entered interactively (hidden). `/data` must be a **persistent
volume** — it holds the users file and the session signing key; losing it logs
everyone out and deletes all accounts.

**Seed the first user without `docker exec`.** Set these in the environment (or
`.env`) and the user is created on first start — only if it doesn't already
exist, so restarts never reset it:

```ini
ONCALL_ADMIN_USER=alice
ONCALL_ADMIN_PASSWORD=your-strong-password   # min 10 chars
```

Or point at a file / Docker secret instead of an inline value:
`ONCALL_ADMIN_PASSWORD_FILE=/run/secrets/oncall_admin_pw`. Changing an existing
user's password is done with `manage-users.py passwd` — editing these env vars
does **not** update an account that already exists. Because the value sits in
your `.env` (gitignored), keep that file private; you can blank
`ONCALL_ADMIN_PASSWORD` after the first successful boot.

> This is a lightweight, standards-based auth service suitable for a small
> trusted team behind your tunnel. For a larger deployment or stricter
> assurance, a vetted identity provider (Authelia, Cloudflare Access) in front
> is still the gold standard.

## Local development

Requires only Python 3 (standard library):

```bash
python3 scripts/dev.py 8080
```

This rebuilds the index from `content/` and serves `public/` at
`http://localhost:8080` with the same SPA fallback nginx uses. Note: `dev.py`
serves the UI **unauthenticated** — it's for front-end work only. The real
login gate (`auth_request` + the auth service) is exercised in the container.

Or run the real container (with auth), creating a data volume and a first user:

```bash
docker build -t oncall-guide .
docker run -d --name oncall-guide -p 8095:80 -v oncall-data:/data oncall-guide
docker exec -it oncall-guide python3 /app/manage-users.py add alice
# then open http://localhost:8095 — the login page is shown until you sign in
```

## Content schema

One file per topic in `content/`, filename = its `id`
(`content/hyperkalaemia.json`):

```json
{
  "id": "hyperkalaemia",
  "title": "Hyperkalaemia",
  "category": "Metabolic & Electrolytes",
  "subcategory": "Potassium",
  "tags": ["emergency", "renal"],
  "severity": "high",
  "summary": "One line: what it is / when to act.",
  "lastUpdated": "2026-07-25",
  "sources": [{ "label": "Guideline name", "url": "https://..." }],
  "blocks": [
    { "type": "callout", "variant": "red-flag", "title": "Call for help if", "body": "..." },
    { "type": "heading", "text": "Immediate assessment" },
    { "type": "bullets", "items": ["ABCDE", "12-lead ECG now"] },
    { "type": "numbered", "items": ["Step one", "Step two"] },
    { "type": "flowsheet", "title": "Management algorithm", "steps": [
      { "step": "Protect the myocardium", "detail": "Drug/dose/route", "branch": "If X → do Y" }
    ] },
    { "type": "table", "headers": ["Severity", "K⁺"], "rows": [["Mild", "5.5–5.9"]] },
    { "type": "education", "title": "Why calcium first?", "body": "Short teaching paragraph." },
    { "type": "references", "items": [{ "label": "Name", "url": "https://..." }] },
    { "type": "html", "html": "<svg>…</svg> escape hatch for custom flow charts" }
  ]
}
```

Rules enforced by the validator (`/ingest` and the build script agree):

- Required: `id` (lowercase-hyphen slug), `title`, `category`, `severity`
  (`high|medium|low`), `summary`, non-empty `blocks`.
- Recommended: `subcategory`, `tags`, `lastUpdated` (YYYY-MM-DD), `sources`.
- Invalid files are **skipped with a warning** at index time — one bad file
  never takes the site down. Unknown block types degrade gracefully.
- `manifest.json` is always generated — never hand-edit it (it's gitignored).

## Adding a topic

1. Open **`/ingest`** on the site and copy one of the two example prompts
   (Prompt A: simple topic; Prompt B: complex topic with flowsheet + table).
2. Give it to Claude with your topic filled in; paste the returned JSON back
   into the `/ingest` validator; fix anything it flags; check the live
   preview; click **Download .json** (named from the `id`).
3. Deploy it either way:
   - **Via git:** put the file in `content/`, commit, push to `main`. CI
     rebuilds the image; on the server run
     `docker compose pull && docker compose up -d`.
   - **Via the volume:** drop the file into
     `/mnt/user/appdata/oncall-guide/content/` on Unraid and restart the
     container.
4. **Review the rendered topic clinically before relying on it.**

## CI / GHCR image

`.github/workflows/docker-publish.yml` builds on every push to `main` (and on
`v*` tags) and pushes to `ghcr.io/<owner>/<repo>` with tags `latest`,
`sha-<short-sha>`, and the git tag when present. It uses the built-in
`GITHUB_TOKEN` (`packages: write`) — **no secrets to configure**. Target
platform is `linux/amd64` (Unraid); an arm64 line is commented in the workflow.

First push: the GHCR package may default to *private*. Either keep it private
(then `docker login ghcr.io` on the server with a read-only PAT) or make it
public: GitHub → your profile → Packages → the package → Package settings →
Change visibility.

## Deploying on Unraid

`docker-compose.yml` reads its settings from a `.env` file in the same
directory, so you don't edit the compose file itself.

1. Copy `.env.example` to `.env` and set at least `IMAGE` to your GHCR path
   (lowercase), e.g. `IMAGE=ghcr.io/drawesome2050/medicine-oncall`. The other
   values have sensible defaults.

   | Variable | Default | Purpose |
   |----------|---------|---------|
   | `IMAGE` | `ghcr.io/owner/repo` | Your GHCR image path (lowercase) |
   | `IMAGE_TAG` | `latest` | `latest`, a git tag, or `sha-<short>` |
   | `CONTAINER_NAME` | `oncall-guide` | Container name |
   | `HOST_PORT` | `8095` | Host port NPM/Cloudflare forwards to |
   | `CONTENT_DIR` | `/mnt/user/appdata/oncall-guide/content` | Host dir for extra topics |
   | `DATA_DIR` | `/mnt/user/appdata/oncall-guide/data` | Login users + session key — **keep persistent** |
   | `SESSION_SECRET` | *(blank)* | Session signing key; blank = generated and persisted to `DATA_DIR` |
   | `SESSION_TTL_HOURS` | `12` | Session lifetime |
   | `ONCALL_DISABLE_SEEDS` | `false` | `true` = serve only mounted content |
   | `RESTART_POLICY` | `unless-stopped` | Docker restart policy |

2. Deploy with `docker compose up -d`, or paste both `docker-compose.yml` and
   your `.env` into Dockge / Unraid Compose Manager. The site listens on
   `HOST_PORT` (plain HTTP).
3. Point NGINX Proxy Manager at `<unraid-ip>:<HOST_PORT>` and expose it through
   your existing Cloudflare Tunnel. No TLS in-container — NPM/Cloudflare handle it.
   (The Secure session cookie relies on the HTTPS that NPM/Cloudflare provide.)
4. **Create your first login user** (no accounts exist until you do):
   ```bash
   docker exec -it oncall-guide python3 /app/manage-users.py add <username>
   ```
5. The **`DATA_DIR` volume** holds the users file + session key and **must be
   persistent**. `CONTENT_DIR` is optional — the image ships with the seed
   topics; use it to add/override topics without rebuilding, then restart.

> `.env` is gitignored (it holds your server's config); `.env.example` is the
> committed template. Keep both `docker-compose.yml` and `.env` together —
> Compose only auto-loads `.env` from the directory you run it in.

### Updating

- **New image** (code or committed content changed): push to `main`, wait for
  the Action, then on the server: `docker compose pull && docker compose up -d`.
- **Volume content only**: restart the container
  (`docker restart oncall-guide`) — the entrypoint re-indexes on every start.

## Repository layout

```
content/                     topic JSON files (the data)
public/                      static site served by nginx
  css/app.css                all styling incl. dark mode + print
  js/app.js                  router, views, nav tree, command palette
  js/render.js               block renderers (all ten types + fallback)
  js/validate.js             client-side schema validator (used by /ingest)
  js/ingest.js               /ingest page (validator, preview, prompts)
  vendor/minifuzz.js         vendored fuzzy search (no CDN)
  sw.js                      service worker (offline; logout purges it)
  login.html, login.js       login page (self-contained, public)
  app.webmanifest, icons/    PWA bits
auth/server.py               session-auth service (nginx auth_request target)
auth/entrypoint.sh           starts the auth service before nginx
scripts/build-index.py       content scanner → manifest.json + web-root content
scripts/manage-users.py      CLI to add/change/remove login users (PBKDF2)
scripts/dev.py               local dev server (unauthenticated; UI work only)
Dockerfile                   nginx:alpine + python3, HEALTHCHECK, EXPOSE 80
docker-entrypoint.sh         re-indexes /content at every container start
nginx.conf                   auth_request gating, SPA fallback, gzip, /healthz
nginx-security-headers.conf  CSP + hardening headers (included everywhere)
docker-compose.yml           Unraid deployment (reads .env; content + data volumes)
.env.example                 template for .env (copy → edit → deploy)
.github/workflows/docker-publish.yml   push → GHCR image
```

## License

MIT — see [LICENSE](LICENSE), which also carries the clinical content notice.
