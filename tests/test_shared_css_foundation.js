const assert = require("node:assert/strict");
const fs = require("node:fs");

const indexSource = fs.readFileSync("templates/index.html", "utf8");
const sharedSource = fs.readFileSync("static/style.css", "utf8");
const settingsSource = fs.readFileSync("static/settings.css", "utf8");
const weeklySource = fs.readFileSync("static/weekly.css", "utf8");
const coachSessionsSource = fs.readFileSync("static/coach-sessions.css", "utf8");

assert.ok(indexSource.indexOf("/static/style.css") < indexSource.indexOf("/static/settings.css"));
assert.ok(indexSource.indexOf("/static/style.css") < indexSource.indexOf("/static/weekly.css"));

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractRules(source, selector) {
    const pattern = new RegExp(`(?:^|\\n)${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\n\\}`, "gm");
    return [...source.matchAll(pattern)].map(match => match[1].replace(/\s+/g, " ").trim());
}

assert.deepEqual(extractRules(sharedSource, ".hidden"), ["display: none !important;"]);
assert.deepEqual(extractRules(sharedSource, ".button-secondary"), [
    "background: var(--button-secondary-bg); color: var(--text);",
]);
assert.deepEqual(extractRules(sharedSource, ".button-primary"), [
    "background: var(--blue); color: var(--button-active-text); border: 1px solid var(--blue);",
]);

assert.deepEqual(extractRules(settingsSource, ".button-secondary"), []);
assert.deepEqual(extractRules(weeklySource, ".button-primary"), []);
assert.deepEqual(extractRules(sharedSource, ".button-secondary.small"), [
    "padding: 5px 9px; font-size: 11px;",
]);
assert.deepEqual(extractRules(coachSessionsSource, ".coach-delete-dialog-actions .button-secondary"), [
    "border: 1px solid var(--input-border); background: var(--button-secondary-bg); color: var(--text);",
]);

console.log("Shared CSS foundation contract tests passed.");