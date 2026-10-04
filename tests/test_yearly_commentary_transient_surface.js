const assert = require("node:assert/strict");
const fs = require("node:fs");

const appSource = fs.readFileSync("static/app.js", "utf8");
const yearlySource = fs.readFileSync("static/yearly.js", "utf8");
const indexSource = fs.readFileSync("templates/index.html", "utf8");
const transientSource = fs.readFileSync("static/transient-surface.js", "utf8");

assert.match(indexSource, /src="\/static\/transient-surface\.js\?v=\{\{ asset_version \}\}"/);
assert.ok(indexSource.indexOf("/static/transient-surface.js") < indexSource.indexOf("/static/yearly.js"));
assert.ok(indexSource.indexOf("/static/yearly.js") < indexSource.indexOf("/static/app.js"));
assert.match(transientSource, /app\.TransientSurface = app\.TransientSurface \|\| \{ create: createTransientSurface \}/);

assert.match(appSource, /yearlyCommentarySurface = window\.TrainingApp\.TransientSurface\.create/);
assert.match(appSource, /yearlyCommentarySurface\.requestClose\("backdrop"\)/);
assert.match(appSource, /yearlyCommentarySurface\.requestClose\("close-button"\)/);
assert.match(appSource, /yearlyCommentarySurface\.requestClose\("escape"\)/);
assert.match(appSource, /yearlyCommentarySurface\.open\(\{ opener \}\)/);
assert.equal((appSource.match(/openYearlyCommentaryDrawer\(row\.dataset\.calendarYear, row\)/g) || []).length, 2);
assert.equal((appSource.match(/drawer\.classList\.add\("hidden"\)/g) || []).length, 1, "Yearly close hiding remains owner-owned");

assert.match(appSource, /goodNode\.textContent = "Loading\.\.\."/);
assert.match(appSource, /badNode\.textContent = "Loading\.\.\."/);
assert.match(appSource, /annualNode\.textContent = "Loading\.\.\."/);
assert.match(appSource, /goodNode\.textContent = "No entry recorded\."/);
assert.match(appSource, /fetchYearlyCommentary\(calendarYear\)/);
assert.match(appSource, /window\.showYearlyView = showYearlyView;/);
assert.match(yearlySource, /window\.YearlyController = \{/);
assert.match(appSource, /window\.TrainingApp\.registerFeature\("yearly", window\.YearlyController\)/);
assert.doesNotMatch(appSource, /localStorage[^\n]*yearlyCommentary/);

console.log("Yearly commentary transient-surface contract tests passed.");
