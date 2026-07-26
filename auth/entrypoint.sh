#!/bin/sh
# Installed as /docker-entrypoint.d/30-auth.sh — runs before nginx starts.
# Ensures the data dir exists and launches the auth service in the background;
# nginx (started afterwards by the stock entrypoint) proxies auth_request to it.
set -eu

: "${ONCALL_DATA_DIR:=/data}"
export ONCALL_DATA_DIR
mkdir -p "$ONCALL_DATA_DIR"

# Optional: seed an initial login user from env vars on start. The account is
# created only if it doesn't already exist, so restarts never reset a password
# you later change with manage-users.py. The password may come from a file
# (ONCALL_ADMIN_PASSWORD_FILE — e.g. a Docker/compose secret) or, less securely,
# straight from ONCALL_ADMIN_PASSWORD. Must be at least 10 characters.
if [ -n "${ONCALL_ADMIN_USER:-}" ]; then
    if [ -n "${ONCALL_ADMIN_PASSWORD_FILE:-}" ] && [ -f "${ONCALL_ADMIN_PASSWORD_FILE}" ]; then
        ONCALL_NEW_PASSWORD="$(cat "${ONCALL_ADMIN_PASSWORD_FILE}")"
    else
        ONCALL_NEW_PASSWORD="${ONCALL_ADMIN_PASSWORD:-}"
    fi
    export ONCALL_NEW_PASSWORD
    if [ -z "$ONCALL_NEW_PASSWORD" ]; then
        echo "auth: ONCALL_ADMIN_USER set but no password provided — skipping user bootstrap"
    elif ! python3 /app/manage-users.py ensure "$ONCALL_ADMIN_USER"; then
        echo "auth: could not bootstrap user '$ONCALL_ADMIN_USER' (see error above) — create one manually"
    fi
    unset ONCALL_NEW_PASSWORD
fi

if [ ! -f "$ONCALL_DATA_DIR/users.json" ]; then
    echo "auth: no users yet. Create one with:"
    echo "      docker exec -it <container> python3 /app/manage-users.py add <username>"
    echo "      or set ONCALL_ADMIN_USER / ONCALL_ADMIN_PASSWORD in the environment."
fi

# Start the auth service and wait briefly until it is accepting connections so
# the first requests don't race nginx's auth_request.
python3 /app/auth-server.py &

i=0
while [ "$i" -lt 50 ]; do
    if python3 -c "import socket,sys; s=socket.socket(); s.settimeout(0.2); sys.exit(0 if s.connect_ex(('127.0.0.1', int('${AUTH_PORT:-8081}')))==0 else 1)" 2>/dev/null; then
        echo "auth: service is up"
        break
    fi
    i=$((i + 1))
    sleep 0.1
done
