"""
Pump test. Both pumps must be OFF when you start.
Run:  ./run.sh tests/pump_test.py
"""
from button import ButtonPresser
from pumps import Pump, run_together

presser = ButtonPresser()
pump1 = Pump(presser, servo=1)
pump2 = Pump(presser, servo=2)

print("pump 1 for 10 s")
pump1.run(10)

print("pump 2 for 10 s")
pump2.run(10)

print("both together: pump 1 for 10 s, pump 2 for 5 s")
run_together({pump1: 10, pump2: 5})

print("done")
