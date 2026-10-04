const assert = require("node:assert/strict");
const fs = require("node:fs");

const appSource = fs.readFileSync("static/app.js", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");
const weeklySource = fs.readFileSync("static/weekly.js", "utf8");
const zonesSource = fs.readFileSync("static/zones.js", "utf8");

assert.doesNotMatch(planSource, /window\.loadPlan\s*=/);
assert.doesNotMatch(appSource, /window\.loadPlan/);
assert.doesNotMatch(appSource, /featureName === "plan"/);
assert.match(appSource, /window\.TrainingApp\.registerFeature\("plan", window\.PlanController\);/);
assert.match(planSource, /init: initPlan/);
assert.match(planSource, /activate: \(\) => loadPlan\(false\)/);
assert.match(planSource, /refresh: \(\) => loadPlan\(true\)/);
assert.match(planSource, /load: \(\) => loadPlan\(true\)/);
assert.match(planSource, /PLAN_LOAD_REQUESTS/);

assert.doesNotMatch(weeklySource, /window\.loadWeekly\s*=\s*loadWeekly;/);
assert.doesNotMatch(zonesSource, /window\.loadZones\s*=\s*loadZones;/);
assert.doesNotMatch(zonesSource, /window\.ZonesController\s*=/);

console.log("F23 Plan compatibility-global contract tests passed.");
