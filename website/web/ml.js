// Recipe model: learns which recipe each person likes best.
//
// Every rated order is a data point (recipe -> stars, plus optional "which
// way?" answers like "stronger"). We fit one curve for the whole group, a
// small correction for each person and one for each tea, all at once with
// gradient descent:
//
//   predicted stars = starting guess + group curve + your correction + tea's correction
//
// Your correction starts at zero, so a newcomer gets the group's best cup. It
// grows as you rate, and since it sits on top of the live group curve, you
// keep benefiting when the group curve improves. The correction's constant
// term soaks up how generously you rate, so harsh and easy raters both count.
// A tea's correction works the same way: a new tea starts from what everyone
// likes and learns its own shift (say, "this one needs more tea") as it gets
// rated, while every rating still teaches the group curve.
//
// Then we climb that curve (gradient ascent) to the recipe it predicts you'll
// rate highest, and add a random wiggle so the model keeps learning. The only
// limit is the cup: the knobs together can't go over 100%.
//
// No Firebase imports here, so tools/simulate.mjs can run it in Node.

// One entry per thing the machine can vary, each a % of the cup. Water fills
// whatever tea and creamer leave, so tea % is how strong the drink is and
// creamer % how creamy (and sweet: the creamer is sweetened) it is.
// Each can be 0–100, as long as they add up to at most 100 (a full cup); the
// model and the picky sliders (index.html) both stick to that and nothing else.
// less/more label the "which way?" buttons on the rating page.
export const KNOBS = [
  {
    key: "tea", label: "Tea", default: 35,
    less: "Weaker", more: "Stronger",
    describe: (v) => `${v}%`,
  },
  {
    key: "creamer", label: "Sweet creamer", default: 15,
    less: "Less creamy", more: "Creamier",
    describe: (v) => `${v}%`,
  },
];

const PRIOR_STARS = 3.5;  // our guess for a default-recipe cup before any ratings
const PRIOR_BOWL = 2;     // stars the guess loses 100 points from the default
const RIDGE_GROUP = 2;    // roughly how many ratings it takes to outweigh the guess
const RIDGE_TASTE = 1.5;   // ...for your cup to drift from the group's
const RIDGE_BIAS = 1;     // ...to learn that you rate high or low
const RIDGE_TEA = 2;      // ...for a tea's best cup to drift from the group's
const SLOPE_MARGIN = 2;   // "more creamer" means stars climb at least this fast that way
const FIT_STEPS = 3000;
const CLIMB_STEPS = 400;

// Knobs are worked on as fractions of the cup (0–1).
const norm = (knob, v) => v / 100;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const dot = (a, b) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};
const add = (a, b) => a.map((ai, i) => ai + b[i]);

const X0 = KNOBS.map((k) => norm(k, k.default));

// The nearest mix that fits in the cup: every knob 0–1 and all of them
// together at most 1. Over a full cup, it takes the same amount off each
// knob that still has some.
function fitCup(x) {
  x = x.map(clamp01);
  let over = x.reduce((s, xi) => s + xi, 0) - 1;
  while (over > 1e-9) {
    const left = x.filter((xi) => xi > 0);
    const cut = Math.min(over / left.length, ...left);
    x = x.map((xi) => (xi > 0 ? xi - cut : xi));
    over -= cut * left.length;
  }
  return x;
}

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
  const teas = new Set();
  const rows = [];
  orders.forEach((o, i) => {
    if (!Number.isInteger(o.rating) || !o.recipe) return;
    if (!KNOBS.every((k) => typeof o.recipe[k.key] === "number")) return;
    const id = o.drinker_id || `order-${i}`;
    const tea = o.recipe.tea_type || null;
    if (tea) teas.add(tea);
    const x = KNOBS.map((k) => norm(k, o.recipe[k.key]));
    const p = people.get(id) || { n: 0, top: null };
    p.n += 1;
    if (!p.top || o.rating > p.top.stars) p.top = { x, stars: o.rating };
    p.last = x;
    people.set(id, p);
    rows.push({ id, tea, f: features(x), y: o.rating - prior(x), x, stars: o.rating });
    if (!useFeedback || !o.feedback) return;
    KNOBS.forEach((k, ki) => {
      const dir = o.feedback[k.key];
      if (dir === -1 || dir === 0 || dir === 1)
        rows.push({ id, tea, g: featureSlope(x, ki), base: priorSlope(x, ki), dir });
    });
  });
  return { rows, people, teas };
}

// Gradient descent on all the rows at once: the group curve plus one
// correction per person and one per tea, each held back by its ridge penalty.
function fit(rows, ids, teas, personal) {
  const zeros = () => new Array(NF).fill(0);
  const wg = zeros();
  const wp = new Map(ids.map((id) => [id, zeros()]));
  const wt = new Map(teas.map((t) => [t, zeros()]));
  if (!rows.length) return { wg, wp, wt };
  // Step size small enough that descent can't overshoot for any data.
  const scale = 1 + (personal ? 1 : 0) + (teas.length ? 1 : 0);
  const lr = 1 / (rows.reduce((s, r) => s + scale * dot(r.f || r.g, r.f || r.g), 0)
                  + Math.max(RIDGE_GROUP, RIDGE_TASTE, RIDGE_TEA));
  for (let step = 0; step < FIT_STEPS; step++) {
    const gg = wg.map((w) => RIDGE_GROUP * w);
    const gp = new Map();
    for (const [id, w] of wp) gp.set(id, w.map((wi, i) => (i === 0 ? RIDGE_BIAS : RIDGE_TASTE) * wi));
    const gt = new Map();
    for (const [t, w] of wt) gt.set(t, w.map((wi) => RIDGE_TEA * wi));
    for (const r of rows) {
      const tg = gt.get(r.tea);
      const v = r.f || r.g;
      // Group + person + tea curves at this row, without building their sum.
      let at = dot(wg, v);
      if (personal) at += dot(wp.get(r.id), v);
      if (tg) at += dot(wt.get(r.tea), v);
      let err;
      if (r.f) {
        err = at - r.y;
      } else {
        // Direction rows: the curve's slope should point the way they said.
        const slope = r.base + at;
        if (r.dir === 0) err = slope;
        else err = Math.min(0, r.dir * slope - SLOPE_MARGIN) * r.dir;
      }
      if (!err) continue;
      for (let i = 0; i < NF; i++) gg[i] += err * v[i];
      if (personal) { const p = gp.get(r.id); for (let i = 0; i < NF; i++) p[i] += err * v[i]; }
      if (tg) for (let i = 0; i < NF; i++) tg[i] += err * v[i];
    }
    for (let i = 0; i < NF; i++) wg[i] -= lr * gg[i];
    if (personal) for (const [id, w] of wp) { const p = gp.get(id); for (let i = 0; i < NF; i++) w[i] -= lr * p[i]; }
    for (const [t, w] of wt) { const p = gt.get(t); for (let i = 0; i < NF; i++) w[i] -= lr * p[i]; }
  }
  return { wg, wp, wt };
}

// Gradient ascent on a fitted curve, staying within a cup. Starts from a few
// places and keeps the best peak.
function climb(w, starts) {
  const h = 1e-4;
  let best = null;
  for (const start of starts) {
    let x = fitCup(start);
    for (let step = 0; step < CLIMB_STEPS; step++) {
      const lr = 0.05 / (1 + step / 50);
      x = fitCup(x.map((xi, i) => {
        const up = [...x]; up[i] += h;
        const down = [...x]; down[i] -= h;
        const g = (predictNorm(w, up) - predictNorm(w, down)) / (2 * h);
        return xi + lr * g;
      }));
    }
    const stars = predictNorm(w, x);
    if (!best || stars > best.stars) best = { x, stars };
  }
  return best;
}

// Whole percents, still adding up to at most 100 after rounding.
function toRecipe(x) {
  const v = x.map((xi) => Math.round(xi * 100));
  while (v.reduce((s, vi) => s + vi, 0) > 100) v[v.indexOf(Math.max(...v))] -= 1;
  return Object.fromEntries(KNOBS.map((k, i) => [k.key, v[i]]));
}

const roundStars = (s) => Math.round(Math.min(5, Math.max(1, s)) * 10) / 10;

// orders: order docs ({ recipe, rating, feedback?, drinker_id? }). Unrated
// orders and orders from before a knob existed are skipped.
// options turn off parts of the model, for comparing in tools/simulate.mjs.
export function learn(orders, { personal = true, feedback = true, perTea = true } = {}) {
  const { rows, people, teas } = toRows(orders, feedback);
  const n = rows.filter((r) => r.f).length;
  // With only one tea, the group curve already is that tea's curve.
  const teaList = perTea && teas.size > 1 ? [...teas] : [];
  const { wg, wp, wt } = fit(rows, [...people.keys()], teaList, personal);
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
    wt,
  };
}

// The model's view for one person and tea: their best recipe and predicted
// stars. Someone with no ratings gets the group's (for that tea).
export function forDrinker(model, id, tea) {
  const p = model.personal && model.people.get(id);
  const wt = model.wt.get(tea);
  if (!p && !wt) return { ...model, nMine: 0 };
  let w = model.w;
  if (wt) w = add(w, wt);
  if (p) w = add(w, model.wp.get(id));
  const starts = [model.bestX, X0];
  if (p) starts.push(p.last);
  if (p?.top) starts.push(p.top.x);
  const peak = climb(w, starts);
  return {
    ...model,
    nMine: p ? p.n : 0,
    w,
    best: toRecipe(peak.x),
    bestX: peak.x,
    predicted: roundStars(peak.stars),
    explore: p ? Math.max(0.03, model.explore / Math.sqrt(1 + p.n / 2)) : model.explore,
  };
}

// Predicted stars for a recipe like { tea: 35, creamer: 25 }.
export function predict(model, recipe) {
  return predictNorm(model.w, KNOBS.map((k) => norm(k, recipe[k.key])));
}

// The recipe for an "Order now" cup: the best guess plus a random wiggle.
export function pickRecipe(model, rng = Math.random) {
  const gauss = () => Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
  return toRecipe(fitCup(model.bestX.map((xi) => xi + model.explore * gauss())));
}
