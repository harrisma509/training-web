const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeElement {
    constructor(id = "") {
        this.id = id;
        this.listeners = {};
        this.dataset = {};
        this.value = "";
        this.textContent = "";
        this.innerHTML = "";
        this.disabled = false;
        this.scrollLeft = 0;
        this.classList = {
            add() { },
            remove() { },
            contains() { return false; },
            toggle() { },
        };
    }

    addEventListener(name, handler) {
        (this.listeners[name] ||= []).push(handler);
    }

    async trigger(name, event = {}) {
        for (const handler of this.listeners[name] || []) {
            await handler(event);
        }
    }
}

function zoneRow(weekStart, suffix) {
    return {
        week_start: weekStart,
        week_end: `${weekStart}-end`,
        ride_time_hhmm: `0${suffix}:30`,
        zone_flag: `Flag ${suffix}`,
        z1_z2_pct: 70 + suffix,
        z3_pct: 10,
        z4_z5_pct: 5,
        z1_hhmm: "01:00",
        z2_hhmm: "00:30",
        z3_hhmm: "00:10",
        z4_hhmm: "00:05",
        z5_hhmm: "00:00",
        ride_count: suffix,
    };
}

function createZonesHarness(rowsByLimit) {
    const elements = new Map();
    const getElementById = id => {
        if (!elements.has(id)) elements.set(id, new FakeElement(id));
        return elements.get(id);
    };
    getElementById("zonesLimit").value = "60";
    getElementById("zonesExport").textContent = "Export CSV";
    getElementById("zonesExport").disabled = true;

    const fetchRequests = [];
    const downloadRequests = [];
    const downloadResolvers = [];
    const window = {
        APP_ROW_LIMITS: { zones: [26, 60, 260] },
        APP_CONSTANTS: {
            ZONE_THRESHOLDS: {
                z1_z2_pct: { targetMin: 70, targetMax: 90 },
                z3_pct: { targetMin: 5, targetMax: 15 },
                z4_z5_pct: { targetMax: 10, cautionMax: 20 },
            },
        },
        AppState: { activeTab: "zones", zonesLimit: 60, zonesRows: [] },
        location: { href: "http://localhost/?tab=zones&keep=1" },
        api: {
            async fetchZones(limit) {
                fetchRequests.push(limit);
                return rowsByLimit[limit] || [];
            },
            downloadCsv(url, filename, options) {
                downloadRequests.push({ url, filename, options });
                return new Promise((resolve, reject) => downloadResolvers.push({ resolve, reject }));
            },
        },
        TrainingApp: {
            features: {
                settings: {
                    updateLimitPreference(name, value) {
                        window.AppState[name] = value;
                        window.__limitRefresh = window.TrainingApp.features.zones.refresh();
                    },
                },
            },
            registerFeature(name, feature) {
                this.features[name] = feature;
            },
        },
        persistPreferences() { },
    };
    const document = {
        getElementById,
    };
    vm.runInNewContext(fs.readFileSync("static/zones.js", "utf8"), {
        window,
        document,
        console,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Math,
        JSON,
        Promise,
        safe: value => value == null ? "" : String(value),
        zoneHeaderRange: () => "70-90",
        renderHeaderSummary() { },
        fetch: async () => ({ json: async () => [] }),
    });

    return {
        elements,
        window,
        fetchRequests,
        downloadRequests,
        downloadResolvers,
        zones: window.TrainingApp.features.zones,
    };
}

async function main() {
    const indexSource = fs.readFileSync("templates/index.html", "utf8");
    const controlStart = indexSource.indexOf('<div id="zonesControls"');
    const controlEnd = indexSource.indexOf("</div>", controlStart);
    const controlsMarkup = indexSource.slice(controlStart, controlEnd);
    assert.ok(controlsMarkup.indexOf('id="zonesExport"') > controlsMarkup.indexOf('id="zonesLimit"'));
    assert.match(controlsMarkup, /id="zonesExportStatus"[^>]*role="status"/);
    assert.equal((indexSource.match(/id="zonesExport"/g) || []).length, 1);

    const visibleRows = [
        zoneRow("2026-10-05", 1),
        zoneRow("2026-09-28", 2),
        zoneRow("2026-09-21", 3),
    ];
    const harness = createZonesHarness({ 60: visibleRows, 26: [visibleRows[0]] });
    const zones = harness.zones;
    const button = harness.elements.get("zonesExport");
    await zones.refresh();
    assert.deepEqual(harness.fetchRequests, [60]);
    assert.equal(button.disabled, false);

    const table = harness.elements.get("zonesTable");
    const renderedTable = table.innerHTML;
    table.scrollLeft = 238;
    const oldRows = JSON.stringify(harness.window.AppState.zonesRows);
    const exportPending = button.trigger("click");
    await Promise.resolve();
    assert.equal(button.textContent, "Exporting…");
    assert.equal(button.disabled, true);
    assert.equal(harness.elements.get("zonesExportStatus").textContent, "Exporting…");
    await button.trigger("click");
    assert.equal(harness.downloadRequests.length, 1);
    harness.downloadResolvers[0].resolve("training-zones.csv");
    await exportPending;

    const request = harness.downloadRequests[0];
    assert.equal(request.url, "/api/zones/export");
    assert.equal(request.filename, "training-zones.csv");
    assert.equal(request.options.method, "POST");
    const posted = JSON.parse(request.options.body);
    assert.equal(posted.limit, 60);
    assert.deepEqual(
        Object.keys(posted.rows[0]),
        [
            "week_start",
            "ride_time_hhmm",
            "zone_flag",
            "z1_z2_pct",
            "z3_pct",
            "z4_z5_pct",
            "z1_hhmm",
            "z2_hhmm",
            "z3_hhmm",
            "z4_hhmm",
            "z5_hhmm",
            "ride_count",
        ],
    );
    assert.deepEqual(posted.rows.map(row => row.week_start), visibleRows.map(row => row.week_start));
    assert.equal(posted.rows[0].week_end, undefined);
    assert.equal(harness.elements.get("zonesExportStatus").textContent, "Zones CSV downloaded.");
    assert.equal(button.disabled, false);
    assert.equal(button.textContent, "Export CSV");
    assert.equal(table.innerHTML, renderedTable);
    assert.equal(table.scrollLeft, 238);
    assert.equal(JSON.stringify(harness.window.AppState.zonesRows), oldRows);
    assert.equal(harness.window.AppState.zonesLimit, 60);
    assert.equal(harness.window.location.href, "http://localhost/?tab=zones&keep=1");

    const limit = harness.elements.get("zonesLimit");
    limit.value = "26";
    await limit.trigger("change", { target: limit });
    await harness.window.__limitRefresh;
    assert.deepEqual(harness.fetchRequests, [60, 26]);
    assert.equal(harness.window.AppState.zonesLimit, 26);
    const changedExport = button.trigger("click");
    await Promise.resolve();
    assert.equal(harness.downloadRequests.length, 2);
    harness.downloadResolvers[1].resolve("training-zones.csv");
    await changedExport;
    const changedPayload = JSON.parse(harness.downloadRequests[1].options.body);
    assert.equal(changedPayload.limit, 26);
    assert.deepEqual(changedPayload.rows.map(row => row.week_start), ["2026-10-05"]);

    const empty = createZonesHarness({ 60: [] });
    await empty.zones.load();
    assert.equal(empty.elements.get("zonesExport").disabled, true);
    await empty.elements.get("zonesExport").trigger("click");
    assert.equal(empty.downloadRequests.length, 0);

    let resolveLoading;
    const loadingRows = createZonesHarness({});
    loadingRows.window.api.fetchZones = () => new Promise(resolve => { resolveLoading = resolve; });
    const loadPromise = loadingRows.zones.refresh();
    assert.equal(loadingRows.elements.get("zonesExport").disabled, true);
    resolveLoading([zoneRow("2026-10-05", 1)]);
    await loadPromise;
    assert.equal(loadingRows.elements.get("zonesExport").disabled, false);

    console.log("Zones export UI contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
