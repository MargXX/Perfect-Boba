# Perfect-Boba

A boba machine that learns to make each person's best cup of boba: an overengineered project between friends. People order from their phones at **https://perfect-boba-bot.web.app**, the machine pumps tea and shelf-stable creamer, and their ratings teach it everyone's taste.

## How it fits together

```
Phone ──WiFi──▶ ESP32 (MicroPython) ──1 wire, UART──▶ Arduino Uno ──▶ servos ──▶ pump toggle buttons
                  │
                  └── (planned) polls Firestore for orders placed on the website
```

- **ESP32** (`ESP32_Code/`): decides when each pump runs. It currently creates its own WiFi network with a phone control page for running each pump for a set time.
- **Arduino Uno** (`Arduino_Code/`): drives the servos that physically press the pumps' toggle buttons, on command from the ESP32. Keeping the servos on the Uno keeps their power surges away from the ESP32.
- **Website** (`website/`): Firebase app for ordering, live queue, ratings, an admin view and passcode-locked dev tools (`/dev`). Guests pick a size in liquid oz, then either let the model pick their creamer:tea mix (**Order now**) or set it themselves (**I'm picky**). After drinking they rate 1–5 stars and can say "more tea / perfect / more creamer".
- **Model** (`website/web/ml.js`): learns a group taste plus each person's own taste from every rating, using gradient descent. Runs in the browser, no server.

## Status

- [x] ESP32 + Uno servo control of two toggle pumps, running reliably on wall power
- [x] Phone control page over the ESP32's own WiFi (`ESP32_Code/apps/pump_server.py`)
- [ ] ESP32 picks up orders from Firestore and dispenses them (needs internet WiFi, e.g. a phone hotspot)
- [x] Website live on our own Firebase project (`perfect-boba-bot`), with dev tools
- [x] Recipe model: learns each person's creamer:tea mix from ratings and "which way" feedback
- [ ] Map a recipe (`creamer` %, `volume_ml`) to pump times (needs each pump's ml per second)

## Getting started

| Folder | Read |
|---|---|
| `ESP32_Code/` | [ESP32_Code/README.md](ESP32_Code/README.md): flashing, running scripts, phone control, wiring, troubleshooting |
| `Arduino_Code/` | [Arduino_Code/README.md](Arduino_Code/README.md): uploading the servo sketch, wiring, tuning press angles |
| `website/` | [website/README.md](website/README.md): pages, database, deploying, dev tools, how the model learns |

Passwords for the website's dev and machine accounts are in `SECRETS.md` (gitignored, so it's only on the laptop that has it).

## Hardware notes

- Upload to the Uno through a **USB 2.0** port or dongle. Uploads fail on the USB 3.0 dongle.
- Connect the ESP32 ↔ Uno ground jumper **only** when the boards aren't powered from the same USB source. On the same source it makes a ground loop that crashes the ESP32.
- The ESP32 only joins 2.4 GHz WiFi with a plain password, not username/password (enterprise) networks.
