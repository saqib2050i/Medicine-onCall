#!/bin/sh
# Installed as /docker-entrypoint.d/30-auth.sh — runs before nginx starts.
# Ensures the data dir exists and launches the auth service in the background;
# nginx (started afterwards by the stock entrypoint) proxies auth_request to it.
set -eu

: "${ONCALL_DATA_DIR:=/data}"
export ONCALL_DATA_DIR
mkdir -p "$ONCALL_DATA_DIR"

if [ ! -f "$ONCALL_DATA_DIR/users.json" ]; then
    echo "auth: no users yet. Create one with:"
    echo "      docker exec -it <container> python3 /app/manage-users.py add <username>"
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
