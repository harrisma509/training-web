const assert = require("node:assert/strict");
const fs = require("node:fs");

const planSource = fs.readFileSync("static/plan.js", "utf8");
const appSource = fs.readFileSync("static/app.js", "utf8");
const apiSource = fs.readFileSync("static/api.js", "utf8");
const dailySource = fs.readFileSync("routes/daily.py", "utf8");
const weeklySource = fs.readFileSync("routes/weekly.py", "utf8");
const templateSource = fs.readFileSync("templates/partials/panes/plan_pane.html", "utf8");

assert.match(planSource, /const PLAN_ANCHOR_PARAMETER = "plan_start"/);
assert.match(planSource, /const PLAN_TIME_ZONE = "America\/Denver"/);
assert.match(planSource, /const weekOffsets = \[0, 1, 2, 3\]/);
assert.match(planSource, /setUTCDate\(start\.getUTCDate\(\) \+ index\)/);
assert.match(planSource, /Nothing planned/);
assert.match(planSource, /No activity recorded today/);
assert.match(planSource, /No activity recorded/);
assert.match(planSource, /const defaultCollapsed = weeksBack >= 2/);
assert.match(planSource, /fetchDaily\(28, "", "", range\.start, range\.end\)/);
assert.match(planSource, /fetchWeekly\(4, range\.start, range\.end\)/);
assert.match(planSource, /PLAN_WEEK_COLLAPSE_STATE/);

for (const id of [
  "planPreviousFour",
  "planPreviousOne",
  "planToday",
  "planDateJump",
  "planNextOne",
  "planNextFour",
]) {
  assert.match(templateSource, new RegExp(id));
}
assert.match(templateSource, /aria-label="Plan calendar navigation"/);
assert.match(apiSource, /startDate = "", endDate = ""/);
assert.match(dailySource, /start_date: Date \| None = None/);
assert.match(dailySource, /daily_training\.date >= %s/);
assert.match(weeklySource, /start_date: Date \| None = None/);
assert.match(weeklySource, /weeks\.week_start >= %s/);
assert.match(appSource, /if \(tab !== "plan"\) url\.searchParams\.delete\("plan_start"\)/);
assert.match(appSource, /window\.TrainingApp\.navigatePlan = function navigatePlan/);

console.log("Plan four-week calendar contract tests passed.");
