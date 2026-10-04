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
assert.match(yearlySource, /window\.TrainingApp\.registerFeature\("yearly", yearlyController\)/);
assert.equal((yearlySource.match(/fetchYearly\(\)/g) || []).length, 1);
assert.equal((yearlySource.match(/function renderYearlyTable\(/g) || []).length, 1);
assert.equal((yearlySource.match(/function renderYearlyMonthlyTable\(/g) || []).length, 1);
assert.equal((yearlySource.match(/function showYearlyView\(/g) || []).length, 1);
assert.equal((yearlySource.match(/function loadYearly\(/g) || []).length, 1);
assert.doesNotMatch(appSource, /fetchYearly\(\)|function renderYearlyTable|function renderYearlyMonthlyTable|function showYearlyView|function loadYearly/);
assert.doesNotMatch(appSource, /yearlyAnnualTab|yearlyMonthlyTab|yearlyAnnualView|yearlyMonthlyView|yearlyRefresh/);
assert.match(appSource, /window\.TrainingApp\?\.features\?\.yearly\?\.refresh\?\.\(\)/);
assert.match(appSource, /window\.TrainingApp\?\.features\?\.yearly\?\.showView\?\./);

console.log("F29 Yearly ownership contract tests passed.");
