# Perfect-Boba

A boba machine that learns to make the best cup of boba. People order from their phones, the machine dispenses calibrated amounts of each ingredient, and their ratings tune the recipe over time.

## How it fits together

```
Phone ──WiFi──▶ ESP32 (MicroPython) ──1 wire, UART──▶ Arduino Uno ──▶ servos ──▶ pump toggle buttons
                  │
                  └── (planned) polls Firestore for orders placed on the website
```

- **ESP32** (`ESP32_Code/`): decides when each pump runs. It currently creates its own WiFi network with a phone control page for running each pump for a set time.
- **Arduino Uno** (`Arduino_Code/`): drives the servos that physically press the pumps' toggle buttons, on command from the ESP32. Keeping the servos on the Uno keeps their power surges away from the ESP32.
- **Website** (`website/`): Firebase app for ordering, live queue, ratings and an admin view. Guests order online, and ratings feed `website/tools/optimize.py`, which tunes the default recipe.

## Status

- [x] ESP32 + Uno servo control of two toggle pumps, running reliably on wall power
- [x] Phone control page over the ESP32's own WiFi (`ESP32_Code/pump_server.py`)
- [ ] ESP32 picks up orders from Firestore and dispenses them (needs internet WiFi, e.g. a phone hotspot)
- [ ] Map recipe sliders (tea / sweetness / milk / tapioca) to pump times

## Getting started

| Folder | Read |
|---|---|
| `ESP32_Code/` | [ESP32_Code/README.md](ESP32_Code/README.md): flashing, running scripts, phone control, wiring, troubleshooting |
| `Arduino_Code/` | [Arduino_Code/README.md](Arduino_Code/README.md): uploading the servo sketch, wiring, tuning press angles |
| `website/` | [website/README.md](website/README.md): Firebase setup, deploy, optimizer |

## Hardware notes

- Upload to the Uno through a **USB 2.0** port or dongle. Uploads fail on the USB 3.0 dongle.
- Connect the ESP32 ↔ Uno ground jumper **only** when the boards aren't powered from the same USB source. On the same source it makes a ground loop that crashes the ESP32.
- The ESP32 only joins 2.4 GHz WiFi with a plain password, not username/password (enterprise) networks.
