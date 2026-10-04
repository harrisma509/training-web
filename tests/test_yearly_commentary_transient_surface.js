const assert = require("node:assert/strict");
const fs = require("node:fs");

const yearlySource = fs.readFileSync("static/yearly.js", "utf8");
const appSource = fs.readFileSync("static/app.js", "utf8");
const indexSource = fs.readFileSync("templates/index.html", "utf8");
const transientSource = fs.readFileSync("static/transient-surface.js", "utf8");

assert.match(indexSource, /src="\/static\/transient-surface\.js\?v=\{\{ asset_version \}\}"/);
assert.ok(indexSource.indexOf("/static/transient-surface.js") < indexSource.indexOf("/static/yearly.js"));
assert.ok(indexSource.indexOf("/static/yearly.js") < indexSource.indexOf("/static/app.js"));
assert.match(transientSource, /app\.TransientSurface = app\.TransientSurface \|\| \{ create: createTransientSurface \}/);

assert.match(yearlySource, /yearlyCommentarySurface = window\.TrainingApp\.TransientSurface\.create/);
assert.match(yearlySource, /yearlyCommentarySurface\.requestClose\("backdrop"\)/);
assert.match(yearlySource, /yearlyCommentarySurface\.requestClose\("close-button"\)/);
assert.match(yearlySource, /yearlyCommentarySurface\.requestClose\("escape"\)/);
assert.match(yearlySource, /yearlyCommentarySurface\.open\(\{ opener \}\)/);
assert.equal((yearlySource.match(/openYearlyCommentaryDrawer\(row\.dataset\.calendarYear, row\)/g) || []).length, 2);
assert.equal((yearlySource.match(/drawer\.classList\.add\("hidden"\)/g) || []).length, 1, "Yearly close hiding remains owner-owned");

assert.match(yearlySource, /goodNode\.textContent = "Loading\.\.\."/);
assert.match(yearlySource, /badNode\.textContent = "Loading\.\.\."/);
assert.match(yearlySource, /annualNode\.textContent = "Loading\.\.\."/);
assert.match(yearlySource, /goodNode\.textContent = "No entry recorded\."/);
assert.match(yearlySource, /fetchYearlyCommentary\(calendarYear\)/);
assert.match(yearlySource, /window\.showYearlyView = showYearlyView;/);
assert.match(yearlySource, /window\.YearlyController = yearlyController;/);
assert.match(yearlySource, /window\.TrainingApp\.registerFeature\("yearly", yearlyController\)/);
assert.doesNotMatch(appSource, /openYearlyCommentaryDrawer|yearlyCommentarySurface|fetchYearlyCommentary/);
assert.doesNotMatch(appSource, /localStorage[^\n]*yearlyCommentary/);

console.log("Yearly commentary transient-surface contract tests passed.");
