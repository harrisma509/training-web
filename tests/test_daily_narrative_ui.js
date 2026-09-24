const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("static/daily.js", "utf8");
const apiSource = fs.readFileSync("static/api.js", "utf8");
const styleSource = fs.readFileSync("static/style.css", "utf8");

assert.match(source, /main_ride_has_description/);
assert.match(source, /main_ride_has_private_note/);
assert.match(source, /daily-narrative-toggle/);
assert.match(source, /daily-narrative-main-ride-toggle/);
assert.match(source, /daily-narrative-mobile-toggle/);
assert.match(source, /renderNarrativeToggle/);
assert.match(source, /renderMobileNarrativeCell/);
assert.match(source, /renderNarrativeToggle\(activityId, "daily-narrative-main-ride-toggle"\)/);
assert.match(source, /renderNarrativeToggle\(activityId, "daily-narrative-mobile-toggle"\)/);
assert.match(source, /hasNarrativeForRow/);
assert.match(source, /aria-expanded/);
assert.match(source, /Show activity notes/);
assert.match(source, /Hide activity notes/);
assert.match(source, /dailyNarrativeCache = new Map/);
assert.match(source, /dailyNarrativeRequestId/);
assert.match(source, /textContent = String\(value\)/);
assert.match(source, /daily-narrative-retry/);
assert.doesNotMatch(source, /localStorage|sessionStorage/);
assert.match(apiSource, /fetchActivityNarrative/);
assert.match(apiSource, /\/api\/activities\//);
assert.match(styleSource, /\.daily-narrative-drawer-row/);
assert.match(styleSource, /overflow-wrap: anywhere/);
assert.match(styleSource, /@media \(max-width: 1050px\)/);
assert.match(styleSource, /daily-narrative-mobile-toggle/);
assert.match(styleSource, /min-height: 32px/);

console.log("Daily narrative UI contract tests passed.");
