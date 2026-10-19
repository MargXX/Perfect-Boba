#!/usr/bin/env bash
# Copy every .py file in this folder to the ESP32 and reset it.
# main.py runs automatically on boot.
set -euo pipefail
cd "$(dirname "$0")"

for f in *.py; do
  .venv/bin/mpremote cp "$f" ":$f"
done
.venv/bin/mpremote reset
