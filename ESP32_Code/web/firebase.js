// Stand-in for Firebase when the ESP32 serves the website itself
// (apps/boba_server.py). Same exports as website/web/firebase.js, so every
// other page and script is shared with the real website.
//
// The phone keeps a copy of all the data. Every second it asks the ESP32 for
// version numbers (/api/poll), re-downloads only the files of orders that
// changed (/api/chunk), and answers queries itself. Writes go to /api/write,
// where the ESP32 checks the same rules as website/firestore.rules.

const POLL_MS = 1000;
const BATCH_OPS = 40;  // ops per /api/write, so a big batch fits the ESP32's memory
const TOKEN_KEY = "devToken";

export const db = { local: true };
export const auth = { currentUser: null };

// Firestore-style timestamps. On the wire they're {"__ts": ms}.
class Timestamp {
  constructor(ms) { this.ms = ms; }
  toMillis() { return this.ms; }
  toDate() { return new Date(this.ms); }
  get seconds() { return Math.floor(this.ms / 1000); }
  toJSON() { return { __ts: this.ms }; }
}
const revive = (_k, v) => (v && typeof v === "object" && "__ts" in v ? new Timestamp(v.__ts) : v);
export const serverTimestamp = () => ({ __ts: "server" });

// --- talking to the ESP32 --------------------------------------------------

function token() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

async function call(path, body) {
  const r = await fetch(path, body === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, now: Date.now(), token: token() }),
  });
  const text = await r.text();
  const out = text ? JSON.parse(text, revive) : {};
  if (!r.ok) throw new Error(out.error || `The machine said ${r.status}`);
  return out;
}

const cache = { boot: null, chunkV: [], chunks: [], peopleV: null, people: {}, state: {} };
const listeners = new Set();
let syncing = null;

// Bring the local copy up to date (one sync at a time).
function sync() {
  if (!syncing) syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  const p = await call(`/api/poll?now=${Date.now()}`);
  if (p.boot !== cache.boot) {  // the ESP32 restarted: start over
    Object.assign(cache, { boot: p.boot, chunkV: [], chunks: [], peopleV: null, people: {} });
  }
  cache.chunks.length = cache.chunkV.length = p.chunks.length;
  // One at a time: the ESP32 can only handle a few connections.
  for (let k = 0; k < p.chunks.length; k++) {
    if (cache.chunkV[k] === p.chunks[k]) continue;
    cache.chunks[k] = await call(`/api/chunk?n=${k}`);
    cache.chunkV[k] = p.chunks[k];
  }
  if (cache.peopleV !== p.people) {
    cache.people = await call("/api/people");
    cache.peopleV = p.people;
  }
  // The ESP32 just answered, so that's its heartbeat.
  cache.state = { ...p.state, last_heartbeat_ms: Date.now() };
  notify();
}

let polling = false;
function startPolling() {
  if (polling) return;
  polling = true;
  const tick = async () => {
    if (!document.hidden) await sync().catch(() => {});
    setTimeout(tick, POLL_MS);
  };
  tick();
}

// --- documents and queries -------------------------------------------------

export function collection(_db, name) { return { type: "collection", name }; }

// doc(db, "orders", id) or doc(collectionRef, id)
export function doc(parent, a, b) {
  return parent.type === "collection" ? { type: "doc", col: parent.name, id: a } : { type: "doc", col: a, id: b };
}

export const where = (field, op, value) => ({ kind: "where", field, op, value });
export const orderBy = (field, dir = "asc") => ({ kind: "orderBy", field, dir });
export const limit = (n) => ({ kind: "limit", n });
export function query(col, ...constraints) { return { type: "query", col: col.name, constraints }; }

function rows(col) {
  if (col === "orders") return cache.chunks.flatMap((c) => Object.entries(c || {}));
  if (col === "people") return Object.entries(cache.people);
  if (col === "machine") return [["state", cache.state]];
  return [];
}

function docSnap(col, id, data) {
  return { id, ref: { type: "doc", col, id }, exists: () => data !== undefined, data: () => data };
}

const plain = (v) => (v instanceof Timestamp ? v.ms : v);

function matches(data, { field, op, value }) {
  const v = plain(data[field]);
  switch (op) {
    case "==": return v === value;
    case "!=": return v !== value && v != null;
    case "in": return value.includes(v);
    case "not-in": return v != null && !value.includes(v);
    case ">=": return v != null && v >= value;
    case ">": return v != null && v > value;
    case "<=": return v != null && v <= value;
    case "<": return v != null && v < value;
    default: throw new Error(`where("${op}") isn't supported on the machine`);
  }
}

function runQuery(q) {
  if (q.type === "collection") q = { col: q.name, constraints: [] };
  let docs = rows(q.col).map(([id, d]) => docSnap(q.col, id, d));
  for (const c of q.constraints) {
    if (c.kind === "where") docs = docs.filter((d) => matches(d.data(), c));
    if (c.kind === "orderBy") {
      const sign = c.dir === "desc" ? -1 : 1;
      docs = docs.filter((d) => d.data()[c.field] != null)
        .sort((x, y) => {
          const a = plain(x.data()[c.field]), b = plain(y.data()[c.field]);
          return a < b ? -sign : a > b ? sign : 0;
        });
    }
    if (c.kind === "limit") docs = docs.slice(0, c.n);
  }
  return { docs, size: docs.length, empty: !docs.length, forEach: (fn) => docs.forEach(fn) };
}

function read(target) {
  if (target.type === "doc") {
    const found = rows(target.col).find(([id]) => id === target.id);
    return docSnap(target.col, target.id, found?.[1]);
  }
  return runQuery(target);
}

export async function getDoc(ref) { await sync(); return read(ref); }
export async function getDocs(q) { await sync(); return read(q); }
export async function getCountFromServer(q) {
  await sync();
  const n = read(q).size;
  return { data: () => ({ count: n }) };
}

// Calls back now (once data is in) and whenever the result changes.
export function onSnapshot(target, callback) {
  const l = { target, callback, last: null };
  listeners.add(l);
  if (cache.boot) fire(l);
  startPolling();
  return () => listeners.delete(l);
}

function fire(l) {
  const snap = read(l.target);
  const key = JSON.stringify(l.target.type === "doc" ? snap.data() : snap.docs.map((d) => [d.id, d.data()]));
  if (key === l.last) return;
  l.last = key;
  try { l.callback(snap); } catch (err) { console.error(err); }
}

function notify() { listeners.forEach(fire); }

// --- writes ------------------------------------------------------------------

async function write(ops) {
  const ids = [];
  for (let i = 0; i < ops.length; i += BATCH_OPS) {
    const r = await call("/api/write", { ops: ops.slice(i, i + BATCH_OPS) });
    ids.push(...r.ids);
  }
  // Show the change right away (after any sync that started before it).
  await syncing?.catch(() => {});
  await sync().catch(() => {});
  return ids;
}

const op = (kind, ref, data) => ({ op: kind, col: ref.col, id: ref.id, data });

export async function addDoc(col, data) {
  const [id] = await write([{ op: "add", col: col.name, data }]);
  return { type: "doc", col: col.name, id };
}
export const setDoc = (ref, data, opts) => write([op(opts?.merge ? "merge" : "set", ref, data)]);
export const updateDoc = (ref, data) => write([op("update", ref, data)]);
export const deleteDoc = (ref) => write([op("delete", ref)]);

export function writeBatch() {
  const ops = [];
  return {
    set(ref, data, opts) { ops.push(op(opts?.merge ? "merge" : "set", ref, data)); return this; },
    update(ref, data) { ops.push(op("update", ref, data)); return this; },
    delete(ref) { ops.push(op("delete", ref)); return this; },
    commit: () => write(ops),
  };
}

// --- dev sign-in -------------------------------------------------------------
// The dev passcode is DEV_PASSCODE in the ESP32's wifi_config.py. Signing in
// keeps a token on this phone that the ESP32 accepts for dev-only writes.

const authListeners = new Set();
const userFor = (email) => ({ email, getIdTokenResult: async () => ({ claims: {} }) });

function setUser(user) {
  auth.currentUser = user;
  authListeners.forEach((cb) => cb(user));
}

const authReady = (async () => {
  if (!token()) return;
  try {
    const r = await call("/api/login", {});
    auth.currentUser = userFor(r.email);
  } catch (err) {
    // Only forget the token if the machine rejected it, not if it's unreachable.
    if (!/fetch|network|load/i.test(err.message)) localStorage.removeItem(TOKEN_KEY);
    else auth.currentUser = userFor("dev@bobabot.local");
  }
})();

export function onAuthStateChanged(_auth, callback) {
  authListeners.add(callback);
  authReady.then(() => callback(auth.currentUser));
  return () => authListeners.delete(callback);
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  const r = await call("/api/login", { passcode: password });
  localStorage.setItem(TOKEN_KEY, r.token);
  const user = userFor(email);
  setUser(user);
  return { user };
}

export async function signOut() {
  localStorage.removeItem(TOKEN_KEY);
  setUser(null);
}

// Things that only exist on the machine's own site (like the /pumps link on /dev).
const showLocalOnly = () => document.querySelectorAll("[data-machine-only]").forEach((el) => { el.hidden = false; });
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", showLocalOnly);
else showLocalOnly();
