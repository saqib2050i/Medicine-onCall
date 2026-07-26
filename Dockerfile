FROM nginx:alpine

# python3 runs both the content indexer and the auth service (stdlib only).
RUN apk add --no-cache python3

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY public/ /usr/share/nginx/html/
COPY content/ /app/seed-content/
COPY scripts/build-index.py /app/build-index.py
COPY scripts/manage-users.py /app/manage-users.py
COPY auth/server.py /app/auth-server.py

# The stock nginx entrypoint runs every script in /docker-entrypoint.d/ (in
# name order) before starting nginx: 30 launches auth, 40 builds the index.
COPY auth/entrypoint.sh /docker-entrypoint.d/30-auth.sh
COPY docker-entrypoint.sh /docker-entrypoint.d/40-build-index.sh

# Index the seed content at build time too, so the image is complete even if
# the entrypoint hook is bypassed (e.g. a custom command).
RUN chmod +x /docker-entrypoint.d/30-auth.sh /docker-entrypoint.d/40-build-index.sh \
    && python3 /app/build-index.py --content /app/seed-content --out /usr/share/nginx/html

EXPOSE 80

# /healthz is public (no auth), so this stays green regardless of login state.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/healthz || exit 1
