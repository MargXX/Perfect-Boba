#!/usr/bin/env bash
# Copy every .py file in this folder to the ESP32 and reset it.
# main.py runs automatically on boot.
set -euo pipefail
cd "$(dirname "$0")"
MP=".venv/bin/mpremote connect $(tools/esp32_port.sh)"

for f in *.py; do
  $MP cp "$f" ":$f"
done
$MP reset
