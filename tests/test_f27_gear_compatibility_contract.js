const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function createHarness() {
    const gearTable = { innerHTML: "" };
    const filters = {};
    const requests = [];
    const resolvers = [];
    let searchRefreshes = 0;
    let summaryRenders = 0;

    for (const id of ["hideShoesCheckbox", "hideRetiredCheckbox", "settingsHideShoes", "settingsHideRetired"]) {
        filters[id] = {
            checked: true,
            dataset: {},
            listeners: {},
            addEventListener(name, handler) {
                (this.listeners[name] ||= []).push(handler);
            },
            async trigger(name, event = {}) {
                for (const handler of this.listeners[name] || []) await handler(event);
            },
        };
    }

    const registry = { features: { sentinel: {} } };
    const window = {
        AppState: {
            activeTab: "service",
            serviceSubtab: "gear",
            gearRows: [],
            hideShoes: true,
            hideRetired: true,
        },
        TrainingApp: registry,
        api: {
            fetchGearDashboard: limit => {
                requests.push(limit);
                return new Promise(resolve => resolvers.push(resolve));
            },
        },
        syncFormCheckboxes() { },
        persistPreferences() { },
    };
    const document = {
        getElementById(id) {
            return id === "gearTable" ? gearTable : filters[id] || null;
        },
    };
    const context = {
        window,
        document,
        console,
        Intl,
        escapeHtml: value => String(value ?? ""),
        safe: value => String(value ?? ""),
        persistPreferences() { },
        renderHeaderSummary() {
            summaryRenders += 1;
        },
    };

    vm.runInNewContext(fs.readFileSync("static/gear.js", "utf8"), context);

    return {
        window,
        registry,
        gearTable,
        filters,
        requests,
        get searchRefreshes() { return searchRefreshes; },
        get summaryRenders() { return summaryRenders; },
        resolve(index, rows) {
            resolvers[index](rows);
        },
        installSearchFeature() {
            window.TrainingApp.features.search = {
                refreshGearOptions() {
                    searchRefreshes += 1;
                },
            };
        },
    };
}

async function main() {
    const source = fs.readFileSync("static/gear.js", "utf8");
    const appSource = fs.readFileSync("static/app.js", "utf8");
    const settingsSource = fs.readFileSync("static/settings.js", "utf8");

    assert.doesNotMatch(source, /window\.GearController\s*=/);
    assert.doesNotMatch(source, /window\.renderGearTable\s*=/);
    assert.match(source, /const gearController = \{/);
    assert.match(source, /window\.TrainingApp\.registerFeature\("gear", gearController\);/);
    assert.doesNotMatch(appSource, /window\.GearController/);
    assert.doesNotMatch(appSource, /\bloadGear\b/);
    assert.doesNotMatch(settingsSource, /window\.renderGearTable/);
    assert.match(appSource, /window\.TrainingApp\?\.features\?\.gear\?\.refresh\?\.\(\)/);
    assert.match(settingsSource, /window\.TrainingApp\?\.features\?\.gear\?\.render\?\.\(\)/);

    const harness = createHarness();
    const registry = harness.window.TrainingApp;
    const features = registry.features;
    const gear = features.gear;
    assert.equal(harness.window.TrainingApp, registry);
    assert.equal(harness.window.TrainingApp.features, features);
    assert.equal(typeof gear.init, "function");
    assert.equal(typeof gear.activate, "function");
    assert.equal(typeof gear.refresh, "function");
    assert.equal(typeof gear.render, "function");
    assert.equal(typeof gear.syncFilters, "function");
    assert.equal("GearController" in harness.window, false);
    assert.equal("renderGearTable" in harness.window, false);

    harness.installSearchFeature();
    const rows = [
        { gear_id: "bike-1", gear_name: "Trail Bike", gear_type: "bike", active: true, retired: false, ride_count: 3, miles: 12.5 },
        { gear_id: "shoe-1", gear_name: "Race Shoes", gear_type: "shoe", active: true, retired: false },
        { gear_id: "old-1", gear_name: "Old Bike", gear_type: "bike", active: false, retired: true },
    ];

    const preload = gear.refresh();
    const activationDuringPreload = gear.activate();
    assert.deepEqual(harness.requests, [10000], "activation must share startup preload");
    harness.resolve(0, rows);
    await Promise.all([preload, activationDuringPreload]);
    assert.equal(harness.searchRefreshes, 1);
    assert.equal(harness.summaryRenders, 1);
    assert.match(harness.gearTable.innerHTML, /Trail Bike/);
    assert.doesNotMatch(harness.gearTable.innerHTML, /Race Shoes|Old Bike/);

    await gear.activate();
    assert.deepEqual(harness.requests, [10000], "activation after preload must use the cache");

    const forcedRefresh = gear.refresh();
    assert.deepEqual(harness.requests, [10000, 10000], "manual refresh must force a request");
    harness.resolve(1, rows);
    await forcedRefresh;

    await harness.filters.hideShoesCheckbox.trigger("change", { target: { checked: false } });
    assert.equal(harness.window.AppState.hideShoes, false);
    assert.match(harness.gearTable.innerHTML, /Race Shoes/);
    await harness.filters.hideRetiredCheckbox.trigger("change", { target: { checked: false } });
    assert.equal(harness.window.AppState.hideRetired, false);
    assert.match(harness.gearTable.innerHTML, /Old Bike/);

    const staleFirst = gear.refresh();
    const staleSecond = gear.refresh();
    assert.deepEqual(harness.requests, [10000, 10000, 10000, 10000]);
    harness.resolve(3, [{ gear_id: "new", gear_name: "Newer Bike", gear_type: "bike" }]);
    await staleSecond;
    harness.resolve(2, [{ gear_id: "old", gear_name: "Older Bike", gear_type: "bike" }]);
    await staleFirst;
    assert.match(harness.gearTable.innerHTML, /Newer Bike/);
    assert.doesNotMatch(harness.gearTable.innerHTML, /Older Bike/);

    console.log("F27 Gear compatibility-global contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
