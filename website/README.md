# Website

The ordering + rating web app for Perfect Boba. Built on Firebase (Hosting + Firestore). Live at https://perfect-boba-bot.web.app (Firebase project `perfect-boba-bot`; moved from the original `boba-bot-1973b` project on 2026-10-20).

## What it does

- `/` — guests scan a QR on the machine, enter a name, how many liquid oz they want (8/12/16/20) and tapioca on/off, then either tap **🤖 Order now** (the model picks the creamer:tea mix) or **I'm picky** (set the mix yourself). Shows the total order count, and for returning guests "You've had N cups · #K on the leaderboard". It never shows what an **Order now** cup will be; that's meant to be a surprise.
- `/queue` — live queue position, status pill, browser push + audio ding when it's your turn, auto-redirects to rate when done
- `/rate/:id` — 1–5 stars after drinking, plus an optional "More tea / Perfect / More creamer"; trains the recipe model
- `/leaderboard` — cups made per person (only orders that reached `done` count, so spamming orders doesn't help). People are grouped by their phone ID and shown under their latest name; no login needed.
- `/admin` — read-only operator dashboard with active queue + recent completed orders
- `/dev` — passcode-locked tools: pause/resume, hot-water clean, mark orders done, cancel, clear the queue, delete orders, model status, and leaderboard edits (merge two entries, ±1 cup, rename, hide)

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
  drinker_id: string                     # random ID saved on the guest's phone; ties their ratings together
  mode: "ml" | "picky"
  size_oz: 8 | 12 | 16 | 20             # liquid fl oz chosen by the guest
  recipe: { creamer: 0–100 (% of the drink; the rest is tea), volume_ml: int (size_oz in ml, for the pumps), tapioca: bool }
  model: { n, n_mine, best, predicted } | null  # what the model knew when it picked an "ml" recipe
  status: queued | awaiting_cup | dispensing | done | cancelled | error
  created_at: timestamp (server)
  rating: int | null                     # 1–5, set once after status is done
  feedback: { creamer: -1 | 0 | 1 }      # optional, with the rating: more tea / perfect / more creamer

/people/{drinker_id}                      # dev edits to the leaderboard; orders are never rewritten
  bonus: int                               # cups to add (or take away, if negative)
  name: string | null                      # display name instead of their latest order's name
  hidden: bool
  merged_into: drinker_id | null           # counts as that person, on the leaderboard and in the model

/machine/state
  is_busy, current_order_id, paused, last_heartbeat_ms
  clean: { seconds, status, requested_at, reason? }   # hot-water clean requested from /dev
```

### Security

Rules in `firestore.rules`:
- Anyone can create orders (with `status: "queued"` and `rating: null`)
- Anyone can rate an order once (1–5, plus optional feedback), only after it's `done`
- Anyone can cancel an order that's still `queued`
- Anyone can read `/people`; only dev can write it
- The machine account (`machine@bobabot.local`) and the dev account (`dev@bobabot.local`) can change order status and write `/machine/state`; only dev can delete orders. The rules recognise them by their sign-in email (a `role` custom claim from `tools/grant_machine_role.js` also works).

The dev passcode is the password of the `dev@bobabot.local` auth user, so it's checked by Firebase, not stored in the site's code. Both passwords are kept in `SECRETS.md` at the repo root, which is gitignored. Never commit them; the repo is public.

The web-app Firebase API key is published in `web/app.js` — this is expected. Firebase security is enforced by rules, not by hiding the key.

## Layout

```
website/
├── web/                       # static site, hosted by Firebase Hosting
│   ├── index.html              # order form
│   ├── queue.html              # live queue + push notify
│   ├── rate.html               # 1–5 stars + "more tea / perfect / more creamer"
│   ├── admin.html              # operator view
│   ├── dev.html                # passcode-locked dev tools
│   ├── leaderboard.html        # cups made per person
│   ├── app.js                  # shared Firebase init + helpers
│   ├── ml.js                   # recipe model (no Firebase; runs in browser and Node)
│   └── style.css
├── firebase.json               # hosting + firestore config
├── firestore.rules             # security rules
├── firestore.indexes.json      # composite index for queue query
└── tools/
    ├── grant_machine_role.js   # optional: set a role custom claim (needs a service account key)
    ├── seed.js                 # optional: seed /machine/state (needs a service account key)
    ├── simulate.mjs            # watch the model learn from pretend ratings
    └── package.json
```

## Setup from scratch

You only need this to rebuild the site in a new Firebase project. The current one is already set up.

Tools: Node (`brew install node`) and the Firebase CLI (`npm install -g firebase-tools`, then `firebase login`).

1. **Project**: `firebase projects:create <id>`, then put the id in `website/.firebaserc` (gitignored): `{"projects": {"default": "<id>"}}`
2. **Web config**: `firebase apps:create web "BobaBot web"`, then paste the output of `firebase apps:sdkconfig web` into `firebaseConfig` in `web/app.js`
3. **Database**: enable the Cloud Firestore API in the Google Cloud console, then `firebase firestore:databases:create "(default)" --location nam5`
4. **Deploy**: from `website/`, `firebase deploy --only firestore,hosting` (rules can take a minute to take effect)
5. **Logins**: in the Firebase console → Authentication, enable Email/Password, then add `dev@bobabot.local` (password = dev passcode) and `machine@bobabot.local`. Do this right after deploying so nobody else can register those emails first.

`/machine/state` is created the first time the dev page's Pause button is used (or by the ESP32).

## Everyday use

- **Deploy changes**: from `website/`, `firebase deploy --only hosting` for page changes, or `--only firestore,hosting` when `firestore.rules` changed too.
- **Clear the queue**: `/dev` → passcode → **Clear queue (cancel all)**.
- **Clean the machine**: put both intake tubes in hot water and a cup under the spout, then `/dev` → **Clean machine** → seconds → **Clean**. Until the ESP32 takes orders from the website, use **Clean** on the ESP32's phone page instead (`ESP32_Code/apps/pump_server.py`).
- **Test without the machine**: place an order, mark it **Done** on `/dev`, then rate it from the page you ordered on.
- **Fix the leaderboard**: `/dev` → **Leaderboard**. Merge two entries that are the same person (e.g. two phones), use −1/+1 to adjust cups, **Name** to rename, **Hide** to remove someone from the public board. Each change can be undone (**Unmerge**, **Show**, the opposite ±1).
- **Start the model over** (e.g. after testing): `/dev` → **Delete ALL orders and ratings**.

## What the ESP32 must do for cleaning

The dev page only writes a request; the ESP32 carries it out. When it sees `/machine/state.clean.status == "requested"`:

- If `requested_at` is more than 60 s old, ignore it (the dev page shows it as expired), so a clean sent while the machine was offline never starts by surprise.
- If it's in the middle of an order, set `status: "skipped"`, `reason: "busy"`.
- Otherwise set `status: "running"` and `is_busy: true`, run both pumps for `seconds` (`run_together` in `ESP32_Code/lib/pumps.py`), then set `status: "done"` and `is_busy: false`. Don't start orders while cleaning.

## How the recipe learns

With two pumps (creamer and tea), a recipe is one number: the creamer %. `web/ml.js` learns it from ratings, separately for each person:

1. **Fit.** Every rated order (picky ones too) is a data point: creamer % → stars, plus the optional "more tea / perfect / more creamer". Gradient descent fits one curve for the whole group and a small correction for each person at the same time. Both start from a gentle guess that peaks at 30%, so a few ratings can't swing it far.
   - Your cup = group curve + your correction. Your correction starts at zero, so a newcomer gets the group's best cup, and since it sits on top of the *live* group curve, you keep benefiting as the group curve improves.
   - The correction's constant term learns whether you rate generously or harshly, so both kinds of rater are useful.
   - "More creamer" tells the model which way your curve slopes at that cup. That points straight at a better cup, so it learns far faster than from stars alone.
2. **Climb.** Gradient ascent on your curve finds the creamer % it predicts you'll rate highest, kept within 5–60% and at most ~8% away from your last cup (a few answers say which way, not how far).
3. **Explore.** An **Order now** cup gets that best guess plus a random wiggle, so the model keeps learning. The wiggle shrinks as ratings pile up, overall and for you.

People are recognised by a random ID saved on their phone, not by name, so lazy or duplicate names don't matter. The name box is remembered too. A new phone or cleared browser data means starting over as a newcomer.

The order page refits from all ratings every time it loads (well under a second at friend scale). To add a pump, add an entry to `KNOBS` in `ml.js`; the model handles any number of knobs.

Try it without any hardware or Firebase (needs Node):

```bash
node tools/simulate.mjs           # 8 pretend friends with different tastes, 80 cups
node tools/simulate.mjs 12 150    # 12 friends, 150 cups
```


## What's not in this folder

- **Firmware** (ESP32 MicroPython code) — lives in the sibling `ESP32_Code/` folder
- **Hardware docs / BOM / CAD** — see the main project notes
