#!/usr/bin/env bash
# Run a script on the ESP32 without saving it, using the libraries already on the board.
# Usage: ./run.sh servo_test.py     (no argument = open the REPL; Ctrl-] to exit)
set -euo pipefail
cd "$(dirname "$0")"
MP=".venv/bin/mpremote connect $(tools/esp32_port.sh)"

if [ $# -eq 0 ]; then
  $MP repl
else
  # Hard-reset first: if a previous run was interrupted, the board can be left
  # hung and refuse to connect ("could not enter raw repl").
  .venv/bin/python tools/hard_reset.py
  # mount . makes local files (servo.py etc.) importable without uploading
  $MP mount . run "$1"
fi
