# Arduino code (Uno)

The Uno drives the button-pressing servos (up to 2). The ESP32 tells it when to press over one wire (see `ESP32_Code/lib/button.py`).

Tools: `arduino-cli` (`brew install arduino-cli`), with the `arduino:avr` core and the `Servo` library installed.

| Command | What it does |
|---|---|
| `./upload.sh` | Compiles and uploads `button_presser/` to the Uno |
| `./monitor.sh` | Shows the Uno's debug output (Ctrl-C to exit) |

To try commands by hand, run `./monitor.sh` and type `PRESS 1`, `PRESS 2`, `ANGLE 1 70` or `ANGLE 2 70`. Plain `PRESS` and `ANGLE 70` mean servo 1. The monitor sends over USB rather than pin 2, so this tests the servo side without the ESP32.

## Wiring

| From | To |
|---|---|
| ESP32 GPIO 18 | Uno pin 2 |
| ESP32 GND | Uno GND |
| Servo 1 orange | Uno pin 9 |
| Servo 2 orange | Uno pin 10 |
| Both servos red | Uno 5V |
| Both servos brown | Uno GND |

**Ground jumper (ESP32 GND → Uno GND):** connect it only when the boards are *not* both plugged into the Mac. If both are on the Mac's USB, they already share ground through it, and the extra jumper makes a ground loop that carries servo current through the ESP32 and crashes it. Standalone (wall power, no Mac) the jumper is required.

Tune `PRESS_ANGLE` and `REST_ANGLE` (one value per servo) at the top of `button_presser.ino`.
