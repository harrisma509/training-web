const assert = require("node:assert/strict");
const fs = require("node:fs");

const settingsSource = fs.readFileSync("static/settings.js", "utf8");
const appStateSource = fs.readFileSync("static/app-state.js", "utf8");
const appSource = fs.readFileSync("static/app.js", "utf8");
const dailySource = fs.readFileSync("static/daily.js", "utf8");
const weeklySource = fs.readFileSync("static/weekly.js", "utf8");
const zonesSource = fs.readFileSync("static/zones.js", "utf8");
const templateSource = fs.readFileSync("templates/index.html", "utf8");
const yearlySource = fs.readFileSync("static/yearly.js", "utf8");

assert.equal(
    (settingsSource.match(/registerFeature\("settings", settingsController\)/g) || []).length,
    1,
    "Settings must register exactly once",
);
assert.match(settingsSource, /window\.TrainingApp\.registerFeature\("settings", settingsController\)/);
assert.match(settingsSource, /const settingsController = \{/);
assert.match(settingsSource, /syncFormCheckboxes: syncFormCheckboxes/);
assert.match(settingsSource, /syncDefaultBikeSelect: syncDefaultBikeSelect/);
assert.doesNotMatch(settingsSource, /window\.(?:SettingsController|loadSystemStatus|copySystemDiagnostics|loadDefaultSyncDaysPreference|saveDefaultSyncDaysPreference|restorePreferences|syncLimitSelects|updateLimitPreference|applyAppearancePreference|syncFormCheckboxes|syncDefaultBikeSelect|updateStartupTabVisibility|validateAiCoachSettingsDraft|loadAiCoachSettings|saveAiCoachSettings|cancelAiCoachSettings)\s*=/);
for (const method of ["init", "open", "requestClose", "applyAppearance", "updateLimitPreference"]) {
    assert.match(settingsSource, new RegExp(`${method}:`), method);
}
assert.match(settingsSource, /let settingsInitialized = false/);
assert.match(settingsSource, /if \(settingsInitialized\)/);
assert.match(settingsSource, /settingsInitialized = true/);
assert.match(settingsSource, /settingsMediaListenerBound/);
assert.doesNotMatch(appSource, /registerFeature\("settings"/);
assert.doesNotMatch(appSource, /settingsDrawer|settingsCloseBtn|settingsDailyLimit|settingsWeeklyLimit|settingsZonesLimit|settingsHideShoes|settingsHideRetired/);
assert.doesNotMatch(appSource, /applyAppearancePreference|prefers-color-scheme|data-theme/);
assert.doesNotMatch(appSource, /yearlyMaintenance|calculateMaintenance|previewMaintenance|rebuild/);
assert.doesNotMatch(appStateSource, /function applyAppearancePreference\(/);
assert.match(settingsSource, /function applyAppearancePreference\(/);
assert.match(settingsSource, /data-theme/);
assert.match(settingsSource, /prefers-color-scheme/);

for (const source of [dailySource, weeklySource, zonesSource]) {
    assert.match(source, /features\?\.settings\?\.updateLimitPreference/);
}
assert.doesNotMatch(dailySource, /typeof window\.loadDaily/);
assert.doesNotMatch(weeklySource, /typeof window\.loadWeekly/);
assert.doesNotMatch(zonesSource, /typeof window\.loadZones/);
assert.match(settingsSource, /features\?\.daily\?\.refresh\?\./);
assert.match(settingsSource, /features\?\.weekly\?\.refresh\?\./);
assert.match(settingsSource, /features\?\.zones\?\.refresh\?\./);
assert.match(settingsSource, /features\?\.gear\?\.render\?\./);
assert.doesNotMatch(settingsSource, /window\.renderGearTable|window\.loadDaily\(|window\.loadWeekly\(|window\.loadZones\(/);
assert.match(settingsSource, /yearlyMaintenance/);
assert.match(settingsSource, /previewMaintenance\?\./);
assert.match(settingsSource, /calculateMaintenance\?\./);
assert.match(settingsSource, /yearlyMaintenancePreviewBtn\?\.addEventListener/);
assert.match(settingsSource, /yearlyMaintenanceCalculateBtn\?\.addEventListener/);
assert.match(yearlySource, /previewMaintenance: handleYearlyMaintenancePreview/);
assert.match(yearlySource, /calculateMaintenance: handleYearlyMaintenanceCalculate/);
assert.doesNotMatch(yearlySource, /yearlyMaintenancePreviewBtn\?\.addEventListener/);
assert.doesNotMatch(yearlySource, /yearlyMaintenanceCalculateBtn\?\.addEventListener/);

const settingsScriptIndex = templateSource.indexOf('/static/settings.js?v={{ asset_version }}');
const appScriptIndex = templateSource.indexOf('/static/app.js?v={{ asset_version }}');
assert.ok(settingsScriptIndex >= 0 && appScriptIndex > settingsScriptIndex, "app.js must load after settings.js");
assert.match(templateSource, /settings\.js\?v=\{\{ asset_version \}\}/);
assert.match(templateSource, /app\.js\?v=\{\{ asset_version \}\}/);

console.log("F33 Settings ownership contract tests passed.");
