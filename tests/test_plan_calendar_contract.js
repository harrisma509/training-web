const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const planSource = fs.readFileSync("static/plan.js", "utf8");
const appSource = fs.readFileSync("static/app.js", "utf8");
const apiSource = fs.readFileSync("static/api.js", "utf8");
const dailySource = fs.readFileSync("routes/daily.py", "utf8");
const weeklySource = fs.readFileSync("routes/weekly.py", "utf8");
const templateSource = fs.readFileSync("templates/partials/panes/plan_pane.html", "utf8");

assert.match(planSource, /const PLAN_ANCHOR_PARAMETER = "plan_start"/);
assert.match(planSource, /const PLAN_TIME_ZONE = "America\/Denver"/);
assert.match(planSource, /const MONTH_NAMES = \["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"\]/);
assert.match(planSource, /const month = MONTH_NAMES\[dateValue\.getUTCMonth\(\)\]/);
assert.match(planSource, /const weekOffsets = \[0, 1, 2, 3\]/);
assert.match(planSource, /setUTCDate\(start\.getUTCDate\(\) \+ index\)/);
assert.match(planSource, /function getDefaultPlanAnchor\(\)/);
assert.match(planSource, /currentWeekStart\.setUTCDate\(currentWeekStart\.getUTCDate\(\) - 21\)/);
assert.match(planSource, /return parsed \? toLocalDateKey\(getWeekStart\(parsed\)\) : getDefaultPlanAnchor\(\)/);
assert.match(planSource, /Nothing planned/);
assert.match(planSource, /No activity recorded today/);
assert.match(planSource, /No activity recorded/);
assert.match(planSource, /const defaultCollapsed = false/);
assert.match(planSource, /is-current-week/);
assert.match(planSource, /is-current-day/);
assert.match(planSource, /aria-current="date"/);
assert.match(planSource, /const isCurrentDay = dayKey === getDenverTodayKey\(\)/);
assert.match(planSource, /setPlanAnchor\(getDefaultPlanAnchor\(\)\)/);
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

const planCss = fs.readFileSync("static/plan.css", "utf8");
assert.match(planCss, /--plan-current-outline/);
assert.match(planCss, /\.plan-day-header\.is-current-week/);
assert.match(planCss, /\.plan-day-header\.is-current-day/);
assert.match(planCss, /--plan-current-week-fill/);
assert.match(planCss, /--plan-current-day-fill/);
assert.match(planCss, /box-shadow: inset 0 0 0 2px var\(--plan-current-outline\)/);
assert.match(planCss, /box-shadow: inset 0 0 0 4px var\(--plan-current-outline\)/);

const formatterStart = planSource.indexOf("function formatPlanDay(");
const formatterEnd = planSource.indexOf("\n  function formatPlanHeaderLoad", formatterStart);
assert.ok(formatterStart >= 0 && formatterEnd > formatterStart);
const formatPlanDay = vm.runInNewContext(
  `(${planSource.slice(formatterStart, formatterEnd).trim()})`,
  {
    DAY_NAMES: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    MONTH_NAMES: ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"],
  },
);

for (const [isoDate, expectedMonth, expectedDate] of [
  ["2026-09-28", "SEP", "28"],
  ["2026-09-29", "SEP", "29"],
  ["2026-09-30", "SEP", "30"],
  ["2026-10-01", "OCT", "1"],
  ["2026-10-02", "OCT", "2"],
  ["2026-10-03", "OCT", "3"],
  ["2026-10-04", "OCT", "4"],
  ["2026-12-28", "DEC", "28"],
  ["2026-12-31", "DEC", "31"],
  ["2027-01-01", "JAN", "1"],
  ["2027-01-03", "JAN", "3"],
]) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const label = formatPlanDay(new Date(Date.UTC(year, month - 1, day)));
  assert.equal(`${label.month} ${label.date}`, `${expectedMonth} ${expectedDate}`);
}

console.log("Plan four-week calendar contract tests passed.");
