#!/bin/sh
# Runs at every container start (installed into /docker-entrypoint.d/, which
# the stock nginx image executes before starting nginx).
#
# Merges baked seed content with anything mounted at /content (mounted files
# with the same name win), then regenerates manifest.json + web-root content.
# Result: drop a topic JSON on the volume, restart the container, done.
set -eu

STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT

if [ "${ONCALL_DISABLE_SEEDS:-false}" != "true" ] && [ -d /app/seed-content ]; then
    cp /app/seed-content/*.json "$STAGING"/ 2>/dev/null || true
fi

if [ -d /content ]; then
    cp /content/*.json "$STAGING"/ 2>/dev/null || true
fi

python3 /app/build-index.py --content "$STAGING" --out /usr/share/nginx/html
