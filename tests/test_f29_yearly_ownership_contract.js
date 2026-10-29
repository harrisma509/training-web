const assert = require("node:assert/strict");
const fs = require("node:fs");

const appSource = fs.readFileSync("static/app.js", "utf8");
const yearlySource = fs.readFileSync("static/yearly.js", "utf8");

assert.match(yearlySource, /^\(function \(\) \{/);
assert.match(yearlySource, /const yearlyController = \{/);
assert.match(yearlySource, /init: initializeYearlyFeature/);
assert.match(yearlySource, /activate: \(\) => loadYearly\(false\)/);
assert.match(yearlySource, /refresh: \(\) => loadYearly\(true\)/);
assert.match(yearlySource, /showView: showYearlyView/);
assert.doesNotMatch(yearlySource, /window\.(?:YearlyController|showYearlyView)\s*=/);
assert.match(yearlySource, /window\.TrainingApp\.registerFeature\("yearly", yearlyController\)/);
assert.equal((yearlySource.match(/fetchYearly\(\)/g) || []).length, 1);
assert.equal((yearlySource.match(/function renderYearlyTable\(/g) || []).length, 1);
assert.equal((yearlySource.match(/function renderYearlyMonthlyTable\(/g) || []).length, 1);
assert.equal((yearlySource.match(/function showYearlyView\(/g) || []).length, 1);
assert.equal((yearlySource.match(/function loadYearly\(/g) || []).length, 1);
for (const metric of [
  "training_hours",
  "active_days",
  "cycling_distance_mi",
  "total_elevation_ft",
  "bike_elevation_ft",
  "ride_count",
  "ski_days",
]) {
  assert.match(
    yearlySource,
    new RegExp(`formatRecordCell\\(row\\.${metric},\\s*\\d+,\\s*Boolean\\(row\\.${metric}_record\\)\\)`),
  );
}
assert.doesNotMatch(appSource, /fetchYearly\(\)|function renderYearlyTable|function renderYearlyMonthlyTable|function showYearlyView|function loadYearly/);
assert.doesNotMatch(appSource, /yearlyAnnualTab|yearlyMonthlyTab|yearlyAnnualView|yearlyMonthlyView|yearlyRefresh/);
assert.match(appSource, /window\.TrainingApp\?\.features\?\.yearly\?\.refresh\?\.\(\)/);
assert.match(appSource, /window\.TrainingApp\?\.features\?\.yearly\?\.showView\?\./);

console.log("F29 Yearly ownership contract tests passed.");
