const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { formatActivityLocalDate, formatActivityLocalTime } = require("../static/search.js");

class FakeElement {
    constructor(tagName = "div") {
        this.tagName = tagName.toUpperCase();
        this.children = [];
        this.listeners = {};
        this.attributes = {};
        this.dataset = {};
        this.value = "";
        this.textContent = "";
        this.disabled = false;
        this.checked = false;
        this.open = false;
        this.className = "";
        this.classList = {
            add: () => { },
            remove: () => { },
            toggle: () => { },
        };
    }

    addEventListener(name, handler) {
        (this.listeners[name] ||= []).push(handler);
    }

    async trigger(name, event = {}) {
        for (const handler of this.listeners[name] || []) await handler(event);
    }

    appendChild(child) {
        this.children.push(child);
        return child;
    }

    replaceChildren(...children) {
        this.children = children;
    }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    querySelectorAll() {
        return this.controls || [];
    }
}

function createSearchHarness(initialHref = "http://localhost/?tab=search") {
    const ids = [
        "searchForm", "searchText", "searchStartDate", "searchEndDate", "searchSportType",
        "searchCategory", "searchGearId", "searchMinDistance", "searchMaxDistance",
        "searchMinElevation", "searchMaxElevation", "searchMinDuration", "searchMaxDuration",
        "searchStartTimeFrom", "searchStartTimeTo", "searchSort", "searchLimit", "searchClear",
        "searchPrevious", "searchNext", "searchKeepFiltersOpen", "searchValidationMessage",
        "searchStatus", "searchScope", "searchActiveFilters", "searchResults", "searchPageStatus",
    ];
    const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id === "searchForm" ? "form" : "div")]));
    const inputIds = [
        "searchText", "searchStartDate", "searchEndDate", "searchSportType", "searchCategory",
        "searchGearId", "searchMinDistance", "searchMaxDistance", "searchMinElevation",
        "searchMaxElevation", "searchMinDuration", "searchMaxDuration", "searchStartTimeFrom",
        "searchStartTimeTo", "searchSort", "searchLimit",
    ];
    elements.searchForm.controls = inputIds.map(id => elements[id]);
    elements.searchSort.value = "newest";
    elements.searchLimit.value = "50";
    const filterPanel = new FakeElement("details");
    let currentUrl = new URL(initialHref);
    const requests = [];
    let respond = async () => ({ items: [], has_more: false, next_offset: null });
    const window = {
        AppState: { activeTab: "search", gearRows: [{ gear_id: 3, gear_name: "Trail Bike" }] },
        api: {
            searchActivities: async query => {
                requests.push(structuredClone(query));
                return respond(query);
            },
        },
        location: {
            get href() { return currentUrl.href; },
            get search() { return currentUrl.search; },
        },
        history: {
            replaceState: (_state, _title, url) => { currentUrl = new URL(url, currentUrl); },
        },
    };
    const document = {
        getElementById: id => elements[id] || null,
        querySelector: selector => selector === ".search-filters" ? filterPanel : null,
        createElement: tagName => new FakeElement(tagName),
    };
    vm.runInNewContext(fs.readFileSync("static/search.js", "utf8"), { window, document, URL, URLSearchParams, Intl, Number, String, Boolean, JSON, encodeURIComponent });

    return {
        elements,
        filterPanel,
        requests,
        window,
        setResponse(handler) { respond = handler; },
        getUrl() { return currentUrl; },
        async settle() { await new Promise(resolve => setImmediate(resolve)); },
    };
}

function descendantText(element) {
    return [element.textContent, ...element.children.map(descendantText)].filter(Boolean).join(" ");
}

async function main() {
    process.env.TZ = "Pacific/Auckland";

    assert.equal(formatActivityLocalDate("2024-03-10"), "2024-03-10");
    assert.equal(formatActivityLocalTime("2024-03-10T03:15:00"), "03:15");
    assert.equal(formatActivityLocalDate("2024-11-03"), "2024-11-03");
    assert.equal(formatActivityLocalTime("2024-11-03T09:45:00"), "09:45");
    assert.equal(formatActivityLocalTime(null), "");
    assert.equal(formatActivityLocalTime(""), "");

    const searchSource = fs.readFileSync("static/search.js", "utf8");
    const dailySource = fs.readFileSync("static/daily.js", "utf8");
    const appSource = fs.readFileSync("static/app.js", "utf8");
    const htmlSource = fs.readFileSync("index.html", "utf8");
    assert.doesNotMatch(searchSource, /new Date|Date\.parse/);
    assert.match(searchSource, /window\.api\.searchActivities\(\{/);
    assert.match(searchSource, /const SEARCH_URL_KEYS/);
    assert.match(searchSource, /Date range incomplete/);
    assert.match(searchSource, /Showing \$\{first\}–\$\{last\}/);
    assert.match(searchSource, /Last valid results remain shown\./);
    assert.match(appSource, /removeSearchParameters\(url\)/);
    assert.match(appSource, /history\.pushState/);
    assert.match(appSource, /tab === "search"\) window\.SearchController\?\.restoreFromUrl/);
    assert.match(searchSource, /"highest_elevation"/);
    assert.match(searchSource, /"longest_distance"/);
    assert.match(searchSource, /"longest_duration"/);
    assert.match(dailySource, /dailySearchAdvanced/);
    assert.match(dailySource, /openAdvancedSearch\(\{ text:/);
    assert.match(htmlSource, /id="searchTab"/);
    assert.match(htmlSource, /id="searchResults"/);
    assert.match(htmlSource, /id="dailySearchAdvanced"/);
    assert.match(htmlSource, /search\.css/);
    assert.doesNotMatch(fs.readFileSync("static/style.css", "utf8"), /\.search-(?:pane|filters|results|chip)/);

    const harness = createSearchHarness();
    harness.setResponse(async () => ({
        items: [{ activity_id: 12, name: "Local ride", date_local: "2024-04-03" }],
        has_more: true,
        next_offset: 50,
    }));
    harness.window.SearchController.activate();
    await harness.settle();
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].sort, "newest");
    assert.equal(harness.requests[0].limit, 50);
    assert.equal(harness.requests[0].offset, 0);
    assert.equal(harness.requests[0].start_date, "");
    assert.equal(harness.requests[0].end_date, "");
    assert.equal(harness.elements.searchScope.textContent, "All history");
    assert.match(harness.elements.searchPageStatus.textContent, /Showing 1–1 · More activities available/);
    assert.match(descendantText(harness.elements.searchResults), /Local ride/);
    assert.equal(harness.getUrl().searchParams.get("sort"), "newest");
    assert.equal(harness.getUrl().searchParams.has("start_date"), false);

    harness.elements.searchStartDate.value = "2024-01-01";
    await harness.elements.searchStartDate.trigger("input");
    assert.equal(harness.elements.searchScope.textContent, "Date range incomplete");
    await harness.elements.searchForm.trigger("submit", { preventDefault() { } });
    assert.equal(harness.requests.length, 1, "an incomplete date range must not issue a request");
    assert.match(harness.elements.searchValidationMessage.textContent, /both a start date and an end date/);
    assert.match(descendantText(harness.elements.searchResults), /Local ride/, "validation must preserve prior rows");
    assert.match(harness.elements.searchPageStatus.textContent, /More activities available/);
    await harness.elements.searchNext.trigger("click");
    await harness.settle();
    assert.equal(harness.requests.at(-1).offset, 50, "Next must use the last valid result snapshot");

    harness.setResponse(async () => { throw new Error("offline"); });
    await harness.elements.searchForm.trigger("submit", { preventDefault() { } });
    await harness.settle();
    assert.match(harness.elements.searchStatus.textContent, /temporarily unavailable/);
    assert.match(descendantText(harness.elements.searchResults), /Local ride/, "request errors must preserve prior rows");
    assert.match(harness.elements.searchPageStatus.textContent, /More activities available/);

    harness.getUrl().searchParams.set("start_date", "2024-01-01");
    harness.getUrl().searchParams.set("end_date", "2024-01-31");
    harness.getUrl().searchParams.set("keep", "1");
    harness.window.SearchController.restoreFromUrl();
    assert.equal(harness.elements.searchStartDate.value, "2024-01-01");
    assert.equal(harness.elements.searchEndDate.value, "2024-01-31");
    harness.window.SearchController.removeSearchParameters(harness.getUrl());
    assert.equal(harness.getUrl().searchParams.has("start_date"), false);
    assert.equal(harness.getUrl().searchParams.has("sort"), false);
    assert.equal(harness.getUrl().searchParams.get("keep"), "1");

    harness.setResponse(async () => ({ items: [], has_more: false, next_offset: null }));
    harness.elements.searchStartDate.value = "";
    harness.elements.searchEndDate.value = "";
    await harness.elements.searchForm.trigger("submit", { preventDefault() { } });
    await harness.settle();
    assert.match(descendantText(harness.elements.searchResults), /No activities match these filters/);
    assert.equal(harness.elements.searchPageStatus.textContent, "");
    assert.equal(harness.elements.searchNext.disabled, true);

    assert.ok(harness.elements.searchGearId.children.some(option => option.textContent === "Trail Bike"));
    harness.elements.searchGearId.value = "3";
    await harness.elements.searchGearId.trigger("change");
    assert.equal(harness.elements.searchGearId.value, "3", "reading a changed gear selection must not overwrite it");
    harness.setResponse(async () => ({ items: [], has_more: false, next_offset: null }));
    await harness.elements.searchForm.trigger("submit", { preventDefault() { } });
    await harness.settle();
    assert.equal(harness.requests.at(-1).gear_id, "3");
    assert.equal(harness.elements.searchGearId.children.find(option => option.value === "3").textContent, "Trail Bike");
    assert.match(harness.elements.searchActiveFilters.children[0].textContent, /^Bike: Trail Bike ×$/);
    assert.equal(harness.getUrl().searchParams.get("search_gear_id"), "3");
    assert.equal(harness.getUrl().searchParams.has("gear_id"), false);
    await harness.elements.searchActiveFilters.children[0].trigger("click");
    await harness.settle();
    assert.equal(harness.requests.at(-1).gear_id, "");
    assert.equal(harness.requests.at(-1).offset, 0);
    assert.equal(harness.getUrl().searchParams.has("search_gear_id"), false);

    harness.elements.searchCategory.value = "Run";
    await harness.elements.searchCategory.trigger("input");
    await harness.elements.searchForm.trigger("submit", { preventDefault() { } });
    await harness.settle();
    const categoryChip = harness.elements.searchActiveFilters.children.find(chip => /Category: Run/.test(chip.textContent));
    assert.ok(categoryChip, "active filters should be removable chips");
    await categoryChip.trigger("click");
    await harness.settle();
    assert.equal(harness.requests.at(-1).activity_category, "");

    harness.elements.searchText.value = "temporary filter";
    await harness.elements.searchClear.trigger("click");
    await harness.settle();
    assert.equal(harness.requests.at(-1).text, "");
    assert.equal(harness.requests.at(-1).sort, "newest");
    assert.equal(harness.requests.at(-1).limit, 50);
    assert.equal(harness.requests.at(-1).offset, 0);
    assert.equal(harness.elements.searchText.value, "");
    assert.equal(harness.elements.searchScope.textContent, "All history");

    const restored = createSearchHarness("http://localhost/?tab=search&text=climb&start_date=2024-02-01&end_date=2024-02-29&sort=oldest&limit=25&offset=25&keep=1");
    restored.window.SearchController.activate();
    await restored.settle();
    assert.equal(restored.requests[0].text, "climb");
    assert.equal(restored.requests[0].start_date, "2024-02-01");
    assert.equal(restored.requests[0].end_date, "2024-02-29");
    assert.equal(restored.requests[0].sort, "oldest");
    assert.equal(restored.requests[0].limit, 25);
    assert.equal(restored.requests[0].offset, 25);
    assert.equal(restored.getUrl().searchParams.get("keep"), "1");

    const restoredGear = createSearchHarness("http://localhost/?tab=search&search_gear_id=3");
    restoredGear.window.SearchController.activate();
    await restoredGear.settle();
    assert.equal(restoredGear.requests[0].gear_id, "3");
    assert.match(restoredGear.elements.searchActiveFilters.children[0].textContent, /^Bike: Trail Bike ×$/);

    const lateGear = createSearchHarness("http://localhost/?tab=search&search_gear_id=3");
    lateGear.window.AppState.gearRows = [];
    lateGear.window.SearchController.activate();
    await lateGear.settle();
    assert.match(lateGear.elements.searchActiveFilters.children[0].textContent, /^Bike: 3 ×$/);
    lateGear.window.AppState.gearRows = [{ gear_id: 3, gear_name: "Rallon" }];
    lateGear.window.SearchController.refreshGearOptions();
    assert.match(lateGear.elements.searchActiveFilters.children[0].textContent, /^Bike: Rallon ×$/);

    const legacyGear = createSearchHarness("http://localhost/?tab=search&gear_id=3");
    legacyGear.window.SearchController.activate();
    await legacyGear.settle();
    assert.equal(legacyGear.requests[0].gear_id, "3");
    assert.equal(legacyGear.getUrl().searchParams.get("search_gear_id"), "3");
    assert.equal(legacyGear.getUrl().searchParams.has("gear_id"), false);

    const unknownGear = createSearchHarness("http://localhost/?tab=search&search_gear_id=retired-bike");
    unknownGear.window.AppState.gearRows = [];
    unknownGear.window.SearchController.activate();
    await unknownGear.settle();
    assert.equal(unknownGear.requests[0].gear_id, "retired-bike");
    assert.match(unknownGear.elements.searchActiveFilters.children[0].textContent, /^Bike: retired-bike ×$/);
    assert.equal(unknownGear.elements.searchGearId.children.at(-1).value, "retired-bike");
    assert.equal(unknownGear.elements.searchGearId.children.at(-1).textContent, "retired-bike");
    await unknownGear.elements.searchActiveFilters.children[0].trigger("click");
    await unknownGear.settle();
    assert.equal(unknownGear.requests.at(-1).gear_id, "");
    assert.equal(unknownGear.requests.at(-1).offset, 0);
    assert.equal(unknownGear.getUrl().searchParams.has("search_gear_id"), false);
    assert.equal(unknownGear.getUrl().searchParams.has("gear_id"), false);

    global.window = {};
    let requestedUrl = "";
    global.fetch = async url => {
        requestedUrl = String(url);
        return { ok: true, json: async () => ({ items: [] }) };
    };
    require("../static/api.js");
    await global.window.api.searchActivities({
        text: "Floyd Hill",
        start_date: "2024-01-01",
        end_date: "2024-12-31",
        sort: "highest_elevation",
        limit: 50,
        offset: 0,
        gear_id: "",
    });
    const params = new URL(`http://localhost${requestedUrl}`).searchParams;
    assert.equal(params.get("text"), "Floyd Hill");
    assert.equal(params.get("start_date"), "2024-01-01");
    assert.equal(params.get("end_date"), "2024-12-31");
    assert.equal(params.get("sort"), "highest_elevation");
    assert.equal(params.get("limit"), "50");
    assert.equal(params.get("offset"), "0");
    assert.equal(params.has("gear_id"), false);

    await global.window.api.fetchDaily(60, "", "2012-07-15");
    assert.match(requestedUrl, /^\/api\/daily\?/);
    assert.equal(new URL(`http://localhost${requestedUrl}`).searchParams.get("date"), "2012-07-15");

    console.log("Activity Search UI contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});