// Watch the recipe model learn from pretend friends, no Firebase needed.
// Each friend has a favorite creamer % near TRUE_FAVORITE and rates their cup
// 1–5 with some noise. Usage:
//   node tools/simulate.mjs            # friends like 20% creamer
//   node tools/simulate.mjs 45 100     # friends like 45%, 100 cups
import { readFileSync } from "node:fs";

// Imported from source so it runs on any Node version.
const src = readFileSync(new URL("../web/ml.js", import.meta.url), "utf8");
const { learn, pickRecipe } = await import("data:text/javascript," + encodeURIComponent(src));

const TRUE_FAVORITE = Number(process.argv[2] ?? 20);
const CUPS = Number(process.argv[3] ?? 60);
const gauss = () => Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());

const orders = [];
for (let i = 1; i <= CUPS; i++) {
  const model = learn(orders);
  const recipe = pickRecipe(model);
  const favorite = TRUE_FAVORITE + 6 * gauss();
  const stars = Math.round(5 - 0.004 * (recipe.creamer - favorite) ** 2 + 0.7 * gauss());
  orders.push({ recipe, rating: Math.min(5, Math.max(1, stars)) });
  if (i % 5 === 0) {
    console.log(`cup ${String(i).padStart(3)}: served ${recipe.creamer}% → ${orders.at(-1).rating}★` +
      `   model's best guess ${model.best.creamer}% (predicts ${model.predicted}★)`);
  }
}
