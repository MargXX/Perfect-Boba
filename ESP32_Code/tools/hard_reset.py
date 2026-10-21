"""
Hard-reset the ESP32 over USB (same as pressing its EN button), then wait for
MicroPython to boot. Runs on the Mac, not the board — it lives in tools/ so
install.sh doesn't copy it to the ESP32.

Usage: .venv/bin/python tools/hard_reset.py [port]
"""
import glob
import sys
import time

import serial

ports = sys.argv[1:] or glob.glob("/dev/cu.usbserial-*") + glob.glob("/dev/cu.SLAB_USBtoUART*")
if not ports:
    sys.exit("No ESP32 serial port found. Is it plugged in?")

s = serial.Serial(ports[0], 115200, timeout=0.1)
# On ESP32 dev boards RTS drives EN (reset) and DTR drives BOOT.
# Pulse EN with BOOT released so it restarts normally.
s.dtr = False
s.rts = True
time.sleep(0.1)
s.rts = False

# Wait for the MicroPython prompt so the next command doesn't race the boot.
out = b""
deadline = time.time() + 5
while time.time() < deadline and b">>>" not in out:
    out += s.read(256)
s.close()
