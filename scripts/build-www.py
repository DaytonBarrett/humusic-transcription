#!/usr/bin/env python3
"""Assemble www/ — the web bundle Capacitor ships inside the iOS app.

The app bundle is the transcriber only, not the marketing site: app.html
becomes index.html so WKWebView opens straight into the instrument.

The build fails if anything in the bundle references a remote host. An App
Store build has to work with no network at all, so a stray CDN link is a
release blocker, not a warning.
"""

import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WWW = ROOT / "www"

# (source, destination-relative-to-www)
FILES = [
    ("app.html", "index.html"),
    ("base.css", "base.css"),
    ("app.css", "app.css"),
    ("app.js", "app.js"),
    ("vendor/vexflow.js", "vendor/vexflow.js"),
    ("images/humusic-icon.png", "images/humusic-icon.png"),
]

FONT_DIR = ("vendor/fonts", "vendor/fonts")

REMOTE = re.compile(rb"""(?:https?:)?//([\w-]+(?:\.[\w-]+)+)""")
SCANNED_SUFFIXES = {".html", ".css", ".js"}

# vexflow.js embeds its homepage and a sourceMappingURL in comments; neither
# is fetched at runtime.
SCAN_SKIP = {"vendor/vexflow.js"}

# Both of these are identifiers rather than fetches. Nothing resolves either
# one at runtime, in the app or in a browser.
#
#   musicxml.org  the DTD system identifier in the DOCTYPE line humusic
#                 writes into exported .musicxml files.
#   w3.org        the SVG namespace URI. createElementNS takes the namespace
#                 as a literal string and there is no other spelling of it;
#                 the selection layer the score is made tappable with builds
#                 its rects that way.
ALLOWED_HOSTS = {b"www.musicxml.org", b"www.w3.org"}


def main() -> int:
    if WWW.exists():
        shutil.rmtree(WWW)
    WWW.mkdir(parents=True)

    for src_rel, dst_rel in FILES:
        src = ROOT / src_rel
        if not src.exists():
            print(f"missing source file: {src_rel}", file=sys.stderr)
            return 1
        dst = WWW / dst_rel
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, dst)

    src_fonts = ROOT / FONT_DIR[0]
    if not src_fonts.is_dir():
        print(f"missing font directory: {FONT_DIR[0]}", file=sys.stderr)
        return 1
    shutil.copytree(src_fonts, WWW / FONT_DIR[1])

    offenders = []
    for path in sorted(WWW.rglob("*")):
        if not path.is_file() or path.suffix not in SCANNED_SUFFIXES:
            continue
        rel = path.relative_to(WWW).as_posix()
        if rel in SCAN_SKIP:
            continue
        for host in set(REMOTE.findall(path.read_bytes())) - ALLOWED_HOSTS:
            offenders.append(f"{rel}: {host.decode('utf-8', 'replace')}")

    if offenders:
        print("bundle references remote hosts — it would not work offline:", file=sys.stderr)
        for o in offenders:
            print(f"  {o}", file=sys.stderr)
        return 1

    total = sum(p.stat().st_size for p in WWW.rglob("*") if p.is_file())
    count = sum(1 for p in WWW.rglob("*") if p.is_file())
    print(f"www/ built — {count} files, {total / 1024:.0f} KB, no remote references")
    return 0


if __name__ == "__main__":
    sys.exit(main())
