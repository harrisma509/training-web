/*
 * daily.js
 * Daily dashboard feature module.
 * Owns daily-table rendering, health summaries, and the data-loading path for the Daily tab. It interacts with
 * AppState and the shared API layer, but keeps the presentation logic local to this module.
 */
function formatCommaInt(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Intl.NumberFormat("en-US").format(Math.round(parsed));
}

function formatSleepHours(totalSleepHours) {
  if (totalSleepHours === null || totalSleepHours === undefined || totalSleepHours === "") {
    return "";
  }
  const parsed = Number(totalSleepHours);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return "";
  }
  const totalMinutes = Math.round(parsed * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatSleepCell(score, totalSleepHours) {
  const scoreText = score === null || score === undefined || score === "" ? "" : String(score);
  const hoursText = formatSleepHours(totalSleepHours);

  if (scoreText && hoursText) {
    return `(${scoreText}) ${hoursText}`;
  }
  if (scoreText) {
    return scoreText;
  }
  return hoursText;
}

function formatHrvMs(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return `${Math.round(parsed)} ms`;
}

function hasMainRide(row) {
  const rideId = row.main_ride_id == null ? "" : String(row.main_ride_id).trim();
  const rideName = row.main_ride_name == null ? "" : String(row.main_ride_name).trim();
  return Boolean(rideId || rideName);
}

function hasOtherActivity(row) {
  const otherCount = row.other_count == null ? 0 : Number(row.other_count);
  if (Number.isFinite(otherCount) && otherCount > 0) {
    return true;
  }

  const otherActivityNames = row.other_activity_names == null ? "" : String(row.other_activity_names).trim();
  return Boolean(otherActivityNames);
}

function renderRideLinkFromFields(name, rideId) {
  const safeName = safe(name);
  if (!safeName) {
    return "";
  }

  const cleanedRideId = rideId == null ? "" : String(rideId).trim();
  const escapedName = escapeHtml(safeName);

  if (/^[0-9]+$/.test(cleanedRideId)) {
    return `<a class="activity-link" href="https://www.strava.com/activities/${cleanedRideId}" target="_blank" rel="noopener noreferrer">${escapedName}</a>`;
  }

  return escapedName;
}

function renderMainRideCell(row) {
  if (!hasMainRide(row)) {
    return "";
  }

  return renderRideLinkFromFields(row.main_ride_name, row.main_ride_id);
}

function formatHrZones(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const escaped = escapeHtml(String(value));
  return escaped.replace(/\b(Z[1-5])\b/g, '<span class="hr-zone-label">$1</span>');
}

function renderDailyTable() {
  const rows = (window.AppState.dailyRows || []).map(row => {
    const hasRide = hasMainRide(row);
    const hasOther = hasOtherActivity(row);
    const mainRideLoad = hasRide ? (row.main_ride_load_text || (row.main_ride_load == null ? "" : Number(row.main_ride_load).toFixed(0))) : "";
    return `
      <tr>
        <td>${safe(row.date)}</td>
        <td>${row.weight_lb == null ? "" : Number(row.weight_lb).toFixed(1)}</td>
        <td>${formatSleepCell(row.sleep_score, row.total_sleep_hr)}</td>
        <td>${formatCommaInt(row.steps)}</td>
        <td>${safe(row.rhr_bpm)}</td>
        <td>${formatHrvMs(row.hrv_sdnn_ms)}</td>
        <td>${row.total_load == null ? "" : Number(row.total_load).toFixed(0)}</td>
        <td>${hasRide ? safe(row.main_ride_time) : ""}</td>
        <td>${hasRide && row.main_ride_miles != null ? Number(row.main_ride_miles).toFixed(1) : ""}</td>
        <td>${hasRide ? formatCommaInt(row.main_ride_elevation_ft) : ""}</td>
        <td>${renderMainRideCell(row)}</td>
        <td>${hasRide ? safe(row.main_ride_bike_name) : ""}</td>
        <td>${safe(mainRideLoad)}</td>
        <td>${hasRide ? formatHrZones(row.main_ride_hr_zones) : ""}</td>
        <td>${hasOther && row.other_load != null ? Number(row.other_load).toFixed(0) : ""}</td>
        <td>${safe(row.activity_categories)}</td>
        <td>${safe(row.other_activity_names).replaceAll("\\n", "<br>")}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("dailyTable").innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Lbs</th>
        <th>Sleep</th>
        <th>Steps</th>
        <th>RHR</th>
        <th>HRV</th>
        <th>Load</th>
        <th>Time</th>
        <th>Miles</th>
        <th>Feet</th>
        <th>Main Ride</th>
        <th>Bike</th>
        <th>Main Ride Load</th>
        <th>HR Zones</th>
        <th>Other</th>
        <th>Count</th>
        <th>Other Activities</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  `;
}

let dailySearchRequestId = 0;
let dailySearchDebounceTimer = null;
let dailySearchResultItems = [];
let dailySearchSelectedIndex = -1;

function hideDailySearchResults() {
  const results = document.getElementById("dailySearchResults");
  if (!results) {
    return;
  }
  results.classList.add("hidden");
  results.innerHTML = "";
  dailySearchResultItems = [];
  dailySearchSelectedIndex = -1;
}

function showDailySearchResults() {
  const results = document.getElementById("dailySearchResults");
  if (!results) {
    return;
  }
  results.classList.remove("hidden");
}

function formatSearchCount(value) {
  if (!Number.isFinite(Number(value))) {
    return "0";
  }
  return new Intl.NumberFormat("en-US").format(Number(value));
}

function updateDailySearchControls() {
  const input = document.getElementById("dailySearch");
  const applyBtn = document.getElementById("dailySearchApply");
  const dailyLimit = document.getElementById("dailyLimit");
  const searchStatus = document.getElementById("dailySearchStatusWrap");
  const statusText = document.getElementById("dailySearchStatusText");
  const appliedQuery = String(window.AppState.dailyAppliedQuery || "").trim();
  const rawDraftQuery = String(window.AppState.dailyDraftQuery || "");
  const draftQuery = rawDraftQuery.trim();
  const displayedCount = Number(window.AppState.dailySearchMatchCount || 0);
  const totalCount = Number(window.AppState.dailySearchTotalCount || 0);

  if (input) {
    input.value = rawDraftQuery;
  }
  if (applyBtn) {
    applyBtn.disabled = draftQuery.length < 2;
  }
  if (dailyLimit) {
    dailyLimit.disabled = Boolean(appliedQuery);
  }
  if (searchStatus) {
    searchStatus.classList.toggle("hidden", !appliedQuery);
  }
  if (statusText) {
    if (!appliedQuery) {
      statusText.textContent = "";
    } else if (totalCount > 0 && displayedCount < totalCount) {
      statusText.textContent = `Showing ${formatSearchCount(displayedCount)} of ${formatSearchCount(totalCount)} matching days across all history for '${appliedQuery}'`;
    } else {
      statusText.textContent = `Showing ${formatSearchCount(displayedCount)} matching days across all history for '${appliedQuery}'`;
    }
  }
}

function renderDailySearchResults(payload = { rows: [], total_count: 0 }, query = "") {
  const results = document.getElementById("dailySearchResults");
  if (!results) {
    return;
  }

  const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
  const totalCount = Number(payload && payload.total_count) || 0;
  results.innerHTML = "";
  dailySearchResultItems = [];
  dailySearchSelectedIndex = -1;

  if (!query || String(query).trim().length < 2) {
    hideDailySearchResults();
    return;
  }

  if (!rows.length) {
    showDailySearchResults();
    const empty = document.createElement("div");
    empty.className = "daily-search-empty";
    empty.textContent = "No matching rides found.";
    results.appendChild(empty);
    return;
  }

  const summary = document.createElement("div");
  summary.className = "daily-search-header";
  const dayWord = totalCount === 1 ? "day" : "days";
  const summaryText = totalCount > rows.length
    ? `${totalCount} matching ${dayWord} across all history`
    : `${totalCount} matching ${dayWord} across all history`;
  summary.textContent = summaryText;
  results.appendChild(summary);

  rows.slice(0, 5).forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "daily-search-preview-item";
    item.setAttribute("role", "option");
    item.setAttribute("tabindex", "0");
    item.dataset.index = String(index);

    const topRow = document.createElement("div");
    topRow.className = "daily-search-preview-top";

    const dateCell = document.createElement("div");
    dateCell.className = "daily-search-date";
    dateCell.textContent = row.date || "";

    const nameCell = document.createElement("div");
    nameCell.className = "daily-search-name";
    nameCell.innerHTML = renderRideLinkFromFields(row.main_ride_name, row.main_ride_id);

    topRow.append(dateCell, nameCell);

    const bikeCell = document.createElement("div");
    bikeCell.className = "daily-search-preview-bike";
    bikeCell.textContent = row.main_ride_bike_name || "";

    item.append(topRow, bikeCell);
    item.addEventListener("click", () => {
      const anchor = item.querySelector("a.activity-link");
      if (anchor) {
        anchor.click();
      }
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const anchor = item.querySelector("a.activity-link");
        if (anchor) {
          anchor.click();
        }
      }
    });
    results.appendChild(item);
    dailySearchResultItems.push(item);
  });

  showDailySearchResults();
}

async function searchDailyRides(query) {
  const cleanedQuery = (query || "").trim();
  const results = document.getElementById("dailySearchResults");
  if (!results) {
    return;
  }

  if (!cleanedQuery || cleanedQuery.length < 2) {
    hideDailySearchResults();
    return;
  }

  const requestId = ++dailySearchRequestId;
  results.classList.remove("hidden");
  results.innerHTML = '<div class="daily-search-status">Searching...</div>';
  dailySearchResultItems = [];
  dailySearchSelectedIndex = -1;

  try {
    const payload = await window.api.fetchRideSearch(cleanedQuery, 5);
    if (requestId !== dailySearchRequestId) {
      return;
    }
    const totalCount = Number(payload && payload.total_count) || 0;
    window.AppState.dailySearchTotalCount = totalCount;
    renderDailySearchResults(payload, cleanedQuery);
  } catch (error) {
    console.error("Ride search failed", error);
    if (requestId !== dailySearchRequestId) {
      return;
    }
    window.AppState.dailySearchTotalCount = 0;
    results.innerHTML = '<div class="daily-search-error">Search failed. Please try again.</div>';
    results.classList.remove("hidden");
  }
}

function handleDailySearchInput(event) {
  const query = String(event.target.value || "");
  window.AppState.dailyDraftQuery = query;
  updateDailySearchControls();

  if (dailySearchDebounceTimer) {
    window.clearTimeout(dailySearchDebounceTimer);
  }

  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    hideDailySearchResults();
    return;
  }

  dailySearchDebounceTimer = window.setTimeout(() => {
    searchDailyRides(trimmed);
  }, 300);
}

function applyDailySearch() {
  const trimmed = String(window.AppState.dailyDraftQuery || "").trim();
  if (trimmed.length < 2) {
    return;
  }

  window.AppState.dailyAppliedQuery = trimmed;
  hideDailySearchResults();
  updateDailySearchControls();
  loadDaily();
}

function clearAppliedDailySearch() {
  window.AppState.dailyAppliedQuery = "";
  window.AppState.dailyDraftQuery = "";
  window.AppState.dailySearchMatchCount = 0;
  window.AppState.dailySearchTotalCount = 0;
  hideDailySearchResults();
  const input = document.getElementById("dailySearch");
  if (input) {
    input.value = "";
  }
  updateDailySearchControls();
  loadDaily();
}

function handleDailySearchKeydown(event) {
  const results = document.getElementById("dailySearchResults");
  const hasOpenResults = results && !results.classList.contains("hidden") && dailySearchResultItems.length > 0;
  const targetTag = event.target && event.target.tagName ? event.target.tagName.toUpperCase() : "";
  const isEditableTarget = ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(targetTag) || (event.target && event.target.isContentEditable);

  if (isEditableTarget && !["Enter", "Escape", "ArrowDown", "ArrowUp"].includes(event.key)) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    if (hasOpenResults && dailySearchSelectedIndex >= 0) {
      const anchor = dailySearchResultItems[dailySearchSelectedIndex].querySelector("a.activity-link");
      if (anchor) {
        anchor.click();
      }
      return;
    }
    applyDailySearch();
    return;
  }

  if (!hasOpenResults) {
    return;
  }

  if (event.key === "Escape") {
    hideDailySearchResults();
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(dailySearchResultItems.length - 1, dailySearchSelectedIndex + delta));
    if (nextIndex === dailySearchSelectedIndex) {
      return;
    }
    dailySearchSelectedIndex = nextIndex;
    dailySearchResultItems.forEach((item, index) => item.classList.toggle("active", index === dailySearchSelectedIndex));
  }
}

function attachDailySearch() {
  const input = document.getElementById("dailySearch");
  const results = document.getElementById("dailySearchResults");
  const applyBtn = document.getElementById("dailySearchApply");
  const clearBtn = document.getElementById("dailyClearSearch");
  if (!input || !results) {
    return;
  }

  input.addEventListener("input", handleDailySearchInput);
  input.addEventListener("keydown", handleDailySearchKeydown);
  input.addEventListener("focus", () => {
    const trimmed = input.value.trim();
    if (trimmed.length >= 2) {
      dailySearchDebounceTimer = window.setTimeout(() => searchDailyRides(trimmed), 300);
    }
  });
  applyBtn?.addEventListener("click", applyDailySearch);
  clearBtn?.addEventListener("click", clearAppliedDailySearch);

  document.addEventListener("click", (event) => {
    const isInside = input.contains(event.target) || results.contains(event.target);
    if (!isInside) {
      hideDailySearchResults();
    }
  });

  updateDailySearchControls();
}

attachDailySearch();

async function loadDaily() {
  const query = String(window.AppState.dailyAppliedQuery || "").trim();
  const limit = query ? 1000 : Number(window.AppState.dailyLimit);

  try {
    if (window.api && typeof window.api.fetchDaily === "function") {
      const payload = await window.api.fetchDaily(limit, query);
      const rows = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.rows) ? payload.rows : []);
      const totalCount = query ? Number((payload && payload.total_count) || rows.length) : 0;
      window.AppState.dailyRows = rows;
      window.AppState.dailySearchTotalCount = query ? totalCount : 0;
    } else {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) {
        params.set("q", query);
      }
      const payload = await fetch(`/api/daily?${params.toString()}`).then(response => response.json());
      const rows = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.rows) ? payload.rows : []);
      const totalCount = query ? Number((payload && payload.total_count) || rows.length) : 0;
      window.AppState.dailyRows = rows;
      window.AppState.dailySearchTotalCount = query ? totalCount : 0;
    }
  } catch (error) {
    console.error(error);
    window.AppState.dailyRows = [];
    window.AppState.dailySearchTotalCount = 0;
  }

  if (query) {
    window.AppState.dailySearchMatchCount = Array.isArray(window.AppState.dailyRows) ? window.AppState.dailyRows.length : 0;
  } else {
    window.AppState.dailySearchMatchCount = 0;
    window.AppState.dailySearchTotalCount = 0;
  }

  renderDailyTable();
  updateDailySearchControls();

  if (window.AppState.activeTab === "daily") {
    renderHeaderSummary();
  }
}

window.DailyController = {
  load: loadDaily,
  render: renderDailyTable,
};
