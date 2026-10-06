/*
 * zones.js
 * Training zones feature module.
 * Owns zone table rendering and the threshold-based highlighting logic. It reads AppState and fetches data via the
 * shared API layer, while leaving the main tab shell and global theme styling elsewhere.
 */
(function () {
  let zonesLoadRequestId = 0;
  let zonesLimitListenerBound = false;
  let zonesInitialized = false;
  let zonesLoadPromise = null;
  let zonesLoaded = false;
  let zonesLoading = false;
  let zonesExporting = false;
  let zonesExportListenerBound = false;
  const ZONES_EXPORT_FIELDS = [
    "week_start",
    "ride_time_hhmm",
    "zone_flag",
    "z1_z2_pct",
    "z3_pct",
    "z4_z5_pct",
    "z1_hhmm",
    "z2_hhmm",
    "z3_hhmm",
    "z4_hhmm",
    "z5_hhmm",
    "ride_count",
  ];

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

  function updateZonesExportButton() {
    const button = document.getElementById("zonesExport");
    if (!button) {
      return;
    }
    const rows = window.AppState.zonesRows;
    button.disabled = zonesLoading || zonesExporting || !Array.isArray(rows) || rows.length === 0;
  }

  function setZonesExportStatus(message, state = "") {
    const status = document.getElementById("zonesExportStatus");
    if (!status) {
      return;
    }
    status.textContent = message;
    status.dataset.state = state;
  }

  async function exportZonesCsv() {
    const rows = window.AppState.zonesRows;
    if (zonesLoading || zonesExporting || !Array.isArray(rows) || rows.length === 0) {
      return;
    }

    const limit = Number(window.AppState.zonesLimit);
    const allowedLimits = window.APP_ROW_LIMITS?.zones || [26, 60, 260];
    if (!Number.isInteger(limit) || !allowedLimits.includes(limit) || rows.length > limit) {
      setZonesExportStatus("Select 26, 60, or 260 Zones rows.", "error");
      return;
    }

    const exportRows = rows.map(row => {
      const exportRow = {};
      ZONES_EXPORT_FIELDS.forEach(field => {
        exportRow[field] = row[field] === undefined ? null : row[field];
      });
      return exportRow;
    });
    const button = document.getElementById("zonesExport");
    zonesExporting = true;
    if (button) {
      button.textContent = "Exporting…";
    }
    updateZonesExportButton();
    setZonesExportStatus("Exporting…", "loading");

    try {
      await window.api.downloadCsv(
        "/api/zones/export",
        "training-zones.csv",
        {
          method: "POST",
          body: JSON.stringify({ limit, rows: exportRows }),
        },
      );
      setZonesExportStatus("Zones CSV downloaded.", "success");
    } catch (_error) {
      setZonesExportStatus("Zones CSV export is temporarily unavailable.", "error");
    } finally {
      zonesExporting = false;
      if (button) {
        button.textContent = "Export CSV";
      }
      updateZonesExportButton();
    }
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

  async function loadZonesData() {
    const requestId = ++zonesLoadRequestId;
    const limit = Number(window.AppState.zonesLimit);
    zonesLoading = true;
    updateZonesExportButton();
    setZonesExportStatus("", "");

    try {
      try {
        if (window.api && typeof window.api.fetchZones === "function") {
          const rows = await window.api.fetchZones(limit);
          if (requestId !== zonesLoadRequestId) {
            return false;
          }
          window.AppState.zonesRows = rows;
        } else {
          const rows = await fetch(`/api/zones?limit=${limit}`).then(response => response.json());
          if (requestId !== zonesLoadRequestId) {
            return false;
          }
          window.AppState.zonesRows = rows;
        }
      } catch (error) {
        console.error(error);
        if (requestId !== zonesLoadRequestId) {
          return false;
        }
        window.AppState.zonesRows = [];
      }

      if (requestId !== zonesLoadRequestId) {
        return false;
      }

      renderZonesTable();

      if (window.AppState.activeTab === "zones") {
        renderHeaderSummary();
      }
      return true;
    } finally {
      if (requestId === zonesLoadRequestId) {
        zonesLoading = false;
        updateZonesExportButton();
      }
    }
  }

  function loadZones(force = true) {
    if (!force && zonesLoaded) {
      return Promise.resolve(true);
    }
    if (!force && zonesLoadPromise) {
      return zonesLoadPromise;
    }
    zonesLoadPromise = loadZonesData()
      .then(result => {
        zonesLoaded = result === true;
        return result === true;
      })
      .catch(() => false)
      .finally(() => {
        zonesLoadPromise = null;
      });
    return zonesLoadPromise;
  }

  function initZones() {
    if (zonesInitialized) {
      return true;
    }
    zonesInitialized = true;
    attachZonesLimitSelector();
    attachZonesExportButton();
    return true;
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

      if (typeof window.TrainingApp?.features?.settings?.updateLimitPreference === "function") {
        window.TrainingApp.features.settings.updateLimitPreference("zonesLimit", nextValue);
        return;
      }

      window.AppState.zonesLimit = nextValue;
      if (typeof window.persistPreferences === "function") {
        window.persistPreferences();
      }
      if (window.AppState.activeTab === "zones") {
        window.TrainingApp?.features?.zones?.refresh?.();
      }
    });

    zonesLimitListenerBound = true;
  }

  function attachZonesExportButton() {
    if (zonesExportListenerBound) {
      return;
    }
    const button = document.getElementById("zonesExport");
    if (!button) {
      return;
    }
    button.addEventListener("click", exportZonesCsv);
    zonesExportListenerBound = true;
    updateZonesExportButton();
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

  initZones();

  const zonesController = {
    init: initZones,
    activate: () => loadZones(false),
    refresh: () => loadZones(true),
    load: () => loadZones(true),
    render: renderZonesTable,
  };
  window.TrainingApp = window.TrainingApp || { features: {} };
  window.TrainingApp.features = window.TrainingApp.features || {};
  window.TrainingApp.registerFeature = window.TrainingApp.registerFeature || function (name, feature) {
    if (!feature || typeof feature !== "object") return;
    if (!Object.prototype.hasOwnProperty.call(window.TrainingApp.features, name)) {
      window.TrainingApp.features[name] = feature;
    }
  };
  window.TrainingApp.registerFeature("zones", zonesController);
})();
