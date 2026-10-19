#!/usr/bin/env bash
# Compile and upload a sketch to the Arduino Uno.
# Usage: ./upload.sh [sketch_folder] [port]     (defaults: button_presser, auto-detected port)
set -euo pipefail
cd "$(dirname "$0")"

SKETCH="${1:-button_presser}"
PORT="${2:-$(arduino-cli board list | awk '/arduino:avr:uno/ {print $1; exit}')}"

if [ -z "$PORT" ]; then
  echo "No Arduino Uno found. Plug it in, or pass the port: ./upload.sh $SKETCH /dev/cu.usbmodemXXXX"
  exit 1
fi

arduino-cli compile --fqbn arduino:avr:uno "$SKETCH"
arduino-cli upload --fqbn arduino:avr:uno --port "$PORT" "$SKETCH"
echo "Uploaded $SKETCH to $PORT"
