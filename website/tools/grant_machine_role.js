// One-shot: grant the role:"machine" custom claim to the machine auth user.
// Usage:
//   1. Firebase console → Project settings → Service accounts → "Generate new private key"
//      Save as tools/serviceAccount.json (gitignored)
//   2. node tools/grant_machine_role.js machine@bobabot.local
const admin = require("firebase-admin");
const cred = require("./serviceAccount.json");
admin.initializeApp({ credential: admin.credential.cert(cred) });

const email = process.argv[2];
if (!email) { console.error("usage: node grant_machine_role.js <email>"); process.exit(1); }

(async () => {
  const u = await admin.auth().getUserByEmail(email);
  await admin.auth().setCustomUserClaims(u.uid, { role: "machine" });
  console.log("granted role:machine to", u.uid);
})();
