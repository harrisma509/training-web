const assert = require("node:assert/strict");
const fs = require("node:fs");

const dailySource = fs.readFileSync("static/daily.js", "utf8");
const appSource = fs.readFileSync("static/app.js", "utf8");
const settingsSource = fs.readFileSync("static/settings.js", "utf8");
const templateSource = fs.readFileSync("templates/index.html", "utf8");

assert.match(dailySource, /^\(\(\) => \{/);
assert.match(dailySource, /const dailyController = \{/);
for (const method of ["init", "activate", "refresh", "load", "render"]) {
    assert.match(dailySource, new RegExp(`${method}:`), method);
}
assert.equal(
    (dailySource.match(/registerFeature\("daily", dailyController\)/g) || []).length,
    1,
    "Daily must register exactly once",
);
assert.match(dailySource, /window\.TrainingApp\.registerFeature\("daily", dailyController\)/);
assert.doesNotMatch(dailySource, /window\.(?:loadDaily|DailyController)\s*=/);

for (const ownerPattern of [
    /function renderDailyTable\(/,
    /function loadDailyData\(/,
    /function getDailyExactDate\(/,
    /dailyNarrativeCache = new Map/,
    /dailyNarrativeRequestId/,
    /dailyDayMenu/,
    /dailyDayOperation/,
    /fetchActivityNarrative/,
    /previewDayResync/,
    /resyncDay/,
    /fetchSyncRequestStatus/,
    /dailyLoadPromise/,
    /dailyLoadRequestId/,
    /window\.addEventListener\("beforeunload", clearDailyDayStatusTimer\)/,
]) {
    assert.match(dailySource, ownerPattern);
}

assert.match(dailySource, /if \(dailySearchListenerBound\)/);
assert.match(dailySource, /if \(dailyLimitListenerBound\)/);
assert.match(dailySource, /if \(dailyInitialized\)/);
assert.match(dailySource, /if \(dailyLoadPromise && dailyLoadPromiseKey === loadKey\)/);
assert.match(dailySource, /if \(!force && dailyLoadedKey === loadKey\)/);
assert.match(dailySource, /requestId !== dailyLoadRequestId/);
assert.match(dailySource, /requestId !== dailyNarrativeRequestId/);
assert.match(dailySource, /dailyNarrativeActiveId !== normalizedId/);
assert.match(dailySource, /DAILY_DAY_SUCCESS_DISMISS_DELAY_MS = 10000/);
assert.match(dailySource, /window\.setTimeout/);
assert.match(dailySource, /window\.clearTimeout/);
assert.match(dailySource, /context\.route\?\.date/);
assert.match(dailySource, /getDailyExactDate\(\)/);

for (const shellPattern of [
    /fetchDaily\(/,
    /\/api\/daily/,
    /renderDailyTable\(/,
    /window\.loadDaily\(/,
    /DailyController/,
    /dailyNarrative/,
    /dailyDay/,
    /daily-day-resync/,
    /daily-narrative/,
]) {
    assert.doesNotMatch(appSource, shellPattern, `app.js must not own ${shellPattern}`);
}
assert.doesNotMatch(appSource, /registerFeature\("daily"/);
assert.doesNotMatch(appSource, /featureName === "daily"/);
assert.match(appSource, /features\?\.daily\?\.refresh\?\./);
assert.match(settingsSource, /features\?\.daily\?\.refresh\?\./);
assert.doesNotMatch(settingsSource, /window\.loadDaily\(\)/);

const dailyScriptIndex = templateSource.indexOf('/static/daily.js');
const appScriptIndex = templateSource.indexOf('/static/app.js');
assert.ok(dailyScriptIndex >= 0 && appScriptIndex > dailyScriptIndex, "app.js must load after daily.js");
assert.match(templateSource, /daily\.js\?v=\{\{ asset_version \}\}/);
assert.match(templateSource, /app\.js\?v=\{\{ asset_version \}\}/);

assert.match(appSource, /source: "popstate"/);
assert.match(appSource, /window\.history\.replaceState\(\{\}, "", lastAcceptedRoute\)/);
assert.match(appSource, /date: url\.searchParams\.get\("date"\)/);

console.log("F31 Daily ownership contract tests passed.");
