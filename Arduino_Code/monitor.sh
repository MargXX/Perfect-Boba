#!/usr/bin/env bash
# Show the Arduino's debug output (the "got: PRESS" lines). Ctrl-C to exit.
set -euo pipefail

PORT="${1:-$(arduino-cli board list | awk '/arduino:avr:uno/ {print $1; exit}')}"
arduino-cli monitor --port "$PORT" --config baudrate=9600
