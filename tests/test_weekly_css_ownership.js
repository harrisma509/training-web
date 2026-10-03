const assert = require("node:assert/strict");
const fs = require("node:fs");

const indexSource = fs.readFileSync("index.html", "utf8");
const weeklySource = fs.readFileSync("static/weekly.css", "utf8");
const sharedSource = fs.readFileSync("static/style.css", "utf8");
const weeklyJsSource = fs.readFileSync("static/weekly.js", "utf8");

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

console.log("Weekly CSS ownership contract tests passed.");