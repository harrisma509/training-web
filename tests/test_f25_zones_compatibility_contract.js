const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createHarness() {
    const zonesTable = { innerHTML: "" };
    const zonesLimit = {
        value: "60",
        listeners: {},
        addEventListener(name, handler) {
            (this.listeners[name] ||= []).push(handler);
        },
        async trigger(name, event = {}) {
            for (const handler of this.listeners[name] || []) await handler(event);
        },
    };
    const requests = [];
    const resolvers = [];
    const registry = { features: {} };
    const window = {
        AppState: { activeTab: "zones", zonesLimit: 60, zonesRows: [] },
        APP_ROW_LIMITS: { zones: [26, 60, 260] },
        APP_CONSTANTS: {
            ZONE_THRESHOLDS: {
                z1_z2_pct: { targetMin: 70, targetMax: 90 },
                z3_pct: { targetMin: 5, targetMax: 15 },
                z4_z5_pct: { targetMax: 10, cautionMax: 20 },
            },
        },
        TrainingApp: registry,
        api: {
            fetchZones: limit => {
                requests.push(limit);
                return new Promise(resolve => resolvers.push(resolve));
            },
        },
        updateLimitPreference(name, value, callback) {
            window.AppState[name] = value;
            callback();
        },
        persistPreferences() { },
    };
    const document = {
        getElementById(id) {
            return id === "zonesTable" ? zonesTable : id === "zonesLimit" ? zonesLimit : null;
        },
    };
    const context = {
        window,
        document,
        safe: value => value == null ? "" : String(value),
        zoneHeaderRange: () => "70-90",
        renderHeaderSummary() { },
        console,
    };

    vm.runInNewContext(fs.readFileSync("static/zones.js", "utf8"), context);

    return {
        window,
        zonesTable,
        zonesLimit,
        requests,
        resolve(index, rows) {
            resolvers[index](rows);
        },
    };
}

async function main() {
    const source = fs.readFileSync("static/zones.js", "utf8");
    const appSource = fs.readFileSync("static/app.js", "utf8");
    const settingsSource = fs.readFileSync("static/settings.js", "utf8");
    const searchSource = fs.readFileSync("static/search.js", "utf8");
    const gearSource = fs.readFileSync("static/gear.js", "utf8");
    const weeklySource = fs.readFileSync("static/weekly.js", "utf8");

    assert.doesNotMatch(source, /window\.loadZones\s*=/);
    assert.doesNotMatch(source, /window\.ZonesController\s*=/);
    assert.match(source, /const zonesController = \{/);
    assert.match(source, /window\.TrainingApp\.registerFeature\("zones", zonesController\);/);
    assert.match(appSource, /window\.TrainingApp\?\.features\?\.zones\?\.refresh\?\.\(\)/);
    assert.match(settingsSource, /window\.TrainingApp\?\.features\?\.zones\?\.refresh\?\.\(\)/);
    assert.doesNotMatch(appSource, /window\.ZonesController/);
    assert.doesNotMatch(settingsSource, /window\.loadZones/);
    assert.doesNotMatch(searchSource, /window\.SearchController/);
    assert.doesNotMatch(appSource, /window\.loadPlan/);
    assert.match(gearSource, /window\.GearController\s*=/);
    assert.match(weeklySource, /window\.WeeklyController\s*=/);
    assert.match(appSource, /window\.TrainingApp = window\.TrainingApp \|\| \{/);

    const harness = createHarness();
    const registry = harness.window.TrainingApp;
    const features = registry.features;
    const zones = harness.window.TrainingApp.features.zones;
    assert.equal(typeof zones.init, "function");
    assert.equal(typeof zones.activate, "function");
    assert.equal(typeof zones.refresh, "function");
    assert.equal(typeof zones.load, "function");
    assert.equal(harness.window.TrainingApp, registry);
    assert.equal(harness.window.TrainingApp.features, features);

    const preload = zones.refresh();
    const activationDuringPreload = zones.activate();
    assert.deepEqual(harness.requests, [60], "activation must share startup preload");
    harness.resolve(0, [{ week_start: "2026-10-01", z1_z2_pct: 80, z3_pct: 10, z4_z5_pct: 5 }]);
    await Promise.all([preload, activationDuringPreload]);
    assert.equal(harness.zonesTable.innerHTML.includes("2026-10-01"), true);

    await zones.activate();
    assert.deepEqual(harness.requests, [60], "activation after preload must use the cache");

    const forcedRefresh = zones.refresh();
    assert.deepEqual(harness.requests, [60, 60], "explicit refresh must force a request");
    harness.resolve(1, [{ week_start: "2026-10-08", z1_z2_pct: 75, z3_pct: 12, z4_z5_pct: 8 }]);
    await forcedRefresh;

    await harness.zonesLimit.trigger("change", { target: { value: "26" } });
    assert.equal(harness.window.AppState.zonesLimit, 26);
    assert.deepEqual(harness.requests, [60, 60, 26], "limit changes must force the selected limit");
    harness.resolve(2, [{ week_start: "2026-10-15", z1_z2_pct: 72, z3_pct: 9, z4_z5_pct: 6 }]);
    await Promise.resolve();

    const staleFirst = zones.refresh();
    const staleSecond = zones.refresh();
    assert.deepEqual(harness.requests, [60, 60, 26, 26, 26]);
    harness.resolve(4, [{ week_start: "newer" }]);
    await staleSecond;
    harness.resolve(3, [{ week_start: "older" }]);
    await staleFirst;
    assert.equal(harness.window.AppState.zonesRows[0].week_start, "newer");

    console.log("F25 Zones compatibility-global contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
