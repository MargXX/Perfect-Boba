from machine import UART

# Talks to Arduino_Code/button_presser on the Arduino Uno, which drives the servo.
# Wiring: ESP32 GPIO 18 -> Arduino pin 2, and ESP32 GND -> Arduino GND.
TX_PIN = 18
RX_PIN = 19  # unused, but UART needs one; keeps it off GPIO 16 (used by main.py)


class ButtonPresser:
    """
        b = ButtonPresser()
        b.press()       # press the button once
        b.angle(70)     # move and hold, for finding the right press angle
    """

    def __init__(self, tx=TX_PIN, rx=RX_PIN):
        self.uart = UART(2, baudrate=9600, tx=tx, rx=rx)

    def send(self, cmd):
        # Leading newline ends any junk the Arduino picked up from line noise,
        # so the command itself arrives on a clean line.
        self.uart.write("\n" + cmd + "\n")

    def press(self):
        self.send("PRESS")

    def angle(self, degrees):
        self.send("ANGLE %d" % degrees)
