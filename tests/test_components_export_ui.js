const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

class FakeElement {
    constructor(id = "") {
        this.id = id;
        this.listeners = {};
        this.dataset = {};
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

function componentPayload(overrides = {}) {
    return {
        selected_gear_id: "bike-1",
        selected_bike: { gear_id: "bike-1", gear_name: "Trail bike" },
        available_bikes: [{ gear_id: "bike-1" }, { gear_id: "bike-2" }],
        components: [{ gear_component_id: 11, gear_id: "bike-1" }],
        archived_components: [{ gear_component_id: 12, gear_id: "bike-1" }],
        ...overrides,
    };
}

function createComponentsHarness(initialPayload = componentPayload()) {
    const elements = new Map();
    const getElementById = id => {
        if (!elements.has(id)) elements.set(id, new FakeElement(id));
        return elements.get(id);
    };
    const fetchRequests = [];
    const downloadRequests = [];
    const downloadResolvers = [];
    const window = {
        AppState: {
            activeTab: "service",
            serviceSubtab: "components",
            componentsSelectedGearId: "bike-1",
            defaultBikeGearId: "bike-1",
            componentsData: initialPayload,
        },
        location: { href: "http://localhost/?tab=service&subtab=components&keep=1" },
        api: {
            fetchComponents(gearId) {
                fetchRequests.push(gearId);
                return new Promise(resolve => { window.__resolveComponents = resolve; });
            },
            downloadCsv(url, filename) {
                downloadRequests.push({ url, filename });
                return new Promise((resolve, reject) => downloadResolvers.push({ resolve, reject }));
            },
        },
        TrainingApp: {
            features: {},
            TransientSurface: {
                create() {
                    return {
                        close() { },
                        open() { },
                    };
                },
            },
            registerFeature(name, feature) {
                this.features[name] = feature;
            },
        },
        confirm: () => true,
    };
    const document = {
        activeElement: null,
        getElementById,
        querySelector: () => null,
        querySelectorAll: () => [],
    };
    const context = {
        window,
        document,
        console,
        Date,
        Promise,
        String,
        Array,
        Object,
        Number,
        Boolean,
        Math,
        JSON,
        encodeURIComponent,
        persistPreferences() { },
        setTimeout(callback) { callback(); },
    };
    vm.runInNewContext(fs.readFileSync("static/components.js", "utf8"), context);
    context.renderComponentsBikeSelect = () => { };
    context.renderComponentsSummary = () => { };
    context.renderComponentsTable = () => { };
    context.renderHeaderSummary = () => { };

    return {
        context,
        elements,
        window,
        fetchRequests,
        downloadRequests,
        downloadResolvers,
        components: window.ComponentsController,
    };
}

async function main() {
    const paneMarkup = fs.readFileSync("templates/partials/panes/service_pane.html", "utf8");
    const componentsCss = fs.readFileSync("static/components.css", "utf8");
    const sharedCss = fs.readFileSync("static/style.css", "utf8");
    const summaryIndex = paneMarkup.indexOf('id="componentsSummary"');
    const exportIndex = paneMarkup.indexOf('id="componentsExport"');
    const addIndex = paneMarkup.indexOf('id="componentsAddButton"');
    assert.ok(summaryIndex < exportIndex && exportIndex < addIndex);
    assert.equal((paneMarkup.match(/id="componentsExport"/g) || []).length, 1);
    assert.match(componentsCss, /\.components-export-status\s*\{/);
    assert.doesNotMatch(sharedCss, /\.components-export-status\s*\{/);

    const harness = createComponentsHarness();
    const button = harness.elements.get("componentsExport");
    assert.equal(button.disabled, false);
    const table = harness.context.document.getElementById("componentsTable");
    table.innerHTML = "<table>existing component rows</table>";
    table.scrollLeft = 185;
    const drawer = harness.context.document.getElementById("componentServiceDrawer");
    drawer.innerHTML = "<aside>open service history</aside>";
    const originalPayload = JSON.stringify(harness.window.AppState.componentsData);
    const originalUrl = harness.window.location.href;

    const exporting = button.trigger("click");
    await Promise.resolve();
    assert.equal(button.textContent, "Exporting…");
    assert.equal(button.disabled, true);
    assert.equal(harness.elements.get("componentsExportStatus").textContent, "Exporting…");
    await button.trigger("click");
    assert.equal(harness.downloadRequests.length, 1);
    assert.equal(
        harness.downloadRequests[0].url,
        "/api/gear/components/export?gear_id=bike-1",
    );
    assert.equal(harness.downloadRequests[0].filename, "training-components.csv");
    harness.downloadResolvers[0].resolve("training-components.csv");
    await exporting;
    assert.equal(button.textContent, "Export CSV");
    assert.equal(button.disabled, false);
    assert.equal(harness.elements.get("componentsExportStatus").textContent, "Components CSV downloaded.");
    assert.equal(table.innerHTML, "<table>existing component rows</table>");
    assert.equal(table.scrollLeft, 185);
    assert.equal(drawer.innerHTML, "<aside>open service history</aside>");
    assert.equal(JSON.stringify(harness.window.AppState.componentsData), originalPayload);
    assert.equal(harness.window.AppState.componentsSelectedGearId, "bike-1");
    assert.equal(harness.window.location.href, originalUrl);

    harness.window.api.downloadCsv = async () => { throw new Error("network detail must not appear"); };
    await button.trigger("click");
    assert.equal(harness.elements.get("componentsExportStatus").textContent, "Components CSV export is temporarily unavailable.");
    assert.equal(button.disabled, false);

    const loading = createComponentsHarness();
    const loadPromise = loading.components.load();
    assert.deepEqual(loading.fetchRequests, ["bike-1"]);
    assert.equal(loading.elements.get("componentsExport").disabled, true);
    loading.window.__resolveComponents(componentPayload({ components: [], archived_components: [] }));
    await loadPromise;
    assert.equal(loading.elements.get("componentsExport").disabled, true);

    const noBike = createComponentsHarness(componentPayload({
        selected_gear_id: "",
        selected_bike: null,
        available_bikes: [],
        components: [{ gear_component_id: 11 }],
    }));
    assert.equal(noBike.elements.get("componentsExport").disabled, true);

    console.log("Components export UI contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
