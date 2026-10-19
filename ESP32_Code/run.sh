#!/usr/bin/env bash
# Run a script on the ESP32 without saving it, using the libraries already on the board.
# Usage: ./run.sh servo_test.py     (no argument = open the REPL; Ctrl-] to exit)
set -euo pipefail
cd "$(dirname "$0")"

if [ $# -eq 0 ]; then
  .venv/bin/mpremote repl
else
  # mount . makes local files (servo.py etc.) importable without uploading
  .venv/bin/mpremote mount . run "$1"
fi
