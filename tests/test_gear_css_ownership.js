const assert = require("node:assert/strict");
const fs = require("node:fs");

const gearSource = fs.readFileSync("static/gear.css", "utf8");
const sharedSource = fs.readFileSync("static/style.css", "utf8");

for (const selector of [
    "#gearPane .table-wrap",
    "#gearTable",
    "#gearTable th:nth-child(1)",
    "#gearTable th:nth-child(8)",
    ".status-retired",
    ".gear-row-retired",
    ".gear-hide-shoes-label",
    ".gear-hide-shoes-label input",
]) {
    assert.ok(gearSource.includes(selector), `missing Gear selector: ${selector}`);
    assert.ok(!sharedSource.includes(selector), `shared stylesheet still owns: ${selector}`);
}

for (const selector of [
    ".status-active",
    ".status-muted",
    ".gear-header-row",
    ".gear-header-main",
    ".gear-header-actions",
    ".gear-title",
    ".gear-subtitle",
    ".service-subtab",
]) {
    assert.ok(sharedSource.includes(selector), `missing shared selector: ${selector}`);
    assert.ok(!gearSource.includes(selector), `shared selector moved to Gear CSS: ${selector}`);
}

assert.match(gearSource, /width: 300px/);
assert.match(gearSource, /width: 130px/);
assert.match(gearSource, /opacity: 0\.72/);
assert.match(gearSource, /white-space: nowrap/);

console.log("Gear CSS ownership contract tests passed.");