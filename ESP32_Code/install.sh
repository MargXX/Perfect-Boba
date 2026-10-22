#!/usr/bin/env bash
# Install a program on the ESP32 so it runs by itself at power-up (no Mac needed).
# Copies lib/*.py to /lib on the board, wifi_config.py to /, the website to /www
# (for programs that serve it), and the program as /main.py.
# Usage: ./install.sh apps/pump_server.py
#        ./install.sh --remove          (delete main.py so nothing runs at power-up)
set -euo pipefail
cd "$(dirname "$0")"
MP=".venv/bin/mpremote connect $(tools/esp32_port.sh)"

if [ $# -ne 1 ]; then
  echo "Usage: ./install.sh apps/pump_server.py   or   ./install.sh --remove"
  exit 1
fi

.venv/bin/python tools/hard_reset.py

if [ "$1" = "--remove" ]; then
  $MP exec "import os; 'main.py' in os.listdir() and os.remove('main.py'); print('on board:', os.listdir())"
  echo "Removed main.py. Nothing runs at power-up now."
  exit
fi

if [ ! -f "$1" ]; then
  echo "No such file: $1"
  exit 1
fi
if grep -q wifi_config "$1" && [ ! -f wifi_config.py ]; then
  echo "$1 needs wifi_config.py. Create it first: cp wifi_config_example.py wifi_config.py"
  exit 1
fi

# Older versions of this script put the libraries at the board's root, where they
# would shadow the ones in /lib, so remove those. Then make sure /lib exists.
args=(exec "import os; [os.remove(f) for f in ('button.py', 'pumps.py', 'servo.py') if f in os.listdir()]; 'lib' in os.listdir() or os.mkdir('lib')")
for f in lib/*.py; do
  args+=(+ cp "$f" ":lib/$(basename "$f")")
done
if [ -f wifi_config.py ]; then
  args+=(+ cp wifi_config.py :wifi_config.py)
fi
# Programs that serve the website (boba_server.py) read it from /www.
if grep -q '"/www"' "$1"; then
  tools/build_www.sh
  args+=(+ exec "import os; 'www' in os.listdir('/') or os.mkdir('/www')")
  for f in www/*; do
    args+=(+ cp "$f" ":/www/$(basename "$f")")
  done
fi
args+=(+ cp "$1" :main.py + reset)

$MP "${args[@]}"
echo "Installed $1 as main.py. It now runs whenever the ESP32 powers on."
