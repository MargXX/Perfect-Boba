"""
BobaBot, run entirely on the ESP32: no internet and no Firebase.

The ESP32 makes its own WiFi network and serves the same website as
https://perfect-boba-bot.web.app (website/web/), with orders saved on its own
flash. Only phones on the BobaBot WiFi can reach it, so nobody can order from
home, and each phone can have only one cup in the queue at a time.

Guests join the WiFi, open http://192.168.4.1 and order. When it's their turn
their phone tells them; they put a cup under the spout and tap "My cup is in —
pour!". The machine pours, and their phone asks for a rating.

    /             order               /queue        your place in line
    /leaderboard  cups per person     /admin        queue overview
    /dev          passcode-locked tools (DEV_PASSCODE in wifi_config.py)
    /pumps        manual pump control and Clean (sign in on /dev first)

With the Mac:   ./run.sh apps/boba_server.py     (Ctrl-C to stop)
Without:        ./install.sh apps/boba_server.py, then power from the wall

Both pumps must be OFF when it starts (the buttons are toggles).
"""
import asyncio
import binascii
import hashlib
import json
import network
import os
import time
from machine import Pin, RTC

import captive_dns
import wifi_config
from button import ButtonPresser
from pump_control import PumpControl
from store import Store

# Which servo presses which pump's button.
CREAMER_PUMP = 1
TEA_PUMP = 2
# How much each pump moves, in ml per second. These are guesses: on /pumps,
# run a pump for 10 s into a measuring cup and divide the ml by 10.
ML_PER_SECOND = {CREAMER_PUMP: 10.0, TEA_PUMP: 10.0}

NUM_PUMPS = 2
MAX_QUEUE = 20          # orders waiting at once
MAX_VOLUME_ML = 700
MAX_SECONDS = 120       # one manual pump run on /pumps
CLEAN_MAX_SECONDS = 300
STARTUP_SECONDS = 3     # when everything powers on together, give the Uno time to boot
WWW = "/www"            # the website's files (install.sh / run.sh copy them here)
MAX_BODY = 8192

DEV_PASSCODE = getattr(wifi_config, "DEV_PASSCODE", None)
DEV_EMAIL = "dev@bobabot.local"
ORDER_KEYS = ("name", "drinker_id", "mode", "size_oz", "recipe", "model", "status", "created_at", "rating")

led = Pin(2, Pin.OUT, value=0)
store = None   # created in main()
pumps = None
my_ip = "192.168.4.1"
# Changes each boot, so phones know to re-download everything.
BOOT = binascii.hexlify(os.urandom(4)).decode()
# Not saved: on restart nothing is pouring and no clean is running.
machine = {"is_busy": False, "current_order_id": None, "clean": None}


class Denied(Exception):
    pass


# --- clock -------------------------------------------------------------------
# The ESP32 has no internet to get the time from, so it takes it from the first
# phone that talks to it. Order times only need to be right relative to each
# other and to the phones' clocks.

EPOCH_S = 946684800 if time.gmtime(0)[0] == 2000 else 0  # some ports count from 2000
clock_set = False


def sync_clock(phone_ms):
    global clock_set
    if clock_set or not phone_ms:
        return
    ms = int(phone_ms)
    t = time.gmtime(ms // 1000 - EPOCH_S)
    RTC().datetime((t[0], t[1], t[2], t[6], t[3], t[4], t[5], ms % 1000 * 1000))
    clock_set = True


def now_ms():
    return time.time_ns() // 1000000 + EPOCH_S * 1000


def stamp(value):
    """Replace serverTimestamp() placeholders (see web/firebase.js) with the time."""
    if isinstance(value, dict):
        if value.get("__ts") == "server":
            return {"__ts": now_ms()}
        return {k: stamp(v) for k, v in value.items()}
    return value


# --- dev sign-in -------------------------------------------------------------

def dev_token(passcode):
    return binascii.hexlify(hashlib.sha256(("bobabot-dev:" + passcode).encode()).digest()).decode()


DEV_TOKEN = dev_token(DEV_PASSCODE) if DEV_PASSCODE else None


def login(req):
    if not DEV_PASSCODE:
        raise Denied("Set DEV_PASSCODE in wifi_config.py first.")
    if req.get("passcode") == DEV_PASSCODE or (DEV_TOKEN and req.get("token") == DEV_TOKEN):
        return {"token": DEV_TOKEN, "email": DEV_EMAIL}
    raise Denied("Wrong passcode.")


# --- writes from phones --------------------------------------------------------
# The same rules as website/firestore.rules, plus one cup per phone in the queue.

def apply(op, is_dev, ip):
    kind, col, oid = op.get("op"), op.get("col"), op.get("id")
    data = stamp(op.get("data") or {})
    if col == "orders":
        if kind == "add":
            return add_order(data, is_dev, ip)
        if kind == "update":
            update_order(oid, data, is_dev)
            return oid
        if not is_dev:
            raise Denied("Only the dev page can do that.")
        if kind == "delete":
            store.delete(oid)
        elif kind == "set":
            store.put(oid, data)
        elif kind == "merge":
            if store.get(oid) is None:
                store.put(oid, data)
            else:
                store.update(oid, data)
        return oid
    if not is_dev:
        raise Denied("Only the dev page can do that.")
    if col == "people":
        if kind == "delete":
            store.delete_person(oid)
        else:
            store.set_person(oid, data, merge=kind != "set")
    elif col == "machine" and oid == "state":
        if "paused" in data:
            store.set_setting("paused", bool(data["paused"]))
        clean = data.get("clean")
        if isinstance(clean, dict) and clean.get("status") == "requested":
            request_clean(clean.get("seconds"))
    else:
        raise Denied("Unknown collection.")
    return oid


def add_order(o, is_dev, ip):
    r = o.get("recipe")
    if (o.get("status") != "queued" or o.get("rating") is not None
            or o.get("mode") not in ("ml", "picky") or any(k not in ORDER_KEYS for k in o)
            or not isinstance(r, dict) or not 0 < r.get("volume_ml", 0) <= MAX_VOLUME_ML
            or not 0 <= r.get("creamer", -1) <= 100):
        raise Denied("That's not a valid order.")
    o["name"] = str(o.get("name") or "Someone")[:30]
    o["created_at"] = {"__ts": now_ms()}  # the queue is in this order, so the phone doesn't get a say
    if not is_dev:
        if len(store.active) >= MAX_QUEUE:
            raise Denied("The queue is full. Try again in a few minutes.")
        for _, _, drinker, phone in store.active.values():
            if drinker == o.get("drinker_id") or phone == ip:
                raise Denied("You already have a cup in the queue. One at a time!")
    return store.add(o, ip)


def update_order(oid, f, is_dev):
    o = store.get(oid)
    if o is None:
        raise Denied("That order doesn't exist anymore.")
    if not is_dev:
        keys = set(f)
        status = o.get("status")
        rating = (keys <= {"rating", "feedback"} and isinstance(f.get("rating"), int)
                  and 1 <= f["rating"] <= 5 and isinstance(f.get("feedback", {}), dict)
                  and status == "done" and o.get("rating") is None)
        # Unlike the website, guests can also cancel once it's their turn, so
        # someone who walked away doesn't hold up the queue.
        cancel = (keys == {"status"} and f["status"] == "cancelled"
                  and status in ("queued", "awaiting_cup"))
        cup = keys == {"cup_ready"} and f["cup_ready"] is True and status == "awaiting_cup"
        if not (rating or cancel or cup):
            raise Denied("You can't change that.")
    store.update(oid, f)


# --- the machine ----------------------------------------------------------------

def pump_times(recipe):
    """{pump: seconds} for a recipe like {"creamer": 30, "volume_ml": 355}."""
    creamer_ml = recipe["volume_ml"] * recipe["creamer"] / 100
    times = {}
    for pump, ml in ((CREAMER_PUMP, creamer_ml), (TEA_PUMP, recipe["volume_ml"] - creamer_ml)):
        if ml >= 1:
            times[pump] = ml / ML_PER_SECOND[pump]
    return times


async def machine_loop():
    while True:
        await asyncio.sleep_ms(500)
        try:
            await machine_step()
        except Exception as e:
            print("machine error:", e)
        store.flush()


async def machine_step():
    oid = machine["current_order_id"]
    if oid is None:
        if machine["is_busy"] or store.setting("paused", False):
            return
        # Someone already called up (from before a restart) goes first.
        oid = store.oldest("awaiting_cup") or store.oldest("queued")
        if oid is not None:
            machine["current_order_id"] = oid
            store.update(oid, {"status": "awaiting_cup"})
        return
    order = store.get(oid)
    if not order or order.get("status") != "awaiting_cup":
        machine["current_order_id"] = None  # cancelled, deleted or marked done on /dev
    elif order.get("cup_ready"):
        await pour(oid, order)


async def pour(oid, order):
    store.update(oid, {"status": "dispensing"})
    store.flush()
    machine["is_busy"] = True
    try:
        await pumps.run_together(pump_times(order["recipe"]))
        store.update(oid, {"status": "done"})
    except Exception as e:
        print("pour failed:", e)
        store.update(oid, {"status": "error"})
    finally:
        machine["is_busy"] = False
        machine["current_order_id"] = None


def request_clean(seconds):
    seconds = float(seconds)
    if not 0 < seconds <= CLEAN_MAX_SECONDS:
        raise Denied("Clean for 1–%d seconds." % CLEAN_MAX_SECONDS)
    c = {"seconds": seconds, "requested_at": {"__ts": now_ms()}}
    if machine["is_busy"] or machine["current_order_id"]:
        c.update(status="skipped", reason="busy with an order")
    else:
        c["status"] = "running"
        asyncio.create_task(clean(seconds))
    machine["clean"] = c


async def clean(seconds):
    # Both pumps run for the full time; pump 2 starts and stops ~1.3 s after pump 1.
    machine["is_busy"] = True
    try:
        await pumps.run_together({p.servo: seconds for p in pumps.pumps})
        machine["clean"]["status"] = "done"
    except Exception as e:
        machine["clean"].update(status="skipped", reason=str(e))
    finally:
        machine["is_busy"] = False


# --- web server -----------------------------------------------------------------

PAGES = {"/": "index.html", "/order": "index.html", "/queue": "queue.html", "/admin": "admin.html",
         "/dev": "dev.html", "/leaderboard": "leaderboard.html", "/pumps": "pumps.html"}
TYPES = {"html": "text/html; charset=utf-8", "js": "text/javascript; charset=utf-8",
         "css": "text/css; charset=utf-8", "json": "application/json", "png": "image/png",
         "svg": "image/svg+xml", "ico": "image/x-icon"}
# Pages phones fetch to check for internet. Answering them keeps phones on the
# BobaBot WiFi instead of switching to mobile data (see captive_dns.py).
APPLE_OK = "<HTML><HEAD><TITLE>Success</TITLE></HEAD><BODY>Success</BODY></HTML>"
PROBES = {"/hotspot-detect.html": ("200 OK", APPLE_OK), "/library/test/success.html": ("200 OK", APPLE_OK),
          "/generate_204": ("204 No Content", ""), "/gen_204": ("204 No Content", ""),
          "/connecttest.txt": ("200 OK", "Microsoft Connect Test"), "/ncsi.txt": ("200 OK", "Microsoft NCSI"),
          "/success.txt": ("200 OK", "success\n")}


def api(method, path, params, headers, body, ip):
    """Returns (status, body)."""
    if path == "/api/poll":
        sync_clock(params.get("now"))
        state = {"is_busy": machine["is_busy"], "current_order_id": machine["current_order_id"],
                 "paused": store.setting("paused", False)}
        if machine["clean"]:
            state["clean"] = machine["clean"]
        return "200 OK", json.dumps({"boot": BOOT, "chunks": store.versions,
                                     "people": store.people_version, "state": state})
    if path == "/api/chunk":
        return "200 OK", store.chunk_text(int(params.get("n", "0")))
    if path == "/api/people":
        return "200 OK", json.dumps(store.people)

    req = json.loads(body) if body else {}
    sync_clock(req.get("now"))
    is_dev = bool(DEV_TOKEN) and DEV_TOKEN in (req.get("token"), headers.get("x-token"))
    if path == "/api/login":
        return "200 OK", json.dumps(login(req))
    if path == "/api/write":
        if method != "POST":
            raise ValueError("use POST")
        ids = [apply(op, is_dev, ip) for op in req.get("ops", [])]
        return "200 OK", json.dumps({"ids": ids})

    if path.startswith("/api/pumps/"):
        action = path[11:]
        if action != "status":
            if not is_dev:
                raise Denied("Sign in on /dev first.")
            pump_action(action, params)
        return "200 OK", json.dumps(pumps.status())
    return "404 Not Found", '{"error": "not found"}'


def pump_action(action, params):
    if action == "stop_all":
        asyncio.create_task(pumps.stop_all())
        return
    if machine["is_busy"] and action != "fix":
        raise Denied("The machine is busy making a cup or cleaning.")
    if action == "clean":
        request_clean(params.get("seconds"))
        return
    n = int(params.get("pump", "0"))
    if pumps.pump(n) is None:
        raise Denied("pump must be 1 or %d" % NUM_PUMPS)
    if action == "run":
        seconds = float(params.get("seconds", "0"))
        if not 0 < seconds <= MAX_SECONDS:
            raise Denied("seconds must be between 0 and %d" % MAX_SECONDS)
        asyncio.create_task(pumps.run_for(n, seconds))
    elif action == "stop":
        asyncio.create_task(pumps.stop(n))
    elif action == "fix":
        pumps.fix(n, params.get("on") == "1")
    else:
        raise Denied("unknown action")


async def send(writer, code, body="", ctype="application/json", extra="Cache-Control: no-store\r\n"):
    body = body.encode() if isinstance(body, str) else body
    writer.write(("HTTP/1.0 %s\r\nContent-Type: %s\r\nContent-Length: %d\r\n%sConnection: close\r\n\r\n"
                  % (code, ctype, len(body), extra)).encode())
    if body:
        writer.write(body)
    await writer.drain()


async def send_file(writer, path, headers):
    try:
        st = os.stat(path)
    except OSError:
        return await send(writer, "404 Not Found", "not found", "text/plain")
    # Size and modified time: phones re-download a file only after it's reinstalled.
    etag = '"%d-%d"' % (st[6], st[8])
    if headers.get("if-none-match") == etag:
        return await send(writer, "304 Not Modified", extra="ETag: %s\r\n" % etag)
    ctype = TYPES.get(path.rsplit(".", 1)[-1], "application/octet-stream")
    writer.write(("HTTP/1.0 200 OK\r\nContent-Type: %s\r\nContent-Length: %d\r\nCache-Control: no-cache\r\n"
                 "ETag: %s\r\nConnection: close\r\n\r\n" % (ctype, st[6], etag)).encode())
    with open(path, "rb") as f:
        while True:
            chunk = f.read(1024)
            if not chunk:
                break
            writer.write(chunk)
            await writer.drain()


def parse_query(query):
    params = {}
    for part in query.split("&"):
        key, _, value = part.partition("=")
        if key:
            params[key] = value
    return params


async def handle(reader, writer):
    try:
        request = (await reader.readline()).decode()
        headers = {}
        while True:
            line = await reader.readline()
            if not line or line == b"\r\n":
                break
            key, _, value = line.decode().partition(":")
            headers[key.strip().lower()] = value.strip()
        parts = request.split(" ")
        if len(parts) < 2:
            return
        method = parts[0]
        path, _, query = parts[1].partition("?")
        length = int(headers.get("content-length", "0") or 0)
        if length > MAX_BODY:
            return await send(writer, "413 Payload Too Large", '{"error": "too big"}')
        body = await reader.readexactly(length) if length else b""
        peer = writer.get_extra_info("peername")
        ip = peer[0] if isinstance(peer, tuple) else str(peer)
        await route(method, path, parse_query(query), headers, body, ip, writer)
    except Exception as e:
        print("request error:", e)
    finally:
        writer.close()
        await writer.wait_closed()


async def route(method, path, params, headers, body, ip, writer):
    host = headers.get("host", "").split(":")[0]
    if host and host != my_ip:
        probe = PROBES.get(path)
        if probe:
            return await send(writer, probe[0], probe[1], "text/html")
        return await send(writer, "302 Found", extra="Location: http://%s/\r\n" % my_ip)

    if path.startswith("/api/"):
        try:
            code, out = api(method, path, params, headers, body, ip)
        except Denied as e:
            if path == "/api/login":
                await asyncio.sleep(1)  # slow down passcode guessing
            code, out = "403 Forbidden", json.dumps({"error": str(e)})
        except (ValueError, KeyError, TypeError) as e:
            code, out = "400 Bad Request", json.dumps({"error": "bad request: %s" % e})
        finally:
            store.flush()
        return await send(writer, code, out)

    name = "rate.html" if path.startswith("/rate/") else PAGES.get(path)
    if name is None:
        name = path[1:]
        if "/" in name or name.startswith("."):
            return await send(writer, "404 Not Found", "not found", "text/plain")
    await send_file(writer, WWW + "/" + name, headers)


def start_access_point():
    ap = network.WLAN(network.AP_IF)
    ap.active(True)
    security = getattr(network.WLAN, "SEC_WPA2", getattr(network, "AUTH_WPA2_PSK", 3))
    ap.config(ssid=wifi_config.AP_SSID, key=wifi_config.AP_PASSWORD, security=security)
    try:
        ap.config(max_clients=10)  # the default lets only 4 phones join
    except Exception as e:
        print("couldn't raise the phone limit:", e)
    while not ap.active():
        time.sleep_ms(100)
    return ap.ifconfig()[0]


async def main():
    global store, pumps, my_ip
    # Three quick blinks: the program has started.
    for _ in range(3):
        led.on()
        await asyncio.sleep_ms(150)
        led.off()
        await asyncio.sleep_ms(150)
    store = Store()
    # A cup that was pouring when the power went out got an unknown amount.
    for oid, (_, status, _, _) in list(store.active.items()):
        if status == "dispensing":
            store.update(oid, {"status": "error"})
    store.flush()
    await asyncio.sleep(STARTUP_SECONDS)
    pumps = PumpControl(ButtonPresser(), NUM_PUMPS, led)

    my_ip = start_access_point()
    asyncio.create_task(pumps.timer_loop())
    asyncio.create_task(captive_dns.serve(my_ip))
    asyncio.create_task(machine_loop())
    await asyncio.start_server(handle, "0.0.0.0", 80, backlog=8)
    print("%d orders saved, %d in the queue" % (store.count, len(store.active)))
    if not DEV_PASSCODE:
        print("No DEV_PASSCODE in wifi_config.py, so /dev and /pumps are locked.")
    print("WiFi network:", wifi_config.AP_SSID)
    print("Open http://%s on your phone" % my_ip)
    while True:
        await asyncio.sleep(3600)


if __name__ == "__main__":
    asyncio.run(main())
