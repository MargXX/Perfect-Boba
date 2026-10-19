"""
Find which GPIO the servo's signal wire is on.
Sends a servo sweep to each pin in turn and prints the pin number —
whichever number is on screen when the servo moves is your pin.

Run:  ./run.sh pin_finder.py      (Ctrl-C to stop)
"""
from servo import Servo
import time

# Every pin that can safely output PWM on a classic ESP32.
# Skips 1 & 3 (USB serial), 6-11 (flash chip), 34-39 (input only).
PINS = [2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33]

while True:
    for pin in PINS:
        print()
        print("========== trying GPIO", pin, "==========")
        s = Servo(pin)
        for _ in range(2):
            s.sweep(0, 180, seconds=1)
            s.sweep(180, 0, seconds=1)
        s.release()
        s.deinit()
        time.sleep(1)
    print("--- all pins tried, starting over ---")
