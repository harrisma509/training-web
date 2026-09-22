const assert = require("node:assert/strict");
const fs = require("node:fs");
const { formatContextCoverage } = require("../static/coach.js");

const base = {
    detailed_activity_days: 55,
    weekly_rows: 52,
    recovery_days: 28,
};

assert.equal(
    formatContextCoverage({ ...base, daily_checkin_count: 3 }),
    "55 activity days, 52 weekly rows, 28 recovery days, 3 daily check-ins",
);
assert.equal(
    formatContextCoverage({ ...base, daily_checkin_count: 1 }),
    "55 activity days, 52 weekly rows, 28 recovery days, 1 daily check-in",
);
assert.equal(
    formatContextCoverage({ ...base, daily_checkin_count: 0 }),
    "55 activity days, 52 weekly rows, 28 recovery days, 0 daily check-ins",
);
assert.equal(
    formatContextCoverage(base),
    "55 activity days, 52 weekly rows, 28 recovery days",
);
assert.equal(
    formatContextCoverage({ ...base, daily_checkin_count: true }),
    "55 activity days, 52 weekly rows, 28 recovery days",
);

const coachSource = fs.readFileSync("static/coach.js", "utf8");
assert.doesNotMatch(coachSource, /oldest_daily_checkin_date|newest_daily_checkin_date/);
assert.doesNotMatch(coachSource, /daily_checkins\]|\.note|overall_status|readiness|soreness|flags/);

console.log("Coach Context coverage UI tests passed.");
