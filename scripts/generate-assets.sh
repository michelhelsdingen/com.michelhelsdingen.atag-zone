#!/usr/bin/env bash
# Genereert alle App Store PNG-assets uit de icon.svg-bronbestanden.
# Gebruikt ImageMagick (`magick`), installeer met: brew install imagemagick
#
# App-icoon: assets/icon.svg -> assets/images/{small,large,xlarge}.png
# Driver-icoon: drivers/thermostat/assets/icon.svg -> drivers/thermostat/assets/images/{small,large,xlarge}.png
#
# Transparante achtergrond, geen tekst, vector-gebaseerd bronbestand
# (voldoet aan Homey's App Store icoon-richtlijnen, zie NOTES.md).

set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v magick >/dev/null 2>&1; then
  echo "ImageMagick (magick) niet gevonden. Installeer met: brew install imagemagick" >&2
  exit 1
fi

generate_rect() {
  local svg="$1" out="$2" width="$3" height="$4"
  magick -size "${width}x${height}" xc:none \
    \( -background none "$svg" -resize "x${height}" \) \
    -gravity center -compose over -composite \
    PNG32:"$out"
}

# App-iconen (250x175, 500x350, 1000x700)
echo "App-iconen genereren..."
generate_rect assets/icon.svg assets/images/small.png 250 175
generate_rect assets/icon.svg assets/images/large.png 500 350
generate_rect assets/icon.svg assets/images/xlarge.png 1000 700

# Driver-iconen (75x75, 500x500, 1000x1000)
echo "Driver-iconen genereren..."
generate_rect drivers/thermostat/assets/icon.svg drivers/thermostat/assets/images/small.png 75 75
generate_rect drivers/thermostat/assets/icon.svg drivers/thermostat/assets/images/large.png 500 500
generate_rect drivers/thermostat/assets/icon.svg drivers/thermostat/assets/images/xlarge.png 1000 1000

echo "Klaar. Gegenereerde bestanden:"
file assets/images/*.png drivers/thermostat/assets/images/*.png
