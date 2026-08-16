/*
 * zones.js
 * Training zones feature module.
 * Owns zone table rendering and the threshold-based highlighting logic. It reads AppState and fetches data via the
 * shared API layer, while leaving the main tab shell and global theme styling elsewhere.
 */
let zonesLoadRequestId = 0;
let zonesLimitListenerBound = false;

function formatPercent(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const pct = Number(value);
  if (Number.isNaN(pct)) {
    return "";
  }

  return `${Math.round(pct)}%`;
}

function zonePctClass(metric, value) {
  const pct = Number(value);

  if (Number.isNaN(pct)) {
    return "";
  }

  const thresholds = window.APP_CONSTANTS.ZONE_THRESHOLDS[metric];
  if (!thresholds) {
    return "";
  }

  if (metric === "z1_z2_pct") {
    if (pct < thresholds.targetMin) return "zone-bad";
    if (pct <= thresholds.targetMax) return "zone-good";
    return "zone-strong";
  }

  if (metric === "z3_pct") {
    if (pct < thresholds.targetMin) return "zone-low";
    if (pct <= thresholds.targetMax) return "zone-good";
    return "zone-bad";
  }

  if (metric === "z4_z5_pct") {
    if (pct <= thresholds.targetMax) return "zone-good";
    if (pct <= thresholds.cautionMax) return "zone-caution";
    return "zone-bad";
  }

  return "";
}

function zoneHeaderLabel(metric, title) {
  return `${title}%(${zoneHeaderRange(metric)})`;
}

async function loadZones() {
  const requestId = ++zonesLoadRequestId;
  const limit = Number(window.AppState.zonesLimit);

  try {
    if (window.api && typeof window.api.fetchZones === "function") {
      const rows = await window.api.fetchZones(limit);
      if (requestId !== zonesLoadRequestId) {
        return;
      }
      window.AppState.zonesRows = rows;
    } else {
      const rows = await fetch(`/api/zones?limit=${limit}`).then(response => response.json());
      if (requestId !== zonesLoadRequestId) {
        return;
      }
      window.AppState.zonesRows = rows;
    }
  } catch (error) {
    console.error(error);
    if (requestId !== zonesLoadRequestId) {
      return;
    }
    window.AppState.zonesRows = [];
  }

  if (requestId !== zonesLoadRequestId) {
    return;
  }

  renderZonesTable();

  if (window.AppState.activeTab === "zones") {
    renderHeaderSummary();
  }
}

function attachZonesLimitSelector() {
  if (zonesLimitListenerBound) {
    return;
  }

  const zonesLimitSelector = document.getElementById("zonesLimit");
  if (!zonesLimitSelector) {
    return;
  }

  zonesLimitSelector.addEventListener("change", (event) => {
    const nextValue = Number(event.target.value);
    const allowedValues = Array.isArray(window.APP_ROW_LIMITS?.zones) ? window.APP_ROW_LIMITS.zones : [26, 60, 260];

    if (!Number.isInteger(nextValue) || !allowedValues.includes(nextValue)) {
      event.target.value = String(window.AppState.zonesLimit ?? 60);
      return;
    }

    if (typeof window.updateLimitPreference === "function") {
      window.updateLimitPreference("zonesLimit", nextValue, () => {
        if (window.AppState.activeTab === "zones" && typeof window.loadZones === "function") {
          window.loadZones();
        }
      });
      return;
    }

    window.AppState.zonesLimit = nextValue;
    if (typeof window.persistPreferences === "function") {
      window.persistPreferences();
    }
    if (window.AppState.activeTab === "zones" && typeof window.loadZones === "function") {
      window.loadZones();
    }
  });

  zonesLimitListenerBound = true;
}

function renderZonesTable() {
  const rows = window.AppState.zonesRows.map(row => {
    const z1z2Class = zonePctClass("z1_z2_pct", row.z1_z2_pct);
    const z3Class = zonePctClass("z3_pct", row.z3_pct);
    const z4z5Class = zonePctClass("z4_z5_pct", row.z4_z5_pct);

    return `
      <tr>
        <td>${safe(row.week_start)}</td>
        <td>${safe(row.ride_time_hhmm)}</td>
        <td>${safe(row.zone_flag)}</td>
        <td class="${z1z2Class}">${formatPercent(row.z1_z2_pct)}</td>
        <td class="${z3Class}">${formatPercent(row.z3_pct)}</td>
        <td class="${z4z5Class}">${formatPercent(row.z4_z5_pct)}</td>
        <td>${safe(row.z1_hhmm)}</td>
        <td>${safe(row.z2_hhmm)}</td>
        <td>${safe(row.z3_hhmm)}</td>
        <td>${safe(row.z4_hhmm)}</td>
        <td>${safe(row.z5_hhmm)}</td>
        <td>${safe(row.ride_count)}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("zonesTable").innerHTML = `
    <thead>
      <tr>
        <th>Week Start</th>
        <th>Ride Time</th>
        <th>Flag</th>
        <th>${zoneHeaderLabel("z1_z2_pct", "Z1-Z2")}</th>
        <th>${zoneHeaderLabel("z3_pct", "Z3")}</th>
        <th>${zoneHeaderLabel("z4_z5_pct", "Z4-Z5")}</th>
        <th>Z1</th>
        <th>Z2</th>
        <th>Z3</th>
        <th>Z4</th>
        <th>Z5</th>
        <th>Ride Count</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  `;
}

attachZonesLimitSelector();

window.ZonesController = {
  load: loadZones,
  render: renderZonesTable,
};
