from button import ButtonPresser
import time

# How long the Arduino takes to press a button and return (~1.1 s).
# We wait this long after each press so commands never overlap.
PRESS_SECONDS = 1.3


class Pump:
    """
    A pump switched by a toggle button that a servo presses.
    One press turns it on, the next press turns it off.
    Assumes the pump is OFF when the program starts.

        presser = ButtonPresser()
        pump1 = Pump(presser, servo=1)
        pump1.run(10)        # on for 10 s, then off
    """

    def __init__(self, presser, servo):
        self.presser = presser
        self.servo = servo
        self.is_on = False

    def toggle(self):
        self.presser.press(self.servo)
        time.sleep(PRESS_SECONDS)
        self.is_on = not self.is_on

    def on(self):
        if not self.is_on:
            self.toggle()

    def off(self):
        if self.is_on:
            self.toggle()

    def run(self, seconds):
        self.on()
        time.sleep(seconds)
        self.off()


def run_together(durations):
    """
    Run several pumps at once, each for its own time:
        run_together({pump1: 10, pump2: 5})
    Pumps turn on one after another (a press takes ~1.3 s), and each one's
    timer starts when it actually turns on, so every pump runs its full time.
    """
    stop_at = {}
    for pump, seconds in durations.items():
        pump.on()
        stop_at[pump] = time.ticks_add(time.ticks_ms(), int(seconds * 1000))

    for pump in sorted(stop_at, key=lambda p: stop_at[p]):
        wait = time.ticks_diff(stop_at[pump], time.ticks_ms())
        if wait > 0:
            time.sleep_ms(wait)
        pump.off()
