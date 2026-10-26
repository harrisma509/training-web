const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const planSource = fs.readFileSync("static/plan.js", "utf8");
const appSource = fs.readFileSync("static/app.js", "utf8");
const apiSource = fs.readFileSync("static/api.js", "utf8");
const dailySource = fs.readFileSync("routes/daily.py", "utf8");
const weeklySource = fs.readFileSync("routes/weekly.py", "utf8");
const templateSource = fs.readFileSync("templates/partials/panes/plan_pane.html", "utf8");

function extractPlanFunction(name) {
  const start = planSource.indexOf(`function ${name}(`);
  const end = planSource.indexOf("\n  function ", start + 1);
  assert.ok(start >= 0 && end > start, `Expected ${name} function in plan.js`);
  return planSource.slice(start, end).trim();
}

assert.match(planSource, /const PLAN_ANCHOR_PARAMETER = "plan_start"/);
assert.match(planSource, /const PLAN_TIME_ZONE = "America\/Denver"/);
assert.match(planSource, /const PLAN_RANGE_DAYS = 91/);
assert.match(planSource, /const MONTH_NAMES = \["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"\]/);
assert.match(planSource, /const month = MONTH_NAMES\[dateValue\.getUTCMonth\(\)\]/);
assert.match(planSource, /const weekOffsets = Array\.from\(\{ length: 13 \}, \(_, index\) => 4 - index\)/);
assert.match(planSource, /setUTCDate\(start\.getUTCDate\(\) \+ index\)/);
assert.match(planSource, /function getDefaultPlanAnchor\(\)/);
assert.match(planSource, /return toLocalDateKey\(getWeekStart\(getDenverTodayDate\(\)\)\)/);
assert.match(planSource, /start\.setUTCDate\(start\.getUTCDate\(\) - 56\)/);
assert.match(planSource, /end\.setUTCDate\(end\.getUTCDate\(\) \+ PLAN_RANGE_DAYS\)/);
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
assert.match(planSource, /fetchDaily\(365, "", "", range\.start, range\.end\)/);
assert.match(planSource, /fetchWeekly\(13, range\.start, range\.end\)/);
assert.match(planSource, /data-plan-week="\$\{escapeHtml\(weekKey \|\| ""\)\}"/);
assert.match(planSource, /function positionPendingPlanAnchor\(\)/);
assert.match(planSource, /const isCurrentWeek = weekKey === getPlanWeekKey\(getDenverTodayDate\(\)\)/);
assert.match(planSource, /const planItemsPromise = window\.PlanItemsController\?\.load\?\.\(range, \{ force \}\)/);
assert.match(planSource, /await Promise\.all\(\[planItemsPromise, loadPlanCheckins\(\)\]\);\s+if \(requestId !== PLAN_LOAD_REQUESTS\.current\) \{\s+return false;\s+\}\s+positionPendingPlanAnchor\(\);/);
assert.match(planSource, /scrollRegion\.addEventListener\("wheel", cancelPendingPosition/);
assert.match(planSource, /scrollRegion\.addEventListener\("touchmove", cancelPendingPosition/);
assert.match(planSource, /pendingPlanScrollAnchor = planAnchor/);
assert.match(planSource, /PLAN_WEEK_COLLAPSE_STATE/);

const planDateHelpers = [
  extractPlanFunction("parsePlanDate"),
  extractPlanFunction("toLocalDateKey"),
  extractPlanFunction("getWeekStart"),
].join("\n");
const rangeContext = vm.createContext({
  planAnchor: "2026-10-19",
  PLAN_RANGE_DAYS: 91,
});
vm.runInContext(`${planDateHelpers}\n${extractPlanFunction("getPlanRange")}`, rangeContext);
const planRange = vm.runInContext("getPlanRange()", rangeContext);
assert.deepEqual({ ...planRange }, { start: "2026-08-24", end: "2026-11-23" });
const rangeStart = new Date(`${planRange.start}T00:00:00Z`);
const rangeEnd = new Date(`${planRange.end}T00:00:00Z`);
assert.equal((rangeEnd - rangeStart) / 86400000, 91);
assert.equal((rangeEnd - rangeStart) / (7 * 86400000), 13);
const defaultAnchorContext = vm.createContext({
  getDenverTodayDate: () => new Date(Date.UTC(2026, 9, 21)),
});
vm.runInContext(`${planDateHelpers}\n${extractPlanFunction("getDefaultPlanAnchor")}`, defaultAnchorContext);
assert.equal(vm.runInContext("getDefaultPlanAnchor()", defaultAnchorContext), "2026-10-19");
const jumpAnchorContext = vm.createContext({
  getDefaultPlanAnchor: () => "2026-10-19",
});
vm.runInContext(`${planDateHelpers}\n${extractPlanFunction("normalizePlanAnchor")}`, jumpAnchorContext);
assert.equal(vm.runInContext('normalizePlanAnchor("2026-10-22")', jumpAnchorContext), "2026-10-19");

const renderedStrip = { innerHTML: "" };
const stripRenderContext = vm.createContext({
  planAnchor: "2026-10-19",
  document: {
    getElementById: id => id === "planStrip" ? renderedStrip : null,
  },
  window: { PlanItemEditor: { bind() {} } },
  getPlanRows: () => [],
  buildPlanRowMap: () => new Map(),
  getPlanWeeklyRows: () => [],
  buildPlanWeeklyRowMap: () => new Map(),
  setupPlanToggleHandlers() {},
  setupPlanCheckinHandlers() {},
  setupPlanPaletteDragHandlers() {},
});
vm.runInContext([
  planDateHelpers,
  extractPlanFunction("getWeekDates"),
  extractPlanFunction("getWeekDatesOffset"),
  extractPlanFunction("getPlanWeekKey"),
  extractPlanFunction("renderPlanStrip"),
].join("\n"), stripRenderContext);
vm.runInContext(`
  renderPlanWeekRow = function (weekStartDate) {
    const days = getWeekDates(weekStartDate).map(toLocalDateKey);
    return '<section data-plan-week="' + toLocalDateKey(weekStartDate)
      + '" data-plan-days="' + days.join(",") + '"></section>';
  };
  renderPlanStrip();
`, stripRenderContext);
const renderedWeekRows = Array.from(
  renderedStrip.innerHTML.matchAll(/data-plan-week="([^"]+)" data-plan-days="([^"]+)"/g),
  match => ({ weekKey: match[1], dayKeys: match[2].split(",") }),
);
const renderedWeekOffsets = renderedWeekRows.map(({ weekKey }) => {
  const anchorDate = new Date("2026-10-19T00:00:00Z");
  const weekDate = new Date(`${weekKey}T00:00:00Z`);
  return (weekDate - anchorDate) / (7 * 86400000);
});
assert.equal(renderedWeekRows.length, 13);
assert.deepEqual(renderedWeekOffsets, [4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6, -7, -8]);
assert.deepEqual(renderedWeekOffsets.slice(3, 6), [1, 0, -1]);
for (const { weekKey, dayKeys } of renderedWeekRows) {
  const weekStart = new Date(`${weekKey}T00:00:00Z`);
  assert.equal(weekStart.getUTCDay(), 1, `${weekKey} starts on Monday`);
  assert.equal(dayKeys.length, 7);
  const expectedDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(weekStart);
    date.setUTCDate(date.getUTCDate() + index);
    return date.toISOString().slice(0, 10);
  });
  assert.deepEqual(dayKeys, expectedDays);
}

const scrollWeekKeys = [
  "2026-11-16",
  "2026-11-09",
  "2026-11-02",
  "2026-10-26",
  "2026-10-19",
  "2026-10-12",
  "2026-10-05",
  "2026-09-28",
  "2026-09-21",
  "2026-09-14",
  "2026-09-07",
  "2026-08-31",
  "2026-08-24",
];
const scrollRows = scrollWeekKeys.map((weekKey, index) => ({
  dataset: { planWeek: weekKey },
  offsetHeight: 140,
  getBoundingClientRect: () => ({ top: index === 4 ? 400 : 200 }),
}));
const scrollRegion = {
  clientHeight: 600,
  scrollTop: 0,
  getBoundingClientRect: () => ({ top: 100 }),
  querySelectorAll: () => scrollRows,
};
const scrollContext = vm.createContext({
  pendingPlanScrollAnchor: "2026-10-19",
  document: {
    getElementById: () => scrollRegion,
  },
});
vm.runInContext(extractPlanFunction("positionPendingPlanAnchor"), scrollContext);
assert.equal(vm.runInContext("positionPendingPlanAnchor()", scrollContext), true);
assert.equal(scrollRegion.scrollTop, 70);
assert.equal(vm.runInContext("pendingPlanScrollAnchor", scrollContext), "");

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
assert.match(templateSource, /class="plan-calendar-scroll"[\s\S]*id="planStrip"/);
assert.ok(templateSource.indexOf('class="plan-toolbar"') < templateSource.indexOf('class="plan-calendar-scroll"'));
assert.match(apiSource, /startDate = "", endDate = ""/);
assert.match(dailySource, /start_date: Date \| None = None/);
assert.match(dailySource, /daily_training\.date >= %s/);
assert.match(weeklySource, /start_date: Date \| None = None/);
assert.match(weeklySource, /weeks\.week_start >= %s/);
assert.match(appSource, /if \(tab !== "plan"\) url\.searchParams\.delete\("plan_start"\)/);
assert.match(appSource, /window\.TrainingApp\.navigatePlan = function navigatePlan/);

const planCss = fs.readFileSync("static/plan.css", "utf8");
assert.match(planCss, /\.plan-calendar-scroll\s*\{[^}]*max-height:\s*calc\(100vh - 120px\)[^}]*overflow-y:\s*auto/s);
assert.doesNotMatch(planCss, /\.plan-calendar-scroll\s*\{[^}]*max-height:\s*min\(72vh/);
assert.match(planCss, /@media \(max-width: 980px\)\s*\{\s*\.plan-strip\s*\{\s*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
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

console.log("Plan 13-week calendar contract tests passed.");
