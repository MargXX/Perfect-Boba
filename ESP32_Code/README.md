# ESP32 code (MicroPython)

The ESP32 is the machine's brain. It decides when each pump runs and tells the Arduino Uno (`../Arduino_Code`) to press the pumps' toggle buttons with servos.

## Folder layout

```
ESP32_Code/
├── lib/                    Libraries the programs import (installed to /lib on the board)
│   ├── button.py             Sends PRESS / ANGLE commands to the Uno over UART
│   ├── pumps.py              Pump class: tracks each toggle pump's on/off state
│   └── servo.py              Drives a servo straight from an ESP32 pin (PWM)
├── apps/                   Programs that run the machine (one becomes the board's main.py)
│   ├── pump_server.py        Phone control page over the ESP32's own WiFi
│   └── gpio_recipe.py        Early prototype: recipe on pumps wired directly to GPIO pins
├── tests/                  Hardware test scripts
│   ├── pump_test.py          Each pump for 10 s, then both together
│   ├── pump_loop_test.py     Endless alternating pump runs, for reliability checks
│   ├── button_test.py        Presses servo 1 three times
│   ├── pin_finder.py         Sweeps a servo on each GPIO to find which pin it's on
│   └── servo_test.py         Drives a servo directly from the ESP32 (no Uno)
├── tools/                  Mac-side helpers used by the scripts (never copied to the board)
│   ├── esp32_port.sh         Finds the ESP32's serial port
│   └── hard_reset.py         Resets the ESP32 over USB and waits for it to boot
├── run.sh                  Run a script on the board without installing it
├── install.sh              Install a program so it runs on its own at power-up
├── flash.sh                Erase the board and install MicroPython (one time)
├── wifi_config_example.py  Template for wifi_config.py (the real one is gitignored)
├── requirements.txt        Mac-side Python tools (esptool, mpremote, editor stubs)
└── pyrightconfig.json      Editor settings so VS Code understands MicroPython + lib/
```

On the board, an installed setup looks like `/main.py` (the program), `/wifi_config.py` and `/lib/*.py`. MicroPython searches `/lib` for imports automatically.

## One-time setup

The Mac-side tools are in `.venv/`. To recreate the venv on another machine:

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cp wifi_config_example.py wifi_config.py   # then edit the network name/password
```

Plug in the ESP32 over USB, then flash MicroPython:

```sh
./flash.sh            # classic ESP32 (ESP32-WROOM / DevKit)
./flash.sh esp32s3    # ESP32-S3 boards
```

If it can't connect, hold the **BOOT** button while it connects.

## Day-to-day

| Command | What it does |
|---|---|
| `./run.sh apps/pump_server.py` | Runs a script on the board without installing it, using `lib/` and `wifi_config.py` straight from the Mac (Ctrl-C to stop) |
| `./run.sh tests/pump_test.py` | Same, for a test |
| `./run.sh` | Opens the interactive REPL (Ctrl-] to exit) |
| `./install.sh apps/pump_server.py` | Installs `lib/`, `wifi_config.py` and the program as `main.py`, so it runs on its own at power-up |
| `./install.sh --remove` | Deletes `main.py`, so nothing runs at power-up |

`run.sh` and `install.sh` hard-reset the board first, so a run that was interrupted can't leave it stuck. All the scripts connect to the ESP32's port explicitly. Otherwise mpremote can pick the Uno instead when both are plugged in.

After changing anything in `lib/` or `apps/`, run `./install.sh …` again to update the board. `run.sh` always uses the current files on the Mac.

## Phone control over WiFi (`apps/pump_server.py`)

The ESP32 creates its own WiFi network. No school or home WiFi is needed.

1. Make sure both pumps are **off**. The buttons are toggles, so the program assumes they start off.
2. Run `./run.sh apps/pump_server.py`, or `./install.sh apps/pump_server.py` to run it from the wall without the Mac.
3. On your phone, join the network set in `wifi_config.py` (default `BobaBot`). Stay connected even if the phone says there's no internet.
4. Open **http://192.168.4.1**.

Each pump has **Run** (for a number of seconds, up to 120) and **Stop**, and both can run at once. The page updates every second. If a pump gets out of step (for example, someone pressed its button by hand), use "Out of sync? It's actually on / off" to correct it without pressing the button. The onboard LED (GPIO 2) is lit while any pump is on.

The ESP32 only supports 2.4 GHz WPA2 WiFi with a plain password. It can't join networks like "Brown" that use a username and password (enterprise WiFi).

## Libraries (`lib/`)

```python
from button import ButtonPresser
from pumps import Pump, run_together

presser = ButtonPresser()
pump1 = Pump(presser, servo=1)
pump2 = Pump(presser, servo=2)

pump1.run(10)                        # on for 10 s, then off
pump2.on(); pump2.off()
run_together({pump1: 10, pump2: 5})  # both at once, each with its own time
```

- **`button.py`** sends `PRESS <servo> <id> <check>` lines to the Uno over UART at 9600 baud (GPIO 18 → Uno pin 2). The link is one-way with no acknowledgments, so each press is sent 3 times with the same id and a checksum. The Uno acts on the first intact copy and ignores the rest, so a garbled command can't cause an extra toggle.
- **`pumps.py`** remembers whether each pump is on, and waits 1.3 s after each press so commands never overlap.
- **`servo.py`** drives a servo directly with the ESP32's PWM hardware (50 Hz, 500–2500 µs pulses). The current setup doesn't use it, since the Uno drives the servos, but `tests/servo_test.py` and `tests/pin_finder.py` do.

## Wiring

| From | To |
|---|---|
| ESP32 GPIO 18 (through a 1 kΩ resistor) | Uno pin 2 |
| ESP32 GND | Uno GND, **only when the boards aren't both on the same USB source** (see below) |

The servos are wired to and powered by the Uno. See `../Arduino_Code/README.md`.

**Ground jumper rule:** if both boards are plugged into the Mac, or into the same multi-port USB charger, they already share ground through it. Adding the jumper then makes a ground loop. Servo current flows through the ESP32 and crashes it (`Guru Meditation Error … IllegalInstruction`). Leave the jumper off in that case. If the boards are on separate power sources, the jumper is required, or the commands won't get through.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `could not enter raw repl` with a `b'\x00\x00…'` dump | mpremote talked to the Uno instead of the ESP32. The scripts handle this. By hand, use `mpremote connect /dev/cu.usbserial-0001 …` |
| `Guru Meditation Error … IllegalInstruction` when a servo moves | Ground loop. Remove the ESP32 ↔ Uno GND jumper when both boards share a USB source |
| Boot loop with `flash read err` | Something is on GPIO 6–11 or 12, or a servo is powered from the ESP32's 5V pin. Unplug it |
| A pump is on when the page says off (or the reverse) | A press was lost, or the button was pressed by hand. Use "Out of sync?" on the page |
| `ImportError: no module named 'button'` | When running by hand, `lib/` isn't on the import path. Use `./run.sh`, or `./install.sh` to put the libraries in `/lib` on the board |
| `PWM is inactive` | MicroPython 1.29 bug with `duty_ns=` in the `PWM()` constructor. `servo.py` works around it |

## Driving a servo directly from the ESP32

`lib/servo.py` can drive an MG995/MG996R straight from an ESP32 pin. The current setup uses the Uno instead, because the servo's power surges made this ESP32 reset.

```python
from servo import Servo, ContinuousServo
arm = Servo(18)
arm.angle(90)
arm.sweep(0, 180, seconds=2)
arm.release()
```

Power the servo from a separate 5–6 V supply, never the ESP32's pins, and connect that supply's ground to the ESP32's GND. Avoid GPIO 34–39 (input only) and 6–11 (flash).
