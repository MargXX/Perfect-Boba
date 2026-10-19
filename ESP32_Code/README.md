# ESP32 code (MicroPython)

The board runs MicroPython. `main.py` runs automatically on boot.

## One-time setup

The tools are in `.venv/`. To recreate the venv on another machine:

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

Plug in the ESP32 over USB, then flash MicroPython:

```sh
./flash.sh            # classic ESP32 (ESP32-WROOM / DevKit)
./flash.sh esp32s3    # ESP32-S3 boards
```

If the port isn't found, hold the **BOOT** button while it connects. You can also pass the port yourself: `./flash.sh esp32 /dev/cu.usbserial-0001`.

## Day-to-day

| Command | What it does |
|---|---|
| `./run.sh servo_test.py` | Runs a script on the board without saving it |
| `./upload.sh` | Copies all `.py` files to the board and resets it |
| `./run.sh` | Opens the interactive REPL (Ctrl-] to exit) |

## Button-pressing servo (via the Arduino)

The button servo is driven by the Arduino Uno (`../Arduino_Code`). The ESP32 sends it commands over one wire: GPIO 18 to Uno pin 2, plus a shared GND. This keeps the servo's power surges away from the ESP32, which otherwise boot-loops.

```python
from button import ButtonPresser
b = ButtonPresser()
b.press()
b.angle(70)    # move and hold, for tuning
```

**Ground jumper (ESP32 GND → Uno GND):** connect it only when the boards are *not* both plugged into the Mac. If both are on the Mac's USB, they already share ground through it, and the extra jumper makes a ground loop that carries servo current through the ESP32 and crashes it. Standalone (wall power, no Mac) the jumper is required.

Test it with `./run.sh button_test.py`. To find which pin a servo is on, use `./run.sh pin_finder.py`.

## Servos driven directly by the ESP32 (MG995 / MG996R)

```python
from servo import Servo, ContinuousServo

arm = Servo(18)          # standard 180° servo
arm.angle(90)
arm.sweep(0, 180, seconds=2)
arm.release()            # go limp

spin = ContinuousServo(19)   # only for the 360° continuous-rotation version
spin.speed(0.5)
spin.stop()
```

### Wiring

| Servo wire | Connect to |
|---|---|
| Brown | GND, shared by the servo supply **and** the ESP32 |
| Red | **External 5–6 V supply** (never the ESP32's 3.3 V or 5 V pin) |
| Orange | ESP32 GPIO (e.g. 18, 19, 21, 22, 23, 25, 26, 27, 32, 33) |

Each MG995/MG996R can pull 2–2.5 A when it stalls, so budget about 2.5 A per servo on the supply. Put a large capacitor (470–1000 µF) across the servo supply. Avoid GPIO 34–39 (input only) and 6–11 (flash). GPIO 4, 5, 13, 14, 16 and 17 are already used by `main.py`.
