const assert = require("node:assert/strict");
const fs = require("node:fs");

const appSource = fs.readFileSync("static/app.js", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");

assert.match(
  appSource,
  /if \(window\.PlanController\)\s*\{\s*window\.TrainingApp\.registerFeature\("plan", window\.PlanController\);\s*\}/,
);
assert.match(planSource, /window\.loadPlan\s*=\s*loadPlan;/);
assert.match(appSource, /window\.TrainingApp\.registerFeature = window\.TrainingApp\.registerFeature \|\| function/);
assert.match(appSource, /function createFeatureActivationDispatcher/);
assert.match(appSource, /window\.TrainingApp\.activateFeature = activateFeature;/);
assert.match(appSource, /window\.activateFeature = activateFeature;/);

console.log("TrainingApp Plan registry contract tests passed.");
