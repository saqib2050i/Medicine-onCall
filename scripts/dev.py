#!/usr/bin/env python3
"""Local dev server: rebuilds the content index, then serves public/ with an
SPA fallback (any extension-less path serves index.html), mirroring nginx.

Usage: python3 scripts/dev.py [port]   (default 8080)
"""

import http.server
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUBLIC = os.path.join(ROOT, "public")

subprocess.check_call([
    sys.executable, os.path.join(ROOT, "scripts", "build-index.py"),
    "--content", os.path.join(ROOT, "content"),
    "--out", PUBLIC,
])


class SpaHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def send_head(self):
        clean = self.path.split("?", 1)[0].split("#", 1)[0]
        fs_path = self.translate_path(clean)
        if not os.path.exists(fs_path) and "." not in os.path.basename(clean):
            self.path = "/index.html"
        return super().send_head()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    print(f"Serving {PUBLIC} at http://localhost:{port}")
    http.server.ThreadingHTTPServer(("127.0.0.1", port), SpaHandler).serve_forever()
