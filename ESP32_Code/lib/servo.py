from machine import Pin, PWM
import time

# --- MG995 / MG996R defaults ---
# Both use a 50 Hz signal. Pulse width sets the position:
#   ~500 us = 0 deg, ~1500 us = 90 deg (center), ~2500 us = 180 deg
# Individual servos vary — calibrate MIN_US / MAX_US per motor if the
# ends buzz or don't reach full travel.
FREQ_HZ = 50
MIN_US = 500
MAX_US = 2500
MAX_ANGLE = 180


class Servo:
    """
    Positional servo (standard MG995 / MG996R).

        s = Servo(18)
        s.angle(90)
        s.sweep(0, 180, seconds=2)
    """

    def __init__(self, pin, min_us=MIN_US, max_us=MAX_US, max_angle=MAX_ANGLE):
        self.min_us = min_us
        self.max_us = max_us
        self.max_angle = max_angle
        self._angle = None
        # Start with duty_u16=0 (no pulses). Passing duty_ns= to the constructor
        # raises "PWM is inactive" on MicroPython 1.29 for ESP32.
        self.pwm = PWM(Pin(pin), freq=FREQ_HZ, duty_u16=0)

    def pulse_us(self, us):
        """Send a raw pulse width in microseconds."""
        us = max(self.min_us, min(self.max_us, us))
        self.pwm.duty_ns(int(us * 1000))

    def angle(self, degrees=None):
        """Move to `degrees` (0..max_angle). With no argument, return the last angle set."""
        if degrees is None:
            return self._angle
        degrees = max(0, min(self.max_angle, degrees))
        span = self.max_us - self.min_us
        self.pulse_us(self.min_us + span * degrees / self.max_angle)
        self._angle = degrees

    def sweep(self, start, end, seconds=1.0, steps=50):
        """Move smoothly from `start` to `end` degrees over `seconds`."""
        for i in range(steps + 1):
            self.angle(start + (end - start) * i / steps)
            time.sleep(seconds / steps)

    def release(self):
        """Stop sending pulses so the motor goes limp (saves power, stops buzzing)."""
        self.pwm.duty_ns(0)
        self._angle = None

    def deinit(self):
        self.pwm.deinit()


class ContinuousServo(Servo):
    """
    360-degree / continuous-rotation version of the MG995 / MG996R.
    Pulse width sets speed and direction instead of position.

        m = ContinuousServo(19)
        m.speed(0.5)    # half speed forward
        m.speed(-1)     # full speed reverse
        m.stop()
    """

    def __init__(self, pin, min_us=1000, max_us=2000, stop_us=1500):
        super().__init__(pin, min_us=min_us, max_us=max_us)
        # If the motor creeps at speed(0), nudge stop_us until it holds still.
        self.stop_us = stop_us

    def speed(self, value):
        """-1.0 (full reverse) .. 0 (stop) .. 1.0 (full forward)."""
        value = max(-1.0, min(1.0, value))
        if value >= 0:
            us = self.stop_us + (self.max_us - self.stop_us) * value
        else:
            us = self.stop_us + (self.stop_us - self.min_us) * value
        self.pulse_us(us)

    def stop(self):
        self.pulse_us(self.stop_us)
