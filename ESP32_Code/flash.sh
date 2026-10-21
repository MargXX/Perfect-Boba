#!/usr/bin/env bash
# Erase the ESP32 and install MicroPython firmware.
# Usage: ./flash.sh [esp32|esp32s3] [port]
#   Port is auto-detected if omitted.
set -euo pipefail
cd "$(dirname "$0")"

CHIP="${1:-esp32}"
PORT="${2:-$(tools/esp32_port.sh)}"
VERSION="20260824-v1.29.0"

case "$CHIP" in
  esp32)   BIN="ESP32_GENERIC-$VERSION.bin";    OFFSET=0x1000 ;;
  esp32s3) BIN="ESP32_GENERIC_S3-$VERSION.bin"; OFFSET=0x0 ;;
  *) echo "Unknown chip '$CHIP' (use esp32 or esp32s3)"; exit 1 ;;
esac

if [ ! -f "firmware/$BIN" ]; then
  mkdir -p firmware
  curl -fL -o "firmware/$BIN" "https://micropython.org/resources/firmware/$BIN"
fi

PORT_ARG=""
[ -n "$PORT" ] && PORT_ARG="--port $PORT"

.venv/bin/esptool.py --chip "$CHIP" $PORT_ARG erase_flash
# Conservative flash settings (DIO, 40 MHz, 115200 baud) — slower, but works on boards
# whose flash chip is flaky at the faster defaults. Override with BAUD=460800 ./flash.sh
.venv/bin/esptool.py --chip "$CHIP" $PORT_ARG --baud "${BAUD:-115200}" write_flash \
  --flash_mode dio --flash_freq 40m -z "$OFFSET" "firmware/$BIN"
echo "MicroPython installed. Next: ./run.sh apps/pump_server.py"
