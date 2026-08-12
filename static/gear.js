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

  if (digits > 0) {
    const fixed = parsed.toFixed(digits);
    const [integer, fraction] = fixed.split(".");
    const formattedInt = new Intl.NumberFormat("en-US").format(Number(integer));
    return fraction ? `${formattedInt}.${fraction}` : formattedInt;
  }

  return new Intl.NumberFormat("en-US").format(Math.round(parsed));
}

function normalizeGearDisplayPart(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).trim();
  if (!text) {
    return "";
  }

  const normalized = text.toLowerCase();
  if (normalized === "null" || normalized === "undefined" || normalized === "none") {
    return "";
  }

  return text;
}

function formatGearDisplayName(row) {
  const parts = [
    normalizeGearDisplayPart(row.model_year),
    normalizeGearDisplayPart(row.brand),
    normalizeGearDisplayPart(row.gear_name),
  ].filter(Boolean);

  return parts.join(" ") || normalizeGearDisplayPart(row.gear_name) || normalizeGearDisplayPart(row.gear_id) || "";
}

function shouldShowGearRow(row) {
  const hideShoes = window.AppState.hideShoes;
  const hideRetired = window.AppState.hideRetired;

  if (hideShoes && String(row.gear_type).toLowerCase() === "shoe") {
    return false;
  }
  if (hideRetired && row.retired) {
    return false;
  }
  return true;
}

function renderGearTable() {
  const rows = window.AppState.gearRows
    .filter(row => shouldShowGearRow(row))
    .map(row => `
      <tr class="${row.retired ? "gear-row-retired" : ""}">
        <td>${escapeHtml(formatGearDisplayName(row))}</td>
        <td>${safe(row.gear_type)}</td>
        <td>${gearStatusBadge(row)}</td>
        <td>${formatGearNumber(row.ride_count)}</td>
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
  const fixedLimit = 10000;

  try {
    const response = await fetch(`/api/gear/dashboard?limit=${fixedLimit}`);
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
