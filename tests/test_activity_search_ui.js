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
        this.style = {};
        this.parentNode = null;
        this.focused = false;
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

    async keyboardActivate(key) {
        if (this.tagName !== "BUTTON") throw new Error("Keyboard activation requires a button");
        await this.trigger("keydown", { key });
        if (key === "Enter" || key === " ") await this.trigger("click");
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    replaceChildren(...children) {
        this.children.forEach(child => { child.parentNode = null; });
        this.children = children;
        children.forEach(child => { child.parentNode = this; });
    }

    remove() {
        if (!this.parentNode) return;
        this.parentNode.children = this.parentNode.children.filter(child => child !== this);
        this.parentNode = null;
    }

    contains(element) {
        return this === element || this.children.some(child => child.contains(element));
    }

    focus() {
        this.focused = true;
    }

    getBoundingClientRect() {
        return { left: 10, right: 110, top: 10, bottom: 40, width: 100, height: 30 };
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
        "searchGearId", "searchMinDistance", "searchMaxDistance",
        "searchMinElevation", "searchMaxElevation", "searchMinDuration", "searchMaxDuration",
        "searchStartTimeFrom", "searchStartTimeTo", "searchLimit", "searchClear",
        "searchPrevious", "searchNext", "searchKeepFiltersOpen", "searchValidationMessage",
        "searchStatus", "searchScope", "searchActiveFilters", "searchResults", "searchPageStatus",
    ];
    const elements = Object.fromEntries(ids.map(id => [id, new FakeElement(id === "searchForm" ? "form" : "div")]));
    const inputIds = [
        "searchText", "searchStartDate", "searchEndDate", "searchSportType",
        "searchGearId", "searchMinDistance", "searchMaxDistance", "searchMinElevation",
        "searchMaxElevation", "searchMinDuration", "searchMaxDuration", "searchStartTimeFrom",
        "searchStartTimeTo", "searchLimit",
    ];
    elements.searchForm.controls = inputIds.map(id => elements[id]);
    elements.searchLimit.value = "50";
    const filterPanel = new FakeElement("details");
    let currentUrl = new URL(initialHref);
    const requests = [];
    const resyncCalls = [];
    const statusCalls = [];
    const confirmations = [];
    let respond = async () => ({ items: [], total_count: 0 });
    const documentListeners = {};
    const body = new FakeElement("body");
    const document = {
        body,
        getElementById: id => elements[id] || null,
        querySelector: selector => selector === ".search-filters" ? filterPanel : null,
        createElement: tagName => new FakeElement(tagName),
        addEventListener(name, handler) { (documentListeners[name] ||= []).push(handler); },
        async trigger(name, event = {}) {
            for (const handler of documentListeners[name] || []) await handler(event);
        },
    };
    const window = {
        AppState: { activeTab: "search", gearRows: [{ gear_id: 3, gear_name: "Trail Bike" }] },
        api: {
            fetchActivitySearchTypes: async () => ({ sport_types: ["Ride", "MountainBikeRide", "FutureSport"] }),
            searchActivities: async query => {
                requests.push(structuredClone(query));
                return respond(query);
            },
            resyncActivity: async activityId => {
                resyncCalls.push(activityId);
                return { request_id: 9001, status: "pending", activity_id: Number(activityId) };
            },
            fetchSyncRequestStatus: async requestId => {
                statusCalls.push(requestId);
                return { request_id: requestId, status: "completed" };
            },
        },
        confirm(message) { confirmations.push(message); return true; },
        setTimeout(callback) { return setImmediate(callback); },
        innerWidth: 1024,
        innerHeight: 768,
        showTab(tab) { this.AppState.activeTab = tab; },
        DailyController: { load() { } },
        TrainingApp: { features: {} },
        location: {
            get href() { return currentUrl.href; },
            get search() { return currentUrl.search; },
        },
        history: {
            replaceState: (_state, _title, url) => { currentUrl = new URL(url, currentUrl); },
        },
    };
    vm.runInNewContext(fs.readFileSync("static/search.js", "utf8"), { window, document, URL, URLSearchParams, Intl, Number, String, Boolean, JSON, encodeURIComponent });

    return {
        elements,
        filterPanel,
        requests,
        resyncCalls,
        statusCalls,
        confirmations,
        window,
        document,
        body,
        setResponse(handler) { respond = handler; },
        getUrl() { return currentUrl; },
        async settle() { await new Promise(resolve => setImmediate(resolve)); },
    };
}

function descendantText(element) {
    return [element.textContent, ...element.children.map(descendantText)].filter(Boolean).join(" ");
}

function descendants(element) {
    return element.children.flatMap(child => [child, ...descendants(child)]);
}

function tableRows(table) {
    return table.children.find(element => element.tagName === "TBODY")?.children || [];
}

function sortButton(table, label) {
    return descendants(table).find(element => element.className.includes("search-sort")
        && element.children.some(child => child.className === "search-sort-label" && child.textContent === label));
}

async function main() {
    process.env.TZ = "Pacific/Auckland";

    assert.equal(formatActivityLocalDate("2024-03-10"), "2024-03-10");
    assert.equal(formatActivityLocalTime("2024-03-10T03:15:00"), "3:15 AM");
    assert.equal(formatActivityLocalDate("2024-11-03"), "2024-11-03");
    assert.equal(formatActivityLocalTime("2024-11-03T09:45:00"), "9:45 AM");
    assert.equal(formatActivityLocalTime("2024-11-03T00:05:00"), "12:05 AM");
    assert.equal(formatActivityLocalTime("2024-11-03T12:05:00"), "12:05 PM");
    assert.equal(formatActivityLocalTime(null), "");
    assert.equal(formatActivityLocalTime(""), "");

    const searchSource = fs.readFileSync("static/search.js", "utf8");
    const dailySource = fs.readFileSync("static/daily.js", "utf8");
    const appSource = fs.readFileSync("static/app.js", "utf8");
    const searchPartialSource = fs.readFileSync("templates/partials/panes/search_pane.html", "utf8");
    const dailyPartialSource = fs.readFileSync("templates/partials/panes/daily_pane.html", "utf8");
    const htmlSource = fs.readFileSync("templates/index.html", "utf8") + searchPartialSource + dailyPartialSource;
    const searchCssSource = fs.readFileSync("static/search.css", "utf8");
    assert.doesNotMatch(searchSource, /new Date|Date\.parse/);
    assert.match(searchSource, /Array\.from\(menu\.children\)\.find\(item => !item\.disabled\)/);
    assert.doesNotMatch(searchSource, /menu\.children\.find/);
    assert.match(searchSource, /window\.api\.searchActivities\(\{/);
    assert.match(searchSource, /const SEARCH_URL_KEYS/);
    assert.match(searchSource, /Date range incomplete/);
    assert.match(searchSource, /Showing \$\{first\}–\$\{last\} of \$\{totalCount\} activities/);
    assert.match(searchSource, /sort_by: query\.sort_by/);
    assert.match(searchSource, /sort_direction: query\.sort_direction/);
    assert.doesNotMatch(searchSource, /field\("searchSort"\)/);
    assert.match(searchSource, /Last valid results remain shown\./);
    assert.match(appSource, /removeSearchParameters\(url\)/);
    assert.match(appSource, /history\.pushState/);
    assert.match(appSource, /context\.source === "popstate"\) \{\s*window\.TrainingApp\?\.features\?\.search\?\.restoreFromUrl/);
    assert.doesNotMatch(searchSource, /window\.SearchController/);
    assert.doesNotMatch(appSource, /window\.SearchController/);
    assert.doesNotMatch(dailySource, /window\.SearchController/);
    assert.match(dailySource, /dailySearchAdvanced/);
    assert.match(dailySource, /openAdvancedSearch\(\{ text:/);
    assert.match(htmlSource, /id="searchTab"/);
    assert.match(htmlSource, /id="searchResults"/);
    assert.match(htmlSource, /id="searchSportType"/);
    assert.doesNotMatch(htmlSource, /id="searchCategory"|>Category</);
    assert.match(htmlSource, /id="dailySearchAdvanced"/);
    assert.match(htmlSource, /search\.css/);
    assert.match(htmlSource, /search\.js\?v=20261003-activity-resync-fix-v1/);
    assert.doesNotMatch(fs.readFileSync("static/style.css", "utf8"), /\.search-(?:pane|filters|results|chip)/);
    assert.match(searchCssSource, /#searchResults th:first-child,\s*#searchResults td:first-child\s*\{[^}]*width:\s*1%;[^}]*white-space:\s*nowrap;/s);
    assert.match(searchCssSource, /#searchResults th:nth-child\(2\),\s*#searchResults td:nth-child\(2\)\s*\{[^}]*width:\s*1%;[^}]*white-space:\s*nowrap;[^}]*text-align:\s*right;/s);
    assert.match(searchCssSource, /#searchResults \.search-date-cell-content\s*\{[^}]*display:\s*inline-flex;[^}]*gap:\s*1px;[^}]*white-space:\s*nowrap;/s);
    assert.match(searchCssSource, /#searchResults th:nth-child\(2\) \.search-sort\s*\{[^}]*justify-content:\s*flex-end;[^}]*text-align:\s*right;/s);
    assert.doesNotMatch(searchCssSource, /(^|\n)\s*(?:table\s+)?(?:tr\s+)?(?:th|td|tr)(?:\s|:|\{)/);
    assert.doesNotMatch(searchCssSource, /(^|\n)\s*(?:th|td|tr):nth-child\(/);
    assert.doesNotMatch(searchCssSource, /\.search-actions-cell/);

    const harness = createSearchHarness();
    harness.setResponse(async () => ({
        items: Array.from({ length: 50 }, (_, index) => ({
            activity_id: index + 12,
            name: index === 0 ? "Local ride" : `Ride ${index}`,
            date_local: "2024-04-03",
        })),
        total_count: 126,
    }));
    harness.window.TrainingApp.features.search.activate();
    await harness.settle();
    assert.equal(harness.requests.length, 1);
    assert.equal(harness.requests[0].sort_by, "date");
    assert.equal(harness.requests[0].sort_direction, "desc");
    assert.equal(harness.requests[0].limit, 50);
    assert.equal(harness.requests[0].offset, 0);
    assert.equal(harness.requests[0].start_date, "");
    assert.equal(harness.requests[0].end_date, "");
    assert.equal(harness.elements.searchScope.textContent, "All history");
    assert.equal(harness.elements.searchPageStatus.textContent, "Showing 1–50 of 126 activities");
    assert.ok(harness.elements.searchSportType.children.some(option => option.value === "MountainBikeRide"
        && option.textContent === "Mountain Bike Ride"));
    assert.ok(harness.elements.searchSportType.children.some(option => option.value === "FutureSport"
        && option.textContent === "Future Sport"));
    assert.equal(harness.elements.searchNext.disabled, false);
    assert.match(descendantText(harness.elements.searchResults), /Local ride/);
    assert.equal(harness.getUrl().searchParams.get("search_sort_by"), "date");
    assert.equal(harness.getUrl().searchParams.get("search_sort_direction"), "desc");
    assert.equal(harness.getUrl().searchParams.has("sort"), false);
    assert.equal(harness.getUrl().searchParams.has("start_date"), false);

    harness.elements.searchStartDate.value = "2024-01-01";
    await harness.elements.searchStartDate.trigger("input");
    assert.equal(harness.elements.searchScope.textContent, "Date range incomplete");
    await harness.elements.searchForm.trigger("submit", { preventDefault() { } });
    assert.equal(harness.requests.length, 1, "an incomplete date range must not issue a request");
    assert.match(harness.elements.searchValidationMessage.textContent, /both a start date and an end date/);
    assert.match(descendantText(harness.elements.searchResults), /Local ride/, "validation must preserve prior rows");
    assert.equal(harness.elements.searchPageStatus.textContent, "Showing 1–50 of 126 activities");
    await harness.elements.searchNext.trigger("click");
    await harness.settle();
    assert.equal(harness.requests.at(-1).offset, 50, "Next must use the last valid result snapshot");

    harness.setResponse(async () => { throw new Error("offline"); });
    await harness.elements.searchForm.trigger("submit", { preventDefault() { } });
    await harness.settle();
    assert.match(harness.elements.searchStatus.textContent, /temporarily unavailable/);
    assert.match(descendantText(harness.elements.searchResults), /Local ride/, "request errors must preserve prior rows");
    assert.equal(harness.elements.searchPageStatus.textContent, "Showing 51–100 of 126 activities");

    harness.getUrl().searchParams.set("start_date", "2024-01-01");
    harness.getUrl().searchParams.set("end_date", "2024-01-31");
    harness.getUrl().searchParams.set("keep", "1");
    harness.window.TrainingApp.features.search.restoreFromUrl();
    assert.equal(harness.elements.searchStartDate.value, "2024-01-01");
    assert.equal(harness.elements.searchEndDate.value, "2024-01-31");
    harness.window.TrainingApp.features.search.removeSearchParameters(harness.getUrl());
    assert.equal(harness.getUrl().searchParams.has("start_date"), false);
    assert.equal(harness.getUrl().searchParams.has("sort"), false);
    assert.equal(harness.getUrl().searchParams.get("keep"), "1");

    harness.setResponse(async () => ({ items: [], total_count: 0 }));
    harness.elements.searchStartDate.value = "";
    harness.elements.searchEndDate.value = "";
    await harness.elements.searchForm.trigger("submit", { preventDefault() { } });
    await harness.settle();
    assert.match(descendantText(harness.elements.searchResults), /No activities match these filters/);
    assert.equal(harness.elements.searchPageStatus.textContent, "0 activities");
    assert.equal(harness.elements.searchNext.disabled, true);

    assert.ok(harness.elements.searchGearId.children.some(option => option.textContent === "Trail Bike"));
    harness.elements.searchGearId.value = "3";
    await harness.elements.searchGearId.trigger("change");
    assert.equal(harness.elements.searchGearId.value, "3", "reading a changed gear selection must not overwrite it");
    harness.setResponse(async () => ({ items: [], total_count: 0 }));
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

    harness.elements.searchSportType.value = "MountainBikeRide";
    await harness.elements.searchSportType.trigger("change");
    await harness.elements.searchForm.trigger("submit", { preventDefault() { } });
    await harness.settle();
    const typeChip = harness.elements.searchActiveFilters.children.find(chip => /Activity type: Mountain Bike Ride/.test(chip.textContent));
    assert.ok(typeChip, "friendly activity type filters should be removable chips");
    assert.equal(harness.requests.at(-1).sport_type, "MountainBikeRide");
    await typeChip.trigger("click");
    await harness.settle();
    assert.equal(harness.requests.at(-1).sport_type, "");

    harness.elements.searchText.value = "temporary filter";
    await harness.elements.searchClear.trigger("click");
    await harness.settle();
    assert.equal(harness.requests.at(-1).text, "");
    assert.equal(harness.requests.at(-1).sort_by, "date");
    assert.equal(harness.requests.at(-1).sort_direction, "desc");
    assert.equal(harness.requests.at(-1).limit, 50);
    assert.equal(harness.requests.at(-1).offset, 0);
    assert.equal(harness.elements.searchText.value, "");
    assert.equal(harness.elements.searchScope.textContent, "All history");

    const restored = createSearchHarness("http://localhost/?tab=search&search_text=climb&search_start_date=2024-02-01&search_end_date=2024-02-29&search_sort_by=load&search_sort_direction=asc&search_limit=25&search_offset=25&keep=1");
    restored.setResponse(async () => ({ items: Array(25).fill({ name: "Climb" }), total_count: 100 }));
    restored.window.TrainingApp.features.search.activate();
    await restored.settle();
    assert.equal(restored.requests[0].text, "climb");
    assert.equal(restored.requests[0].start_date, "2024-02-01");
    assert.equal(restored.requests[0].end_date, "2024-02-29");
    assert.equal(restored.requests[0].sort_by, "load");
    assert.equal(restored.requests[0].sort_direction, "asc");
    assert.equal(restored.requests[0].limit, 25);
    assert.equal(restored.requests[0].offset, 25);
    assert.equal(restored.getUrl().searchParams.get("keep"), "1");
    assert.equal(restored.getUrl().searchParams.has("text"), false);
    assert.equal(restored.getUrl().searchParams.get("search_sort_by"), "load");

    const legacySort = createSearchHarness("http://localhost/?tab=search&sort=oldest");
    legacySort.setResponse(async () => ({ items: [], total_count: 0 }));
    legacySort.window.TrainingApp.features.search.activate();
    await legacySort.settle();
    assert.equal(legacySort.requests[0].sort_by, "date");
    assert.equal(legacySort.requests[0].sort_direction, "asc");
    assert.equal(legacySort.getUrl().searchParams.get("search_sort_by"), "date");
    assert.equal(legacySort.getUrl().searchParams.get("search_sort_direction"), "asc");
    assert.equal(legacySort.getUrl().searchParams.has("sort"), false);

    const sortableColumns = [
        ["Date", "date"], ["Start", "start"], ["Activity", "activity"],
        ["Type", "type"], ["Bike", "bike"],
        ["Distance", "distance"], ["Elevation", "elevation"],
        ["Moving", "moving"], ["Elapsed", "elapsed"], ["Load", "load"],
    ];
    const sorting = createSearchHarness();
    sorting.setResponse(async () => ({ items: [], total_count: 0 }));
    sorting.window.TrainingApp.features.search.activate();
    await sorting.settle();
    assert.equal(tableRows(sorting.elements.searchResults)[0].children[0].colSpan, 10, "empty state should span all Search columns");
    sorting.elements.searchText.value = "tempo";
    await sorting.elements.searchText.trigger("input");
    const headers = descendants(sorting.elements.searchResults).filter(element => element.tagName === "TH");
    assert.equal(headers.length, 10);
    assert.equal(headers.some(header => header.textContent === "Category"), false);
    assert.equal(headers.some(header => descendantText(header).includes("Actions")), false);
    assert.ok(headers.every(header => header.className === "search-sortable-header"));
    assert.equal(sortableColumns.length, 10);
    for (const [label, sortBy] of sortableColumns) {
        const initialButton = sortButton(sorting.elements.searchResults, label);
        assert.ok(initialButton, `${label} should be sortable`);
        assert.match(descendantText(initialButton), /[↓↑]/, `${label} should show a direction arrow`);
        if (label === "Start") {
            assert.deepEqual(initialButton.children.map(child => child.className), ["search-sort-label", "search-sort-indicator"]);
        }
        const firstDirection = sortBy === "date" ? "asc" : "desc";
        await initialButton.trigger("click");
        assert.equal(sorting.requests.at(-1).sort_by, sortBy);
        assert.equal(sorting.requests.at(-1).sort_direction, firstDirection);
        assert.equal(sorting.requests.at(-1).text, "tempo", "sorting must preserve filters");
        assert.equal(sorting.getUrl().searchParams.get("search_sort_by"), sortBy);
        assert.equal(sorting.getUrl().searchParams.get("search_sort_direction"), firstDirection);
        let activeHeader = descendants(sorting.elements.searchResults).find(element =>
            element.tagName === "TH" && element.children.some(child =>
                child.className.includes("search-sort") && child.children.some(labelElement =>
                    labelElement.className === "search-sort-label" && labelElement.textContent === label)));
        assert.equal(activeHeader.attributes["aria-sort"], firstDirection === "desc" ? "descending" : "ascending");
        const secondButton = sortButton(sorting.elements.searchResults, label);
        await secondButton.trigger("click");
        const secondDirection = firstDirection === "desc" ? "asc" : "desc";
        assert.equal(sorting.requests.at(-1).sort_by, sortBy);
        assert.equal(sorting.requests.at(-1).sort_direction, secondDirection);
        activeHeader = descendants(sorting.elements.searchResults).find(element =>
            element.tagName === "TH" && element.children.some(child =>
                child.className.includes("search-sort") && child.children.some(labelElement =>
                    labelElement.className === "search-sort-label" && labelElement.textContent === label)));
        assert.equal(activeHeader.attributes["aria-sort"], secondDirection === "desc" ? "descending" : "ascending");
    }

    const invalidInitial = createSearchHarness("http://localhost/?tab=search&search_start_date=2024-01-01");
    invalidInitial.window.TrainingApp.features.search.activate();
    await invalidInitial.settle();
    assert.equal(invalidInitial.requests.length, 0, "an incomplete initial date range must not request results");
    assert.equal(tableRows(invalidInitial.elements.searchResults)[0].children[0].colSpan, 10, "validation placeholder should span all Search columns");

    const failedInitial = createSearchHarness();
    failedInitial.setResponse(async () => { throw new Error("offline"); });
    failedInitial.window.TrainingApp.features.search.activate();
    await failedInitial.settle();
    assert.equal(tableRows(failedInitial.elements.searchResults)[0].children[0].colSpan, 10, "request-error placeholder should span all Search columns");

    const actions = createSearchHarness();
    actions.setResponse(async () => ({
        items: [
            {
                activity_id: 12345,
                name: "Local ride",
                date_local: "2024-04-03",
                start_at_local: "2024-04-03T15:20:00",
                sport_type: "MountainBikeRide",
            },
            {
                activity_id: 12346,
                name: "Second ride",
                date_local: "2024-04-04",
                sport_type: "Ride",
            },
        ],
        total_count: 2,
    }));
    actions.window.TrainingApp.features.search.activate();
    await actions.settle();
    const resultRows = tableRows(actions.elements.searchResults);
    assert.equal(resultRows.length, 2);
    assert.ok(resultRows.every(row => row.children.length === 10), "each result row should have ten data cells and no Actions cell");
    for (const [index, row] of resultRows.entries()) {
        const dateCell = row.children[0];
        const dateContent = dateCell.children[0];
        assert.equal(dateContent.className, "search-date-cell-content");
        assert.equal(dateContent.children[0].className, "search-date-value");
        assert.equal(dateContent.children[0].textContent, index === 0 ? "2024-04-03" : "2024-04-04");
        assert.equal(dateContent.children[1].className, "search-actions-toggle");
    }
    assert.equal(resultRows[0].children[1].textContent, "3:20 PM", "Start values should retain 12-hour formatting");
    const actionsButtons = descendants(actions.elements.searchResults)
        .filter(element => element.className.includes("search-actions-toggle"));
    assert.equal(actionsButtons.length, 2, "each result row should have one compact actions trigger");
    assert.deepEqual(actionsButtons.map(button => button.textContent), ["⋮", "⋮"]);
    for (const [index, button] of actionsButtons.entries()) {
        assert.equal(button.tagName, "BUTTON");
        assert.equal(button.attributes["aria-label"], `Activity actions for ${index === 0 ? "Local ride" : "Second ride"}`);
        assert.equal(button.attributes["aria-haspopup"], "menu");
        assert.equal(button.attributes["aria-expanded"], "false");
        assert.equal(button.attributes["aria-controls"], "search-actions-menu");
    }
    const actionsButton = actionsButtons[0];
    const requestsBeforeMenu = actions.requests.length;
    await actionsButton.keyboardActivate("Enter");
    assert.equal(actionsButton.attributes["aria-expanded"], "true");
    assert.equal(actions.requests.length, requestsBeforeMenu, "opening the date-cell menu must not activate Date sorting");
    assert.equal(actions.window.AppState.activeTab, "search", "opening the menu must not navigate to Daily");
    assert.equal(actions.getUrl().searchParams.has("date"), false, "opening the menu must not navigate to a date");
    let menu = actions.body.children.find(element => element.attributes.role === "menu");
    assert.ok(menu, "Actions menu should be portalled outside the scrollable results table");
    assert.ok(Number.parseFloat(menu.style.left) >= 8, "the portalled menu should stay within the viewport's left edge");
    const editLink = menu.children.find(element => element.tagName === "A");
    assert.equal(editLink.href, "https://www.strava.com/activities/12345/edit");
    assert.equal(editLink.target, "_blank");
    assert.equal(editLink.rel, "noopener noreferrer");
    assert.deepEqual(menu.children.map(element => element.textContent), [
        "Edit in Strava", "Resync activity", "Open Daily",
    ]);
    actions.document.activeElement = menu.children[0];
    let preventedArrow = false;
    await menu.trigger("keydown", { key: "ArrowDown", preventDefault() { preventedArrow = true; } });
    assert.equal(preventedArrow, true);
    assert.equal(menu.children[1].focused, true);
    await actionsButtons[1].keyboardActivate(" ");
    assert.equal(actions.body.children.length, 1, "opening another row should close the first menu");
    assert.equal(actionsButton.attributes["aria-expanded"], "false");
    assert.equal(actionsButtons[1].attributes["aria-expanded"], "true");
    menu = actions.body.children[0];
    await actions.document.trigger("keydown", { key: "Escape", preventDefault() { this.prevented = true; } });
    assert.equal(actions.body.children.length, 0, "Escape should close the menu");
    assert.equal(actionsButtons[1].focused, true, "Escape should return focus to the menu button");

    await actionsButton.keyboardActivate(" ");
    menu = actions.body.children[0];
    await actions.document.trigger("click", { target: new FakeElement("div") });
    assert.equal(actions.body.children.length, 0, "outside clicks should close the menu");
    assert.equal(actionsButton.attributes["aria-expanded"], "false");

    await actionsButton.trigger("click");
    menu = actions.body.children[0];
    await menu.children.find(element => element.textContent === "Open Daily").trigger("click");
    assert.equal(actions.window.AppState.dailyExactDate, "2024-04-03");
    assert.equal(actions.getUrl().searchParams.get("date"), "2024-04-03");
    actions.window.AppState.activeTab = "search";

    await actionsButton.trigger("click");
    menu = actions.body.children[0];
    await menu.children.find(element => element.textContent === "Resync activity").trigger("click");
    await actions.settle();
    assert.deepEqual(actions.confirmations, ["Queue a refresh for activity 12345 from Strava?"]);
    assert.deepEqual(actions.resyncCalls, ["12345"], "one row action should enqueue exactly one activity");
    assert.deepEqual(actions.statusCalls, [9001]);
    assert.equal(actions.requests.length, 2, "successful refresh should rerun the current Search query");
    assert.equal(actions.requests[1].sport_type, "");
    assert.equal(actions.elements.searchStatus.textContent, "Activity refreshed from Strava.");
    assert.equal(actions.elements.searchStatus.dataset.state, "success");
    assert.equal(actions.body.children.length, 0, "the menu should close before queueing and polling");

    const unknownType = createSearchHarness("http://localhost/?tab=search&search_sport_type=UnmappedActivityType&search_activity_category=run&activity_category=run");
    unknownType.window.TrainingApp.features.search.activate();
    await unknownType.settle();
    assert.equal(unknownType.elements.searchSportType.value, "UnmappedActivityType");
    assert.ok(unknownType.elements.searchSportType.children.some(option => option.value === "UnmappedActivityType"));
    assert.equal(unknownType.requests[0].sport_type, "UnmappedActivityType");
    assert.equal(unknownType.requests[0].activity_category, undefined);
    assert.equal(unknownType.getUrl().searchParams.has("search_activity_category"), false);
    assert.equal(unknownType.getUrl().searchParams.has("activity_category"), false);

    const unsafeActivity = createSearchHarness();
    unsafeActivity.setResponse(async () => ({
        items: [{ activity_id: "12/34", name: "Unsafe id", date_local: "2024-04-03" }],
        total_count: 1,
    }));
    unsafeActivity.window.TrainingApp.features.search.activate();
    await unsafeActivity.settle();
    const unsafeButton = descendants(unsafeActivity.elements.searchResults)
        .find(element => element.className.includes("search-actions-toggle"));
    assert.equal(tableRows(unsafeActivity.elements.searchResults)[0].children.length, 10);
    await unsafeButton.trigger("click");
    const unsafeMenu = unsafeActivity.body.children[0];
    assert.equal(unsafeMenu.children.some(element => element.tagName === "A"), false);
    assert.equal(unsafeMenu.children[0].textContent, "Edit in Strava");
    assert.equal(unsafeMenu.children[0].disabled, true);
    assert.equal(unsafeMenu.children.find(element => element.textContent === "Resync activity").disabled, true);

    const pagination = createSearchHarness();
    pagination.setResponse(async query => ({
        items: Array.from({ length: query.offset === 100 ? 26 : 50 }, (_, index) => ({ name: `Activity ${query.offset + index + 1}` })),
        total_count: 126,
    }));
    pagination.window.TrainingApp.features.search.activate();
    await pagination.settle();
    assert.equal(pagination.elements.searchPageStatus.textContent, "Showing 1–50 of 126 activities");
    await pagination.elements.searchNext.trigger("click");
    await pagination.settle();
    assert.equal(pagination.requests.at(-1).offset, 50);
    assert.equal(pagination.elements.searchPageStatus.textContent, "Showing 51–100 of 126 activities");
    await pagination.elements.searchNext.trigger("click");
    await pagination.settle();
    assert.equal(pagination.requests.at(-1).offset, 100);
    assert.equal(pagination.elements.searchPageStatus.textContent, "Showing 101–126 of 126 activities");
    assert.equal(pagination.elements.searchNext.disabled, true);
    await pagination.elements.searchPrevious.trigger("click");
    await pagination.settle();
    assert.equal(pagination.requests.at(-1).offset, 50);

    const singleResult = createSearchHarness();
    singleResult.setResponse(async () => ({ items: [{ name: "Solo" }], total_count: 1 }));
    singleResult.window.TrainingApp.features.search.activate();
    await singleResult.settle();
    assert.equal(singleResult.elements.searchPageStatus.textContent, "Showing 1 of 1 activity");
    assert.equal(singleResult.elements.searchNext.disabled, true);

    const staleOffset = createSearchHarness("http://localhost/?tab=search&search_offset=250");
    staleOffset.setResponse(async query => query.offset === 250
        ? { items: [], total_count: 75 }
        : { items: Array(50).fill({ name: "Recovered" }), total_count: 75 });
    staleOffset.window.TrainingApp.features.search.activate();
    await staleOffset.settle();
    assert.deepEqual(staleOffset.requests.map(query => query.offset), [250, 0]);
    assert.equal(staleOffset.getUrl().searchParams.get("search_offset"), "0");
    assert.equal(staleOffset.elements.searchPageStatus.textContent, "Showing 1–50 of 75 activities");

    const staleEmptyOffset = createSearchHarness("http://localhost/?tab=search&search_offset=250");
    staleEmptyOffset.setResponse(async () => ({ items: [], total_count: 0 }));
    staleEmptyOffset.window.TrainingApp.features.search.activate();
    await staleEmptyOffset.settle();
    assert.deepEqual(staleEmptyOffset.requests.map(query => query.offset), [250, 0]);
    assert.equal(staleEmptyOffset.elements.searchPageStatus.textContent, "0 activities");

    const restoredGear = createSearchHarness("http://localhost/?tab=search&search_gear_id=3");
    restoredGear.window.TrainingApp.features.search.activate();
    await restoredGear.settle();
    assert.equal(restoredGear.requests[0].gear_id, "3");
    assert.match(restoredGear.elements.searchActiveFilters.children[0].textContent, /^Bike: Trail Bike ×$/);

    const lateGear = createSearchHarness("http://localhost/?tab=search&search_gear_id=3");
    lateGear.window.AppState.gearRows = [];
    lateGear.window.TrainingApp.features.search.activate();
    await lateGear.settle();
    assert.match(lateGear.elements.searchActiveFilters.children[0].textContent, /^Bike: 3 ×$/);
    lateGear.window.AppState.gearRows = [{ gear_id: 3, gear_name: "Rallon" }];
    lateGear.window.TrainingApp.features.search.refreshGearOptions();
    assert.match(lateGear.elements.searchActiveFilters.children[0].textContent, /^Bike: Rallon ×$/);

    const legacyGear = createSearchHarness("http://localhost/?tab=search&gear_id=3");
    legacyGear.window.TrainingApp.features.search.activate();
    await legacyGear.settle();
    assert.equal(legacyGear.requests[0].gear_id, "3");
    assert.equal(legacyGear.getUrl().searchParams.get("search_gear_id"), "3");
    assert.equal(legacyGear.getUrl().searchParams.has("gear_id"), false);

    const unknownGear = createSearchHarness("http://localhost/?tab=search&search_gear_id=retired-bike");
    unknownGear.window.AppState.gearRows = [];
    unknownGear.window.TrainingApp.features.search.activate();
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
    let requestedOptions = {};
    global.fetch = async (url, options = {}) => {
        requestedUrl = String(url);
        requestedOptions = options;
        return { ok: true, json: async () => ({ items: [] }) };
    };
    require("../static/api.js");
    await global.window.api.searchActivities({
        text: "Floyd Hill",
        start_date: "2024-01-01",
        end_date: "2024-12-31",
        sort_by: "elevation",
        sort_direction: "desc",
        limit: 50,
        offset: 0,
        gear_id: "",
    });
    const params = new URL(`http://localhost${requestedUrl}`).searchParams;
    assert.equal(params.get("text"), "Floyd Hill");
    assert.equal(params.get("start_date"), "2024-01-01");
    assert.equal(params.get("end_date"), "2024-12-31");
    assert.equal(params.get("sort_by"), "elevation");
    assert.equal(params.get("sort_direction"), "desc");
    assert.equal(params.has("sort"), false);
    assert.equal(params.get("limit"), "50");
    assert.equal(params.get("offset"), "0");
    assert.equal(params.has("gear_id"), false);

    await global.window.api.fetchActivitySearchTypes();
    assert.equal(requestedUrl, "/api/activities/search/types");

    await global.window.api.resyncActivity("12345");
    assert.equal(requestedUrl, "/api/sync/activities/12345/resync");
    assert.equal(requestedOptions.method, "POST");
    assert.equal(requestedOptions.body, undefined);

    await global.window.api.fetchSyncRequestStatus(9001);
    assert.equal(requestedUrl, "/api/sync-requests/9001");

    await global.window.api.fetchDaily(60, "", "2012-07-15");
    assert.match(requestedUrl, /^\/api\/daily\?/);
    assert.equal(new URL(`http://localhost${requestedUrl}`).searchParams.get("date"), "2012-07-15");

    console.log("Activity Search UI contract tests passed.");
}

main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});