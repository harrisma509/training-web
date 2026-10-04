const assert = require("node:assert/strict");
const fs = require("node:fs");

const indexSource = fs.readFileSync("templates/index.html", "utf8");
const weeklySource = fs.readFileSync("static/weekly.css", "utf8");
const sharedSource = fs.readFileSync("static/style.css", "utf8");
const weeklyJsSource = fs.readFileSync("static/weekly.js", "utf8");
const weeklyPaneSource = fs.readFileSync("templates/partials/panes/weekly_pane.html", "utf8");

const styleLink = "/static/style.css";
const weeklyLink = "/static/weekly.css";
const yearlyLink = "/static/yearly.css";
assert.ok(indexSource.indexOf(styleLink) < indexSource.indexOf(weeklyLink));
assert.ok(indexSource.indexOf(weeklyLink) < indexSource.indexOf(yearlyLink));

const ratioSelectors = [
    ".ac-ratio-low",
    ".ac-ratio-target",
    ".ac-ratio-caution",
    ".ac-ratio-spike",
];

for (const selector of ratioSelectors) {
    const definition = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\{`);
    assert.match(weeklySource, definition, `missing Weekly selector: ${selector}`);
    assert.doesNotMatch(sharedSource, definition, `shared stylesheet still owns: ${selector}`);
    assert.ok(weeklyJsSource.includes(`"${selector.slice(1)}"`), `Weekly emitter missing: ${selector}`);
}

for (const selector of [
    ".zone-good",
    ".zone-strong",
    ".zone-caution",
    ".zone-bad",
    ".zone-low",
    ".hr-zone-label",
    ".table-wrap",
    "table",
]) {
    const definition = new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\{`);
    assert.doesNotMatch(weeklySource, definition, `unrelated selector moved to Weekly CSS: ${selector}`);
}

assert.match(weeklySource, /color: var\(--yellow\)/);
assert.match(weeklySource, /color: var\(--green\)/);
assert.match(weeklySource, /font-weight: 700/);

assert.match(weeklyJsSource, /<td class="weekly-actions-cell">\s*<div class="weekly-row-actions">[\s\S]*?class="audit-score-button[\s\S]*?class="drawer-open-button"[\s\S]*?<\/div>\s*<\/td>/);
assert.match(weeklyJsSource, /<th class="weekly-actions-header">Actions<\/th>/);
assert.doesNotMatch(weeklyJsSource, /weekly-edit-notes-header|weekly-edit-notes-cell|<th>N<\/th>/);
assert.match(weeklyJsSource, /<\/td>\s*<td>\$\{renderWeeklyHoursCell\(row\.weekly_total_hours\)\}<\/td>/);
assert.match(weeklyJsSource, /openWeeklyDrawer\(button\.dataset\.weekStart\)/);
assert.match(weeklyJsSource, /event\.stopPropagation\(\)/);
assert.match(weeklyJsSource, /attachAuditScoreHandlers\(\)/);
assert.match(weeklyJsSource, /attachWeeklyCommentHandlers\(cell\)/);
assert.match(weeklySource, /\.weekly-actions-header,\s*\.weekly-actions-cell\s*\{[^}]*width:\s*72px;[^}]*min-width:\s*72px;/s);
assert.match(weeklySource, /\.weekly-row-actions\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*5px;/s);
assert.doesNotMatch(weeklySource, /\.weekly-edit-notes-(?:header|cell)[^{]*\{/);
assert.doesNotMatch(weeklySource, /@media\s*\(max-width:\s*1050px\)[\s\S]*\.weekly-drawer[\s\S]*display:\s*none/);
assert.doesNotMatch(weeklySource, /@media\s*\(max-width:\s*1050px\)[\s\S]*\.weekly-actions-(?:header|cell)[\s\S]*display:\s*none/);
assert.match(weeklyPaneSource, /<div class="table-wrap">\s*<table id="weeklyTable"><\/table>\s*<\/div>/);
assert.match(sharedSource, /\.table-wrap\s*\{[^}]*overflow-x:\s*auto;/s);

console.log("Weekly CSS ownership contract tests passed.");
