const state = window.AppState;

const dailyTab = document.getElementById("dailyTab");
const weeklyTab = document.getElementById("weeklyTab");
const zonesTab = document.getElementById("zonesTab");
const dailyPane = document.getElementById("dailyPane");
const weeklyPane = document.getElementById("weeklyPane");
const zonesPane = document.getElementById("zonesPane");

const dailyControls = document.getElementById("dailyControls");
const weeklyControls = document.getElementById("weeklyControls");
const zonesControls = document.getElementById("zonesControls");

const dailyLimit = document.getElementById("dailyLimit");
const weeklyLimit = document.getElementById("weeklyLimit");
const zonesLimit = document.getElementById("zonesLimit");
const dailyRefresh = document.getElementById("dailyRefresh");
const weeklyRefresh = document.getElementById("weeklyRefresh");
const zonesRefresh = document.getElementById("zonesRefresh");


const syncNowBtn = document.getElementById("syncNowBtn");

dailyTab.addEventListener("click", () => showTab("daily"));
weeklyTab.addEventListener("click", () => showTab("weekly"));
zonesTab.addEventListener("click", () => showTab("zones"));
dailyRefresh.addEventListener("click", loadDaily);
weeklyRefresh.addEventListener("click", loadWeekly);
zonesRefresh.addEventListener("click", loadZones);
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
  state.activeTab = tab;

  const isDaily = tab === "daily";
  const isWeekly = tab === "weekly";
  const isZones = tab === "zones";

  dailyPane.classList.toggle("hidden", !isDaily);
  weeklyPane.classList.toggle("hidden", !isWeekly);
  zonesPane.classList.toggle("hidden", !isZones);

  dailyControls.classList.toggle("hidden", !isDaily);
  weeklyControls.classList.toggle("hidden", !isWeekly);
  zonesControls.classList.toggle("hidden", !isZones);

  dailyTab.classList.toggle("active", isDaily);
  weeklyTab.classList.toggle("active", isWeekly);
  zonesTab.classList.toggle("active", isZones);
}

function renderHeaderSummary() {
  return;
}

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

function renderMainRideCell(row) {
  const name = safe(row.main_ride_name);
  if (!name) {
    return "";
  }

  const rideId = row.main_ride_id == null ? "" : String(row.main_ride_id).trim();
  const escapedName = escapeHtml(name);

  if (/^[0-9]+$/.test(rideId)) {
    return `<a class="activity-link" href="https://www.strava.com/activities/${rideId}" target="_blank" rel="noopener noreferrer">${escapedName}</a>`;
  }

  return escapedName;
}


function renderDailyTable() {
  const rows = state.dailyRows.map(row => {
    const mainRideLoad = row.main_ride_load_text || (row.main_ride_load == null ? "" : Number(row.main_ride_load).toFixed(0));
    return `
    <tr>
      <td>${safe(row.date)}</td>
      <td>${row.weight_lb == null ? "" : Number(row.weight_lb).toFixed(1)}</td>
      <td>${formatSleepCell(row.sleep_score, row.total_sleep_hr)}</td>
      <td>${formatCommaInt(row.steps)}</td>
      <td>${safe(row.rhr_bpm)}</td>
      <td>${formatHrvMs(row.hrv_sdnn_ms)}</td>
      <td>${row.total_load == null ? "" : Number(row.total_load).toFixed(0)}</td>
      <td>${safe(row.main_ride_time)}</td>
      <td>${row.main_ride_miles == null ? "" : Number(row.main_ride_miles).toFixed(1)}</td>
      <td>${formatCommaInt(row.main_ride_elevation_ft)}</td>
      <td>${renderMainRideCell(row)}</td>
      <td>${safe(row.main_ride_bike_name)}</td>
      <td>${safe(mainRideLoad)}</td>
      <td>${formatHrZones(row.main_ride_hr_zones)}</td>
      <td>${safe(row.other_load == null ? "" : Number(row.other_load).toFixed(0))}</td>
      <td>${safe(row.activity_categories)}</td>
      <td>${safe(row.other_activity_names).replaceAll("\\n", "<br>")}</td>
    </tr>
  `;
  }).join("");

  document.getElementById("dailyTable").innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Weight</th>
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

async function loadDaily() {
  const limit = dailyLimit.value;
  state.dailyRows = await fetch(`/api/daily?limit=${limit}`).then(response => response.json());
  renderDailyTable();

  if (state.activeTab === "daily") {
    renderHeaderSummary();
  }
}

function truncateText(value, maxLength = 100) {
  if (value == null) {
    return "";
  }
  const stringValue = String(value);
  return stringValue.length <= maxLength
    ? stringValue
    : `${stringValue.slice(0, maxLength)}…`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatHrZones(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const escaped = escapeHtml(String(value));
  return escaped.replace(/\b(Z[1-5])\b/g, '<span class="hr-zone-label">$1</span>');
}

async function loadData() {
  await Promise.all([
    loadDaily(),
    loadWeekly(),
    loadZones()
  ]);

  renderHeaderSummary();
  loadSyncStatus();
}

setInterval(loadSyncStatus, 60000);
showTab("daily");
loadData();