const assert = require("node:assert/strict");
const fs = require("node:fs");

const indexSource = fs.readFileSync("templates/index.html", "utf8");
const zonesSource = fs.readFileSync("static/zones.css", "utf8");
const sharedSource = fs.readFileSync("static/style.css", "utf8");

const gearLink = "/static/gear.css?v={{ asset_version }}";
const zonesLink = "/static/zones.css?v={{ asset_version }}";
assert.ok(indexSource.indexOf(gearLink) < indexSource.indexOf(zonesLink));

for (const selector of [
    "#zonesPane .table-wrap",
    "#zonesTable",
    "#zonesTable th",
    "#zonesTable td",
    ".zone-good",
    ".zone-strong",
    ".zone-caution",
    ".zone-bad",
    ".zone-low",
]) {
    assert.ok(zonesSource.includes(selector), `missing Zones selector: ${selector}`);
    assert.ok(!sharedSource.includes(selector), `shared stylesheet still owns: ${selector}`);
}

for (const token of [
    "--zone-good-text",
    "--zone-strong-text",
    "--zone-caution-text",
    "--zone-bad-text",
    "--zone-low-text",
]) {
    assert.ok(sharedSource.includes(token), `missing shared theme token: ${token}`);
}

for (const [selector, pattern] of [
    [".table-wrap", /(?:^|\n)\.table-wrap\s*\{/],
    ["table", /(?:^|\n)table\s*\{/],
    ["th", /(?:^|\n)th\s*,/],
    ["td", /(?:^|\n)td\s*\{/],
    ["tr:hover td", /(?:^|\n)tr:hover td\s*\{/],
    [".hr-zone-label", /(?:^|\n)\.hr-zone-label\s*\{/],
]) {
    assert.match(sharedSource, pattern, `missing shared or unrelated selector: ${selector}`);
    assert.doesNotMatch(zonesSource, pattern, `shared or unrelated selector moved: ${selector}`);
}

assert.match(zonesSource, /width: max-content/);
assert.match(zonesSource, /table-layout: auto/);
assert.match(zonesSource, /padding: 1px 4px/);
assert.match(zonesSource, /color-mix\(in srgb, var\(--green\) 90%, var\(--panel\)\)/);

console.log("Zones CSS ownership contract tests passed.");