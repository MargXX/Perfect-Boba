"""
Turns the pump on for 10 seconds, then off.
The pump's button is a toggle (one press = on, next press = off),
so this assumes the pump is OFF when you start.

Run:  ./run.sh pump_test.py
"""
from button import ButtonPresser
import time

PUMP_SECONDS = 10

b = ButtonPresser()

print("pump ON")
b.press()
time.sleep(PUMP_SECONDS)

print("pump OFF")
b.press()
print("done")
