const assert = require("node:assert/strict");
const fs = require("node:fs");

const weeklySource = fs.readFileSync("static/weekly.js", "utf8");
const appSource = fs.readFileSync("static/app.js", "utf8");
const settingsSource = fs.readFileSync("static/settings.js", "utf8");

assert.match(weeklySource, /const weeklyController = \{/);
assert.match(weeklySource, /window\.TrainingApp\.registerFeature\("weekly", weeklyController\);/);
assert.equal((weeklySource.match(/registerFeature\("weekly"/g) || []).length, 1);
assert.doesNotMatch(weeklySource, /window\.(?:WeeklyController|loadWeekly|renderWeeklyTable|showWeeklyCommentary|openWeeklyDrawer|closeWeeklyDrawer)\s*=/);
assert.doesNotMatch(appSource, /window\.(?:WeeklyController|loadWeekly|renderWeeklyTable|showWeeklyCommentary|openWeeklyDrawer|closeWeeklyDrawer)/);
assert.doesNotMatch(settingsSource, /window\.(?:WeeklyController|loadWeekly|renderWeeklyTable|showWeeklyCommentary|openWeeklyDrawer|closeWeeklyDrawer)/);

assert.match(weeklySource, /activate: \(\) => loadWeekly\(false\)/);
assert.match(weeklySource, /refresh: \(\) => loadWeekly\(true\)/);
assert.match(weeklySource, /load: \(\) => loadWeekly\(true\)/);
assert.match(weeklySource, /if \(!force && weeklyLoaded\)/);
assert.match(weeklySource, /if \(!force && weeklyLoadPromise\)/);
assert.match(weeklySource, /if \(requestId !== weeklyLoadRequestId\)/);
assert.match(weeklySource, /registerWeeklyEventHandlers\(\);/);
assert.match(weeklySource, /attachWeeklyLimitSelector\(\);/);
assert.match(appSource, /window\.TrainingApp\?\.features\?\.weekly\?\.refresh\?\.\(\)/);
assert.match(settingsSource, /window\.TrainingApp\?\.features\?\.weekly\?\.refresh\?\.\(\)/);
assert.match(weeklySource, /function openWeeklyAuditDrawer\(/);
assert.match(weeklySource, /function closeWeeklyAuditDrawer\(/);
assert.match(weeklySource, /function openWeeklyDrawer\(/);
assert.match(weeklySource, /function closeWeeklyDrawer\(/);
assert.match(weeklySource, /function renderWeeklyTable\(/);
assert.match(weeklySource, /function saveWeeklyDrawer\(/);

console.log("F28 Weekly compatibility-global contract tests passed.");