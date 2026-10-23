// Recipe model: learns which recipe each person likes best.
//
// Every rated order is a data point (recipe -> stars, plus an optional "more
// tea / perfect / more creamer"). We fit one curve for the whole group and a
// small correction for each person, all at once with gradient descent:
//
//   your predicted stars = starting guess + group curve + your correction
//
// Your correction starts at zero, so a newcomer gets the group's best cup. It
// grows as you rate, and since it sits on top of the live group curve, you
// keep benefiting when the group curve improves. The correction's constant
// term soaks up how generously you rate, so harsh and easy raters both count.
//
// Then we climb your curve (gradient ascent) to the recipe it predicts you'll
// rate highest, and add a little random wiggle so the model keeps learning.
//
// No Firebase imports here, so tools/simulate.mjs can run it in Node.

// One entry per thing the machine can vary, each a % of the cup. Water fills
// whatever tea and creamer leave, so tea % is how strong the drink is and
// creamer % how creamy (and sweet: the creamer is sweetened) it is.
// min/max bound what the model may try. They add up to at most 100 so the
// model can never ask for more than a full cup; picky orders can use 0–100
// as long as the total stays at 100 (index.html enforces that).
// less/more label the "which way?" buttons on the rating page.
export const KNOBS = [
  {
    key: "tea", label: "Tea", min: 15, max: 60, default: 35,
    less: "Weaker", more: "Stronger",
    describe: (v) => `${v}%`,
  },
  {
    key: "creamer", label: "Sweet creamer", min: 5, max: 30, default: 15,
    less: "Less creamy", more: "Creamier",
    describe: (v) => `${v}%`,
  },
];

const PRIOR_STARS = 3.5;  // our guess for a default-recipe cup before any ratings
const PRIOR_BOWL = 2;     // stars the guess loses one full knob range from the default
const RIDGE_GROUP = 2;    // roughly how many ratings it takes to outweigh the guess
const RIDGE_TASTE = 1.5;   // ...for your cup to drift from the group's
const RIDGE_BIAS = 1;     // ...to learn that you rate high or low
const SLOPE_MARGIN = 2;   // "more creamer" means stars climb at least this fast that way
const MAX_STEP = 0.15;    // your next cup moves at most this far (of a knob's range) from your last
const FIT_STEPS = 3000;
const CLIMB_STEPS = 400;

const norm = (knob, v) => (v - knob.min) / (knob.max - knob.min);
const denorm = (knob, x) => knob.min + x * (knob.max - knob.min);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const dot = (a, b) => a.reduce((s, ai, i) => s + ai * b[i], 0);
const add = (a, b) => a.map((ai, i) => ai + b[i]);

const X0 = KNOBS.map((k) => norm(k, k.default));

// [1, x1, x2, ..., x1², x1·x2, ..., x2², ...]
function features(x) {
  const f = [1, ...x];
  for (let i = 0; i < x.length; i++)
    for (let j = i; j < x.length; j++) f.push(x[i] * x[j]);
  return f;
}
const NF = features(X0).length;

// How each feature changes as knob k increases.
function featureSlope(x, k) {
  const g = [0, ...x.map((_, i) => (i === k ? 1 : 0))];
  for (let i = 0; i < x.length; i++)
    for (let j = i; j < x.length; j++) g.push((i === k ? x[j] : 0) + (j === k ? x[i] : 0));
  return g;
}

// A gentle bowl centered on the default recipe. Everything learned is a
// correction on top of it, so with no ratings the best recipe is the default.
function prior(x) {
  return PRIOR_STARS - PRIOR_BOWL * x.reduce((s, xi, i) => s + (xi - X0[i]) ** 2, 0);
}
const priorSlope = (x, k) => -2 * PRIOR_BOWL * (x[k] - X0[k]);

function predictNorm(w, x) {
  return prior(x) + dot(w, features(x));
}

// Orders turn into two kinds of rows, each tied to the person who ordered:
//   stars:     "this recipe got this many stars"
//   direction: "from this recipe, more of knob k would be better/worse/same"
function toRows(orders, useFeedback) {
  const people = new Map(); // id -> { n, top }
  const rows = [];
  orders.forEach((o, i) => {
    if (!Number.isInteger(o.rating) || !o.recipe) return;
    if (!KNOBS.every((k) => typeof o.recipe[k.key] === "number")) return;
    const id = o.drinker_id || `order-${i}`;
    const x = KNOBS.map((k) => norm(k, o.recipe[k.key]));
    const p = people.get(id) || { n: 0, top: null };
    p.n += 1;
    if (!p.top || o.rating > p.top.stars) p.top = { x, stars: o.rating };
    p.last = x;
    people.set(id, p);
    rows.push({ id, f: features(x), y: o.rating - prior(x), x, stars: o.rating });
    if (!useFeedback || !o.feedback) return;
    KNOBS.forEach((k, ki) => {
      const dir = o.feedback[k.key];
      if (dir === -1 || dir === 0 || dir === 1)
        rows.push({ id, g: featureSlope(x, ki), base: priorSlope(x, ki), dir });
    });
  });
  return { rows, people };
}

// Gradient descent on all the rows at once: the group curve plus one
// correction per person, each held back by its ridge penalty.
function fit(rows, ids, personal) {
  const wg = new Array(NF).fill(0);
  const wp = new Map(ids.map((id) => [id, new Array(NF).fill(0)]));
  if (!rows.length) return { wg, wp };
  // Step size small enough that descent can't overshoot for any data.
  const scale = personal ? 2 : 1;
  const lr = 1 / (rows.reduce((s, r) => s + scale * dot(r.f || r.g, r.f || r.g), 0)
                  + Math.max(RIDGE_GROUP, RIDGE_TASTE));
  for (let step = 0; step < FIT_STEPS; step++) {
    const gg = wg.map((w) => RIDGE_GROUP * w);
    const gp = new Map();
    for (const [id, w] of wp) gp.set(id, w.map((wi, i) => (i === 0 ? RIDGE_BIAS : RIDGE_TASTE) * wi));
    for (const r of rows) {
      const w = personal ? add(wg, wp.get(r.id)) : wg;
      let err, v;
      if (r.f) {
        v = r.f; err = dot(w, v) - r.y;
      } else {
        // Direction rows: the curve's slope should point the way they said.
        v = r.g;
        const slope = r.base + dot(w, v);
        if (r.dir === 0) err = slope;
        else err = Math.min(0, r.dir * slope - SLOPE_MARGIN) * r.dir;
      }
      if (!err) continue;
      for (let i = 0; i < NF; i++) gg[i] += err * v[i];
      if (personal) { const p = gp.get(r.id); for (let i = 0; i < NF; i++) p[i] += err * v[i]; }
    }
    for (let i = 0; i < NF; i++) wg[i] -= lr * gg[i];
    if (personal) for (const [id, w] of wp) { const p = gp.get(id); for (let i = 0; i < NF; i++) w[i] -= lr * p[i]; }
  }
  return { wg, wp };
}

// Gradient ascent on a fitted curve, kept inside the knob ranges (and within
// lo..hi if given). Starts from a few places and keeps the best peak.
function climb(w, starts, lo = X0.map(() => 0), hi = X0.map(() => 1)) {
  const h = 1e-4;
  const bound = (xi, i) => Math.min(hi[i], Math.max(lo[i], xi));
  let best = null;
  for (const start of starts) {
    let x = start.map(bound);
    for (let step = 0; step < CLIMB_STEPS; step++) {
      const lr = 0.05 / (1 + step / 50);
      x = x.map((xi, i) => {
        const up = [...x]; up[i] += h;
        const down = [...x]; down[i] -= h;
        const g = (predictNorm(w, up) - predictNorm(w, down)) / (2 * h);
        return bound(xi + lr * g, i);
      });
    }
    const stars = predictNorm(w, x);
    if (!best || stars > best.stars) best = { x, stars };
  }
  return best;
}

function toRecipe(x) {
  return Object.fromEntries(KNOBS.map((k, i) => [k.key, Math.round(denorm(k, x[i]))]));
}

const roundStars = (s) => Math.round(Math.min(5, Math.max(1, s)) * 10) / 10;

// orders: order docs ({ recipe, rating, feedback?, drinker_id? }). Unrated
// orders and orders from before a knob existed are skipped.
// options turn off parts of the model, for comparing in tools/simulate.mjs.
export function learn(orders, { personal = true, feedback = true } = {}) {
  const { rows, people } = toRows(orders, feedback);
  const n = rows.filter((r) => r.f).length;
  const { wg, wp } = fit(rows, [...people.keys()], personal);
  const topRated = rows.filter((r) => r.f).reduce((a, r) => (!a || r.stars > a.stars ? r : a), null);
  const starts = [X0, KNOBS.map(() => 0.5)];
  if (topRated) starts.push(topRated.x);
  const peak = climb(wg, starts);
  return {
    n,
    w: wg,
    best: toRecipe(peak.x),
    bestX: peak.x,
    predicted: roundStars(peak.stars),
    // How far "Order now" cups wander from the best guess. Shrinks with data.
    explore: Math.max(0.04, 0.25 / Math.sqrt(1 + n / 10)),
    personal,
    people,
    wp,
  };
}

// The model's view for one person: their best recipe and predicted stars.
// Someone with no ratings gets the group's.
export function forDrinker(model, id) {
  const p = model.personal && model.people.get(id);
  if (!p) return { ...model, nMine: 0 };
  const w = add(model.w, model.wp.get(id));
  const starts = [model.bestX, X0, p.last];
  if (p.top) starts.push(p.top.x);
  // A few ratings say which way to go, not how far, so take a limited step.
  const lo = p.last.map((xi) => clamp01(xi - MAX_STEP));
  const hi = p.last.map((xi) => clamp01(xi + MAX_STEP));
  const peak = climb(w, starts, lo, hi);
  return {
    ...model,
    nMine: p.n,
    w,
    best: toRecipe(peak.x),
    bestX: peak.x,
    predicted: roundStars(peak.stars),
    explore: Math.max(0.03, model.explore / Math.sqrt(1 + p.n / 2)),
  };
}

// Predicted stars for a recipe like { tea: 35, creamer: 25 }.
export function predict(model, recipe) {
  return predictNorm(model.w, KNOBS.map((k) => norm(k, recipe[k.key])));
}

// The recipe for an "Order now" cup: the best guess plus a random wiggle.
export function pickRecipe(model, rng = Math.random) {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return toRecipe(model.bestX.map((xi) => clamp01(xi + model.explore * gauss())));
}
