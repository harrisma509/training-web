const assert = require("node:assert/strict");
const fs = require("node:fs");

const sourceFiles = [
    "static/daily.js",
    "static/charts.js",
    "static/yearly.js",
    "static/coach.js",
    "static/settings.js",
    "static/sync.js",
];
const sources = sourceFiles.map(file => fs.readFileSync(file, "utf8"));
const allSource = sources.join("\n");
const retiredGlobals = [
    "DailyController",
    "loadDaily",
    "ChartsController",
    "showChartsCategory",
    "YearlyController",
    "showYearlyView",
    "CoachController",
    "SettingsController",
    "loadSystemStatus",
    "copySystemDiagnostics",
    "loadDefaultSyncDaysPreference",
    "saveDefaultSyncDaysPreference",
    "restorePreferences",
    "syncLimitSelects",
    "updateLimitPreference",
    "applyAppearancePreference",
    "syncFormCheckboxes",
    "syncDefaultBikeSelect",
    "updateStartupTabVisibility",
    "validateAiCoachSettingsDraft",
    "loadAiCoachSettings",
    "saveAiCoachSettings",
    "cancelAiCoachSettings",
    "SyncController",
    "loadSyncStatus",
    "handleSyncNow",
];

for (const name of retiredGlobals) {
    assert.doesNotMatch(allSource, new RegExp(`window\\.${name}\\s*=`), `retired global remains: ${name}`);
}

const appSource = fs.readFileSync("static/app.js", "utf8");
assert.doesNotMatch(appSource, /activateLegacyFeature/);
assert.match(appSource, /window\.TrainingApp\?\.features\?\.sync\?\.init\?\./);
assert.match(appSource, /window\.TrainingApp\?\.features\?\.sync\?\.refresh\?\./);

const searchSource = fs.readFileSync("static/search.js", "utf8");
const gearSource = fs.readFileSync("static/gear.js", "utf8");
const componentsSource = fs.readFileSync("static/components.js", "utf8");
assert.match(searchSource, /features\?\.daily\?\.load\?\./);
assert.match(gearSource, /features\?\.settings\?\.syncFormCheckboxes\?\./);
assert.match(componentsSource, /features\?\.settings\?\.syncDefaultBikeSelect\?\./);

for (const name of ["plan", "goals", "kpis", "components", "service"]) {
    assert.match(appSource, new RegExp(`registerFeature\\("${name}"`));
}

console.log("F35 compatibility cleanup contract tests passed.");
