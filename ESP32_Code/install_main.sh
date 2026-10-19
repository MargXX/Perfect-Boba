#!/usr/bin/env bash
# Install a script as the ESP32's main.py so it runs on its own at power-up,
# without the Mac. Also copies the libraries it needs.
# Usage: ./install_main.sh pump_loop_test.py
# Put the real machine code back afterwards with: ./upload.sh
set -euo pipefail
cd "$(dirname "$0")"
MP=".venv/bin/mpremote connect $(tools/esp32_port.sh)"

if [ $# -ne 1 ]; then
  echo "Usage: ./install_main.sh <script.py>"
  exit 1
fi

.venv/bin/python tools/hard_reset.py
EXTRA=""
[ -f wifi_config.py ] && EXTRA="cp wifi_config.py :wifi_config.py +"
$MP cp button.py :button.py + cp pumps.py :pumps.py + cp servo.py :servo.py + $EXTRA cp "$1" :main.py + reset
echo "Installed $1 as main.py. It now runs whenever the ESP32 powers on."
