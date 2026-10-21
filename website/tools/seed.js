// Create the singleton docs the web app subscribes to.
// Run once after `firebase deploy`.
const admin = require("firebase-admin");
const cred = require("./serviceAccount.json");
admin.initializeApp({ credential: admin.credential.cert(cred) });
const db = admin.firestore();

(async () => {
  await db.doc("machine/state").set({
    is_busy: false,
    current_order_id: "",
    paused: false,
    last_heartbeat_ms: 0,
  }, { merge: true });
  console.log("seeded /machine/state");
})();
