"""
Endless pump test: every 20 s, one pump runs for 5 s. Alternates pump 1, pump 2, ...
Only one pump is ever on at a time. The ESP32's onboard LED (GPIO 2) is lit
while a pump should be pumping, so you can compare it with the real pump.

Both pumps must be OFF when it starts.

With the Mac:   ./run.sh tests/pump_loop_test.py  (Ctrl-C to stop)
Without:        ./install.sh tests/pump_loop_test.py, then power from the wall
"""
from machine import Pin
from button import ButtonPresser
from pumps import Pump
import time

CYCLE_SECONDS = 20
PUMP_SECONDS = 5
STARTUP_SECONDS = 3  # when everything powers on together, give the Uno time to boot

led = Pin(2, Pin.OUT, value=0)

# Three quick blinks: the script has started.
for _ in range(3):
    led.on()
    time.sleep_ms(150)
    led.off()
    time.sleep_ms(150)
time.sleep(STARTUP_SECONDS)

presser = ButtonPresser()
pumps = [Pump(presser, servo=1), Pump(presser, servo=2)]

cycle = 0
while True:
    start = time.ticks_ms()
    pump = pumps[cycle % 2]
    print("cycle", cycle + 1, "- pump", pump.servo, "on")

    pump.on()
    led.on()
    time.sleep(PUMP_SECONDS)
    led.off()
    pump.off()
    print("  pump", pump.servo, "off")

    # Wait out the rest of the 20 s cycle, measured from the start of this one.
    remaining = CYCLE_SECONDS * 1000 - time.ticks_diff(time.ticks_ms(), start)
    if remaining > 0:
        time.sleep_ms(remaining)
    cycle += 1
