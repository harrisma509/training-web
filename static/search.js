function formatActivityLocalDate(value) {
    if (value === null || value === undefined || value === "") return "";
    return String(value).trim().split(/[T ]/, 1)[0];
}

function formatActivityLocalTime(value) {
    if (value === null || value === undefined || value === "") return "";
    const text = String(value).trim();
    const match = text.match(/(?:^|[T ])(\d{2}):(\d{2})/);
    if (!match) return text;
    const hour = Number(match[1]);
    if (hour > 23) return text;
    const period = hour < 12 ? "AM" : "PM";
    return `${hour % 12 || 12}:${match[2]} ${period}`;
}

if (typeof module !== "undefined" && module.exports) {
    module.exports = { formatActivityLocalDate, formatActivityLocalTime };
}

(function () {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const SORT_BY_VALUES = new Set([
        "date", "start", "activity", "type", "bike",
        "distance", "elevation", "moving", "elapsed", "load",
    ]);
    const SORT_DIRECTIONS = new Set(["asc", "desc"]);
    const LEGACY_SORTS = {
        newest: ["date", "desc"],
        oldest: ["date", "asc"],
        start_time: ["start", "asc"],
        highest_elevation: ["elevation", "desc"],
        longest_distance: ["distance", "desc"],
        longest_duration: ["moving", "desc"],
    };
    const FILTER_KEYS = [
        "text",
        "start_date",
        "end_date",
        "sport_type",
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
    const FILTER_URL_KEYS = {
        text: "search_text",
        start_date: "search_start_date",
        end_date: "search_end_date",
        sport_type: "search_sport_type",
        gear_id: "search_gear_id",
        min_distance_mi: "search_min_distance_mi",
        max_distance_mi: "search_max_distance_mi",
        min_elevation_ft: "search_min_elevation_ft",
        max_elevation_ft: "search_max_elevation_ft",
        min_duration_sec: "search_min_duration_sec",
        max_duration_sec: "search_max_duration_sec",
        start_time_from: "search_start_time_from",
        start_time_to: "search_start_time_to",
    };
    const SEARCH_URL_KEYS = [
        ...Object.values(FILTER_URL_KEYS),
        "search_sort_by", "search_sort_direction", "search_limit", "search_offset",
        ...FILTER_KEYS, "search_activity_category", "activity_category", "sort", "limit", "offset",
    ];
    const FILTER_LABELS = {
        text: "Activity",
        sport_type: "Activity type",
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
        { label: "Date", key: "date_local", sort_by: "date" },
        { label: "Start", key: "start_at_local", sort_by: "start" },
        { label: "Activity", key: "name", sort_by: "activity" },
        { label: "Type", key: "sport_type", sort_by: "type" },
        { label: "Bike", key: "gear_name", sort_by: "bike" },
        { label: "Distance", key: "distance_mi", sort_by: "distance" },
        { label: "Elevation", key: "elevation_ft", sort_by: "elevation" },
        { label: "Moving", key: "moving_sec", sort_by: "moving" },
        { label: "Elapsed", key: "elapsed_sec", sort_by: "elapsed" },
        { label: "Load", key: "activity_load", sort_by: "load" },
        { label: "Actions", key: "actions" },
    ];
    const ACTIVITY_TYPE_LABELS = {
        AlpineSki: "Alpine Ski",
        BackcountrySki: "Backcountry Ski",
        EBikeRide: "E-bike Ride",
        EMountainBikeRide: "E-mountain Bike Ride",
        GravelRide: "Gravel Ride",
        IceSkate: "Ice Skate",
        InlineSkate: "Inline Skate",
        MountainBikeRide: "Mountain Bike Ride",
        NordicSki: "Nordic Ski",
        RockClimbing: "Rock Climbing",
        StandUpPaddling: "Stand-up Paddling",
        TrailRun: "Trail Run",
        VirtualRide: "Virtual Ride",
        VirtualRun: "Virtual Run",
        VirtualRow: "Virtual Row",
        WeightTraining: "Weight Training",
    };

    const state = {
        filters: Object.fromEntries(FILTER_KEYS.map(key => [key, ""])),
        sortBy: "date",
        sortDirection: "desc",
        limit: 50,
        offset: 0,
        requestId: 0,
        initialized: false,
        resultState: "initial",
        lastResult: null,
        activityTypes: [],
        activityTypesLoaded: false,
        resyncingActivityIds: new Set(),
        openActionsMenu: null,
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

    function friendlyActivityType(value) {
        const raw = String(value || "").trim();
        if (!raw) return "";
        if (ACTIVITY_TYPE_LABELS[raw]) return ACTIVITY_TYPE_LABELS[raw];
        return raw
            .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
            .replace(/[_-]+/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .replace(/\b\w/g, character => character.toUpperCase());
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
            const urlKey = FILTER_URL_KEYS[key];
            state.filters[key] = params.has(urlKey) ? params.get(urlKey) || "" : params.get(key) || "";
        });
        const legacySort = LEGACY_SORTS[params.get("sort")];
        const requestedSortBy = params.get("search_sort_by");
        state.sortBy = SORT_BY_VALUES.has(requestedSortBy)
            ? requestedSortBy
            : params.has("search_sort_by") ? "date" : legacySort?.[0] || "date";
        const requestedDirection = params.get("search_sort_direction");
        state.sortDirection = SORT_DIRECTIONS.has(requestedDirection)
            ? requestedDirection
            : params.has("search_sort_direction") ? "desc" : legacySort?.[1] || "desc";
        const limit = Number(params.has("search_limit") ? params.get("search_limit") : params.get("limit"));
        state.limit = [25, 50, 100].includes(limit) ? limit : 50;
        const offset = Number(params.has("search_offset") ? params.get("search_offset") : params.get("offset"));
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
            if (value) url.searchParams.set(FILTER_URL_KEYS[key], value);
        });
        url.searchParams.set("search_sort_by", query.sort_by || state.sortBy);
        url.searchParams.set("search_sort_direction", query.sort_direction || state.sortDirection);
        url.searchParams.set("search_limit", String(query.limit || state.limit));
        const offset = Number.isInteger(query.offset) ? query.offset : state.offset;
        url.searchParams.set("search_offset", String(offset));
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

    function populateActivityTypeOptions() {
        const select = field("searchSportType");
        if (!select) return;
        const selected = state.filters.sport_type;
        select.replaceChildren();
        const anyType = document.createElement("option");
        anyType.value = "";
        anyType.textContent = "Any activity type";
        select.appendChild(anyType);
        const values = [...new Set([...state.activityTypes, selected].filter(Boolean))];
        values.sort((left, right) => friendlyActivityType(left).localeCompare(friendlyActivityType(right)));
        values.forEach(value => {
            const option = document.createElement("option");
            option.value = value;
            option.textContent = friendlyActivityType(value);
            select.appendChild(option);
        });
        select.value = selected;
    }

    async function loadActivityTypeOptions() {
        if (state.activityTypesLoaded) return;
        state.activityTypesLoaded = true;
        try {
            const payload = await window.api.fetchActivitySearchTypes();
            state.activityTypes = Array.isArray(payload?.sport_types)
                ? [...new Set(payload.sport_types.map(value => String(value || "").trim()).filter(Boolean))]
                : [];
        } catch (error) {
            state.activityTypes = [];
        }
        populateActivityTypeOptions();
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
        populateActivityTypeOptions();
        Object.entries(ids).forEach(([key, id]) => {
            const input = field(id);
            if (input) input.value = state.filters[key];
        });
        if (field("searchLimit")) field("searchLimit").value = String(state.limit);
    }

    function collectInputs() {
        const ids = {
            text: "searchText",
            start_date: "searchStartDate",
            end_date: "searchEndDate",
            sport_type: "searchSportType",
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
        const limit = Number(field("searchLimit")?.value);
        state.limit = [25, 50, 100].includes(limit) ? limit : 50;
        return {
            filters: { ...state.filters },
            sort_by: state.sortBy,
            sort_direction: state.sortDirection,
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
            if (key === "sport_type") value = friendlyActivityType(value);
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
                    sort_by: state.sortBy,
                    sort_direction: state.sortDirection,
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
        const isActive = state.sortBy === column.sort_by;
        const direction = isActive ? state.sortDirection : "desc";
        button.className = isActive ? "search-sort active" : "search-sort";
        button.setAttribute("aria-label", isActive
            ? `${column.label}, currently ${direction}; activate to sort ${direction === "desc" ? "ascending" : "descending"}`
            : `Sort by ${column.label} descending`);
        const label = document.createElement("span");
        label.className = "search-sort-label";
        label.textContent = column.label;
        const indicator = document.createElement("span");
        indicator.className = "search-sort-indicator";
        indicator.setAttribute("aria-hidden", "true");
        indicator.textContent = direction === "desc" ? "↓" : "↑";
        button.appendChild(label);
        button.appendChild(indicator);
        button.addEventListener("click", () => {
            const query = collectInputs();
            query.sort_by = column.sort_by;
            query.sort_direction = isActive
                ? state.sortDirection === "desc" ? "asc" : "desc"
                : "desc";
            query.offset = 0;
            state.sortBy = query.sort_by;
            state.sortDirection = query.sort_direction;
            syncUrl(query);
            return loadResults(query);
        });
        return button;
    }

    function safeActivityId(row) {
        const raw = String(row?.activity_id ?? "");
        if (!/^[0-9]+$/.test(raw)) return "";
        const numericId = Number(raw);
        return Number.isSafeInteger(numericId) && numericId > 0 ? String(numericId) : "";
    }

    function closeActionsMenu(restoreFocus = false) {
        const openMenu = state.openActionsMenu;
        if (!openMenu) return;
        openMenu.menu.remove();
        openMenu.button.setAttribute("aria-expanded", "false");
        state.openActionsMenu = null;
        if (restoreFocus) openMenu.button.focus();
    }

    function actionMenuItem(label, handler, disabled = false) {
        const item = document.createElement("button");
        item.type = "button";
        item.setAttribute("role", "menuitem");
        item.tabIndex = 0;
        item.textContent = label;
        item.disabled = disabled;
        item.addEventListener("click", handler);
        return item;
    }

    function openActionsMenu(button, row) {
        closeActionsMenu();
        const id = safeActivityId(row);
        const menu = document.createElement("div");
        menu.className = "search-actions-menu";
        menu.setAttribute("id", "search-actions-menu");
        menu.setAttribute("role", "menu");
        menu.setAttribute("aria-label", `Actions for ${text(row.name) || "activity"}`);
        if (id) {
            const edit = document.createElement("a");
            edit.href = `https://www.strava.com/activities/${encodeURIComponent(id)}/edit`;
            edit.target = "_blank";
            edit.rel = "noopener noreferrer";
            edit.setAttribute("role", "menuitem");
            edit.tabIndex = 0;
            edit.textContent = "Edit in Strava";
            menu.appendChild(edit);
        } else {
            menu.appendChild(actionMenuItem("Edit in Strava", () => { }, true));
        }
        const refreshing = Boolean(id && state.resyncingActivityIds.has(id));
        menu.appendChild(actionMenuItem(
            refreshing ? "Refreshing…" : "Resync activity",
            () => resyncActivity(row),
            !id || refreshing,
        ));
        const dailyAction = actionMenuItem(
            "Open Daily",
            () => {
                closeActionsMenu();
                openDailyDate(row.date_local);
            },
            !formatActivityLocalDate(row.date_local),
        );
        menu.appendChild(dailyAction);
        menu.addEventListener("keydown", event => {
            const items = Array.from(menu.children).filter(item => !item.disabled);
            if (!items.length) return;
            const currentIndex = items.indexOf(document.activeElement);
            let nextIndex = -1;
            if (event.key === "ArrowDown") nextIndex = (currentIndex + 1) % items.length;
            if (event.key === "ArrowUp") nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
            if (event.key === "Home") nextIndex = 0;
            if (event.key === "End") nextIndex = items.length - 1;
            if (nextIndex >= 0) {
                event.preventDefault();
                items[nextIndex].focus();
            }
        });
        document.body.appendChild(menu);
        const buttonRect = button.getBoundingClientRect();
        const menuRect = menu.getBoundingClientRect();
        const viewportWidth = Number(window.innerWidth) || 1024;
        const viewportHeight = Number(window.innerHeight) || 768;
        const menuWidth = menuRect.width || 190;
        const menuHeight = menuRect.height || 120;
        const left = Math.max(8, Math.min(buttonRect.right - menuWidth, viewportWidth - menuWidth - 8));
        let top = buttonRect.bottom + 4;
        if (top + menuHeight > viewportHeight - 8) top = Math.max(8, buttonRect.top - menuHeight - 4);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        button.setAttribute("aria-expanded", "true");
        state.openActionsMenu = { button, menu };
        menu.children.find(item => !item.disabled)?.focus();
    }

    function createActionsControl(row) {
        const container = document.createElement("div");
        container.className = "search-actions-cell";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button-secondary small search-actions-toggle";
        button.textContent = "Actions";
        button.setAttribute("aria-haspopup", "menu");
        button.setAttribute("aria-expanded", "false");
        button.setAttribute("aria-controls", "search-actions-menu");
        button.setAttribute("aria-label", `Actions for ${text(row.name) || "activity"}`);
        button.disabled = Boolean(safeActivityId(row) && state.resyncingActivityIds.has(safeActivityId(row)));
        button.addEventListener("click", () => {
            if (state.openActionsMenu?.button === button) {
                closeActionsMenu();
            } else {
                openActionsMenu(button, row);
            }
        });
        container.appendChild(button);
        return container;
    }

    async function resyncActivity(row) {
        const activityId = safeActivityId(row);
        if (!activityId || state.resyncingActivityIds.has(activityId)) return;
        closeActionsMenu();
        if (typeof window.confirm === "function" && !window.confirm(`Queue a refresh for activity ${activityId} from Strava?`)) {
            return;
        }

        const query = state.lastResult?.query
            ? { ...state.lastResult.query, filters: { ...state.lastResult.query.filters } }
            : {
                filters: { ...state.filters },
                sort_by: state.sortBy,
                sort_direction: state.sortDirection,
                limit: state.limit,
                offset: state.offset,
            };
        state.resyncingActivityIds.add(activityId);
        if (state.lastResult) renderRows(state.lastResult.items, state.lastResult.items.length ? "results" : "empty");
        setStatus("Refreshing activity from Strava…", "loading");
        try {
            const queued = await window.api.resyncActivity(activityId);
            const requestId = Number(queued?.request_id);
            if (!Number.isSafeInteger(requestId) || requestId <= 0) throw new Error("Invalid request id");
            const deadline = Date.now() + 10 * 60 * 1000;
            let terminalStatus = "";
            for (let attempt = 0; attempt < 400 && Date.now() < deadline; attempt += 1) {
                const status = await window.api.fetchSyncRequestStatus(requestId);
                if (["completed", "failed"].includes(status?.status)) {
                    terminalStatus = status.status;
                    break;
                }
                await new Promise(resolve => window.setTimeout(resolve, 1500));
            }
            if (terminalStatus !== "completed") throw new Error("Activity refresh did not complete");
            if (await loadResults(query)) setStatus("Activity refreshed from Strava.", "success");
        } catch (error) {
            setStatus("This activity could not be refreshed. Try again.", "error");
        } finally {
            state.resyncingActivityIds.delete(activityId);
            if (state.lastResult) renderRows(state.lastResult.items, state.lastResult.items.length ? "results" : "empty");
        }
    }

    function renderRows(items, mode = "results") {
        const table = field("searchResults");
        if (!table) return;
        table.replaceChildren();
        const head = document.createElement("thead");
        const headerRow = document.createElement("tr");
        RESULT_COLUMNS.forEach(column => {
            const header = document.createElement("th");
            if (column.sort_by) {
                header.appendChild(makeSortButton(column));
                header.setAttribute("aria-sort", state.sortBy === column.sort_by
                    ? state.sortDirection === "desc" ? "descending" : "ascending"
                    : "none");
                header.className = "search-sortable-header";
            } else {
                header.textContent = column.label;
                header.className = "search-nonsortable-header";
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
                } else if (column.key === "actions") {
                    cell.appendChild(createActionsControl(row));
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
        if (!result) {
            if (pageStatus) pageStatus.textContent = "";
            if (previous) previous.disabled = true;
            if (next) next.disabled = true;
            return;
        }
        const { offset, items, total_count: totalCount } = result;
        if (totalCount === 0) {
            if (pageStatus) pageStatus.textContent = "0 activities";
            if (previous) previous.disabled = true;
            if (next) next.disabled = true;
            return;
        }
        const first = offset + 1;
        const last = offset + items.length;
        if (pageStatus) {
            pageStatus.textContent = totalCount === 1
                ? "Showing 1 of 1 activity"
                : `Showing ${first}–${last} of ${totalCount} activities`;
        }
        if (previous) previous.disabled = offset === 0;
        if (next) next.disabled = offset + items.length >= totalCount;
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
        sort_by: state.sortBy,
        sort_direction: state.sortDirection,
        limit: state.limit,
        offset: state.offset,
    }) {
        closeActionsMenu();
        const requestId = ++state.requestId;
        state.filters = { ...query.filters };
        state.sortBy = query.sort_by;
        state.sortDirection = query.sort_direction;
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
                sort_by: query.sort_by,
                sort_direction: query.sort_direction,
                limit: query.limit,
                offset: query.offset,
            });
            if (requestId !== state.requestId) return false;
            const items = Array.isArray(payload?.items) ? payload.items : [];
            if (!Number.isInteger(payload?.total_count) || payload.total_count < 0) {
                throw new Error("Invalid activity search total count.");
            }
            if (query.offset > 0 && (payload.total_count === 0 || query.offset >= payload.total_count)) {
                const firstPage = { ...query, offset: 0, filters: { ...query.filters } };
                state.offset = 0;
                syncUrl(firstPage);
                return loadResults(firstPage);
            }
            const result = {
                items,
                total_count: payload.total_count,
                offset: query.offset,
                limit: query.limit,
                query: {
                    filters: { ...query.filters },
                    sort_by: query.sort_by,
                    sort_direction: query.sort_direction,
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
        state.sortBy = "date";
        state.sortDirection = "desc";
        state.limit = 50;
        state.offset = 0;
        state.requestId += 1;
        state.lastResult = null;
        state.resultState = "initial";
        setValidationMessage("");
        setStatus("", "");
        if (field("searchKeepFiltersOpen")) field("searchKeepFiltersOpen").checked = false;
        syncInputs();
        const query = {
            filters: { ...state.filters },
            sort_by: state.sortBy,
            sort_direction: state.sortDirection,
            limit: state.limit,
            offset: 0,
        };
        syncUrl(query);
        renderRows([], "initial");
        updatePagination(null);
        loadResults(query);
    }

    function queryMatches(left, right) {
        return Boolean(left && right)
            && JSON.stringify(left.filters) === JSON.stringify(right.filters)
            && left.sort_by === right.sort_by
            && left.sort_direction === right.sort_direction
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
            sort_by: state.sortBy,
            sort_direction: state.sortDirection,
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
        state.sortBy = "date";
        state.sortDirection = "desc";
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
        loadActivityTypeOptions();
        document.addEventListener("click", event => {
            const openMenu = state.openActionsMenu;
            if (openMenu && !openMenu.menu.contains(event.target) && !openMenu.button.contains(event.target)) {
                closeActionsMenu();
            }
        });
        document.addEventListener("keydown", event => {
            if (event.key === "Escape" && state.openActionsMenu) {
                event.preventDefault();
                closeActionsMenu(true);
            }
        });
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
            if (!state.lastResult || state.lastResult.offset + state.lastResult.items.length >= state.lastResult.total_count) return;
            loadPage(state.lastResult.offset + state.lastResult.items.length);
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
        state.sortBy = query.sort_by;
        state.sortDirection = query.sort_direction;
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