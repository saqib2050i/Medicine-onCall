#!/usr/bin/env python3
"""OnCall auth service — a small, dependency-free session-auth backend that
nginx consults on every request via `auth_request`.

Security model
--------------
* Passwords are stored only as scrypt hashes (never plaintext, never in the
  image) in a users file on the data volume — see scripts/manage-users.py.
* A successful login issues an HMAC-SHA256-signed session token in an
  HttpOnly + Secure + SameSite=Lax cookie with an expiry. The token is
  stateless (verified by signature) so no session store is needed.
* /verify (the nginx auth_request target) only checks the cookie signature +
  expiry — cheap, runs per request. scrypt only runs on POST /login.
* Login is rate-limited per username and per client IP; comparisons are
  constant-time; error messages are generic.

Endpoints (bound to 127.0.0.1 — only nginx talks to it):
  GET  /verify        -> 200 if the session cookie is valid, else 401
  POST /auth/login    -> verify credentials, set cookie, 303 redirect
  POST /auth/logout   -> clear cookie, 303 redirect to /login?loggedout=1
  GET  /auth/whoami   -> 200 {"user": "..."} for the app to show who's logged in

Configuration (env):
  ONCALL_DATA_DIR     directory holding users.json + session.secret (default /data)
  SESSION_SECRET      optional; if unset, a random secret is generated and
                      persisted to <data>/session.secret (survives restarts)
  SESSION_TTL_HOURS   session lifetime, default 12
  AUTH_PORT           listen port, default 8081
  LOGIN_MAX_ATTEMPTS  failed attempts before lockout, default 8
  LOGIN_WINDOW_SEC    lockout window in seconds, default 300
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

DATA_DIR = os.environ.get("ONCALL_DATA_DIR", "/data")
USERS_FILE = os.path.join(DATA_DIR, "users.json")
SECRET_FILE = os.path.join(DATA_DIR, "session.secret")
COOKIE_NAME = "oncall_session"
TTL_SECONDS = int(float(os.environ.get("SESSION_TTL_HOURS", "12")) * 3600)
PORT = int(os.environ.get("AUTH_PORT", "8081"))
MAX_ATTEMPTS = int(os.environ.get("LOGIN_MAX_ATTEMPTS", "8"))
WINDOW_SEC = int(os.environ.get("LOGIN_WINDOW_SEC", "300"))
# Whether the session cookie carries the Secure flag. "auto" (default) sets it
# only when the request arrived over HTTPS (per X-Forwarded-Proto) — so login
# works both over the HTTPS tunnel AND over plain-HTTP LAN access. "always"
# forces it (HTTPS-only deployments); "never" disables it.
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "auto").strip().lower()

_lock = threading.Lock()
_attempts = {}  # key -> [timestamps of recent failures]


# --------------------------------------------------------------------------- secret
def load_secret():
    env = os.environ.get("SESSION_SECRET", "").strip()
    if env:
        return env.encode("utf-8")
    try:
        with open(SECRET_FILE, "rb") as f:
            data = f.read().strip()
            if data:
                return data
    except FileNotFoundError:
        pass
    # Generate and persist so sessions survive container restarts.
    data = secrets.token_urlsafe(48).encode("utf-8")
    os.makedirs(DATA_DIR, exist_ok=True)
    fd = os.open(SECRET_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(data)
    return data


SECRET = load_secret()


# --------------------------------------------------------------------------- users
def load_users():
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def verify_password(record, password):
    """Constant-time PBKDF2-HMAC-SHA256 verification against a stored record."""
    try:
        salt = base64.b64decode(record["salt"])
        expected = base64.b64decode(record["hash"])
        iterations = int(record.get("iterations", 600000))
    except (KeyError, ValueError, TypeError):
        return False
    if record.get("algo", "pbkdf2_sha256") != "pbkdf2_sha256":
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, dklen=len(expected))
    return hmac.compare_digest(dk, expected)


# --------------------------------------------------------------------------- tokens
def b64u(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64u_dec(s):
    pad = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + pad)


def make_token(username):
    exp = int(time.time()) + TTL_SECONDS
    payload = b64u(json.dumps({"u": username, "exp": exp}, separators=(",", ":")).encode("utf-8"))
    sig = b64u(hmac.new(SECRET, payload.encode("ascii"), hashlib.sha256).digest())
    return payload + "." + sig


def read_token(token):
    """Return the username if the token is well-formed, correctly signed and
    unexpired; otherwise None."""
    if not token or "." not in token:
        return None
    payload, _, sig = token.partition(".")
    expected = b64u(hmac.new(SECRET, payload.encode("ascii"), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        return None
    try:
        data = json.loads(b64u_dec(payload))
    except (ValueError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict) or "u" not in data or "exp" not in data:
        return None
    if int(data["exp"]) < int(time.time()):
        return None
    return str(data["u"])


# --------------------------------------------------------------------------- rate limit
def rate_key(username, ip):
    return (username or "", ip or "")


def is_locked(username, ip):
    now = time.time()
    with _lock:
        for key in (rate_key(username, ip), rate_key("", ip)):
            hits = [t for t in _attempts.get(key, []) if now - t < WINDOW_SEC]
            _attempts[key] = hits
            if len(hits) >= MAX_ATTEMPTS:
                return True
    return False


def record_failure(username, ip):
    now = time.time()
    with _lock:
        for key in (rate_key(username, ip), rate_key("", ip)):
            _attempts.setdefault(key, []).append(now)


def clear_failures(username, ip):
    with _lock:
        _attempts.pop(rate_key(username, ip), None)


# --------------------------------------------------------------------------- helpers
def get_cookie(headers, name):
    raw = headers.get("Cookie", "")
    for part in raw.split(";"):
        k, _, v = part.strip().partition("=")
        if k == name:
            return v
    return None


def safe_next(raw):
    """Only allow same-site absolute paths as post-login redirect targets, to
    prevent open redirects."""
    if not raw or not raw.startswith("/") or raw.startswith("//") or raw.startswith("/\\"):
        return "/"
    return raw


def client_ip(handler):
    # nginx sets X-Real-IP / X-Forwarded-For; fall back to socket peer.
    xff = handler.headers.get("X-Forwarded-For", "")
    if xff:
        return xff.split(",")[0].strip()
    return handler.headers.get("X-Real-IP") or handler.client_address[0]


class Handler(BaseHTTPRequestHandler):
    server_version = "OnCallAuth"

    def log_message(self, fmt, *args):
        pass  # nginx already logs; keep the auth service quiet

    # -- responders -------------------------------------------------------
    def _send(self, code, body=b"", ctype="text/plain", extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or []):
            self.send_header(k, v)
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _is_https(self):
        proto = self.headers.get("X-Forwarded-Proto", "").split(",")[0].strip().lower()
        return proto == "https"

    def _set_cookie(self, token, max_age):
        # A browser will not STORE a Secure cookie over plain HTTP, which would
        # make login loop on LAN (http://<ip>:8095). So set Secure only when the
        # request actually came over HTTPS (via the tunnel/proxy), unless
        # COOKIE_SECURE overrides. SameSite=Lax allows normal navigation.
        if COOKIE_SECURE == "always":
            secure = True
        elif COOKIE_SECURE == "never":
            secure = False
        else:
            secure = self._is_https()
        attrs = [
            "%s=%s" % (COOKIE_NAME, token),
            "Path=/",
            "HttpOnly",
            "SameSite=Lax",
            "Max-Age=%d" % max_age,
        ]
        if secure:
            attrs.append("Secure")
        return ("Set-Cookie", "; ".join(attrs))

    # -- routes -----------------------------------------------------------
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/verify":
            user = read_token(get_cookie(self.headers, COOKIE_NAME))
            if user:
                return self._send(200, b"ok", extra=[("X-Auth-User", user)])
            return self._send(401, b"unauthorized")
        if path == "/auth/whoami":
            user = read_token(get_cookie(self.headers, COOKIE_NAME))
            if user:
                return self._send(200, json.dumps({"user": user}).encode(), "application/json")
            return self._send(401, b'{"user":null}', "application/json")
        if path == "/auth/health":
            return self._send(200, b"ok")
        return self._send(404, b"not found")

    def do_POST(self):
        path = urlparse(self.path).path
        length = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(length) if length else b""
        form = parse_qs(raw.decode("utf-8", "replace"))

        if path == "/auth/logout":
            expired = self._set_cookie("", 0)
            return self._send(303, b"", extra=[expired, ("Location", "/login?loggedout=1")])

        if path == "/auth/login":
            username = (form.get("username", [""])[0] or "").strip()
            password = form.get("password", [""])[0] or ""
            nxt = safe_next(form.get("next", ["/"])[0])
            ip = client_ip(self)

            if is_locked(username, ip):
                return self._send(303, b"", extra=[("Location", "/login?error=locked")])

            users = load_users()
            record = users.get(username)
            # Always run a hash comparison to blunt user-enumeration timing.
            ok = bool(record) and verify_password(record, password)
            if not ok:
                record_failure(username, ip)
                return self._send(303, b"", extra=[("Location", "/login?error=1")])

            clear_failures(username, ip)
            token = make_token(username)
            cookie = self._set_cookie(token, TTL_SECONDS)
            return self._send(303, b"", extra=[cookie, ("Location", nxt)])

        return self._send(404, b"not found")


def main():
    if not os.path.exists(USERS_FILE):
        # Not fatal — the service still runs, every login just fails until an
        # admin creates a user with scripts/manage-users.py.
        print("auth: WARNING no users file at %s — create one with manage-users.py" % USERS_FILE, flush=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("auth: listening on 127.0.0.1:%d (ttl=%ds)" % (PORT, TTL_SECONDS), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
