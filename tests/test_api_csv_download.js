const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { test } = require("node:test");

const apiSource = fs.readFileSync(path.join(__dirname, "..", "static", "api.js"), "utf8");

function createApiHarness(fetchImpl) {
    const anchors = [];
    const timers = [];
    const revokedUrls = [];
    const state = { activeTab: "search" };
    const body = {
        appendChild(anchor) {
            anchor.parentNode = this;
            anchors.push(anchor);
        },
    };
    const document = {
        body,
        createElement(tagName) {
            assert.equal(tagName, "a");
            const anchor = {
                style: {},
                clickCount: 0,
                click() { this.clickCount += 1; },
                remove() { this.removed = true; },
            };
            return anchor;
        },
    };
    const browserUrlApi = {
        createObjectURL(blob) {
            this.blob = blob;
            return "blob:csv-export";
        },
        revokeObjectURL(url) {
            revokedUrls.push(url);
        },
    };
    const window = {
        AppState: state,
        URL: browserUrlApi,
        location: {
            href: "https://training.example/search",
            origin: "https://training.example",
        },
        setTimeout(callback) {
            timers.push(callback);
            return timers.length;
        },
    };
    const context = {
        window,
        document,
        fetch: fetchImpl,
        URL,
        console,
        setTimeout: window.setTimeout,
    };
    vm.runInNewContext(apiSource, context, { filename: "static/api.js" });
    return { api: window.api, anchors, timers, revokedUrls, state, window };
}

function successfulResponse(disposition = 'attachment; filename="training-search.csv"') {
    return {
        ok: true,
        status: 200,
        statusText: "OK",
        headers: {
            get(name) {
                if (name === "Content-Disposition") return disposition;
                if (name === "Content-Type") return "text/csv; charset=utf-8";
                return null;
            },
        },
        async blob() {
            return { type: "text/csv", size: 10 };
        },
    };
}

test("downloads a same-origin CSV without navigation or feature-state mutation", async () => {
    let requestedUrl = "";
    let requestedOptions;
    const harness = createApiHarness(async (url, options) => {
        requestedUrl = url;
        requestedOptions = options;
        return successfulResponse();
    });

    const filename = await harness.api.downloadCsv("/api/activities/search/export?q=ride", "fallback.csv");

    assert.equal(filename, "training-search.csv");
    assert.equal(requestedUrl, "https://training.example/api/activities/search/export?q=ride");
    assert.equal(requestedOptions.headers.Accept, "text/csv");
    assert.equal(harness.anchors.length, 1);
    assert.equal(harness.anchors[0].href, "blob:csv-export");
    assert.equal(harness.anchors[0].download, "training-search.csv");
    assert.equal(harness.anchors[0].clickCount, 1);
    assert.equal(harness.anchors[0].removed, true);
    assert.equal(harness.window.location.href, "https://training.example/search");
    assert.deepEqual(harness.state, { activeTab: "search" });
    assert.deepEqual(harness.revokedUrls, []);
    harness.timers[0]();
    assert.deepEqual(harness.revokedUrls, ["blob:csv-export"]);
});

test("rejects non-2xx responses without downloading the error body", async () => {
    let blobCalls = 0;
    const harness = createApiHarness(async () => ({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: { get: () => null },
        async blob() { blobCalls += 1; return {}; },
    }));

    await assert.rejects(
        harness.api.downloadCsv("/api/weekly/export", "weekly.csv"),
        error => {
            assert.match(error.message, /503 Service Unavailable/);
            assert.equal(error.status, 503);
            return true;
        },
    );
    assert.equal(blobCalls, 0);
    assert.equal(harness.anchors.length, 0);
});

test("rejects successful responses that are not CSV", async () => {
    const harness = createApiHarness(async () => ({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: { get: name => name === "Content-Type" ? "application/json" : null },
        async blob() { throw new Error("The response body must not be read."); },
    }));

    await assert.rejects(
        harness.api.downloadCsv("/api/weekly/export", "weekly.csv"),
        /unexpected content type/,
    );
    assert.equal(harness.anchors.length, 0);
});

test("parses safe extended filenames and uses fallback for unsafe names", async () => {
    const extended = createApiHarness(async () => successfulResponse(
        "attachment; filename*=UTF-8''weekly-export.csv",
    ));
    assert.equal(await extended.api.downloadCsv("/api/weekly/export", "fallback.csv"), "weekly-export.csv");

    const unsafe = createApiHarness(async () => successfulResponse(
        'attachment; filename="../outside.csv"',
    ));
    assert.equal(await unsafe.api.downloadCsv("/api/weekly/export", "weekly-fallback.csv"), "weekly-fallback.csv");
});

test("rejects cross-origin endpoints and unsafe fallbacks", async () => {
    const harness = createApiHarness(async () => successfulResponse());
    await assert.rejects(
        harness.api.downloadCsv("https://other.example/export.csv", "fallback.csv"),
        /same-origin/,
    );
    await assert.rejects(
        harness.api.downloadCsv("/export.csv", "../unsafe.csv"),
        /safe fallback/,
    );
    assert.equal(harness.anchors.length, 0);
});
