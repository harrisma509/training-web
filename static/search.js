function formatActivityLocalDate(value) {
    if (value === null || value === undefined || value === "") return "";
    return String(value).trim().split(/[T ]/, 1)[0];
}

function formatActivityLocalTime(value) {
    if (value === null || value === undefined || value === "") return "";
    const text = String(value).trim();
    const match = text.match(/(?:^|[T ])(\d{2}):(\d{2})/);
    return match ? `${match[1]}:${match[2]}` : text;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { formatActivityLocalDate, formatActivityLocalTime };
}

(function () {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const SORTS = new Set([
        "newest",
        "oldest",
        "start_time",
        "highest_elevation",
        "longest_distance",
        "longest_duration",
    ]);
    const FILTER_KEYS = [
        "text",
        "start_date",
        "end_date",
        "sport_type",
        "activity_category",
        "gear_id",
        "min_distance_mi",
        "max_distance_mi",
        "min_elevation_ft",
        "max_elevation_ft",
        "min_duration_sec",
        "max_duration_sec",
        "start_time_from",
        "start_time_to",
    ];
    const SEARCH_URL_KEYS = [...FILTER_KEYS, "search_gear_id", "sort", "limit", "offset"];
    const FILTER_LABELS = {
        text: "Activity",
        sport_type: "Sport",
        activity_category: "Category",
        gear_id: "Bike",
        min_distance_mi: "Distance min",
        max_distance_mi: "Distance max",
        min_elevation_ft: "Elevation min",
        max_elevation_ft: "Elevation max",
        min_duration_sec: "Moving time min",
        max_duration_sec: "Moving time max",
        start_time_from: "Start time from",
        start_time_to: "Start time to",
    };
    const RESULT_COLUMNS = [
        { label: "Date", key: "date_local", sort: "date" },
        { label: "Start", key: "start_at_local", sort: "start_time" },
        { label: "Activity", key: "name" },
        { label: "Type", key: "sport_type" },
        { label: "Category", key: "activity_category" },
        { label: "Bike", key: "gear_name" },
        { label: "Distance", key: "distance_mi", sort: "longest_distance" },
        { label: "Elevation", key: "elevation_ft", sort: "highest_elevation" },
        { label: "Moving", key: "moving_sec", sort: "longest_duration" },
        { label: "Elapsed", key: "elapsed_sec" },
        { label: "Load", key: "activity_load" },
        { label: "", key: "daily_action" },
    ];

    const state = {
        filters: Object.fromEntries(FILTER_KEYS.map(key => [key, ""])),
        sort: "newest",
        limit: 50,
        offset: 0,
        requestId: 0,
        initialized: false,
        resultState: "initial",
        lastResult: null,
    };

    function field(id) {
        return document.getElementById(id);
    }

    function text(value) {
        if (value === null || value === undefined || value === "") return "";
        return String(value);
    }

    function formatNumber(value, digits = 0) {
        if (value === null || value === undefined || value === "") return "";
        const number = Number(value);
        return Number.isFinite(number)
            ? new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(number)
            : "";
    }

    function formatDuration(value) {
        if (value === null || value === undefined || value === "") return "";
        const totalSeconds = Number(value);
        if (!Number.isFinite(totalSeconds) || totalSeconds < 0) return "";
        const seconds = Math.floor(totalSeconds);
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const remainder = seconds % 60;
        return hours > 0
            ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
            : `${minutes}:${String(remainder).padStart(2, "0")}`;
    }

    function formatCell(row, key) {
        const value = row[key];
        if (key === "date_local") return formatActivityLocalDate(value);
        if (key === "start_at_local") return formatActivityLocalTime(value);
        if (key === "distance_mi") {
            const result = formatNumber(value, 1);
            return result ? `${result} mi` : "";
        }
        if (key === "elevation_ft") {
            const result = formatNumber(value);
            return result ? `${result} ft` : "";
        }
        if (key === "moving_sec" || key === "elapsed_sec") return formatDuration(value);
        if (key === "activity_load") return formatNumber(value, 1);
        return text(value);
    }

    function readFromUrl() {
        const params = new URLSearchParams(window.location.search);
        FILTER_KEYS.forEach(key => {
            const urlKey = key === "gear_id" && params.has("search_gear_id") ? "search_gear_id" : key;
            state.filters[key] = params.get(urlKey) || "";
        });
        const sort = params.get("sort") || "newest";
        state.sort = SORTS.has(sort) ? sort : "newest";
        const limit = Number(params.get("limit"));
        state.limit = [25, 50, 100].includes(limit) ? limit : 50;
        const offset = Number(params.get("offset"));
        state.offset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
    }

    function removeSearchParameters(url) {
        SEARCH_URL_KEYS.forEach(key => url.searchParams.delete(key));
        return url;
    }

    function syncUrl(query = {}) {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", "search");
        url.searchParams.delete("date");
        removeSearchParameters(url);
        const filters = query.filters || state.filters;
        FILTER_KEYS.forEach(key => {
            const value = String(filters[key] || "").trim();
            if (value) url.searchParams.set(key === "gear_id" ? "search_gear_id" : key, value);
        });
        url.searchParams.set("sort", query.sort || state.sort);
        url.searchParams.set("limit", String(query.limit || state.limit));
        const offset = Number.isInteger(query.offset) ? query.offset : state.offset;
        if (offset > 0) url.searchParams.set("offset", String(offset));
        window.history.replaceState({}, "", url);
    }

    function populateGearOptions() {
        const select = field("searchGearId");
        if (!select) return;
        const selectedGearId = state.filters.gear_id;
        select.replaceChildren();
        const anyGear = document.createElement("option");
        anyGear.value = "";
        anyGear.textContent = "Any bike / gear";
        select.appendChild(anyGear);
        const rows = Array.isArray(window.AppState?.gearRows) ? window.AppState.gearRows : [];
        rows
            .filter(row => row && row.gear_id != null && String(row.gear_id).trim())
            .slice()
            .sort((left, right) => String(left.gear_name || "").localeCompare(String(right.gear_name || "")))
            .forEach(row => {
                const option = document.createElement("option");
                option.value = String(row.gear_id);
                option.textContent = String(row.gear_name || "").trim() || String(row.gear_id);
                select.appendChild(option);
            });
        if (selectedGearId && !rows.some(row => String(row?.gear_id || "") === selectedGearId)) {
            const option = document.createElement("option");
            option.value = selectedGearId;
            option.textContent = selectedGearId;
            select.appendChild(option);
        }
        select.value = selectedGearId;
    }

    function gearDisplayName(gearId) {
        const rows = Array.isArray(window.AppState?.gearRows) ? window.AppState.gearRows : [];
        const gear = rows.find(row => String(row?.gear_id ?? "") === String(gearId));
        return String(gear?.gear_name || "").trim() || String(gearId);
    }

    function syncInputs() {
        const ids = {
            text: "searchText",
            start_date: "searchStartDate",
            end_date: "searchEndDate",
            sport_type: "searchSportType",
            activity_category: "searchCategory",
            gear_id: "searchGearId",
            min_distance_mi: "searchMinDistance",
            max_distance_mi: "searchMaxDistance",
            min_elevation_ft: "searchMinElevation",
            max_elevation_ft: "searchMaxElevation",
            min_duration_sec: "searchMinDuration",
            max_duration_sec: "searchMaxDuration",
            start_time_from: "searchStartTimeFrom",
            start_time_to: "searchStartTimeTo",
        };
        populateGearOptions();
        Object.entries(ids).forEach(([key, id]) => {
            const input = field(id);
            if (input) input.value = state.filters[key];
        });
        if (field("searchSort")) field("searchSort").value = state.sort;
        if (field("searchLimit")) field("searchLimit").value = String(state.limit);
    }

    function collectInputs() {
        const ids = {
            text: "searchText",
            start_date: "searchStartDate",
            end_date: "searchEndDate",
            sport_type: "searchSportType",
            activity_category: "searchCategory",
            gear_id: "searchGearId",
            min_distance_mi: "searchMinDistance",
            max_distance_mi: "searchMaxDistance",
            min_elevation_ft: "searchMinElevation",
            max_elevation_ft: "searchMaxElevation",
            min_duration_sec: "searchMinDuration",
            max_duration_sec: "searchMaxDuration",
            start_time_from: "searchStartTimeFrom",
            start_time_to: "searchStartTimeTo",
        };
        Object.entries(ids).forEach(([key, id]) => {
            state.filters[key] = String(field(id)?.value || "").trim();
        });
        state.sort = SORTS.has(field("searchSort")?.value) ? field("searchSort").value : "newest";
        const limit = Number(field("searchLimit")?.value);
        state.limit = [25, 50, 100].includes(limit) ? limit : 50;
        return {
            filters: { ...state.filters },
            sort: state.sort,
            limit: state.limit,
            offset: 0,
        };
    }

    function setStatus(message, kind = "") {
        const status = field("searchStatus");
        if (!status) return;
        status.textContent = message;
        status.dataset.state = kind;
    }

    function setValidationMessage(message = "") {
        const validation = field("searchValidationMessage");
        if (validation) validation.textContent = message;
    }

    function renderScope(filters = state.filters) {
        const scope = field("searchScope");
        if (!scope) return;
        scope.textContent = Boolean(filters.start_date) !== Boolean(filters.end_date)
            ? "Date range incomplete"
            : filters.start_date && filters.end_date
                ? `${filters.start_date} – ${filters.end_date}`
                : "All history";
    }

    function renderActiveFilters(filters = state.filters) {
        const container = field("searchActiveFilters");
        if (!container) return;
        container.replaceChildren();
        const active = [];
        if (filters.start_date && filters.end_date) {
            active.push({ key: "date_range", label: `${filters.start_date} – ${filters.end_date}` });
        }
        FILTER_KEYS.forEach(key => {
            if (key === "start_date" || key === "end_date" || !filters[key]) return;
            let value = filters[key];
            if (key === "activity_category") value = value[0].toUpperCase() + value.slice(1);
            if (key === "gear_id") value = gearDisplayName(value);
            active.push({ key, label: `${FILTER_LABELS[key]}: ${value}` });
        });
        active.forEach(({ key, label }) => {
            const chip = document.createElement("button");
            chip.type = "button";
            chip.className = "search-chip";
            chip.textContent = `${label} ×`;
            chip.setAttribute("aria-label", `Remove ${label} filter`);
            chip.addEventListener("click", () => {
                if (key === "date_range") {
                    state.filters.start_date = "";
                    state.filters.end_date = "";
                } else {
                    state.filters[key] = "";
                }
                const query = {
                    filters: { ...state.filters },
                    sort: state.sort,
                    limit: state.limit,
                    offset: 0,
                };
                syncInputs();
                syncUrl(query);
                loadResults(query);
            });
            container.appendChild(chip);
        });
        renderScope(filters);
    }

    function makeSortButton(column) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-sort";
        button.textContent = column.label;
        button.setAttribute("aria-label", `Sort by ${column.label}`);
        button.addEventListener("click", () => {
            const query = collectInputs();
            if (column.sort === "date") {
                query.sort = query.sort === "newest" ? "oldest" : "newest";
            } else {
                query.sort = column.sort;
            }
            state.sort = query.sort;
            if (field("searchSort")) field("searchSort").value = query.sort;
            syncUrl(query);
            loadResults(query);
        });
        return button;
    }

    function renderRows(items, mode = "results") {
        const table = field("searchResults");
        if (!table) return;
        table.replaceChildren();
        const head = document.createElement("thead");
        const headerRow = document.createElement("tr");
        RESULT_COLUMNS.forEach(column => {
            const header = document.createElement("th");
            if (column.sort) {
                header.appendChild(makeSortButton(column));
                if ((column.sort === "date" && ["newest", "oldest"].includes(state.sort))
                    || column.sort === state.sort) {
                    header.setAttribute("aria-sort", state.sort === "oldest" || state.sort === "start_time"
                        ? "ascending"
                        : "descending");
                }
            } else {
                header.textContent = column.label;
            }
            headerRow.appendChild(header);
        });
        head.appendChild(headerRow);
        table.appendChild(head);

        const body = document.createElement("tbody");
        if (mode !== "results" || !items.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = RESULT_COLUMNS.length;
            cell.className = "search-empty";
            cell.textContent = mode === "empty"
                ? "No activities match these filters."
                : "Run a search to see activities.";
            row.appendChild(cell);
            body.appendChild(row);
            table.appendChild(body);
            return;
        }
        items.forEach(row => {
            const tr = document.createElement("tr");
            RESULT_COLUMNS.forEach(column => {
                const cell = document.createElement("td");
                if (column.key === "name" && row.activity_id != null && /^\d+$/.test(String(row.activity_id))) {
                    const link = document.createElement("a");
                    link.className = "activity-link";
                    link.href = `https://www.strava.com/activities/${encodeURIComponent(row.activity_id)}`;
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                    link.textContent = text(row.name);
                    cell.appendChild(link);
                } else if (column.key === "daily_action") {
                    const button = document.createElement("button");
                    button.type = "button";
                    button.className = "button-secondary small";
                    button.textContent = "Daily";
                    button.disabled = !formatActivityLocalDate(row.date_local);
                    button.setAttribute("aria-label", `Open ${formatActivityLocalDate(row.date_local) || "activity date"} in Daily`);
                    button.addEventListener("click", () => openDailyDate(row.date_local));
                    cell.appendChild(button);
                } else {
                    cell.textContent = formatCell(row, column.key);
                }
                tr.appendChild(cell);
            });
            body.appendChild(tr);
        });
        table.appendChild(body);
    }

    function updatePagination(result = state.lastResult) {
        const pageStatus = field("searchPageStatus");
        const previous = field("searchPrevious");
        const next = field("searchNext");
        if (!result || !result.items.length) {
            if (pageStatus) pageStatus.textContent = "";
            if (previous) previous.disabled = true;
            if (next) next.disabled = true;
            return;
        }
        const { offset, items, has_more: hasMore, next_offset: nextOffset } = result;
        const first = offset + 1;
        const last = offset + items.length;
        const moreText = hasMore ? " · More activities available" : "";
        if (pageStatus) pageStatus.textContent = `Showing ${first}–${last}${moreText}`;
        if (previous) previous.disabled = offset === 0;
        if (next) next.disabled = !hasMore || nextOffset === null;
    }

    function validateQuery(query) {
        const startDate = query.filters.start_date;
        const endDate = query.filters.end_date;
        if (Boolean(startDate) !== Boolean(endDate)) {
            return "Choose both a start date and an end date, or leave both blank.";
        }
        if (startDate && endDate && startDate > endDate) {
            return "Start date must be on or before end date.";
        }
        return "";
    }

    async function loadResults(query = {
        filters: { ...state.filters },
        sort: state.sort,
        limit: state.limit,
        offset: state.offset,
    }) {
        const requestId = ++state.requestId;
        state.filters = { ...query.filters };
        state.sort = query.sort;
        state.limit = query.limit;
        state.offset = query.offset;
        renderActiveFilters(query.filters);
        if (window.AppState?.activeTab === "search") syncUrl(query);

        const validationMessage = validateQuery(query);
        if (validationMessage) {
            state.resultState = "validation-error";
            setValidationMessage(validationMessage);
            setStatus(state.lastResult ? "Last valid results remain shown." : "", state.lastResult ? "stale" : "");
            if (!state.lastResult) renderRows([], "initial");
            updatePagination(state.lastResult);
            return false;
        }

        setValidationMessage("");
        state.resultState = "loading";
        setStatus(state.lastResult ? "Searching · previous results remain shown." : "Searching activities…", "loading");
        try {
            const payload = await window.api.searchActivities({
                ...query.filters,
                sort: query.sort,
                limit: query.limit,
                offset: query.offset,
            });
            if (requestId !== state.requestId) return false;
            const items = Array.isArray(payload?.items) ? payload.items : [];
            const result = {
                items,
                returned_count: items.length,
                offset: query.offset,
                limit: query.limit,
                has_more: Boolean(payload?.has_more),
                next_offset: Number.isInteger(payload?.next_offset) ? payload.next_offset : null,
                query: {
                    filters: { ...query.filters },
                    sort: query.sort,
                    limit: query.limit,
                    offset: query.offset,
                },
            };
            state.lastResult = result;
            state.resultState = items.length ? "valid-results" : "valid-empty";
            renderRows(items, items.length ? "results" : "empty");
            renderActiveFilters(query.filters);
            updatePagination(result);
            setStatus("", "ready");
            const filtersPanel = document.querySelector(".search-filters");
            if (filtersPanel && !field("searchKeepFiltersOpen")?.checked) filtersPanel.open = false;
            return true;
        } catch (error) {
            if (requestId !== state.requestId) return false;
            state.resultState = "request-error";
            setStatus(error?.status === 422
                ? "Check the date range and filter values."
                : "Search is temporarily unavailable.", "error");
            if (!state.lastResult) renderRows([], "initial");
            updatePagination(state.lastResult);
            return false;
        }
    }

    function openDailyDate(value) {
        const date = formatActivityLocalDate(value);
        if (!date) return;
        window.AppState.dailyExactDate = date;
        window.AppState.dailyAppliedQuery = "";
        window.AppState.dailyDraftQuery = "";
        window.AppState.dailySearchMatchCount = 0;
        window.AppState.dailySearchTotalCount = 0;
        window.showTab("daily");
        const url = new URL(window.location.href);
        url.searchParams.set("date", date);
        window.history.replaceState({}, "", url);
        window.DailyController?.load();
    }

    function submitSearch(event) {
        event?.preventDefault();
        const query = collectInputs();
        syncUrl(query);
        loadResults(query);
    }

    function clearSearch() {
        FILTER_KEYS.forEach(key => { state.filters[key] = ""; });
        state.sort = "newest";
        state.limit = 50;
        state.offset = 0;
        state.requestId += 1;
        state.lastResult = null;
        state.resultState = "initial";
        setValidationMessage("");
        setStatus("", "");
        if (field("searchKeepFiltersOpen")) field("searchKeepFiltersOpen").checked = false;
        syncInputs();
        const query = { filters: { ...state.filters }, sort: state.sort, limit: state.limit, offset: 0 };
        syncUrl(query);
        renderRows([], "initial");
        updatePagination(null);
        loadResults(query);
    }

    function queryMatches(left, right) {
        return Boolean(left && right)
            && JSON.stringify(left.filters) === JSON.stringify(right.filters)
            && left.sort === right.sort
            && left.limit === right.limit
            && left.offset === right.offset;
    }

    function activate() {
        if (!state.initialized) {
            readFromUrl();
            state.initialized = true;
        }
        syncInputs();
        const query = {
            filters: { ...state.filters },
            sort: state.sort,
            limit: state.limit,
            offset: state.offset,
        };
        syncUrl(query);
        renderActiveFilters(query.filters);
        if (!queryMatches(query, state.lastResult?.query)) {
            loadResults(query);
        } else {
            setValidationMessage("");
            updatePagination(state.lastResult);
        }
    }

    function openAdvancedSearch(values = {}) {
        FILTER_KEYS.forEach(key => { state.filters[key] = ""; });
        state.filters.text = String(values.text || "").trim();
        if (values.start_date && values.end_date) {
            state.filters.start_date = String(values.start_date);
            state.filters.end_date = String(values.end_date);
        }
        state.sort = "newest";
        state.limit = 50;
        state.offset = 0;
        state.initialized = true;
        state.lastResult = null;
        state.resultState = "initial";
        setValidationMessage("");
        setStatus("", "");
        syncInputs();
        renderRows([], "initial");
        updatePagination(null);
        window.showTab("search");
    }

    function restoreFromUrl() {
        readFromUrl();
        state.initialized = true;
        syncInputs();
        renderActiveFilters(state.filters);
    }

    function attach() {
        const form = field("searchForm");
        if (!form) return;
        form.addEventListener("submit", submitSearch);
        form.querySelectorAll("input, select").forEach(control => {
            control.addEventListener("input", captureDraft);
            control.addEventListener("change", captureDraft);
        });
        field("searchClear")?.addEventListener("click", clearSearch);
        field("searchPrevious")?.addEventListener("click", () => {
            if (!state.lastResult) return;
            loadPage(Math.max(0, state.lastResult.offset - state.lastResult.limit));
        });
        field("searchNext")?.addEventListener("click", () => {
            if (!state.lastResult?.has_more || state.lastResult.next_offset === null) return;
            loadPage(state.lastResult.next_offset);
        });
        field("searchSort")?.addEventListener("change", () => {
            const query = collectInputs();
            syncUrl(query);
            loadResults(query);
        });
        field("searchLimit")?.addEventListener("change", () => {
            const query = collectInputs();
            syncUrl(query);
            loadResults(query);
        });
    }

    function captureDraft() {
        const query = collectInputs();
        state.offset = 0;
        renderActiveFilters(query.filters);
        if (window.AppState?.activeTab === "search") syncUrl(query);
        if (state.resultState === "loading") {
            state.requestId += 1;
            state.resultState = state.lastResult
                ? state.lastResult.items.length ? "valid-results" : "valid-empty"
                : "initial";
            setStatus(state.lastResult ? "Last valid results remain shown." : "", state.lastResult ? "stale" : "");
        }
    }

    function loadPage(offset) {
        if (!state.lastResult) {
            renderRows([], "initial");
            updatePagination(null);
        }
        if (!state.lastResult) return;
        const query = {
            ...state.lastResult.query,
            offset,
            filters: { ...state.lastResult.query.filters },
        };
        state.filters = { ...query.filters };
        state.sort = query.sort;
        state.limit = query.limit;
        state.offset = query.offset;
        syncInputs();
        setValidationMessage("");
        syncUrl(query);
        loadResults(query);
    }

    window.SearchController = {
        activate,
        openAdvancedSearch,
        removeSearchParameters,
        refreshGearOptions() {
            populateGearOptions();
            renderActiveFilters();
        },
        restoreFromUrl,
    };
    attach();
})();