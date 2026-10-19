#!/usr/bin/env bash
# Print the ESP32's serial port. Scripts pass it to mpremote explicitly because
# mpremote's auto-detect picks the first USB serial device, which is the
# Arduino Uno when it's plugged in too ("could not enter raw repl").
port=$(ls /dev/cu.usbserial-* /dev/cu.SLAB_USBtoUART* 2>/dev/null | head -1)
if [ -z "$port" ]; then
  echo "No ESP32 found (looked for /dev/cu.usbserial-*). Is it plugged in?" >&2
  exit 1
fi
echo "$port"
