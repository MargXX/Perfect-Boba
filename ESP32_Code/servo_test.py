"""
Quick hardware check for an MG995 / MG996R.
Run without copying to the board:   ./run.sh servo_test.py
"""
from servo import Servo
import time

SERVO_PIN = 18  # change to whichever GPIO the signal wire is on

s = Servo(SERVO_PIN)

for deg in (0, 90, 180, 90):
    print("angle", deg)
    s.angle(deg)
    time.sleep(1)

print("sweep 0 -> 180 -> 0")
s.sweep(0, 180, seconds=2)
s.sweep(180, 0, seconds=2)

s.release()
print("done")
