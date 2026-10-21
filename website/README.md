# Website

The ordering + rating web app for Perfect Boba. Built on Firebase (Hosting + Firestore). Live at https://perfect-boba-bot.web.app (Firebase project `perfect-boba-bot`; moved from the original `boba-bot-1973b` project on 2026-10-20).

## What it does

- `/` — guests scan a QR on the machine, enter a name, how many liquid oz they want (8/12/16/20) and tapioca on/off, then either tap **🤖 Order now** (the model picks the creamer:tea mix) or **I'm picky** (set the mix yourself). Shows the total order count.
- `/queue` — live queue position, status pill, browser push + audio ding when it's your turn, auto-redirects to rate when done
- `/rate/:id` — 1–5 stars after drinking; trains the recipe model
- `/admin` — read-only operator dashboard with active queue + recent completed orders
- `/dev` — passcode-locked tools: pause/resume, mark orders done, cancel, clear the queue, delete orders, model status

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
  mode: "ml" | "picky"
  size_oz: 8 | 12 | 16 | 20             # liquid fl oz chosen by the guest
  recipe: { creamer: 0–100 (% of the drink; the rest is tea), volume_ml: int (size_oz in ml, for the pumps), tapioca: bool }
  model: { n, best, predicted } | null   # what the model knew when it picked an "ml" recipe
  status: queued | awaiting_cup | dispensing | done | cancelled | error
  created_at: timestamp (server)
  rating: int | null                     # 1–5, set once after status is done

/machine/state
  is_busy, current_order_id, paused, last_heartbeat_ms
```

### Security

Rules in `firestore.rules`:
- Anyone can create orders (with `status: "queued"` and `rating: null`)
- Anyone can rate an order once (1–5), only after it's `done`
- Anyone can cancel an order that's still `queued`
- The machine account (`role: "machine"` custom claim) and the dev account (`role: "dev"`) can change order status and write `/machine/state`; only dev can delete orders

The dev passcode is the password of the `dev@bobabot.local` auth user, so it's checked by Firebase, not stored in the site's code.

The web-app Firebase API key is published in `web/app.js` — this is expected. Firebase security is enforced by rules, not by hiding the key.

## Layout

```
website/
├── web/                       # static site, hosted by Firebase Hosting
│   ├── index.html              # order form
│   ├── queue.html              # live queue + push notify
│   ├── rate.html               # 1–5 stars
│   ├── admin.html              # operator view
│   ├── dev.html                # passcode-locked dev tools
│   ├── app.js                  # shared Firebase init + helpers
│   ├── ml.js                   # recipe model (no Firebase; runs in browser and Node)
│   └── style.css
├── firebase.json               # hosting + firestore config
├── firestore.rules             # security rules
├── firestore.indexes.json      # composite index for queue query
└── tools/
    ├── grant_machine_role.js   # one-shot: set role:"machine" or "dev" custom claim on an auth user
    ├── seed.js                 # seed /machine/state
    ├── simulate.mjs            # watch the model learn from pretend ratings
    └── package.json
```

## Setup from scratch

1. **Firebase project**: create at https://console.firebase.google.com, enable Firestore (**Native mode**, not Datastore), enable Email/Password auth, create users `machine@bobabot.local` and `dev@bobabot.local` (the dev user's password is the dev page passcode)
2. **Paste web config**: copy the `firebaseConfig` object from the console's project settings into `web/app.js`
3. **Service account**: project settings → service accounts → generate key → save as `tools/serviceAccount.json` (gitignored)
4. **Custom claims**: `cd tools && npm install && node grant_machine_role.js machine@bobabot.local && node grant_machine_role.js dev@bobabot.local dev`
5. **Seed**: `node tools/seed.js`
6. **Deploy**: `firebase deploy --only firestore:rules,firestore:indexes,hosting`

## How the recipe learns

With two pumps (creamer and tea), a recipe is one number: the creamer %. `web/ml.js` learns it from ratings:

1. **Fit.** Every rated order (picky ones too) is a point: creamer % → stars. Gradient descent fits a quadratic curve through them, starting from a gentle guess that peaks at the default (30%), so a few ratings can't swing it far.
2. **Climb.** Gradient ascent on that curve finds the creamer % with the highest predicted rating, kept within 5–60%.
3. **Explore.** An **Order now** cup gets that best guess plus a random wiggle. Without the wiggle everyone gets the same cup and the model can't learn which direction is better. The wiggle shrinks as ratings pile up.

The order page refits from all ratings every time it loads (it takes milliseconds), so each new rating counts for the next cup. To add a pump, add an entry to `KNOBS` in `ml.js`; the model handles any number of knobs.

Try it without any hardware or Firebase (needs Node):

```bash
node tools/simulate.mjs 20      # pretend friends whose favorite is 20% creamer
```

To test ratings before the ESP32 is taking orders, mark orders **Done** on `/dev`, then rate them.

## What's not in this folder

- **Firmware** (ESP32 MicroPython code) — lives in the sibling `ESP32_Code/` folder
- **Hardware docs / BOM / CAD** — see the main project notes
