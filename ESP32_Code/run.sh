#!/usr/bin/env bash
# Run a script on the ESP32 without saving it to the board.
# Usage: ./run.sh apps/pump_server.py
#        ./run.sh tests/pump_test.py
#        ./run.sh                       (no argument = open the REPL; Ctrl-] to exit)
set -euo pipefail
cd "$(dirname "$0")"
MP=".venv/bin/mpremote connect $(tools/esp32_port.sh)"

if [ $# -eq 0 ]; then
  $MP repl
  exit
fi
if [ ! -f "$1" ]; then
  echo "No such file: $1"
  exit 1
fi

# Hard-reset first: if a previous run was interrupted, the board can be left
# hung and refuse to connect ("could not enter raw repl").
.venv/bin/python tools/hard_reset.py

# Programs that serve the website (boba_server.py) read it from /www on the
# board's own flash (reading it through the mount below is far too slow).
# mpremote skips files that haven't changed.
if grep -q '"/www"' "$1"; then
  tools/build_www.sh
  args=(exec "import os; 'www' in os.listdir('/') or os.mkdir('/www')")
  for f in www/*; do
    args+=(+ cp "$f" ":/www/$(basename "$f")")
  done
  $MP "${args[@]}"
fi

# "mount ." makes this folder appear on the board as /remote (the working
# directory), so wifi_config.py and lib/ are used straight from the Mac.
# The script gets a one-line prefix that puts /remote/lib first on the import
# path (on the board itself, installed libraries live in /lib, which MicroPython
# searches by default). Error line numbers are therefore off by one.
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT
script="$tmpdir/$(basename "$1")"
{ echo "import sys; sys.path.insert(0, '/remote/lib')"; cat "$1"; } > "$script"
$MP mount . run "$script"
