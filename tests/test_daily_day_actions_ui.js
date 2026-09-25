const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("static/daily.js", "utf8");
const apiSource = fs.readFileSync("static/api.js", "utf8");
const styleSource = fs.readFileSync("static/style.css", "utf8");

assert.match(source, /daily-day-actions-toggle/);
assert.match(source, /aria-haspopup="menu"/);
assert.match(source, /Resync day from Strava/);
assert.match(source, /previewDayResync/);
assert.match(source, /showDailyDayDialog/);
assert.match(source, /resyncDay/);
assert.match(source, /fetchSyncRequestStatus/);
assert.match(source, /Promise\.all/);
assert.match(source, /clearDailyNarrativeCache/);
assert.match(source, /loadDaily\(\)/);
assert.match(source, /daily-day-resync-dialog/);
assert.match(source, /daily-day-resync-status-dismiss/);
assert.match(source, /DAILY_DAY_SUCCESS_DISMISS_DELAY_MS = 10000/);
assert.match(source, /state !== "busy"/);
assert.match(source, /dismissDailyDayStatus\(event\.detail === 0\)/);
assert.match(source, /dailyDayStatusGeneration/);
assert.match(source, /text\.textContent = message/);
assert.doesNotMatch(source, /status\.innerHTML/);
assert.doesNotMatch(source, /localStorage|sessionStorage/);
assert.match(apiSource, /sync\/dates/);
assert.match(apiSource, /sync-requests/);
assert.match(styleSource, /\.daily-day-actions-toggle/);
assert.match(styleSource, /min-width: 14px/);
assert.match(styleSource, /height: 24px/);
assert.match(styleSource, /margin: 0/);
assert.match(styleSource, /position: fixed/);
assert.match(styleSource, /\.daily-day-resync-status \{/);
assert.match(styleSource, /\.daily-day-resync-status-dismiss/);
assert.match(styleSource, /flex-basis: 28px/);

console.log("Daily day resync UI contract tests passed.");