#!/usr/bin/env python3
"""build-index.py — scan a content directory of topic JSON files and generate
the site's manifest.json (metadata + search text) into the web root, copying
each valid topic file to <out>/content/<id>.json.

Runs at Docker image build AND at container start (see docker-entrypoint.sh),
so content dropped onto a mounted volume is indexed on restart with no rebuild.

Usage: build-index.py --content <dir> --out <webroot>

Invalid files are reported to stderr and skipped — one bad file never takes
the site down. Exit code is 0 unless the content directory is missing/empty
or nothing at all validated.
"""

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

SEVERITIES = {"high", "medium", "low"}
ID_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SEARCH_TEXT_CAP = 6000

KNOWN_BLOCKS = {
    "heading", "paragraph", "bullets", "numbered", "callout",
    "flowsheet", "table", "education", "references", "html",
}


def warn(msg):
    print(f"  [warn] {msg}", file=sys.stderr)


def err(msg):
    print(f"  [skip] {msg}", file=sys.stderr)


def validate(topic, fname):
    """Return a list of fatal errors (empty list = valid). Non-fatal issues are warned."""
    errors = []
    if not isinstance(topic, dict):
        return ["top level is not a JSON object"]

    for key, typ in (("id", str), ("title", str), ("category", str),
                     ("severity", str), ("summary", str), ("blocks", list)):
        if key not in topic:
            errors.append(f"missing required key '{key}'")
        elif not isinstance(topic[key], typ):
            errors.append(f"'{key}' must be a {typ.__name__}")

    if errors:
        return errors

    if not ID_RE.match(topic["id"]):
        errors.append(f"id '{topic['id']}' is not a lowercase-hyphen slug")
    if topic["severity"] not in SEVERITIES:
        errors.append(f"severity '{topic['severity']}' must be one of {sorted(SEVERITIES)}")
    if topic["id"] != fname:
        warn(f"{fname}.json: id '{topic['id']}' does not match filename — indexing under the id")

    tags = topic.get("tags", [])
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        errors.append("'tags' must be an array of strings")

    lu = topic.get("lastUpdated")
    if lu is not None and (not isinstance(lu, str) or not DATE_RE.match(lu)):
        warn(f"{fname}.json: lastUpdated '{lu}' is not YYYY-MM-DD")

    sources = topic.get("sources", [])
    if not isinstance(sources, list):
        errors.append("'sources' must be an array")
    else:
        for i, s in enumerate(sources):
            if not isinstance(s, dict) or "label" not in s or "url" not in s:
                errors.append(f"sources[{i}] must be an object with 'label' and 'url'")

    for i, b in enumerate(topic["blocks"]):
        if not isinstance(b, dict) or "type" not in b:
            errors.append(f"blocks[{i}] must be an object with a 'type'")
            continue
        if b["type"] not in KNOWN_BLOCKS:
            warn(f"{fname}.json: blocks[{i}] has unknown type '{b['type']}' (will degrade gracefully)")

    return errors


def block_text(block):
    """Extract searchable plain text from one block."""
    parts = []
    t = block.get("type")
    for key in ("text", "title", "body"):
        v = block.get(key)
        if isinstance(v, str):
            parts.append(v)
    if t in ("bullets", "numbered"):
        parts.extend(str(i) for i in block.get("items", []))
    elif t == "flowsheet":
        for s in block.get("steps", []):
            if isinstance(s, dict):
                parts.extend(str(s[k]) for k in ("step", "detail", "branch") if s.get(k))
    elif t == "table":
        parts.extend(str(h) for h in block.get("headers", []))
        for row in block.get("rows", []):
            if isinstance(row, list):
                parts.extend(str(c) for c in row)
    elif t == "references":
        for r in block.get("items", []):
            if isinstance(r, dict) and r.get("label"):
                parts.append(str(r["label"]))
    return " ".join(p for p in parts if p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--content", required=True, help="directory of topic *.json files")
    ap.add_argument("--out", required=True, help="web root to write manifest.json and content/ into")
    args = ap.parse_args()

    content_dir = Path(args.content)
    out_dir = Path(args.out)
    out_content = out_dir / "content"

    files = sorted(content_dir.glob("*.json")) if content_dir.is_dir() else []
    if not files:
        print(f"build-index: no *.json files found in {content_dir}", file=sys.stderr)
        return 1

    out_content.mkdir(parents=True, exist_ok=True)
    for stale in out_content.glob("*.json"):
        stale.unlink()

    topics = {}
    for f in files:
        try:
            topic = json.loads(f.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            err(f"{f.name}: not valid JSON ({e})")
            continue
        errors = validate(topic, f.stem)
        if errors:
            for e in errors:
                err(f"{f.name}: {e}")
            continue

        tid = topic["id"]
        if tid in topics:
            warn(f"{f.name}: duplicate id '{tid}' — this file replaces the earlier one")

        body = " ".join(block_text(b) for b in topic["blocks"] if isinstance(b, dict))
        topics[tid] = {
            "entry": {
                "id": tid,
                "title": topic["title"],
                "category": topic["category"],
                "subcategory": topic.get("subcategory") or None,
                "tags": topic.get("tags", []),
                "severity": topic["severity"],
                "summary": topic["summary"],
                "lastUpdated": topic.get("lastUpdated") or None,
                "searchText": body[:SEARCH_TEXT_CAP],
            },
            "raw": topic,
        }

    if not topics:
        print("build-index: no valid topics — manifest not written", file=sys.stderr)
        return 1

    for tid, t in topics.items():
        (out_content / f"{tid}.json").write_text(
            json.dumps(t["raw"], ensure_ascii=False, indent=2), encoding="utf-8"
        )

    manifest = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count": len(topics),
        "topics": sorted((t["entry"] for t in topics.values()), key=lambda e: e["title"].lower()),
    }
    (out_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"build-index: indexed {len(topics)} topic(s) -> {out_dir / 'manifest.json'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
