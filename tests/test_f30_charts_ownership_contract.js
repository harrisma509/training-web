const assert = require("node:assert/strict");
const fs = require("node:fs");

const appSource = fs.readFileSync("static/app.js", "utf8");
const chartsSource = fs.readFileSync("static/charts.js", "utf8");
const indexSource = fs.readFileSync("templates/index.html", "utf8");

assert.equal((chartsSource.match(/registerFeature\("charts", chartsController\)/g) || []).length, 1);
assert.match(chartsSource, /^\(function \(\) \{/);
assert.match(chartsSource, /const chartsController = \{/);
assert.match(chartsSource, /init: initializeChartsFeature/);
assert.match(chartsSource, /activate: \(\) => showChartsCategory\(getChartsCategory\(\)\)/);
assert.match(chartsSource, /refresh: \(\) => showChartsCategory\(getChartsCategory\(\), \{ force: true \}\)/);
assert.match(chartsSource, /showCategory: showChartsCategory/);
assert.doesNotMatch(chartsSource, /window\.(?:ChartsController|showChartsCategory)\s*=/);

for (const helper of [
  "normalizeChartsCategory",
  "getChartsCategory",
  "showChartsCategory",
  "loadChartsCategory",
  "initializeChartsFeature",
]) {
  assert.equal((chartsSource.match(new RegExp(`function ${helper}\\(`, "g")) || []).length, 1, helper);
}
for (const loader of ["loadCharts", "loadFitnessFatigue", "loadWeeklyLoad", "loadVolume"]) {
  assert.match(chartsSource, new RegExp(`function ${loader}\\(`), loader);
}

assert.match(chartsSource, /fitnessFatigueRequestId/);
assert.match(chartsSource, /fitnessFatigueTrendRequestId/);
assert.match(chartsSource, /weeklyLoadRequestId/);
assert.match(chartsSource, /volumeRequestId/);
assert.match(chartsSource, /weightChartRequestId/);
assert.match(chartsSource, /destroyFitnessFatigueChart\(\)/);
assert.match(chartsSource, /destroyWeeklyLoadChart\(\)/);
assert.match(chartsSource, /destroyVolumeChart\(\)/);
assert.match(chartsSource, /destroyWeightChart\(\)/);
assert.match(chartsSource, /new window\.Chart\(/);
assert.match(chartsSource, /new MutationObserver\(/);
assert.match(chartsSource, /if \(!force && weeklyLoadCache\.has\(cacheKey\)\)/);
assert.match(chartsSource, /loadFitnessFatigueTrend\(force\)/);
assert.match(chartsSource, /showChartsCategory\(getChartsCategory\(\), \{ load: false \}\)/);

for (const shellName of [
  "ChartsController",
  "loadCharts",
  "loadFitnessFatigue",
  "loadWeeklyLoad",
  "loadVolume",
  "showChartsCategory",
  "chartsFitnessTab",
  "chartsLoadTab",
  "chartsHealthTab",
  "chartsVolumeTab",
  "chartsFitnessPanel",
  "chartsLoadPanel",
  "chartsHealthPanel",
  "chartsVolumePanel",
  "new Chart(",
]) {
  assert.doesNotMatch(appSource, new RegExp(shellName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), shellName);
}
assert.match(appSource, /window\.TrainingApp\?\.features\?\.charts\?\.showCategory\?\./);
assert.doesNotMatch(appSource, /\/api\/charts/);

assert.ok(indexSource.indexOf("/static/vendor/chart.umd.min.js") < indexSource.indexOf("/static/charts.js"));
assert.ok(indexSource.indexOf("/static/charts.js") < indexSource.indexOf("/static/app.js"));

console.log("F30 Charts ownership contract tests passed.");
