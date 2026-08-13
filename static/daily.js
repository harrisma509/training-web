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

function renderMainRideCell(row) {
  if (!hasMainRide(row)) {
    return "";
  }

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

async function loadDaily() {
  const limit = Number(window.AppState.dailyLimit);
  window.AppState.dailyRows = await fetch(`/api/daily?limit=${limit}`).then(response => response.json());
  renderDailyTable();

  if (window.AppState.activeTab === "daily") {
    renderHeaderSummary();
  }
}
