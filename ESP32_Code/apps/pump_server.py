"""
Phone control for the pumps over WiFi.

The ESP32 creates its own WiFi network (name and password in wifi_config.py).
Join it from your phone, open http://192.168.4.1, and run either pump for a
set number of seconds, or run both to flush hot water through them (Clean).
The onboard LED (GPIO 2) is lit while any pump is on.

Both pumps must be OFF when it starts (the buttons are toggles).

With the Mac:   ./run.sh apps/pump_server.py     (Ctrl-C to stop)
Without:        ./install.sh apps/pump_server.py, then power from the wall
"""
import asyncio
import json
import network
import time
from machine import Pin

from button import ButtonPresser
from pumps import PRESS_SECONDS
from wifi_config import AP_SSID, AP_PASSWORD

NUM_PUMPS = 2
MAX_SECONDS = 120
CLEAN_MAX_SECONDS = 300
STARTUP_SECONDS = 3  # when everything powers on together, give the Uno time to boot

led = Pin(2, Pin.OUT, value=0)
presser = None  # created in main(), after the startup delay


class PumpState:
    def __init__(self, servo):
        self.servo = servo
        self.is_on = False
        self.stop_at = None  # ticks_ms when a timed run should end


pumps = [PumpState(n + 1) for n in range(NUM_PUMPS)]
# Only one servo press at a time, and wait for each to finish (see pumps.py).
press_lock = asyncio.Lock()


async def set_on(pump, on):
    async with press_lock:
        if pump.is_on != on:
            presser.press(pump.servo)
            await asyncio.sleep(PRESS_SECONDS)
            pump.is_on = on
    led.value(any(p.is_on for p in pumps))


async def run_for(pump, seconds):
    await set_on(pump, True)
    # Start the clock once the pump is actually on, so it runs the full time.
    pump.stop_at = time.ticks_add(time.ticks_ms(), int(seconds * 1000))


async def stop(pump):
    pump.stop_at = None
    await set_on(pump, False)
    pump.stop_at = None  # in case a run_for() finished while we waited


async def clean(seconds):
    # Both pumps run for the full time. The Uno presses one button at a time,
    # so pump 2 starts (and stops) ~1.3 s after pump 1.
    for p in pumps:
        await run_for(p, seconds)


async def stop_all():
    for p in pumps:
        await stop(p)


async def timer_loop():
    while True:
        for p in pumps:
            if p.stop_at is not None and time.ticks_diff(p.stop_at, time.ticks_ms()) <= 0:
                await stop(p)
        await asyncio.sleep_ms(100)


def status():
    out = []
    for p in pumps:
        left = None
        if p.stop_at is not None:
            left = max(0, time.ticks_diff(p.stop_at, time.ticks_ms())) / 1000
        out.append({"on": p.is_on, "remaining": left})
    return {"pumps": out, "busy": press_lock.locked()}


def parse_query(query):
    params = {}
    for part in query.split("&"):
        key, _, value = part.partition("=")
        if key:
            params[key] = value
    return params


def get_pump(params):
    try:
        n = int(params.get("pump", ""))
    except ValueError:
        return None
    return pumps[n - 1] if 1 <= n <= NUM_PUMPS else None


def route(path, params):
    """Returns (status, content_type, body)."""
    if path == "/":
        return "200 OK", "text/html; charset=utf-8", PAGE
    if path == "/api/status":
        return "200 OK", "application/json", json.dumps(status())

    if path == "/api/clean":
        try:
            seconds = float(params.get("seconds", ""))
        except ValueError:
            seconds = 0
        if not 0 < seconds <= CLEAN_MAX_SECONDS:
            return "400 Bad Request", "application/json", \
                '{"error": "seconds must be between 0 and %d"}' % CLEAN_MAX_SECONDS
        asyncio.create_task(clean(seconds))
        return "200 OK", "application/json", json.dumps(status())
    if path == "/api/stop_all":
        asyncio.create_task(stop_all())
        return "200 OK", "application/json", json.dumps(status())

    if path in ("/api/run", "/api/stop", "/api/fix"):
        pump = get_pump(params)
        if pump is None:
            return "400 Bad Request", "application/json", '{"error": "pump must be 1 or 2"}'

        if path == "/api/run":
            try:
                seconds = float(params.get("seconds", ""))
            except ValueError:
                seconds = 0
            if not 0 < seconds <= MAX_SECONDS:
                return "400 Bad Request", "application/json", \
                    '{"error": "seconds must be between 0 and %d"}' % MAX_SECONDS
            asyncio.create_task(run_for(pump, seconds))
        elif path == "/api/stop":
            asyncio.create_task(stop(pump))
        else:
            # The pump got out of step with what we think (a lost press, or it
            # was toggled by hand). Correct our record without pressing.
            pump.is_on = params.get("on") == "1"
            pump.stop_at = None
            led.value(any(p.is_on for p in pumps))
        return "200 OK", "application/json", json.dumps(status())

    return "404 Not Found", "text/plain", "not found"


async def handle(reader, writer):
    try:
        request = await reader.readline()
        while True:  # skip the headers
            line = await reader.readline()
            if not line or line == b"\r\n":
                break
        parts = request.decode().split(" ")
        if len(parts) < 2:
            return
        path, _, query = parts[1].partition("?")
        code, ctype, body = route(path, parse_query(query))
        body = body.encode() if isinstance(body, str) else body
        writer.write(("HTTP/1.0 %s\r\nContent-Type: %s\r\nContent-Length: %d\r\n"
                      "Cache-Control: no-store\r\nConnection: close\r\n\r\n")
                     % (code, ctype, len(body)))
        writer.write(body)
        await writer.drain()
    except Exception as e:
        print("request error:", e)
    finally:
        writer.close()
        await writer.wait_closed()


def start_access_point():
    ap = network.WLAN(network.AP_IF)
    ap.active(True)
    security = getattr(network.WLAN, "SEC_WPA2", getattr(network, "AUTH_WPA2_PSK", 3))
    ap.config(ssid=AP_SSID, key=AP_PASSWORD, security=security)
    while not ap.active():
        time.sleep_ms(100)
    return ap.ifconfig()[0]


async def main():
    global presser
    # Three quick blinks: the program has started.
    for _ in range(3):
        led.on()
        await asyncio.sleep_ms(150)
        led.off()
        await asyncio.sleep_ms(150)
    await asyncio.sleep(STARTUP_SECONDS)
    presser = ButtonPresser()

    ip = start_access_point()
    print("WiFi network:", AP_SSID)
    print("Open http://%s on your phone" % ip)

    asyncio.create_task(timer_loop())
    await asyncio.start_server(handle, "0.0.0.0", 80)
    while True:
        await asyncio.sleep(3600)


PAGE = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Boba Pumps</title>
<style>
:root { --bg:#faf7f2; --card:#fff; --text:#2b2118; --muted:#7a6a5c; --accent:#8a5a2b; --on:#2f8f4e; --line:#e6ddd2; }
@media (prefers-color-scheme: dark) {
  :root { --bg:#1b1612; --card:#26201a; --text:#f3ebe2; --muted:#b3a393; --accent:#d9a066; --on:#5cc27d; --line:#3a3128; }
}
* { box-sizing: border-box; }
body { margin:0; padding:16px; background:var(--bg); color:var(--text);
       font:16px/1.4 -apple-system, system-ui, sans-serif; }
h1 { font-size:22px; margin:4px 0 16px; }
.card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px; margin-bottom:14px; }
.head { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; }
.name { font-weight:600; font-size:18px; }
.state { font-weight:600; color:var(--muted); }
.state.on { color:var(--on); }
.row { display:flex; gap:8px; align-items:center; }
input { width:90px; font-size:18px; padding:10px; border-radius:10px; border:1px solid var(--line);
        background:var(--bg); color:var(--text); }
button { flex:1; font-size:17px; padding:12px; border-radius:10px; border:0; cursor:pointer; }
.go { background:var(--accent); color:#fff; }
.stop { background:var(--line); color:var(--text); }
.fix { margin-top:10px; font-size:13px; color:var(--muted); }
.fix a { color:var(--muted); margin-left:6px; }
#msg { color:var(--muted); font-size:14px; min-height:20px; }
</style></head><body>
<h1>Boba Pumps</h1>
<div id="pumps"></div>
<div class="card">
  <div class="head"><span class="name">Clean</span></div>
  <p class="fix" style="margin-top:0">Put both intake tubes in hot water and a cup under the spout.
    Runs both pumps, then turns them off.</p>
  <div class="row">
    <input id="clean-t" type="number" inputmode="decimal" min="1" max="300" step="1" value="30"> s
    <button class="go" onclick="clean()">Clean</button>
    <button class="stop" onclick="api('/api/stop_all')">Stop both</button>
  </div>
</div>
<div id="msg"></div>
<script>
const N = 2;
const box = document.getElementById("pumps");
for (let i = 1; i <= N; i++) {
  box.insertAdjacentHTML("beforeend", `
  <div class="card">
    <div class="head"><span class="name">Pump ${i}</span><span class="state" id="s${i}">…</span></div>
    <div class="row">
      <input id="t${i}" type="number" inputmode="decimal" min="0.5" max="120" step="0.5" value="5"> s
      <button class="go" onclick="run(${i})">Run</button>
      <button class="stop" onclick="api('/api/stop?pump=${i}')">Stop</button>
    </div>
    <div class="fix">Out of sync? It's actually
      <a href="#" onclick="api('/api/fix?pump=${i}&on=1');return false">on</a>
      <a href="#" onclick="api('/api/fix?pump=${i}&on=0');return false">off</a></div>
  </div>`);
}
const msg = document.getElementById("msg");
function show(st) {
  st.pumps.forEach((p, k) => {
    const el = document.getElementById("s" + (k + 1));
    el.textContent = p.on ? (p.remaining != null ? `ON · ${p.remaining.toFixed(1)} s left` : "ON") : "OFF";
    el.className = "state" + (p.on ? " on" : "");
  });
  msg.textContent = st.busy ? "Pressing button…" : "";
}
async function api(url) {
  try {
    const r = await fetch(url);
    const st = await r.json();
    if (st.error) msg.textContent = st.error; else show(st);
  } catch (e) { msg.textContent = "Can't reach the machine. Still on the BobaBot WiFi?"; }
}
function clean() {
  if (!confirm("Both intake tubes in hot water and a cup under the spout?")) return;
  api(`/api/clean?seconds=${document.getElementById("clean-t").value}`);
}
function run(i) { api(`/api/run?pump=${i}&seconds=${document.getElementById("t" + i).value}`); }
api("/api/status");
setInterval(() => api("/api/status"), 1000);
</script></body></html>
"""

asyncio.run(main())
