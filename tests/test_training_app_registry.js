const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const appSource = fs.readFileSync("static/app.js", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");

assert.match(
  appSource,
  /if \(window\.PlanController\)\s*\{\s*window\.TrainingApp\.features\.plan = window\.PlanController;\s*\}/,
);
assert.match(planSource, /window\.loadPlan\s*=\s*loadPlan;/);

const planDispatchSource = appSource.match(/if \(isPlan\) \{[\s\S]*?\n  \}/);
assert.ok(planDispatchSource, "Plan activation should have an explicit dispatch block");
const dispatchPlan = vm.runInNewContext(
  `(function (window, isPlan) { ${planDispatchSource[0]} })`,
);

const normalActivationCalls = [];
dispatchPlan({
  TrainingApp: {
    features: {
      plan: { load: () => normalActivationCalls.push("registered") },
    },
  },
  loadPlan: () => normalActivationCalls.push("legacy"),
}, true);
assert.deepEqual(normalActivationCalls, ["registered"]);

const nonPlanActivationCalls = [];
dispatchPlan({
  TrainingApp: {
    features: {
      plan: { load: () => nonPlanActivationCalls.push("registered") },
    },
  },
  loadPlan: () => nonPlanActivationCalls.push("legacy"),
}, false);
assert.deepEqual(nonPlanActivationCalls, []);

for (const features of [{}, { plan: {} }]) {
  const fallbackCalls = [];
  dispatchPlan({
    TrainingApp: { features },
    loadPlan: () => fallbackCalls.push("legacy"),
  }, true);
  assert.deepEqual(fallbackCalls, ["legacy"]);
}

console.log("TrainingApp Plan registry contract tests passed.");
