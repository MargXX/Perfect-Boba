# ESP32 code (MicroPython)

The ESP32 is the machine's brain. It decides when each pump runs and tells the Arduino Uno (`../Arduino_Code`) to press the pumps' toggle buttons with servos. `main.py` runs automatically on boot.

## One-time setup

The tools (`esptool`, `mpremote`, editor stubs) are in `.venv/`. To recreate the venv on another machine:

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
| `./run.sh pump_server.py` | Runs a script on the board without saving it (Ctrl-C to stop) |
| `./run.sh` | Opens the interactive REPL (Ctrl-] to exit) |
| `./install_main.sh pump_server.py` | Saves a script as the board's `main.py`, so it runs on its own at power-up |
| `./upload.sh` | Copies every `.py` file to the board and resets it |

`run.sh` hard-resets the board first, so a run that was interrupted can't leave it stuck. All the scripts connect to the ESP32's port explicitly (`tools/esp32_port.sh`). Otherwise mpremote can pick the Uno instead when both are plugged in.

## Phone control over WiFi (`pump_server.py`)

The ESP32 creates its own WiFi network. No school or home WiFi is needed.

1. Make sure both pumps are **off**. The buttons are toggles, so the program assumes they start off.
2. Run `./run.sh pump_server.py`, or `./install_main.sh pump_server.py` to run it from the wall without the Mac.
3. On your phone, join the network set in `wifi_config.py` (default `BobaBot`). Stay connected even if the phone says there's no internet.
4. Open **http://192.168.4.1**.

Each pump has **Run** (for a number of seconds, up to 120) and **Stop**, and both can run at once. The page updates every second. If a pump gets out of step (for example, someone pressed its button by hand), use "Out of sync? It's actually on / off" to correct it without pressing the button. The onboard LED (GPIO 2) is lit while any pump is on.

The ESP32 only supports 2.4 GHz WPA2 WiFi with a plain password. It can't join networks like "Brown" that use a username and password (enterprise WiFi).

## Pumps in code

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

- `button.py` sends `PRESS` commands to the Uno over UART (GPIO 18 → Uno pin 2). Each press is sent 3 times with an id and checksum. The Uno acts on the first good copy, so a garbled command can't cause an extra toggle.
- `pumps.py` tracks whether each pump is on and waits 1.3 s after each press so commands never overlap.

## Tests

| Script | What it does |
|---|---|
| `pump_test.py` | Pump 1 for 10 s, pump 2 for 10 s, then both together |
| `pump_loop_test.py` | Runs forever: one pump for 5 s every 20 s, alternating, with the LED on while pumping. Good for long reliability checks. |
| `button_test.py` | Presses servo 1 three times |
| `pin_finder.py` | Sweeps a servo on each GPIO in turn, to find which pin it's on |
| `servo_test.py` | Drives a servo directly from the ESP32 (no Uno) |

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
| `PWM is inactive` | MicroPython 1.29 bug with `duty_ns=` in the `PWM()` constructor. `servo.py` works around it |

## Servos driven directly by the ESP32

`servo.py` can also drive an MG995/MG996R straight from an ESP32 pin, but the current setup uses the Uno instead. The servo's power surges made this ESP32 reset.

```python
from servo import Servo, ContinuousServo
arm = Servo(18)
arm.angle(90)
arm.sweep(0, 180, seconds=2)
arm.release()
```

Power the servo from a separate 5–6 V supply, never the ESP32's pins, and connect that supply's ground to the ESP32's GND. Avoid GPIO 34–39 (input only) and 6–11 (flash).
