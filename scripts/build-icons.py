#!/usr/bin/env python3
"""Render images/humusic-mark.svg out to the PNGs the app and the store need.

    python3 scripts/build-icons.py

The mark is drawn once, as vector, and every raster comes from it. Exporting
by hand is how a set of icons drifts: the favicon gets redrawn, the store icon
does not, and a year later the app has two logos that are nearly the same.

Two masters are rasterised, because the corners are not a style choice:

  rounded   transparent outside the plate — the favicon and the
            apple-touch-icon, which are composited onto whatever is behind
            them
  square    fully opaque, no rounding at all. iOS masks the app icon to its
            own superellipse, so a rounded icon is rounded twice and lands on
            the home screen with pale corners; and the App Store rejects an
            alpha channel outright

Everything else is cut from those two. The launch image in particular is
composited rather than rendered: it is 2732 square, and asking a headless
browser for a window that size is minutes of work for a picture that is
almost entirely one colour.

Needs Pillow, and Chrome or Edge to rasterise. Both browsers honour the SVG
the way the app's own WebView will, which is the point — anything else is a
second SVG implementation to disagree with the first.
"""

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    print("needs Pillow:  pip install Pillow", file=sys.stderr)
    raise SystemExit(1)

ROOT = Path(__file__).resolve().parent.parent
MARK = ROOT / "images" / "humusic-mark.svg"

BROWSERS = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "chromium",
]

MASTER = 1024
PAPER = (237, 232, 222)

WEB_ICON = ROOT / "images" / "humusic-icon.png"
IOS_ICON = ROOT / "ios-assets" / "AppIcon.appiconset" / "AppIcon-1024.png"
SPLASH = ROOT / "ios-assets" / "splash-2732.png"
SPLASH_SIZE = 2732


def find_browser():
    for candidate in BROWSERS:
        found = candidate if Path(candidate).exists() else shutil.which(candidate)
        if found:
            return found
    print("no Chrome, Edge or Chromium found — cannot rasterise", file=sys.stderr)
    raise SystemExit(1)


def rasterise(browser: str, svg: str, out: Path, transparent: bool) -> None:
    html = (
        "<!DOCTYPE html><html><head><meta charset='utf-8'><style>"
        "html,body{margin:0;padding:0;background:transparent}"
        "svg{display:block;width:100vw;height:100vh}"
        "</style></head><body>" + svg + "</body></html>"
    )
    with tempfile.TemporaryDirectory() as work:
        source = Path(work) / "mark.html"
        source.write_text(html, encoding="utf-8")
        command = [
            browser,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            # Without a time budget the headless screenshot can sit waiting
            # for a frame that never arrives, and never exit.
            "--virtual-time-budget=3000",
            f"--window-size={MASTER},{MASTER}",
            f"--screenshot={out}",
            f"--user-data-dir={work}/profile",
        ]
        if transparent:
            command.append("--default-background-color=00000000")
        command.append(source.as_uri())
        subprocess.run(command, check=True, capture_output=True)


def report(path: Path) -> None:
    with Image.open(path) as image:
        size = f"{image.width}×{image.height}"
    print(f"  {path.relative_to(ROOT)}  {size}  {path.stat().st_size / 1024:.0f} KB")


def main() -> int:
    if not MARK.exists():
        print(f"missing {MARK.relative_to(ROOT)}", file=sys.stderr)
        return 1

    browser = find_browser()
    svg = MARK.read_text(encoding="utf-8")
    # The plate's corner radius is the only difference between the two, so it
    # is edited here rather than the drawing being kept twice and going out
    # of step with itself.
    squared = re.sub(r'(<rect width="100" height="100" rx=")[\d.]+(")', r"\g<1>0\g<2>", svg)
    if squared == svg:
        print("could not find the plate's corner radius in the mark", file=sys.stderr)
        return 1

    with tempfile.TemporaryDirectory() as work:
        rounded_master = Path(work) / "rounded.png"
        square_master = Path(work) / "square.png"
        rasterise(browser, svg, rounded_master, transparent=True)
        rasterise(browser, squared, square_master, transparent=False)

        with Image.open(rounded_master) as rounded:
            rounded = rounded.convert("RGBA")
            rounded.resize((512, 512), Image.LANCZOS).save(WEB_ICON, optimize=True)

            # A launch screen is mostly paper: the mark at a third of the
            # width, sitting a little above centre, because a shape centred
            # by measurement reads as low.
            splash = Image.new("RGB", (SPLASH_SIZE, SPLASH_SIZE), PAPER)
            glyph = SPLASH_SIZE // 3
            small = rounded.resize((glyph, glyph), Image.LANCZOS)
            splash.paste(
                small,
                ((SPLASH_SIZE - glyph) // 2, (SPLASH_SIZE - glyph) // 2 - SPLASH_SIZE // 14),
                small,
            )
            splash.save(SPLASH, optimize=True)

        # Opaque and square, exactly as rendered — no resize, so the store
        # icon is the master rather than a copy of a copy.
        with Image.open(square_master) as square:
            square.convert("RGB").save(IOS_ICON, optimize=True)

    for path in (WEB_ICON, IOS_ICON, SPLASH):
        report(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
