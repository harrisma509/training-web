function gearStatusBadge(row) {
  if (row.retired) {
    return `<span class="status-pill status-retired">Retired</span>`;
  }
  if (row.active) {
    return `<span class="status-pill status-active">Active</span>`;
  }
  return `<span class="status-pill status-muted">Inactive</span>`;
}

function formatGearNumber(value, digits = 0) {
  if (value === null || value === undefined || value === "") {
    return "0";
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "0";
  }
  return digits > 0 ? parsed.toFixed(digits) : String(Math.round(parsed));
}

function renderGearTable() {
  const rows = window.AppState.gearRows.map(row => `
    <tr class="${row.retired ? "gear-row-retired" : ""}">
      <td>${escapeHtml(safe(row.gear_name) || safe(row.gear_id))}</td>
      <td>${safe(row.gear_type)}</td>
      <td>${gearStatusBadge(row)}</td>
      <td>${formatGearNumber(row.ride_count)}</td>
      <td>${formatGearNumber(row.activity_count)}</td>
      <td>${formatGearNumber(row.miles, 1)}</td>
      <td>${formatGearNumber(row.hours, 1)}</td>
      <td>${formatGearNumber(row.elevation_ft)}</td>
      <td>${safe(row.last_activity_date)}</td>
    </tr>
  `).join("");

  document.getElementById("gearTable").innerHTML = `
    <thead>
      <tr>
        <th>Gear</th>
        <th>Type</th>
        <th>Status</th>
        <th>Rides</th>
        <th>Activities</th>
        <th>Miles</th>
        <th>Hours</th>
        <th>Elevation</th>
        <th>Last Activity</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  `;
}

async function loadGear() {
  const gearLimit = document.getElementById("gearLimit");
  const limit = gearLimit.value;
  try {
    const response = await fetch(`/api/gear/dashboard?limit=${limit}`);
    if (!response.ok) {
      throw new Error(`Gear endpoint failed: ${response.status}`);
    }
    window.AppState.gearRows = await response.json();
  } catch (error) {
    console.error(error);
    window.AppState.gearRows = [];
  }
  renderGearTable();

  if (window.AppState.activeTab === "gear") {
    renderHeaderSummary();
  }
}
