from machine import UART
import os
import time

# Talks to Arduino_Code/button_presser on the Arduino Uno, which drives the servo.
# Wiring: ESP32 GPIO 18 -> Arduino pin 2, and ESP32 GND -> Arduino GND.
TX_PIN = 18
RX_PIN = 19  # unused, but UART needs one; keeps it off GPIO 16 (used by main.py)
COPIES = 3   # times each press is sent (see press())


def press_check(servo, press_id):
    # Lets the Arduino reject garbled copies. Must match pressCheck() in button_presser.ino.
    return (servo * 7 + press_id) % 97


class ButtonPresser:
    """
        b = ButtonPresser()
        b.press()           # press with servo 1
        b.press(2)          # press with servo 2
        b.angle(70)         # move servo 1 and hold, for finding the right press angle
        b.angle(70, 2)      # same for servo 2
    """

    def __init__(self, tx=TX_PIN, rx=RX_PIN):
        self.uart = UART(2, baudrate=9600, tx=tx, rx=rx)
        # Start ids at a random point so a fresh run doesn't repeat the previous
        # run's last id (the Arduino would skip it as a duplicate).
        self.press_id = int.from_bytes(os.urandom(2), "little") % 1000
        # Starting the UART puts a glitch on the wire. If a command follows right
        # away, the Arduino is still decoding the glitch and garbles the command,
        # so the first press gets lost. Let the line settle, then flush with a newline.
        time.sleep_ms(100)
        self.uart.write("\n")
        time.sleep_ms(50)

    def send(self, cmd):
        # Leading newline ends any junk the Arduino picked up from line noise,
        # so the command itself arrives on a clean line.
        self.uart.write("\n" + cmd + "\n")

    def press(self, servo=1):
        # The signal to the Arduino is marginal (3.3 V into a 5 V board, plus servo
        # noise), so a single command sometimes arrives garbled. Send each press a
        # few times with the same id; the Arduino acts on the first good copy and
        # ignores the rest.
        self.press_id = (self.press_id + 1) % 1000
        cmd = "PRESS %d %d %d" % (servo, self.press_id, press_check(servo, self.press_id))
        for _ in range(COPIES):
            self.send(cmd)

    def angle(self, degrees, servo=1):
        self.send("ANGLE %d %d" % (servo, degrees))
