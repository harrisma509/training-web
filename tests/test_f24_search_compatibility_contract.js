const assert = require("node:assert/strict");
const fs = require("node:fs");

const searchSource = fs.readFileSync("static/search.js", "utf8");
const appSource = fs.readFileSync("static/app.js", "utf8");
const dailySource = fs.readFileSync("static/daily.js", "utf8");
const gearSource = fs.readFileSync("static/gear.js", "utf8");

assert.doesNotMatch(searchSource, /window\.SearchController/);
assert.doesNotMatch(appSource, /window\.SearchController/);
assert.doesNotMatch(dailySource, /window\.SearchController/);
assert.doesNotMatch(gearSource, /window\.SearchController/);
assert.match(searchSource, /const searchController = \{/);
assert.match(searchSource, /window\.TrainingApp\.registerFeature\("search", searchController\);/);
assert.match(appSource, /window\.TrainingApp\?\.features\?\.search\?\.removeSearchParameters/);
assert.match(appSource, /window\.TrainingApp\?\.features\?\.search\?\.restoreFromUrl/);
assert.match(dailySource, /window\.TrainingApp\?\.features\?\.search\?\.openAdvancedSearch/);
assert.match(gearSource, /window\.TrainingApp\?\.features\?\.search\?\.refreshGearOptions/);

console.log("F24 Search compatibility-global contract tests passed.");
