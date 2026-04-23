import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, getDoc, updateDoc,
  onSnapshot, query, where, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBvweZ8dG93y2DnIVo3n0OhD8RLUEHlypo",
  authDomain: "boba-bot-1973b.firebaseapp.com",
  projectId: "boba-bot-1973b",
  storageBucket: "boba-bot-1973b.firebasestorage.app",
  messagingSenderId: "548176507819",
  appId: "1:548176507819:web:6e759a17f4a053fc2dd8ee"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

export const ORDERS = collection(db, "orders");
export const MACHINE_STATE = doc(db, "machine", "state");

export { addDoc, doc, getDoc, updateDoc, onSnapshot, query, where, orderBy, serverTimestamp };

export function saveOrderId(id) { localStorage.setItem("orderId", id); }
export function getOrderId() { return localStorage.getItem("orderId"); }

export function machineOnline(state) {
  if (!state?.last_heartbeat) return false;
  const hb = state.last_heartbeat.toMillis ? state.last_heartbeat.toMillis() : state.last_heartbeat;
  return Date.now() - hb < 30_000;
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
