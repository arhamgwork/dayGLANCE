#!/usr/bin/env bash
#
# Regenerates the iOS app icons in dayglance-ios/DayGlance/Assets.xcassets/
# AppIcon.appiconset from one square source image, with macOS's built-in `sips`
# (no npm dependency; jimp did this once, ad hoc, and was removed).
#
# The sizes come from the icon set's own Contents.json: each filename is
# Icon-<points>[@<scale>x].png, so Icon-83.5@2x.png is 167px. Adding a size
# there and rerunning is all a new slot needs.
#
# The source must be opaque: App Store Connect rejects a 1024px marketing icon
# with an alpha channel. That is why the default is the maskable icon (solid
# orange background), not icon-512.png (transparent).
#
# Usage:  npm run ios:icons [-- path/to/source.png]
#         default source: public/icon-maskable-512.png

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

SRC="${1:-public/icon-maskable-512.png}"
SET="dayglance-ios/DayGlance/Assets.xcassets/AppIcon.appiconset"

if ! command -v sips >/dev/null 2>&1; then
  echo "sips not found: this script runs on macOS." >&2
  exit 1
fi
[ -f "$SRC" ] || { echo "Source not found: $SRC" >&2; exit 1; }
[ -f "$SET/Contents.json" ] || { echo "Icon set not found: $SET" >&2; exit 1; }

if [ "$(sips -g hasAlpha "$SRC" | awk '/hasAlpha/ {print $2}')" = "yes" ]; then
  echo "Source has an alpha channel: App Store Connect rejects the 1024px icon." >&2
  echo "Use an opaque image (e.g. public/icon-maskable-512.png)." >&2
  exit 1
fi

width="$(sips -g pixelWidth "$SRC" | awk '/pixelWidth/ {print $2}')"
height="$(sips -g pixelHeight "$SRC" | awk '/pixelHeight/ {print $2}')"
if [ "$width" != "$height" ]; then
  echo "Source is ${width}x${height}: it must be square." >&2
  exit 1
fi
if [ "$width" -lt 1024 ]; then
  echo "Note: source is ${width}px, so the 1024px icon is scaled up. A 1024px source looks sharper." >&2
fi

# Every distinct filename in Contents.json, in order.
names="$(grep -o '"filename"[[:space:]]*:[[:space:]]*"[^"]*"' "$SET/Contents.json" | sed 's/.*"\([^"]*\)"$/\1/' | awk '!seen[$0]++')"
[ -n "$names" ] || { echo "No filenames in $SET/Contents.json" >&2; exit 1; }

count=0
for name in $names; do
  px="$(printf '%s\n' "$name" | awk '
    match($0, /^Icon-[0-9.]+(@[0-9]+x)?\.png$/) {
      spec = substr($0, 6, length($0) - 9)   # "83.5@2x" or "1024"
      n = split(spec, part, "@")
      scale = (n == 2) ? substr(part[2], 1, length(part[2]) - 1) : 1
      printf "%d\n", part[1] * scale + 0.5
    }')"
  if [ -z "$px" ]; then
    echo "Unrecognised filename in Contents.json: $name (expected Icon-<points>[@<scale>x].png)" >&2
    exit 1
  fi
  sips -z "$px" "$px" "$SRC" --out "$SET/$name" >/dev/null
  echo "  $name  ${px}px"
  count=$((count + 1))
done

echo "Wrote $count icons to $SET from $SRC"
