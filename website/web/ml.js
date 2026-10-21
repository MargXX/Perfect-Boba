// Recipe model: learns which recipe earns the most stars.
//
// Every rated order is a data point (recipe -> stars). We fit a small quadratic
// surface to all of them with gradient descent, then climb that surface
// (gradient ascent) to find the recipe it predicts will score highest.
// "Order now" cups get that recipe plus a little random wiggle, so the machine
// keeps trying nearby recipes and the fit keeps getting better.
//
// No Firebase imports here, so tools/simulate.mjs can run it in Node.

// One entry per thing the machine can vary. Add a knob when you add a pump.
// min/max bound what the model may try; picky orders can use 0–100.
export const KNOBS = [
  {
    key: "creamer", label: "Creamer", min: 5, max: 60, default: 30,
    describe: (v) => `${v}% creamer · ${100 - v}% tea`,
  },
];

const PRIOR_STARS = 3.5; // our guess for a default-recipe cup before any ratings
const PRIOR_BOWL = 2;    // stars the guess loses one full knob range from the default
const RIDGE = 2;         // roughly how many ratings it takes to outweigh the guess
const FIT_STEPS = 3000;
const CLIMB_STEPS = 400;

const norm = (knob, v) => (v - knob.min) / (knob.max - knob.min);
const denorm = (knob, x) => knob.min + x * (knob.max - knob.min);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const dot = (a, b) => a.reduce((s, ai, i) => s + ai * b[i], 0);

const X0 = KNOBS.map((k) => norm(k, k.default));

// [1, x1, x2, ..., x1², x1·x2, ..., x2², ...]
function features(x) {
  const f = [1, ...x];
  for (let i = 0; i < x.length; i++)
    for (let j = i; j < x.length; j++) f.push(x[i] * x[j]);
  return f;
}

// A gentle bowl centered on the default recipe. The fit learns corrections on
// top of it, so with no ratings the best recipe is just the default.
function prior(x) {
  return PRIOR_STARS - PRIOR_BOWL * x.reduce((s, xi, i) => s + (xi - X0[i]) ** 2, 0);
}

function predictNorm(w, x) {
  return prior(x) + dot(w, features(x));
}

// Gradient descent on squared error + ridge penalty.
function fit(rows) {
  const data = rows.map((r) => ({ f: features(r.x), y: r.stars - prior(r.x) }));
  const w = new Array(features(X0).length).fill(0);
  if (!data.length) return w;
  // Step size small enough that descent can't overshoot for any data.
  const lr = 1 / (data.reduce((s, d) => s + dot(d.f, d.f), 0) + RIDGE);
  for (let step = 0; step < FIT_STEPS; step++) {
    const grad = w.map((wi) => RIDGE * wi);
    for (const d of data) {
      const err = dot(w, d.f) - d.y;
      for (let i = 0; i < grad.length; i++) grad[i] += err * d.f[i];
    }
    for (let i = 0; i < w.length; i++) w[i] -= lr * grad[i];
  }
  return w;
}

// Gradient ascent on the fitted surface, kept inside the knob ranges.
// Starts from a few places and keeps the best peak.
function climb(w, starts) {
  const h = 1e-4;
  let best = null;
  for (const start of starts) {
    let x = start.map(clamp01);
    for (let step = 0; step < CLIMB_STEPS; step++) {
      const lr = 0.05 / (1 + step / 50);
      x = x.map((xi, i) => {
        const up = [...x]; up[i] += h;
        const down = [...x]; down[i] -= h;
        const g = (predictNorm(w, up) - predictNorm(w, down)) / (2 * h);
        return clamp01(xi + lr * g);
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

// orders: order docs ({ recipe, rating }). Unrated orders and orders from
// before a knob existed are skipped.
export function learn(orders) {
  const rows = [];
  for (const o of orders) {
    if (!Number.isInteger(o.rating) || !o.recipe) continue;
    if (!KNOBS.every((k) => typeof o.recipe[k.key] === "number")) continue;
    rows.push({ x: KNOBS.map((k) => norm(k, o.recipe[k.key])), stars: o.rating });
  }
  const w = fit(rows);
  const topRated = rows.reduce((a, r) => (!a || r.stars > a.stars ? r : a), null);
  const starts = [X0, KNOBS.map(() => 0.5)];
  if (topRated) starts.push(topRated.x);
  const peak = climb(w, starts);
  return {
    n: rows.length,
    w,
    best: toRecipe(peak.x),
    bestX: peak.x,
    predicted: Math.round(Math.min(5, Math.max(1, peak.stars)) * 10) / 10,
    // How far "Order now" cups wander from the best guess. Shrinks with data.
    explore: Math.max(0.04, 0.25 / Math.sqrt(1 + rows.length / 10)),
  };
}

// Predicted stars for a recipe like { creamer: 30 }.
export function predict(model, recipe) {
  return predictNorm(model.w, KNOBS.map((k) => norm(k, recipe[k.key])));
}

// The recipe for an "Order now" cup: the best guess plus a random wiggle.
export function pickRecipe(model, rng = Math.random) {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return toRecipe(model.bestX.map((xi) => clamp01(xi + model.explore * gauss())));
}
