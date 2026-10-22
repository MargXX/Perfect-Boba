import {
  db, auth, collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, getCountFromServer,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "/firebase.js";
import { learn } from "/ml.js";

export { db, auth };

export const ORDERS = collection(db, "orders");
export const MACHINE_STATE = doc(db, "machine", "state");
export const ACTIVE_STATUSES = ["queued", "awaiting_cup", "dispensing"];

// Cup choices, in fluid ounces of liquid (creamer + tea, not counting pearls).
export const SIZES_OZ = [8, 12, 16, 20];
export const DEFAULT_OZ = 12;
export const ozToMl = (oz) => Math.round(oz * 29.5735);

// The dev page signs in as this account; its password is the dev passcode.
export const DEV_EMAIL = "dev@bobabot.local";

export {
  collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot, query, where,
  orderBy, limit, serverTimestamp, signInWithEmailAndPassword, signOut, onAuthStateChanged
};

export function saveOrderId(id) { localStorage.setItem("orderId", id); }
export function getOrderId() { return localStorage.getItem("orderId"); }

// A random ID kept on this phone, so the model can learn your taste without
// relying on how you type your name.
export function getDrinkerId() {
  let id = localStorage.getItem("drinkerId");
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
    localStorage.setItem("drinkerId", id);
  }
  return id;
}
export function getSavedName() { return localStorage.getItem("name") || ""; }
export function saveName(name) { localStorage.setItem("name", name); }

export function machineOnline(state) {
  const hb = state?.last_heartbeat_ms ?? state?.last_heartbeat;
  if (!hb) return false;
  return Date.now() - (hb.toMillis ? hb.toMillis() : hb) < 30_000;
}

// Machine status as label/value rows. Yes/no values are green for true and
// red for false, with the word shown too.
export function renderMachineStatus(el, state) {
  const d = state || {};
  const hb = d.last_heartbeat_ms;
  const ago = hb ? Math.round((Date.now() - hb) / 1000) : null;
  const rows = [
    ["Online", machineOnline(d)],
    ["Busy", d.is_busy ?? null],
    ["Paused", d.paused ?? false],
    ["Current order", d.current_order_id || "—"],
    ["Last heartbeat", ago === null ? "never" : ago < 120 ? `${ago} s ago` : `${Math.round(ago / 60)} min ago`],
  ];
  el.innerHTML = rows.map(([label, v]) => {
    const value = typeof v === "boolean"
      ? `<span class="bool ${v}">${v}</span>`
      : `<span>${escapeHtml(v ?? "unknown")}</span>`;
    return `<div class="status-row"><span class="status-label">${label}</span>${value}</div>`;
  }).join("");
}

// Fit the recipe model to every rated order.
// Merged people count as one taster too.
export async function loadModel() {
  const [snap, edits] = await Promise.all([
    getDocs(query(ORDERS, where("rating", ">=", 1))), loadPeopleEdits()]);
  const root = resolver(edits);
  return learn(snap.docs.map((d) => {
    const o = d.data();
    return o.drinker_id ? { ...o, drinker_id: root(o.drinker_id) } : o;
  }));
}

// Dev edits to the leaderboard, one doc per phone ID in /people:
//   { bonus: cups to add or take away, name: display name, hidden: bool,
//     merged_into: another phone ID this person counts as }
// Orders are never rewritten, so every edit can be undone.
export const PEOPLE = collection(db, "people");

async function loadPeopleEdits() {
  try {
    const snap = await getDocs(PEOPLE);
    return new Map(snap.docs.map((d) => [d.id, d.data()]));
  } catch (err) {
    console.warn("people edits unavailable:", err.message);
    return new Map();
  }
}

// Follow merged_into to the person an ID finally counts as.
function resolver(edits) {
  return (id) => {
    for (let hops = 0; hops < 10 && edits.get(id)?.merged_into; hops++) id = edits.get(id).merged_into;
    return id;
  };
}

// Cups actually made (status done), per person. Ordering alone doesn't count,
// so nobody can climb the leaderboard by spamming orders. Each person shows
// under their dev-set name, else the name from their latest order.
// Returns everyone, hidden included; the public board filters them out.
export async function loadPeople() {
  const [snap, edits] = await Promise.all([
    getDocs(query(ORDERS, where("status", "==", "done"))), loadPeopleEdits()]);
  const root = resolver(edits);
  const people = new Map();
  const get = (id) => {
    if (!people.has(id)) people.set(id, { id, made: 0, bonus: 0, orderName: null, latest: 0, members: [] });
    return people.get(id);
  };
  snap.forEach((d) => {
    const o = d.data();
    if (!o.drinker_id) return;
    const p = get(root(o.drinker_id));
    const t = o.created_at?.toMillis?.() ?? 0;
    p.made += 1;
    if (t >= p.latest) { p.latest = t; p.orderName = o.name; }
  });
  for (const [id, e] of edits) {
    const p = get(root(id));
    p.bonus += e.bonus || 0;
    if (e.merged_into) p.members.push(id);
  }
  return [...people.values()]
    .map((p) => {
      const e = edits.get(p.id) || {};
      return { ...p, name: e.name || p.orderName || "Someone", hidden: !!e.hidden,
               bonusOwn: e.bonus || 0, cups: Math.max(0, p.made + p.bonus) };
    })
    .sort((a, b) => b.cups - a.cups || a.latest - b.latest);
}

export async function loadCupCounts() {
  return (await loadPeople()).filter((p) => !p.hidden && p.cups > 0);
}

// The phone ID this phone's orders count as, after any merges.
export async function resolveDrinker(id) {
  return resolver(await loadPeopleEdits())(id);
}

export async function countOrders() {
  const snap = await getCountFromServer(ORDERS);
  return snap.data().count;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function describeRecipe(o) {
  const r = o.recipe || {};
  const parts = [];
  if (o.size_oz) parts.push(`${o.size_oz} oz`);
  if (typeof r.creamer === "number") parts.push(`${r.creamer}% creamer`);
  if (r.tapioca) parts.push("🫧");
  if (o.mode) parts.push(o.mode === "ml" ? "🤖" : "picky");
  const dir = o.feedback?.creamer;
  if (dir !== undefined) parts.push(["wants more tea", "perfect", "wants more creamer"][dir + 1]);
  return parts.join(" · ");
}

export function ding() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.15;
    o.start(); o.stop(ctx.currentTime + 0.25);
  } catch (e) {}
}
