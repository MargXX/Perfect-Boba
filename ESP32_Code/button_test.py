"""
Presses the button 3 times via the Arduino.
Run:  ./run.sh button_test.py
"""
from button import ButtonPresser
import time

b = ButtonPresser()
for i in range(3):
    print("press", i + 1)
    b.press()
    time.sleep(2)
print("done")
