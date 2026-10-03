const assert = require("node:assert/strict");
const fs = require("node:fs");

const indexSource = fs.readFileSync("index.html", "utf8");
const sharedSource = fs.readFileSync("static/style.css", "utf8");
const settingsSource = fs.readFileSync("static/settings.css", "utf8");
const yearlySource = fs.readFileSync("static/yearly.css", "utf8");

assert.ok(indexSource.indexOf("/static/settings.css") < indexSource.indexOf("/static/weekly.css"));
assert.ok(indexSource.indexOf("/static/weekly.css") < indexSource.indexOf("/static/yearly.css"));

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function selectorPattern(selector) {
    return selector.trim().split(/\s+/).map(escapeRegExp).join("\\s*");
}

function extractRule(source, selector) {
    const pattern = new RegExp(`(?:^|\\n)${selectorPattern(selector)}\\s*\\{([\\s\\S]*?)\\n\\}`, "m");
    const match = source.match(pattern);
    return match ? match[1].replace(/\s+/g, " ").trim() : null;
}

const canonicalRules = new Map([
    [".yearly-subnav", "display: flex; gap: 8px; align-items: center; padding: 10px 12px 0; border-bottom: 1px solid var(--line);"],
    [".yearly-subtab", "border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 999px; padding: 6px 12px; cursor: pointer; font-size: 12px; font-weight: 600;"],
    [".yearly-subtab.active", "background: var(--table-header-bg); color: var(--text); border-color: var(--line);"],
    ["#yearlyPane .table-wrap", "width: max-content; max-width: 100%; min-width: 0; display: block;"],
    ["#yearlyTable", "width: max-content; min-width: 0; max-width: 100%; table-layout: auto;"],
    ["#yearlyTable th:nth-child(1),\n#yearlyTable td:nth-child(1)", "width: 80px; min-width: 80px; text-align: left;"],
    ["#yearlyTable th:nth-child(n+2),\n#yearlyTable td:nth-child(n+2)", "width: 110px; min-width: 110px; text-align: right;"],
    ["#yearlyTable th:nth-child(9),\n#yearlyTable td:nth-child(9)", "width: 110px; min-width: 110px; text-align: center;"],
    ["#yearlyMonthlyTable", "width: max-content; min-width: 0; max-width: 100%; table-layout: auto;"],
    ["#yearlyMonthlyTable th,\n#yearlyMonthlyTable td", "min-width: 82px; text-align: right;"],
    ["#yearlyMonthlyTable th:nth-child(1),\n#yearlyMonthlyTable td:nth-child(1)", "width: 80px; min-width: 80px; text-align: left;"],
    [".yearly-month-cell", "white-space: nowrap;"],
    [".record-trophy", "display: inline-block; margin-right: 6px; color: #fbbf24; font-size: 11px; vertical-align: middle; line-height: 1;"],
    [".record-cell", "background: rgba(34, 197, 94, 0.14); box-shadow: inset 3px 0 0 #22c55e; color: var(--record-cell-text);"],
]);

for (const [selector, declarations] of canonicalRules) {
    assert.equal(extractRule(yearlySource, selector), declarations, `Yearly canonical rule changed: ${selector}`);
    assert.equal(extractRule(sharedSource, selector), null, `shared stylesheet still defines: ${selector}`);
}

assert.equal(
    extractRule(settingsSource, ".yearly-section-card"),
    "background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 12px; padding: 14px;",
    "Settings must retain its maintenance-card presentation"
);
assert.equal(
    extractRule(yearlySource, ".yearly-section-card"),
    "background: var(--input-bg); border: 1px solid var(--input-border); border-radius: 12px; padding: 14px;",
    "Yearly must retain its feature-card presentation"
);

for (const selector of [".hidden", "table", "th", "td"]) {
    assert.ok(extractRule(sharedSource, selector), `shared primitive was removed: ${selector}`);
}

console.log("Yearly CSS ownership contract tests passed.");