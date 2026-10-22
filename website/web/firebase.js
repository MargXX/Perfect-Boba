// Everything that talks to Firebase. The ESP32 serves its own firebase.js with
// the same exports (ESP32_Code/web/firebase.js), so every other file is shared.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import {
  initializeAuth, browserLocalPersistence, browserSessionPersistence,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
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

export {
  collection, addDoc, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch,
  onSnapshot, query, where, orderBy, limit, serverTimestamp, getCountFromServer,
  signInWithEmailAndPassword, signOut, onAuthStateChanged
};
