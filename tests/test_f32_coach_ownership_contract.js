const assert = require("node:assert/strict");
const fs = require("node:fs");

const coachSource = fs.readFileSync("static/coach.js", "utf8");
const appSource = fs.readFileSync("static/app.js", "utf8");
const templateSource = fs.readFileSync("templates/index.html", "utf8");
const deleteDialogSource = fs.readFileSync("templates/partials/dialogs/coach_delete_dialog.html", "utf8");

assert.match(coachSource, /const coachController = \{/);
assert.equal((coachSource.match(/registerFeature\("coach", coachController\)/g) || []).length, 1);
assert.match(coachSource, /init: initializeCoachFeature/);
assert.match(coachSource, /activate\(context = \{\}\)/);
assert.match(coachSource, /refresh\(\)/);
assert.match(coachSource, /window\.CoachController = coachController/);
assert.match(coachSource, /if \(state\.initialized\) return/);
assert.match(coachSource, /sessionsLoadPromise/);
assert.match(coachSource, /sessionsLoaded/);
assert.match(coachSource, /if \(state\.sessionsLoadPromise\) return state\.sessionsLoadPromise/);
assert.match(coachSource, /function loadSessions\(preferredId = "", force = false\)/);

for (const ownerPattern of [
    /function renderSessions\(/,
    /function selectSession\(/,
    /function renderConversation\(/,
    /function startLoadingStages\(/,
    /function stopLoadingStages\(/,
    /function openDrawer\(/,
    /function closeDrawer\(/,
    /function toggleSessionMenu\(/,
    /function openDeleteDialog\(/,
    /function confirmDelete\(/,
    /window\.addEventListener\("beforeunload", stopLoadingStages\)/,
]) {
    assert.match(coachSource, ownerPattern);
}

for (const shellPattern of [
    /CoachController/,
    /fetchCoachSessions/,
    /fetchCoachSession/,
    /fetchCoachUsage/,
    /renderConversation/,
    /coachDeleteDialog/,
    /coachSessionMenu/,
    /responsePending/,
]) {
    assert.doesNotMatch(appSource, shellPattern, `app.js must not own ${shellPattern}`);
}

assert.match(templateSource, /coach\.js\?v=\{\{ asset_version \}\}/);
assert.ok(templateSource.indexOf("/static/coach.js") < templateSource.indexOf("/static/app.js"));
assert.match(deleteDialogSource, /role="dialog"/);
assert.match(deleteDialogSource, /Permanently delete this chat\?/);
assert.match(deleteDialogSource, /Delete permanently/);
assert.match(deleteDialogSource, /There is no trash or restore option/);

console.log("F32 Coach ownership contract tests passed.");