// Watch the recipe model learn from pretend friends, no Firebase needed.
// Each friend has their own favorite tea % and creamer %, rates a bit high or
// low, and (if feedback is on) says which way for each. Compares:
//   group       one best cup for everyone
//   personal    a correction per person on top of the group curve
//   +direction  personal, plus the "which way?" answers
// Usage:
//   node tools/simulate.mjs            # 8 friends, 80 cups
//   node tools/simulate.mjs 12 150     # 12 friends, 150 cups
import { readFileSync } from "node:fs";

// Imported from source so it runs on any Node version.
const src = readFileSync(new URL("../web/ml.js", import.meta.url), "utf8");
const { learn, forDrinker, pickRecipe } = await import("data:text/javascript," + encodeURIComponent(src));

const FRIENDS = Number(process.argv[2] ?? 8);
const CUPS = Number(process.argv[3] ?? 80);
const TRIALS = 5;

// Seeded so every version sees the same friends and the same order of visits.
function rng(seed) {
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
}

function run(options, seed) {
  const r = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
  const friends = Array.from({ length: FRIENDS }, (_, i) => ({
    id: `friend-${i}`,
    tea: 20 + 35 * r(),        // favorite tea %, 20–55
    creamer: 8 + 30 * r(),     // favorite creamer %, 8–38
    bias: Math.round(gauss()), // rates about a star high or low
  }));
  const orders = [];
  const misses = [];
  for (let i = 0; i < CUPS; i++) {
    const f = friends[Math.floor(r() * FRIENDS)];
    const model = forDrinker(learn(orders, options), f.id);
    const recipe = pickRecipe(model, r);
    const offTea = recipe.tea - f.tea, offCreamer = recipe.creamer - f.creamer;
    const stars = Math.round(5 - 0.004 * (offTea ** 2 + offCreamer ** 2) + f.bias + 0.5 * gauss());
    const dir = (off) => (Math.abs(off) < 4 ? 0 : off > 0 ? -1 : 1);
    const feedback = { tea: dir(offTea), creamer: dir(offCreamer) };
    orders.push({ drinker_id: f.id, recipe, rating: Math.min(5, Math.max(1, stars)), feedback });
    if (i >= CUPS / 2) misses.push((Math.abs(offTea) + Math.abs(offCreamer)) / 2);
  }
  return misses.reduce((a, b) => a + b, 0) / misses.length;
}

const versions = {
  "group": { personal: false, feedback: false },
  "personal": { personal: true, feedback: false },
  "+direction": { personal: true, feedback: true },
};
console.log(`${FRIENDS} friends, ${CUPS} cups, ${TRIALS} trials.`);
console.log("Average distance from each person's favorite over the second half of cups:");
for (const [name, options] of Object.entries(versions)) {
  let total = 0;
  for (let t = 1; t <= TRIALS; t++) total += run(options, t * 7919);
  console.log(`  ${name.padEnd(11)} ${(total / TRIALS).toFixed(1)} points off per knob`);
}
