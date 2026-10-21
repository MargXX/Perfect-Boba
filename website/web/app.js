import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  initializeAuth, browserLocalPersistence, browserSessionPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { learn } from "/ml.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBG7V9FVRsqaenN9nBJ1PossDsXbKR_0b8",
  authDomain: "perfect-boba-bot.firebaseapp.com",
  projectId: "perfect-boba-bot",
  storageBucket: "perfect-boba-bot.firebasestorage.app",
  messagingSenderId: "686342659061",
  appId: "1:686342659061:web:bd4ac0bf51618821da5ebc"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
// Not getAuth(): its IndexedDB storage never finished starting up in Chrome,
// so the dev page never learned whether you were signed in.
export const auth = initializeAuth(app, {
  persistence: [browserLocalPersistence, browserSessionPersistence],
});

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
  addDoc, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, onSnapshot, query, where,
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
export async function loadModel() {
  const snap = await getDocs(query(ORDERS, where("rating", ">=", 1)));
  return learn(snap.docs.map((d) => d.data()));
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
