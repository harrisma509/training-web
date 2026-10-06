const assert = require("node:assert/strict");
const fs = require("node:fs");

function read(path) {
    return fs.readFileSync(path, "utf8");
}

const architecture = read("docs/FRONTEND_ARCHITECTURE.md");
const readme = read("README.md");
const aiGuide = read("docs/AI_DEV_GUIDE.md");
const testing = read("docs/TESTING_GUIDE.md");
const webInstructions = read(".github/copilot-instructions.md");
const etlReadme = read("../training-etl/README.md");
const etlTesting = read("../training-etl/docs/TESTING_GUIDE.md");
const etlInstructions = read("../training-etl/.github/copilot-instructions.md");
const etlConstitution = read("../training-etl/docs/ENGINEERING_CONSTITUTION.md");
const webConstitution = read("docs/ENGINEERING_CONSTITUTION.md");
const personalization = read("docs/AI_COACH_PERSONALIZATION.md");
const deployScript = read("deploy_training_web.ps1");

for (const key of [
    "plan", "goals", "kpis", "components", "charts", "daily", "search", "weekly",
    "zones", "service", "gear", "yearly", "coach", "sync", "settings",
]) {
    assert.match(architecture, new RegExp("\\\\| \\`" + key + "\\` \\\\|"), `missing registry key: ${key}`);
}

for (const phrase of [
    "FastAPI and server-rendered Jinja2 templates",
    "TrainingApp.features.<feature>",
    "Templates define structure.",
    "Feature modules own feature behavior and local state.",
    "app.js` coordinates shell navigation/history",
    "init(context)",
    "activate(context)",
    "refresh(context, reason)",
    "canDeactivate(context)",
    "deactivate(context)",
    "dirty-state",
    "backdrop, Escape",
    "in-flight requests",
    "older response",
    "Settings is a coordinator",
    "Global Sync status is separate",
    "full clean Git commit",
    "immutable",
    "Container recreation",
    "image rebuild",
    "268 passed, 85 subtests",
    "45/45",
    "15 registry keys",
    "ENGINEERING_CONSTITUTION.md",
    "Historical closeout context",
    "all first-party asset references discovered from the rendered root",
]) {
    assert.ok(architecture.includes(phrase), `missing architecture rule: ${phrase}`);
}

for (const document of [readme, aiGuide, testing, webInstructions, etlInstructions, etlConstitution]) {
    assert.doesNotMatch(document, /FRONTEND_REFACTOR_HANDOFF/);
}
assert.doesNotMatch(deployScript, /FRONTEND_REFACTOR_HANDOFF/);
assert.match(readme, /FRONTEND_ARCHITECTURE\.md/);
assert.match(aiGuide, /Documentation-only changes are not/);
assert.match(webInstructions, /Permanent architecture and execution budget/);
assert.match(etlInstructions, /Permanent architecture and execution budget/);
assert.match(etlConstitution, /FRONTEND_ARCHITECTURE\.md/);
assert.match(testing, /39 `test_\*\.js` files/);
assert.match(etlTesting, /94 passed tests and 52 subtests/);
assert.match(architecture, /Components\/Service/);
assert.doesNotMatch(architecture, /retired frontend handoff/);
assert.doesNotMatch(architecture, /F35 runtime remains deployed/);
assert.doesNotMatch(architecture, /all 43 first-party assets/);
assert.equal(webConstitution, etlConstitution, "repository constitutions must remain byte-identical");
assert.match(etlInstructions, /Feature documents define detailed contracts and current behavior\.\r?\n\r?\n# GitHub Copilot Instructions for training-etl/);
assert.match(personalization, /Generic words such as/);
assert.match(personalization, /conversation \*\*"remember this"\*\*/);
assert.match(personalization, /Generic words such as `park`, `hard`,/);
assert.match(personalization, /`ride`, or `bike` do not independently activate narrow scopes or match a\s+memory title\./);
assert.match(webInstructions, /^# GitHub Copilot Instructions for training-web$/m);
assert.match(etlInstructions, /^# GitHub Copilot Instructions for training-etl$/m);
assert.doesNotMatch(webInstructions, /behavior\.\r?\n# GitHub Copilot Instructions for training-web/);
assert.doesNotMatch(etlInstructions, /behavior\.\r?\n# GitHub Copilot Instructions for training-etl/);
for (const guidance of [readme, webInstructions, aiGuide]) {
    assert.match(guidance, /After deployment, verify the rendered root advertises the expected full commit/);
    assert.match(guidance, /startup-derived commit or asset metadata remains stale, restart only[\s\S]*`training-web`/);
    assert.match(guidance, /Documentation-only changes are not deployed or restarted/);
}
assert.doesNotMatch([readme, aiGuide, webInstructions, etlReadme, etlInstructions].join("\n"), /(^|[\s`])python3? -m (pytest|py_compile)\b/m);
assert.doesNotMatch([readme, aiGuide, webInstructions, etlReadme, etlInstructions].join("\n"), /activate the repository virtual environment/);

for (const stale of [
    "DailyController", "ChartsController", "YearlyController", "CoachController",
    "SettingsController", "SyncController", "loadSyncStatus", "handleSyncNow",
    "activateLegacyFeature", "red baseline", "pre-existing failure",
]) {
    assert.doesNotMatch(
        [readme, aiGuide, testing, webInstructions, etlInstructions, etlConstitution, deployScript].join("\n"),
        new RegExp(stale),
        `stale permanent guidance remains: ${stale}`,
    );
}

console.log("F36 documentation and cold-start contract tests passed.");
