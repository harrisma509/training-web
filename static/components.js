function componentSafe(value, fallback = "") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }
  return value;
}

function componentEscapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatComponentNumber(value, digits = 1, fallback = "-") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(parsed);
}

function formatComponentInteger(value, fallback = "-") {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return new Intl.NumberFormat("en-US").format(Math.round(parsed));
}

function formatServiceInterval(row) {
  const chunks = [];

  if (row.service_interval_miles != null) {
    chunks.push(`${formatComponentNumber(row.service_interval_miles, 0, "0")} mi`);
  }
  if (row.service_interval_hours != null) {
    chunks.push(`${formatComponentNumber(row.service_interval_hours, 0, "0")} hr`);
  }
  if (row.service_interval_days != null) {
    chunks.push(`${formatComponentNumber(row.service_interval_days, 0, "0")} d`);
  }
  if (row.service_interval_rides != null) {
    chunks.push(`${formatComponentNumber(row.service_interval_rides, 0, "0")} rides`);
  }

  return chunks.length > 0 ? chunks.join(" • ") : "-";
}

function formatLatestAction(latestEvent) {
  if (!latestEvent) {
    return "No service event";
  }

  const chunks = [
    componentSafe(latestEvent.action, ""),
    componentSafe(latestEvent.product_name, ""),
    componentSafe(latestEvent.model, ""),
  ].filter(Boolean);

  return chunks.length > 0 ? chunks.join(" • ") : "Service logged";
}

function renderComponentsSummary() {
  const summaryEl = document.getElementById("componentsSummary");
  if (!summaryEl) {
    return;
  }

  const payload = window.AppState.componentsData || {};
  const bike = payload.selected_bike;

  if (!bike) {
    summaryEl.innerHTML = '<span class="components-summary-empty">No eligible bikes found.</span>';
    return;
  }

  summaryEl.innerHTML = `
    <div class="components-summary-bike">${componentEscapeHtml(componentSafe(bike.display_name, bike.gear_id || ""))}</div>
    <div class="components-summary-metrics">
      <span class="status-pill status-muted">${formatComponentInteger(bike.ride_count, "0")} rides</span>
      <span class="status-pill status-muted">${formatComponentNumber(bike.miles, 1, "0.0")} mi</span>
      <span class="status-pill status-muted">${formatComponentNumber(bike.hours, 1, "0.0")} hr</span>
      <span class="status-pill status-muted">${formatComponentInteger(bike.elevation_ft, "0")} ft</span>
    </div>
  `;
}

function renderComponentsBikeSelect() {
  const select = document.getElementById("componentsBikeSelect");
  if (!select) {
    return;
  }

  const payload = window.AppState.componentsData || {};
  const bikes = Array.isArray(payload.available_bikes) ? payload.available_bikes : [];
  const selectedGearId = componentSafe(payload.selected_gear_id, "");

  if (bikes.length === 0) {
    select.innerHTML = "<option value=\"\">No bikes</option>";
    select.value = "";
    select.disabled = true;
    return;
  }

  const optionsHtml = bikes.map(bike => {
    const bikeId = componentSafe(bike.gear_id, "");
    const label = componentSafe(bike.display_name, bikeId);
    return `<option value="${componentEscapeHtml(bikeId)}">${componentEscapeHtml(label)}</option>`;
  }).join("");

  select.innerHTML = optionsHtml;
  select.disabled = false;

  if (selectedGearId && bikes.some(bike => bike.gear_id === selectedGearId)) {
    select.value = selectedGearId;
  } else {
    select.value = bikes[0].gear_id;
  }
}

function renderComponentsTable() {
  const table = document.getElementById("componentsTable");
  if (!table) {
    return;
  }

  const payload = window.AppState.componentsData || {};
  const rows = Array.isArray(payload.components) ? payload.components : [];

  if (rows.length === 0) {
    table.innerHTML = `
      <thead>
        <tr>
          <th>Component</th>
          <th>Group</th>
          <th>Position</th>
          <th>Last Service</th>
          <th>Action</th>
          <th>Miles Since</th>
          <th>Hours Since</th>
          <th>Rides Since</th>
          <th>Days Since</th>
          <th>Interval</th>
          <th>Notes</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td colspan="11" class="components-empty">No active components for this bike.</td>
        </tr>
      </tbody>
    `;
    return;
  }

  const bodyRows = rows.map(row => {
    const usage = row.usage_since_latest_event || {};
    const latestEvent = row.latest_event;

    return `
      <tr>
        <td>${componentEscapeHtml(componentSafe(row.component_name, ""))}</td>
        <td>${componentEscapeHtml(componentSafe(row.component_group, "-"))}</td>
        <td>${componentEscapeHtml(componentSafe(row.position, "-"))}</td>
        <td>${componentEscapeHtml(componentSafe(latestEvent ? latestEvent.service_date : null, "-"))}</td>
        <td>${componentEscapeHtml(formatLatestAction(latestEvent))}</td>
        <td>${formatComponentNumber(usage.miles_since_service, 1)}</td>
        <td>${formatComponentNumber(usage.hours_since_service, 1)}</td>
        <td>${formatComponentInteger(usage.rides_since_service)}</td>
        <td>${formatComponentInteger(usage.days_since_service)}</td>
        <td>${componentEscapeHtml(formatServiceInterval(row))}</td>
        <td>${componentEscapeHtml(componentSafe(latestEvent ? latestEvent.notes : "", "-"))}</td>
      </tr>
    `;
  }).join("");

  table.innerHTML = `
    <thead>
      <tr>
        <th>Component</th>
        <th>Group</th>
        <th>Position</th>
        <th>Last Service</th>
        <th>Action</th>
        <th>Miles Since</th>
        <th>Hours Since</th>
        <th>Rides Since</th>
        <th>Days Since</th>
        <th>Interval</th>
        <th>Notes</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
    </tbody>
  `;
}

async function loadComponents() {
  const selectedGearId = String(window.AppState.componentsSelectedGearId || window.AppState.defaultBikeGearId || "").trim();
  const endpoint = selectedGearId
    ? `/api/gear/components?gear_id=${encodeURIComponent(selectedGearId)}`
    : "/api/gear/components";

  try {
    const response = await fetch(endpoint);
    if (!response.ok) {
      if (response.status === 400 && selectedGearId) {
        window.AppState.componentsSelectedGearId = "";
        if (typeof persistPreferences === "function") {
          persistPreferences();
        }
        return loadComponents();
      }
      throw new Error(`Components endpoint failed: ${response.status}`);
    }

    const payload = await response.json();
    window.AppState.componentsData = payload;
    window.AppState.componentsSelectedGearId = componentSafe(payload.selected_gear_id, "");
    if (typeof persistPreferences === "function") {
      persistPreferences();
    }
  } catch (error) {
    console.error(error);
    window.AppState.componentsData = {
      available_bikes: [],
      selected_gear_id: null,
      selected_bike: null,
      components: [],
    };
  }

  renderComponentsBikeSelect();
  if (typeof window.syncDefaultBikeSelect === "function") {
    window.syncDefaultBikeSelect();
  }
  renderComponentsSummary();
  renderComponentsTable();

  if (window.AppState.activeTab === "components") {
    renderHeaderSummary();
  }
}
