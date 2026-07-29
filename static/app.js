let dailyRows = [];
let weeklyRows = [];
let activeTab = "daily";

const dailyTab = document.getElementById("dailyTab");
const weeklyTab = document.getElementById("weeklyTab");
const dailyPane = document.getElementById("dailyPane");
const weeklyPane = document.getElementById("weeklyPane");

const dailyControls = document.getElementById("dailyControls");
const weeklyControls = document.getElementById("weeklyControls");

const dailyLimit = document.getElementById("dailyLimit");
const weeklyLimit = document.getElementById("weeklyLimit");
const dailyRefresh = document.getElementById("dailyRefresh");
const weeklyRefresh = document.getElementById("weeklyRefresh");


const syncStatus = document.getElementById("syncStatus");
const syncNowBtn = document.getElementById("syncNowBtn");

dailyTab.addEventListener("click", () => showTab("daily"));
weeklyTab.addEventListener("click", () => showTab("weekly"));
dailyRefresh.addEventListener("click", loadDaily);
weeklyRefresh.addEventListener("click", loadWeekly);
syncNowBtn.addEventListener("click", handleSyncNow);

function safe(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  return value;
}

function statusPill(value) {
  const status = safe(value);
  if (!status) {
    return "";
  }
  return `<span class="pill status-${status}">${status}</span>`;
}

function showTab(tab) {
  activeTab = tab;

  const isDaily = tab === "daily";

  dailyPane.classList.toggle("hidden", !isDaily);
  weeklyPane.classList.toggle("hidden", isDaily);

  dailyControls.classList.toggle("hidden", !isDaily);
  weeklyControls.classList.toggle("hidden", isDaily);

  dailyTab.classList.toggle("active", isDaily);
  weeklyTab.classList.toggle("active", !isDaily);
}

function renderHeaderSummary() {
  return;
}


function renderDailyTable() {
  const rows = dailyRows.map(row => `
    <tr>
      <td>${safe(row.date)}</td>
      <td>${safe(row.activity_categories)}</td>
      <td>${safe(row.main_ride_name)}</td>
      <td>${safe(row.main_ride_bike_name)}</td>
      <td>${safe(row.main_ride_load)}</td>
      <td>${safe(row.main_ride_band)}</td>
      <td>${safe(row.other_load)}</td>
      <td>${safe(row.total_load)}</td>
      <td>${safe(row.other_activity_names).replaceAll("\\n", "<br>")}</td>
    </tr>
  `).join("");

  document.getElementById("dailyTable").innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Count</th>
        <th>Main Ride</th>
        <th>Bike</th>
        <th>Main Load</th>
        <th>Band</th>
        <th>Other Load</th>
        <th>Total</th>
        <th>Other Activities</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  `;
}

function renderWeeklyTable() {
  const rows = weeklyRows.map(row => `
    <tr>
      <td>${safe(row.week_start)}</td>
      <td>${safe(row.week_end)}</td>
      <td>${safe(row.total_load)}</td>
      <td>${safe(row.main_ride_load)}</td>
      <td>${safe(row.other_load)}</td>
      <td>${safe(row.activity_days)}</td>
      <td>${safe(row.ride_count)}</td>
      <td>${safe(row.walk_count)}</td>
      <td>${safe(row.hike_count)}</td>
      <td>${safe(row.strength_count)}</td>
      <td>${safe(row.very_hard_epic_days)}</td>
      <td>${safe(row.chronic_weekly_cw)}</td>
      <td>${safe(row.ac_ratio)}</td>
      <td>${safe(row.ramp_pct_display)}</td>
      <td>${statusPill(row.status_level)}</td>
      <td>${safe(row.status_text)}</td>
    </tr>
  `).join("");

  document.getElementById("weeklyTable").innerHTML = `
    <thead>
      <tr>
        <th>Week Start</th>
        <th>Week End</th>
        <th>Total Load</th>
        <th>Main Ride</th>
        <th>Other</th>
        <th>Days</th>
        <th>Rides</th>
        <th>Walks</th>
        <th>Hikes</th>
        <th>Strength</th>
        <th>VH Days</th>
        <th>Chronic</th>
        <th>A/C</th>
        <th>Ramp</th>
        <th>Status</th>
        <th>Status Text</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  `;
}

async function loadDaily() {
  const limit = dailyLimit.value;
  dailyRows = await fetch(`/api/daily?limit=${limit}`).then(response => response.json());
  renderDailyTable();

  if (activeTab === "daily") {
    renderHeaderSummary();
  }
}

async function loadWeekly() {
  const limit = weeklyLimit.value;
  weeklyRows = await fetch(`/api/weekly?limit=${limit}`).then(response => response.json());
  renderWeeklyTable();

  if (activeTab === "weekly") {
    renderHeaderSummary();
  }
}

async function loadData() {
  await Promise.all([
    loadDaily(),
    loadWeekly()
  ]);

  renderHeaderSummary();
  loadSyncStatus();
}

setInterval(loadSyncStatus, 60000);

function renderSyncStatusPlaceholder() {
  syncStatus.className = "sync-pill sync-muted";
  syncStatus.innerHTML = `
    <span class="sync-dot"></span>
    <span>Sync status not wired</span>
  `;
}

function formatSyncTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

async function loadSyncStatus() {
  try {
    const data = await fetch("/api/sync-status").then(response => response.json());
    renderSyncStatus(data);
  } catch (error) {
    syncStatus.className = "sync-pill sync-failed";
    syncStatus.innerHTML = `
      <span class="sync-dot"></span>
      <span>Sync status error</span>
    `;
  }
}
function renderSyncStatus(data) {
  const health = data.health || "unknown";

  const statusClass = health === "healthy"
    ? "sync-healthy"
    : health === "stale"
      ? "sync-stale"
      : health === "failed"
        ? "sync-failed"
        : health === "pending" || health === "running"
          ? "sync-running"
          : "sync-muted";

  const label = data.label || "Sync status unknown";
  const syncTime = formatSyncTime(data.last_sync_time_utc);
  const requestTime = formatSyncTime(data.sync_request_time_utc);
  const hours = data.hours_since_good_sync;

  let detail = label;

  if (health === "pending") {
    detail = requestTime
      ? `Sync requested · ${requestTime}`
      : "Sync requested";
  } else if (health === "running") {
    detail = requestTime
      ? `Sync running · requested ${requestTime}`
      : "Sync running";
  } else {
    if (syncTime) {
      detail = `${detail} · ${syncTime}`;
    }

    if (hours !== null && hours !== undefined) {
      detail = `${detail} · ${hours}h ago`;
    }

    if ((data.warning_count ?? 0) > 0) {
      detail = `${detail} · ${data.warning_count} warn`;
    }
  }

  syncStatus.className = `sync-pill ${statusClass}`;
  syncStatus.innerHTML = `
    <span class="sync-dot"></span>
    <span>${detail}</span>
  `;
}

async function handleSyncNow() {
  syncNowBtn.disabled = true;
  syncNowBtn.textContent = "Requesting...";

  try {
    const response = await fetch("/api/sync-request", {
      method: "POST"
    });

    if (!response.ok) {
      throw new Error("Sync request failed");
    }

    const result = await response.json();

    syncNowBtn.textContent = result.created ? "Requested" : "Already Queued";

    await loadSyncStatus();

    window.setTimeout(() => {
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = "Sync Now";
    }, 4000);
  } catch (error) {
    syncStatus.className = "sync-pill sync-failed";
    syncStatus.innerHTML = `
      <span class="sync-dot"></span>
      <span>Sync request failed</span>
    `;

    syncNowBtn.disabled = false;
    syncNowBtn.textContent = "Sync Now";
  }
}
showTab("daily");
loadData();