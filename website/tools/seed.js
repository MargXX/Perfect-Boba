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
  await db.doc("calibration/current").set({
    defaults: { tea: 50, sweet: 50, milk: 40 },
  }, { merge: true });
  console.log("seeded /machine/state and /calibration/current");
})();
