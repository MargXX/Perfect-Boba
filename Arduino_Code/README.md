# Arduino code (Uno)

The Uno drives the button-pressing servo. The ESP32 tells it when to press over one wire (see `ESP32_Code/button.py`).

Tools: `arduino-cli` (`brew install arduino-cli`), with the `arduino:avr` core and the `Servo` library installed.

| Command | What it does |
|---|---|
| `./upload.sh` | Compiles and uploads `button_presser/` to the Uno |
| `./monitor.sh` | Shows the Uno's debug output (Ctrl-C to exit) |

To try commands by hand, run `./monitor.sh` and type `PRESS` or `ANGLE 70`. The monitor sends over USB rather than pin 2, so this tests the servo side without the ESP32.

## Wiring

| From | To |
|---|---|
| ESP32 GPIO 18 | Uno pin 2 |
| ESP32 GND | Uno GND |
| Servo orange | Uno pin 9 |
| Servo red | Uno 5V |
| Servo brown | Uno GND |

Tune `PRESS_ANGLE` and `REST_ANGLE` at the top of `button_presser.ino`.
