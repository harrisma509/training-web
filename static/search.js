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
        nextOffset: null,
        hasMore: false,
        requestId: 0,
        activated: false,
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
            state.filters[key] = params.get(key) || "";
        });
        const sort = params.get("sort") || "newest";
        state.sort = SORTS.has(sort) ? sort : "newest";
        const limit = Number(params.get("limit"));
        state.limit = [25, 50, 100].includes(limit) ? limit : 50;
        const offset = Number(params.get("offset"));
        state.offset = Number.isInteger(offset) && offset >= 0 ? offset : 0;
        state.nextOffset = null;
        state.hasMore = false;
    }

    function syncUrl() {
        const url = new URL(window.location.href);
        url.searchParams.set("tab", "search");
        url.searchParams.delete("date");
        FILTER_KEYS.forEach(key => {
            const value = String(state.filters[key] || "").trim();
            if (value) url.searchParams.set(key, value);
            else url.searchParams.delete(key);
        });
        url.searchParams.set("sort", state.sort);
        url.searchParams.set("limit", String(state.limit));
        if (state.offset > 0) url.searchParams.set("offset", String(state.offset));
        else url.searchParams.delete("offset");
        window.history.replaceState({}, "", url);
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
        Object.entries(ids).forEach(([key, id]) => {
            const input = field(id);
            if (input) input.value = state.filters[key];
        });
        if (field("searchSort")) field("searchSort").value = state.sort;
        if (field("searchLimit")) field("searchLimit").value = String(state.limit);
        const filters = document.querySelector(".activity-search-filters");
        if (filters) {
            filters.open = FILTER_KEYS.slice(3).some(key => Boolean(state.filters[key]));
        }
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
        state.offset = 0;
    }

    function setStatus(message, kind = "") {
        const status = field("searchStatus");
        if (!status) return;
        status.textContent = message;
        status.dataset.state = kind;
    }

    function makeSortButton(column) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "activity-search-sort";
        button.textContent = column.label;
        button.setAttribute("aria-label", `Sort by ${column.label}`);
        button.addEventListener("click", () => {
            if (column.sort === "date") {
                state.sort = state.sort === "newest" ? "oldest" : "newest";
            } else {
                state.sort = column.sort;
            }
            state.offset = 0;
            if (field("searchSort")) field("searchSort").value = state.sort;
            syncUrl();
            loadResults();
        });
        return button;
    }

    function renderRows(items) {
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
        if (!items.length) {
            const row = document.createElement("tr");
            const cell = document.createElement("td");
            cell.colSpan = RESULT_COLUMNS.length;
            cell.className = "activity-search-empty";
            cell.textContent = "No activities match these filters.";
            row.appendChild(cell);
            body.appendChild(row);
        }
        table.appendChild(body);
    }

    function updatePagination(returnedCount) {
        const first = returnedCount ? state.offset + 1 : 0;
        const last = state.offset + returnedCount;
        const moreText = state.hasMore ? "; more results available" : "";
        const pageStatus = field("searchPageStatus");
        if (pageStatus) pageStatus.textContent = `Showing ${first}–${last}${moreText}`;
        const previous = field("searchPrevious");
        const next = field("searchNext");
        if (previous) previous.disabled = state.offset === 0;
        if (next) next.disabled = !state.hasMore || state.nextOffset === null;
    }

    async function loadResults() {
        const dateStart = state.filters.start_date;
        const dateEnd = state.filters.end_date;
        if (Boolean(dateStart) !== Boolean(dateEnd)) {
            setStatus("Choose both a start date and an end date, or leave both blank.", "error");
            renderRows([]);
            updatePagination(0);
            return;
        }

        const requestId = ++state.requestId;
        setStatus("Searching activities…", "loading");
        const previous = field("searchPrevious");
        const next = field("searchNext");
        if (previous) previous.disabled = true;
        if (next) next.disabled = true;

        try {
            const filters = { ...state.filters, sort: state.sort, limit: state.limit, offset: state.offset };
            const payload = await window.api.searchActivities(filters);
            if (requestId !== state.requestId) return;
            const items = Array.isArray(payload?.items) ? payload.items : [];
            if (!state.filters.start_date && !state.filters.end_date
                && !field("searchStartDate")?.value && !field("searchEndDate")?.value
                && payload?.applied_start_date && payload?.applied_end_date) {
                state.filters.start_date = String(payload.applied_start_date);
                state.filters.end_date = String(payload.applied_end_date);
                field("searchStartDate").value = state.filters.start_date;
                field("searchEndDate").value = state.filters.end_date;
                syncUrl();
            }
            state.hasMore = Boolean(payload?.has_more);
            state.nextOffset = Number.isInteger(payload?.next_offset) ? payload.next_offset : null;
            renderRows(items);
            updatePagination(items.length);
            const range = payload?.applied_start_date && payload?.applied_end_date
                ? ` · ${payload.applied_start_date} to ${payload.applied_end_date}`
                : "";
            setStatus(`${payload?.returned_count || 0} activities${range}`, "ready");
        } catch (error) {
            if (requestId !== state.requestId) return;
            renderRows([]);
            updatePagination(0);
            setStatus(error?.status === 422 ? "Check the date range and filter values." : "Search is temporarily unavailable.", "error");
        }
    }

    function openDailyDate(value) {
        const date = formatActivityLocalDate(value);
        if (!date) return;
        const url = new URL(window.location.href);
        url.searchParams.set("tab", "daily");
        url.searchParams.set("date", date);
        window.history.replaceState({}, "", url);
        window.AppState.dailyExactDate = date;
        window.AppState.dailyAppliedQuery = "";
        window.AppState.dailyDraftQuery = "";
        window.AppState.dailySearchMatchCount = 0;
        window.AppState.dailySearchTotalCount = 0;
        window.showTab("daily");
        window.DailyController?.load();
    }

    function submitSearch(event) {
        event?.preventDefault();
        collectInputs();
        syncUrl();
        loadResults();
    }

    function clearSearch() {
        FILTER_KEYS.forEach(key => { state.filters[key] = ""; });
        state.sort = "newest";
        state.limit = 50;
        state.offset = 0;
        syncInputs();
        syncUrl();
        loadResults();
    }

    function activate() {
        if (!state.activated) {
            readFromUrl();
            syncInputs();
            state.activated = true;
        }
        loadResults();
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
        state.activated = true;
        syncInputs();
        syncUrl();
        window.showTab("search");
    }

    function restoreFromUrl() {
        readFromUrl();
        syncInputs();
        state.activated = true;
    }

    function attach() {
        const form = field("searchForm");
        if (!form) return;
        form.addEventListener("submit", submitSearch);
        field("searchClear")?.addEventListener("click", clearSearch);
        field("searchPrevious")?.addEventListener("click", () => {
            state.offset = Math.max(0, state.offset - state.limit);
            syncUrl();
            loadResults();
        });
        field("searchNext")?.addEventListener("click", () => {
            if (!state.hasMore || state.nextOffset === null) return;
            state.offset = state.nextOffset;
            syncUrl();
            loadResults();
        });
        field("searchSort")?.addEventListener("change", () => {
            state.sort = SORTS.has(field("searchSort").value) ? field("searchSort").value : "newest";
            state.offset = 0;
            syncUrl();
            loadResults();
        });
        field("searchLimit")?.addEventListener("change", () => {
            const limit = Number(field("searchLimit").value);
            state.limit = [25, 50, 100].includes(limit) ? limit : 50;
            state.offset = 0;
            syncUrl();
            loadResults();
        });
    }

    window.SearchController = {
        activate,
        openAdvancedSearch,
        restoreFromUrl,
    };
    attach();
})();