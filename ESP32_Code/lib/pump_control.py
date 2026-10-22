import asyncio
import time

from pumps import PRESS_SECONDS


class _Pump:
    def __init__(self, servo):
        self.servo = servo
        self.is_on = False
        self.stop_at = None  # ticks_ms when a timed run should end
        self.timed = True    # False for Start (run until Stop)
        self.on_at = None    # ticks_ms when the "on" press was sent
        self.last_run = None # seconds between the last on and off presses


class PumpControl:
    """
    The toggle-button pumps, for asyncio programs (pumps.py is the blocking
    version). Both pumps must be OFF when it starts.

        pumps = PumpControl(ButtonPresser(), count=2, led=Pin(2, Pin.OUT))
        asyncio.create_task(pumps.timer_loop())
        await pumps.run_together({1: 10, 2: 4.5})   # pump 1 for 10 s, pump 2 for 4.5 s
    """

    def __init__(self, presser, count=2, led=None):
        self.presser = presser
        self.led = led
        self.pumps = [_Pump(n + 1) for n in range(count)]
        # Only one servo press at a time, and wait for each to finish (see pumps.py).
        self.lock = asyncio.Lock()

    def pump(self, n):
        """Pump n (1-based), or None if there's no such pump."""
        return self.pumps[n - 1] if 1 <= n <= len(self.pumps) else None

    def _show(self):
        if self.led:
            self.led.value(any(p.is_on for p in self.pumps))

    async def set_on(self, n, on):
        p = self.pump(n)
        async with self.lock:
            if p.is_on != on:
                # Time from press to press, so the servo's delay cancels out.
                if on:
                    p.on_at = time.ticks_ms()
                elif p.on_at is not None:
                    p.last_run = time.ticks_diff(time.ticks_ms(), p.on_at) / 1000
                self.presser.press(p.servo)
                await asyncio.sleep(PRESS_SECONDS)
                p.is_on = on
        self._show()

    async def run_for(self, n, seconds, timed=True):
        """Turn pump n on; timer_loop() turns it off after `seconds`.
        timed=False marks it as run-until-Stop (`seconds` is only a safety limit)."""
        self.pump(n).timed = timed
        await self.set_on(n, True)
        # Start the clock once the pump is actually on, so it runs the full time.
        self.pump(n).stop_at = time.ticks_add(time.ticks_ms(), int(seconds * 1000))

    async def stop(self, n):
        p = self.pump(n)
        p.stop_at = None
        await self.set_on(n, False)
        p.stop_at = None  # in case a run_for() finished while we waited

    async def stop_all(self):
        for p in self.pumps:
            await self.stop(p.servo)

    async def run_together(self, durations):
        """Run each pump for its own time ({pump: seconds}) and return when all are off.
        Pumps turn on one after another (a press takes ~1.3 s), and each one's
        timer starts when it actually turns on."""
        for n, seconds in durations.items():
            await self.run_for(n, seconds)
        while any(self.pump(n).is_on for n in durations):
            await asyncio.sleep_ms(100)

    def fix(self, n, on):
        """The pump got out of step with what we think (a lost press, or it was
        toggled by hand). Correct our record without pressing."""
        p = self.pump(n)
        p.is_on = on
        p.stop_at = None
        self._show()

    async def timer_loop(self):
        while True:
            for p in self.pumps:
                if p.stop_at is not None and time.ticks_diff(p.stop_at, time.ticks_ms()) <= 0:
                    await self.stop(p.servo)
            await asyncio.sleep_ms(100)

    def status(self):
        out = []
        for p in self.pumps:
            left = elapsed = None
            if p.stop_at is not None and p.timed:
                left = max(0, time.ticks_diff(p.stop_at, time.ticks_ms())) / 1000
            if p.is_on and p.on_at is not None:
                elapsed = time.ticks_diff(time.ticks_ms(), p.on_at) / 1000
            out.append({"on": p.is_on, "remaining": left, "elapsed": elapsed, "last_run": p.last_run})
        return {"pumps": out, "busy": self.lock.locked()}
