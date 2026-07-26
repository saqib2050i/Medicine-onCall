FROM nginx:alpine

# python3 is the only addition — it runs the content indexer at start-up.
RUN apk add --no-cache python3

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY public/ /usr/share/nginx/html/
COPY content/ /app/seed-content/
COPY scripts/build-index.py /app/build-index.py

# The stock nginx entrypoint runs every script in /docker-entrypoint.d/
# before starting nginx — our indexer slots in there.
COPY docker-entrypoint.sh /docker-entrypoint.d/40-build-index.sh

# Index the seed content at build time too, so the image is complete even if
# the entrypoint hook is bypassed (e.g. a custom command).
RUN chmod +x /docker-entrypoint.d/40-build-index.sh \
    && python3 /app/build-index.py --content /app/seed-content --out /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/healthz || exit 1
