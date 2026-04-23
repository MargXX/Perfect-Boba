# Website

The ordering + rating web app for Perfect Boba. Built on Firebase (Hosting + Firestore). Live at https://boba-bot-1973b.web.app.

## What it does

- `/` — guests scan a QR on the machine, fill in a name + 3 sliders (tea strength, sweetness, milk) + tapioca on/off, tap **Place order**
- `/queue` — live queue position, status pill, browser push + audio ding when it's your turn, auto-redirects to rate when done
- `/rate/:id` — 1–5 stars after drinking; feeds recipe optimizer
- `/admin` — operator dashboard with active queue + recent completed orders

Guests use their own cellular / dorm wifi. The ESP32 joins a phone hotspot to reach Firestore. No LAN-joining required for guests.

## Architecture

```
Guests (any internet)  ──→  Firebase Hosting + Firestore
                                    ↑
                               ESP32 (polls Firestore REST every 2s)
```

### Firestore schema

```
/orders/{id}
  name: string
  recipe: { tea, sweet, milk: 0–100, tapioca: bool }
  status: queued | awaiting_cup | dispensing | done | rated | cancelled | error
  created_at: timestamp (server)
  rating: int | null

/machine/state
  is_busy, current_order_id, paused, last_heartbeat_ms

/calibration/current
  defaults: { tea, sweet, milk }  # updated by tools/optimize.py
```

### Security

Rules in `firestore.rules`:
- Anyone can create orders (with `status: "queued"` and `rating: null`)
- Anyone can update *only* the `rating` field on an existing order (1–5)
- Only the authenticated machine account (`role: "machine"` custom claim) can flip status or write machine/calibration docs

The web-app Firebase API key is published in `web/app.js` — this is expected. Firebase security is enforced by rules, not by hiding the key.

## Layout

```
website/
├── web/                       # static site, hosted by Firebase Hosting
│   ├── index.html              # order form
│   ├── queue.html              # live queue + push notify
│   ├── rate.html               # 1–5 stars
│   ├── admin.html              # operator view
│   ├── app.js                  # shared Firebase init + helpers
│   └── style.css
├── firebase.json               # hosting + firestore config
├── firestore.rules             # security rules
├── firestore.indexes.json      # composite index for queue query
└── tools/
    ├── grant_machine_role.js   # one-shot: set role:"machine" custom claim on the auth user
    ├── seed.js                 # seed /machine/state and /calibration/current
    ├── optimize.py             # offline gradient-descent fit on ratings → new defaults
    └── package.json
```

## Setup from scratch

1. **Firebase project**: create at https://console.firebase.google.com, enable Firestore (**Native mode**, not Datastore), enable Email/Password auth, create a user `machine@bobabot.local`
2. **Paste web config**: copy the `firebaseConfig` object from the console's project settings into `web/app.js`
3. **Service account**: project settings → service accounts → generate key → save as `tools/serviceAccount.json` (gitignored)
4. **Custom claim**: `cd tools && npm install && node grant_machine_role.js machine@bobabot.local`
5. **Seed**: `node tools/seed.js`
6. **Deploy**: `firebase deploy --only firestore:rules,firestore:indexes,hosting`

## After an event: run the optimizer

```bash
pip install firebase-admin numpy
python tools/optimize.py --key tools/serviceAccount.json
```

Fits a quadratic per recipe knob against rating, pushes new defaults to `/calibration/current`.

## What's not in this folder

- **Firmware** (ESP32 MicroPython code) — lives in the sibling `ESP32_Code/` folder
- **Hardware docs / BOM / CAD** — see the main project notes
