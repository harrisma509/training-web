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
        this.className = "";
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

    insertAdjacentHTML() { }

    querySelectorAll() {
        return [];
    }

    appendChild() { }
}

function weeklyRow(index) {
    return {
        week_start: `week-${index}`,
        week_end: "",
        weekly_comment: "",
        audit_grade: null,
        weekly_total_hours: null,
        weekly_total_miles: null,
        weekly_total_elevation_ft: null,
        weekly_avg_weight: null,
        total_load: null,
        chronic_weekly_cw: null,
        ac_ratio: null,
        ramp_pct_display: "",
        status_level: null,
        status_text: "",
        main_ride_load: null,
        other_load: null,
        activity_days: null,
        ride_count: null,
        walk_count: null,
        hike_count: null,
        strength_count: null,
        very_hard_epic_days: null,
        vo2max: null,
        falls: 0,
    };
}

function createWeeklyHarness(limit, fetchRows = async () => [weeklyRow(1)]) {
    const elements = new Map();
    const getElementById = id => {
        if (!elements.has(id)) elements.set(id, new FakeElement(id));
        return elements.get(id);
    };
    getElementById("weeklyLimit").value = String(limit);
    getElementById("weeklyExport").textContent = "Export CSV";
    getElementById("weeklyExport").disabled = true;

    const body = new FakeElement("body");
    body.insertAdjacentHTML = () => { };
    const document = {
        body,
        getElementById,
        querySelectorAll: () => [],
        createElement: id => new FakeElement(id),
    };
    const fetchRequests = [];
    const downloadRequests = [];
    let downloadResponse = async () => "training-weekly.csv";
    const window = {
        APP_ROW_LIMITS: { weekly: [10, 52, 520] },
        APP_CONSTANTS: {
            WEEKLY_HOURS_GREEN_MIN: 6,
            WEEKLY_HOURS_YELLOW_MIN: 4,
            AC_RATIO_TARGET_MIN: 0.8,
            AC_RATIO_TARGET_MAX: 1.3,
            AC_RATIO_CAUTION_MAX: 1.5,
        },
        AppState: { weeklyRows: [], weeklyLimit: limit, activeTab: "search" },
        api: {
            fetchWeekly: async selectedLimit => {
                fetchRequests.push(selectedLimit);
                return fetchRows(selectedLimit);
            },
            downloadCsv: async (url, filename) => {
                downloadRequests.push({ url, filename });
                return downloadResponse(url, filename);
            },
        },
        TrainingApp: {
            features: {},
            registerFeature(name, feature) {
                this.features[name] = feature;
            },
        },
        persistPreferences() { },
        location: { href: "http://localhost/?tab=weekly&keep=1" },
    };

    vm.runInNewContext(fs.readFileSync("static/weekly.js", "utf8"), {
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
        Date,
        Intl,
        Set,
        Map,
        Promise,
        safe: value => value == null ? "" : String(value),
        escapeHtml: value => String(value == null ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;"),
        truncateText: (value, maxLength = 100) => String(value || "").slice(0, maxLength),
        statusPill: () => "",
    });

    return {
        elements,
        window,
        fetchRequests,
        downloadRequests,
        weekly: window.TrainingApp.features.weekly,
        setDownloadResponse(handler) { downloadResponse = handler; },
    };
}

function renderedDataRowCount(table) {
    return (table.innerHTML.match(/<tr>/g) || []).length - 1;
}

async function main() {
    const empty = createWeeklyHarness(10, async () => []);
    assert.equal(empty.elements.get("weeklyExport").disabled, true);
    await empty.elements.get("weeklyExport").trigger("click");
    assert.equal(empty.downloadRequests.length, 0);
    await empty.weekly.load();
    assert.equal(empty.elements.get("weeklyExport").disabled, true);

    const limitRows = new Map([
        [10, Array.from({ length: 10 }, (_, index) => weeklyRow(index + 1))],
        [52, Array.from({ length: 52 }, (_, index) => weeklyRow(index + 1))],
        [520, Array.from({ length: 520 }, (_, index) => weeklyRow(index + 1))],
    ]);
    for (const limit of [10, 52, 520]) {
        const harness = createWeeklyHarness(limit, async selectedLimit => limitRows.get(selectedLimit));
        await harness.weekly.load();
        assert.deepEqual(harness.fetchRequests, [limit]);
        assert.equal(renderedDataRowCount(harness.elements.get("weeklyTable")), limit);
        assert.equal(harness.elements.get("weeklyExport").disabled, false);
        const oldTable = harness.elements.get("weeklyTable").innerHTML;
        harness.elements.get("weeklyTable").scrollLeft = 317;
        harness.window.AppState.activeTab = "weekly";
        await harness.elements.get("weeklyExport").trigger("click");
        assert.deepEqual(harness.downloadRequests, [{
            url: `/api/weekly/export?limit=${limit}`,
            filename: "training-weekly.csv",
        }]);
        assert.equal(harness.window.AppState.weeklyLimit, limit);
        assert.equal(harness.window.AppState.activeTab, "weekly");
        assert.equal(harness.window.AppState.weeklyRows.length, limit);
        assert.equal(harness.elements.get("weeklyTable").innerHTML, oldTable);
        assert.equal(harness.elements.get("weeklyTable").scrollLeft, 317);
        assert.equal(harness.window.location.href, "http://localhost/?tab=weekly&keep=1");
    }

    let resolveRows;
    const loading = createWeeklyHarness(52, () => new Promise(resolve => { resolveRows = resolve; }));
    const loadPromise = loading.weekly.refresh();
    assert.deepEqual(loading.fetchRequests, [52]);
    assert.equal(loading.elements.get("weeklyExport").disabled, true);
    resolveRows([weeklyRow(1)]);
    await loadPromise;
    assert.equal(loading.elements.get("weeklyExport").disabled, false);

    let finishExport;
    loading.setDownloadResponse(() => new Promise(resolve => { finishExport = resolve; }));
    const tableBeforeExport = loading.elements.get("weeklyTable").innerHTML;
    loading.elements.get("weeklyTable").scrollLeft = 129;
    loading.window.AppState.activeTab = "weekly";
    const exportPromise = loading.elements.get("weeklyExport").trigger("click");
    assert.equal(loading.elements.get("weeklyExport").textContent, "Exporting…");
    assert.equal(loading.elements.get("weeklyExport").disabled, true);
    await loading.elements.get("weeklyExport").trigger("click");
    assert.equal(loading.downloadRequests.length, 1);
    finishExport("training-weekly.csv");
    await exportPromise;
    assert.equal(loading.elements.get("weeklyExport").textContent, "Export CSV");
    assert.equal(loading.elements.get("weeklyExport").disabled, false);
    assert.equal(loading.elements.get("weeklyExportStatus").textContent, "Weekly CSV downloaded.");
    assert.equal(loading.elements.get("weeklyExportStatus").dataset.state, "success");
    assert.equal(loading.window.AppState.weeklyLimit, 52);
    assert.equal(loading.window.AppState.activeTab, "weekly");
    assert.equal(loading.elements.get("weeklyTable").innerHTML, tableBeforeExport);
    assert.equal(loading.elements.get("weeklyTable").scrollLeft, 129);

    const failed = createWeeklyHarness(10);
    await failed.weekly.load();
    failed.setDownloadResponse(async () => { throw new Error("private server detail"); });
    await failed.elements.get("weeklyExport").trigger("click");
    assert.equal(failed.elements.get("weeklyExport").textContent, "Export CSV");
    assert.equal(failed.elements.get("weeklyExport").disabled, false);
    assert.equal(failed.elements.get("weeklyExportStatus").textContent, "Weekly CSV export is temporarily unavailable.");
    assert.equal(failed.elements.get("weeklyExportStatus").dataset.state, "error");
    assert.doesNotMatch(failed.elements.get("weeklyExportStatus").textContent, /private server detail/);

    console.log("Weekly CSV export UI contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
