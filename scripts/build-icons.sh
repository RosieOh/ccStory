#!/usr/bin/env bash
# Regenerates build/icon.icns, build/icon.ico and build/icon.png from build/icon.svg.
# Needs rsvg-convert (librsvg), iconutil (macOS) and Python 3 with Pillow.
set -euo pipefail
cd "$(dirname "$0")/.."

src=build/icon.svg
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# macOS: the icon grid as drawn (margin + shadow), every size iconutil expects.
set=$tmp/icon.iconset
mkdir -p "$set"
for s in 16 32 128 256 512; do
  rsvg-convert -w "$s" -h "$s" "$src" -o "$set/icon_${s}x${s}.png"
  rsvg-convert -w $((s * 2)) -h $((s * 2)) "$src" -o "$set/icon_${s}x${s}@2x.png"
done
iconutil -c icns "$set" -o build/icon.icns

# Windows and Linux icons fill their canvas: same artwork, cropped to the body, no shadow.
sed -e 's/viewBox="0 0 1024 1024"/viewBox="96 96 832 832"/' -e 's/ filter="url(#shadow)"//' "$src" > "$tmp/full.svg"
rsvg-convert -w 512 -h 512 "$tmp/full.svg" -o build/icon.png
for s in 16 24 32 48 64 128 256; do
  rsvg-convert -w "$s" -h "$s" "$tmp/full.svg" -o "$tmp/ico-$s.png"
done
python3 - "$tmp" <<'PY'
import sys
from PIL import Image
tmp = sys.argv[1]
sizes = [16, 24, 32, 48, 64, 128, 256]
# Each size rendered from the SVG, not downscaled from 256, so small sizes stay crisp.
imgs = [Image.open(f"{tmp}/ico-{s}.png") for s in sizes]
imgs[-1].save("build/icon.ico", sizes=[(s, s) for s in sizes], append_images=imgs[:-1])
PY
ls -l build/icon.icns build/icon.ico build/icon.png
