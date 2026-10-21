// One-shot: grant a role custom claim ("machine" or "dev") to an auth user.
// Usage:
//   1. Firebase console → Project settings → Service accounts → "Generate new private key"
//      Save as tools/serviceAccount.json (gitignored)
//   2. node tools/grant_machine_role.js machine@bobabot.local
//      node tools/grant_machine_role.js dev@bobabot.local dev
const admin = require("firebase-admin");
const cred = require("./serviceAccount.json");
admin.initializeApp({ credential: admin.credential.cert(cred) });

const email = process.argv[2];
const role = process.argv[3] || "machine";
if (!email || !["machine", "dev"].includes(role)) {
  console.error("usage: node grant_machine_role.js <email> [machine|dev]"); process.exit(1);
}

(async () => {
  const u = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(u.uid, { role });
  console.log(`granted role:${role} to`, u.uid);
})();
