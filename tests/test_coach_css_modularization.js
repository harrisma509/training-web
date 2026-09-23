const assert = require("node:assert/strict");
const fs = require("node:fs");

const indexSource = fs.readFileSync("index.html", "utf8");
const stylesheetLinks = [...indexSource.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)]
    .map(match => match[1]);
const coachStylesheets = [
    "/static/coach-layout.css",
    "/static/coach-sessions.css",
    "/static/coach-conversation.css",
    "/static/coach-composer.css",
    "/static/coach-context.css",
    "/static/coach-responsive.css",
];

assert.deepEqual(stylesheetLinks.slice(-coachStylesheets.length), coachStylesheets);
assert.equal(stylesheetLinks.filter(path => path === "/static/coach.css").length, 0);
assert.equal(fs.existsSync("static/coach.css"), false);

const styles = Object.fromEntries(coachStylesheets.map(path => [
    path,
    fs.readFileSync(path.replace("/static/", "static/"), "utf8"),
]));
for (const path of coachStylesheets) {
    assert.ok(styles[path].trim().length > 0, `${path} should not be empty`);
}
assert.match(styles["/static/coach-responsive.css"], /@media \(max-width: 760px\)/);
assert.match(styles["/static/coach-responsive.css"], /@media \(prefers-reduced-motion: reduce\)/);
assert.match(styles["/static/coach-composer.css"], /\.coach-composer-header/);
assert.match(styles["/static/coach-composer.css"], /\.coach-mode-control/);
assert.match(styles["/static/coach-composer.css"], /\.coach-mode-status/);
assert.match(styles["/static/coach-conversation.css"], /\.coach-response-mode/);
assert.match(styles["/static/coach-context.css"], /\.coach-context-panel/);
assert.match(styles["/static/coach-sessions.css"], /\.coach-session-row/);
assert.match(styles["/static/coach-conversation.css"], /\.coach-message/);
assert.match(styles["/static/coach-composer.css"], /\.coach-composer/);
assert.match(styles["/static/coach-responsive.css"], /\.coach-drawer-backdrop/);

assert.doesNotMatch(styles["/static/coach-layout.css"], /\.coach-session-row|\.coach-message/);
assert.doesNotMatch(styles["/static/coach-sessions.css"], /\.coach-message|\.coach-composer/);
assert.doesNotMatch(styles["/static/coach-conversation.css"], /\.coach-session-row|\.coach-composer/);
assert.doesNotMatch(styles["/static/coach-composer.css"], /\.coach-session-row|\.coach-message/);

console.log("Coach CSS modularization contract tests passed.");
