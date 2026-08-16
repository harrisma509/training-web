/*
 * components.js
 * Component maintenance view and formatting helpers.
 * This module owns the components table and its row formatting; it consumes AppState plus the API helper for
 * fetches but does not own the global app shell or cross-feature preferences.
 */
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
  const archived = Array.isArray(payload.archived_components) ? payload.archived_components : [];

  if (rows.length === 0 && archived.length === 0) {
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
    const rowId = row.gear_component_id;
    const rowHtml = `
      <tr data-component-id="${componentEscapeHtml(String(rowId || ""))}">
        <td class="components-cell-name">${componentEscapeHtml(componentSafe(row.component_name, ""))}</td>
        <td>${componentEscapeHtml(componentSafe(row.component_group, "-"))}</td>
        <td>${componentEscapeHtml(componentSafe(row.position, "-"))}</td>
        <td>${componentEscapeHtml(componentSafe(latestEvent ? latestEvent.service_date : null, "-"))}</td>
        <td>
          <div class="components-action-stack">
            <span>${componentEscapeHtml(formatLatestAction(latestEvent))}</span>
            <div class="components-inline-actions">
              <button type="button" class="components-record-service-button" data-component-id="${componentEscapeHtml(String(rowId || ""))}" data-component-name="${componentEscapeHtml(componentSafe(row.component_name, ""))}" aria-label="Record service for ${componentEscapeHtml(componentSafe(row.component_name, ""))}">Record</button>
              <button type="button" class="components-history-button" data-component-id="${componentEscapeHtml(String(rowId || ""))}" data-component-name="${componentEscapeHtml(componentSafe(row.component_name, ""))}" aria-label="View service history for ${componentEscapeHtml(componentSafe(row.component_name, ""))}">History</button>
              <button type="button" class="components-edit-button" data-component-id="${componentEscapeHtml(String(rowId || ""))}" data-component-name="${componentEscapeHtml(componentSafe(row.component_name, ""))}" aria-label="Edit ${componentEscapeHtml(componentSafe(row.component_name, ""))}">Edit</button>
              <button type="button" class="components-archive-button" data-component-id="${componentEscapeHtml(String(rowId || ""))}" data-component-name="${componentEscapeHtml(componentSafe(row.component_name, ""))}" aria-label="Archive ${componentEscapeHtml(componentSafe(row.component_name, ""))}">Archive</button>
            </div>
          </div>
        </td>
        <td>${formatComponentNumber(usage.miles_since_service, 1)}</td>
        <td>${formatComponentNumber(usage.hours_since_service, 1)}</td>
        <td>${formatComponentInteger(usage.rides_since_service)}</td>
        <td>${formatComponentInteger(usage.days_since_service)}</td>
        <td>${componentEscapeHtml(formatServiceInterval(row))}</td>
        <td>${componentEscapeHtml(componentSafe(latestEvent ? latestEvent.notes : "", "-"))}</td>
      </tr>
    `;
    return rowHtml;
  }).join("");

  const archivedRows = archived.map(row => {
    const rowId = row.gear_component_id;
    return `
      <tr class="components-archived-row" data-component-id="${componentEscapeHtml(String(rowId || ""))}">
        <td class="components-cell-name">${componentEscapeHtml(componentSafe(row.component_name, ""))} <span class="components-archived-tag">Archived</span></td>
        <td>${componentEscapeHtml(componentSafe(row.component_group, "-"))}</td>
        <td>${componentEscapeHtml(componentSafe(row.position, "-"))}</td>
        <td>-</td>
        <td>
          <div class="components-inline-actions">
            <button type="button" class="components-history-button" data-component-id="${componentEscapeHtml(String(rowId || ""))}" data-component-name="${componentEscapeHtml(componentSafe(row.component_name, ""))}" aria-label="View service history for ${componentEscapeHtml(componentSafe(row.component_name, ""))}">History</button>
            <button type="button" class="components-restore-button" data-component-id="${componentEscapeHtml(String(rowId || ""))}" data-component-name="${componentEscapeHtml(componentSafe(row.component_name, ""))}">Restore</button>
          </div>
        </td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>-</td>
        <td>${componentEscapeHtml(formatServiceInterval(row))}</td>
        <td>${componentEscapeHtml(componentSafe(row.notes, "-"))}</td>
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
      ${bodyRows}${archivedRows}
    </tbody>
  `;

  table.querySelectorAll(".components-record-service-button").forEach(button => {
    button.addEventListener("click", async event => {
      const componentId = String(event.currentTarget.dataset.componentId || "").trim();
      if (!componentId) {
        return;
      }
      await openComponentServiceDrawer(componentId, event.currentTarget.dataset.componentName || "");
    });
  });

  table.querySelectorAll(".components-history-button").forEach(button => {
    button.addEventListener("click", async event => {
      const componentId = String(event.currentTarget.dataset.componentId || "").trim();
      if (!componentId) {
        return;
      }
      await openComponentHistoryDrawer(componentId, event.currentTarget.dataset.componentName || "");
    });
  });

  table.querySelectorAll(".components-edit-button").forEach(button => {
    button.addEventListener("click", async event => {
      const componentId = String(event.currentTarget.dataset.componentId || "").trim();
      if (!componentId) {
        return;
      }
      await openComponentEditor(componentId);
    });
  });

  table.querySelectorAll(".components-archive-button").forEach(button => {
    button.addEventListener("click", async event => {
      const componentId = String(event.currentTarget.dataset.componentId || "").trim();
      if (!componentId) {
        return;
      }
      const name = event.currentTarget.dataset.componentName || "this component";
      if (!window.confirm(`Archive ${name}? This keeps the component record but hides it from the active list.`)) {
        return;
      }
      try {
        await window.api.archiveComponent(componentId);
        await loadComponents();
      } catch (error) {
        window.alert(error.message || "Unable to archive component.");
      }
    });
  });

  table.querySelectorAll(".components-restore-button").forEach(button => {
    button.addEventListener("click", async event => {
      const componentId = String(event.currentTarget.dataset.componentId || "").trim();
      if (!componentId) {
        return;
      }
      const name = event.currentTarget.dataset.componentName || "this component";
      try {
        await window.api.restoreComponent(componentId);
        await loadComponents();
      } catch (error) {
        window.alert(error.message || `Unable to restore ${name}.`);
      }
    });
  });
}

function setComponentEditorStatus(message, kind = "info") {
  const statusEl = document.getElementById("componentEditorStatus");
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.remove("hidden", "status-error", "status-success", "status-info");
  statusEl.classList.add(kind === "error" ? "status-error" : kind === "success" ? "status-success" : "status-info");
}

const COMPONENT_TEMPLATES = {
  brake_pads: {
    component_group: "brakes",
    component_name: "Front Brake Pads",
    position: "front",
    component_key: "front_brake_pads",
    preferred_metric: "inspection",
    track_life: true,
    track_service: false,
    service_interval_miles: null,
    service_interval_hours: null,
    service_interval_days: null,
    service_interval_rides: null,
    warning_percent: 80,
    notes: "Original brake pad baseline for a specific wheel position.",
  },
  chain: {
    component_group: "Drivetrain",
    component_name: "Chain",
    position: "Drivetrain",
    component_key: "chain",
    preferred_metric: "miles",
    track_life: true,
    track_service: true,
    service_interval_miles: 1500,
    service_interval_hours: "",
    service_interval_days: "",
    service_interval_rides: "",
    notes: "Chain replacement or wear interval tracking.",
  },
  tires: {
    component_group: "Tire",
    component_name: "Tires",
    position: "Front / Rear",
    component_key: "tires",
    preferred_metric: "miles",
    track_life: true,
    track_service: true,
    service_interval_miles: 2000,
    service_interval_hours: "",
    service_interval_days: "",
    service_interval_rides: "",
    notes: "Use separate entries for front and rear tires when needed.",
  },
  custom: {
    component_group: "",
    component_name: "",
    position: "",
    component_key: "",
    preferred_metric: "mixed",
    track_life: false,
    track_service: true,
    service_interval_miles: "",
    service_interval_hours: "",
    service_interval_days: "",
    service_interval_rides: "",
    notes: "",
  },
};

function getComponentTemplateDefaults(templateKey = "custom") {
  return COMPONENT_TEMPLATES[templateKey] || COMPONENT_TEMPLATES.custom;
}

function applyComponentTemplate(templateKey) {
  const defaults = getComponentTemplateDefaults(templateKey);
  const fields = {
    componentEditorGroup: defaults.component_group || "",
    componentEditorName: defaults.component_name || "",
    componentEditorPosition: defaults.position || "",
    componentEditorKey: defaults.component_key || "",
    componentEditorMetric: defaults.preferred_metric || "mixed",
    componentEditorTrackLife: Boolean(defaults.track_life),
    componentEditorTrackService: defaults.track_service !== false,
    componentEditorMiles: defaults.service_interval_miles ?? "",
    componentEditorHours: defaults.service_interval_hours ?? "",
    componentEditorDays: defaults.service_interval_days ?? "",
    componentEditorRides: defaults.service_interval_rides ?? "",
    componentEditorWarning: defaults.warning_percent ?? 80,
    componentEditorNotes: defaults.notes || "",
  };

  Object.entries(fields).forEach(([id, value]) => {
    const el = document.getElementById(id);
    if (!el) {
      return;
    }
    if (el.type === "checkbox") {
      el.checked = Boolean(value);
      return;
    }
    el.value = value;
  });
}

function syncBrakePadIdentityFromPosition() {
  const positionInput = document.getElementById("componentEditorPosition");
  const nameInput = document.getElementById("componentEditorName");
  const keyInput = document.getElementById("componentEditorKey");
  const groupInput = document.getElementById("componentEditorGroup");
  const templateSelect = document.getElementById("componentEditorTemplate");
  if (!positionInput || !nameInput || !keyInput || !groupInput || !templateSelect) {
    return;
  }

  const template = String(templateSelect.value || "custom");
  if (template !== "brake_pads") {
    return;
  }

  const rawPosition = String(positionInput.value || "front").trim().toLowerCase();
  const normalPosition = rawPosition || "front";
  const displayPosition = normalPosition === "rear" ? "Rear" : normalPosition === "front" ? "Front" : normalPosition.charAt(0).toUpperCase() + normalPosition.slice(1);
  const name = `${displayPosition} Brake Pads`;
  const key = `${normalPosition.replace(/\s+/g, "_")}_brake_pads`;
  const group = "brakes";

  nameInput.value = name;
  keyInput.value = key;
  groupInput.value = group;
  document.getElementById("componentEditorMetric").value = "inspection";
  document.getElementById("componentEditorTrackLife").checked = true;
  document.getElementById("componentEditorTrackService").checked = false;
  document.getElementById("componentEditorWarning").value = 80;
  document.getElementById("componentEditorMiles").value = "";
  document.getElementById("componentEditorHours").value = "";
  document.getElementById("componentEditorDays").value = "";
  document.getElementById("componentEditorRides").value = "";
}

function setComponentEditorAdvancedVisibility(visible) {
  const section = document.getElementById("componentEditorAdvancedFields");
  const toggle = document.getElementById("componentEditorAdvancedToggle");
  if (!section || !toggle) {
    return;
  }
  section.classList.toggle("hidden", !visible);
  toggle.textContent = visible ? "Hide advanced settings" : "Show advanced settings";
}

function setComponentEditorBaselineMode(mode) {
  const buttons = document.querySelectorAll(".component-baseline-mode");
  const currentBlock = document.getElementById("componentEditorBaselineCustom");
  buttons.forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (currentBlock) {
    currentBlock.classList.toggle("hidden", mode !== "custom");
  }
}

function ensureComponentEditorDrawer() {
  let drawer = document.getElementById("componentEditorDrawer");
  if (drawer) {
    return drawer;
  }

  drawer = document.createElement("div");
  drawer.id = "componentEditorDrawer";
  drawer.className = "components-editor-drawer hidden";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <div class="components-editor-panel" role="dialog" aria-modal="true" aria-labelledby="componentEditorTitle">
      <div class="components-editor-header">
        <div>
          <div id="componentEditorTitle" class="components-editor-title">Edit Component</div>
          <div id="componentEditorSubtitle" class="components-editor-subtitle">Update component configuration</div>
        </div>
        <button type="button" id="componentEditorCloseBtn" class="drawer-close-button" aria-label="Close component editor">×</button>
      </div>
      <div id="componentEditorStatus" class="components-editor-status hidden" aria-live="polite"></div>
      <div class="components-editor-body">
        <form id="componentEditorForm" class="components-editor-form">
          <div class="components-editor-grid">
            <section class="components-editor-section">
              <div class="drawer-section-title">Identity</div>
              <div class="drawer-field-group">
                <label for="componentEditorTemplate">Template</label>
                <select id="componentEditorTemplate" name="component_template">
                  <option value="custom">Custom</option>
                  <option value="brake_pads">Brake Pads</option>
                  <option value="chain">Chain</option>
                  <option value="tires">Tires</option>
                </select>
              </div>
              <div class="drawer-field-group">
                <label for="componentEditorGroup">Component group</label>
                <input id="componentEditorGroup" name="component_group" type="text" required>
              </div>
              <div class="drawer-field-group">
                <label for="componentEditorName">Component name</label>
                <input id="componentEditorName" name="component_name" type="text" required>
              </div>
              <div class="drawer-field-group">
                <label for="componentEditorPosition">Position</label>
                <input id="componentEditorPosition" name="position" type="text" placeholder="Front, Rear, dropouts, etc.">
              </div>
              <div class="drawer-field-group">
                <label for="componentEditorKey">Component key</label>
                <input id="componentEditorKey" name="component_key" type="text" placeholder="Optional slug">
              </div>
            </section>

            <section class="components-editor-section">
              <div class="drawer-section-title">Tracking</div>
              <div class="drawer-field-group drawer-toggle-group">
                <label class="drawer-check-label" for="componentEditorTrackLife">
                  <input id="componentEditorTrackLife" name="track_life" type="checkbox">
                  <span>Track life</span>
                </label>
              </div>
              <div class="drawer-field-group drawer-toggle-group">
                <label class="drawer-check-label" for="componentEditorTrackService">
                  <input id="componentEditorTrackService" name="track_service" type="checkbox" checked>
                  <span>Track service</span>
                </label>
              </div>
              <div class="drawer-field-group">
                <label for="componentEditorMetric">Preferred metric</label>
                <select id="componentEditorMetric" name="preferred_metric">
                  <option value="mixed">mixed</option>
                  <option value="miles">miles</option>
                  <option value="hours">hours</option>
                  <option value="days">days</option>
                  <option value="rides">rides</option>
                  <option value="inspection">inspection</option>
                </select>
              </div>
              <div class="drawer-field-group">
                <label>Lifecycle baseline</label>
                <div class="component-baseline-toggle" role="tablist" aria-label="Lifecycle baseline mode">
                  <button type="button" class="component-baseline-mode active" data-mode="current_snapshot" aria-pressed="true">Current bike snapshot</button>
                  <button type="button" class="component-baseline-mode" data-mode="custom" aria-pressed="false">Custom start</button>
                </div>
                <div id="componentEditorBaselineCustom" class="component-baseline-custom hidden">
                  <div class="drawer-inline-grid">
                    <div>
                      <label for="componentEditorBaselineDate">Install date</label>
                      <input id="componentEditorBaselineDate" name="baseline_service_date" type="date">
                    </div>
                    <div>
                      <label for="componentEditorBaselineMiles">Bike miles at install</label>
                      <input id="componentEditorBaselineMiles" name="baseline_bike_miles" type="number" min="0" step="0.1" placeholder="Optional">
                    </div>
                  </div>
                  <div class="drawer-inline-grid">
                    <div>
                      <label for="componentEditorBaselineHours">Bike hours</label>
                      <input id="componentEditorBaselineHours" name="baseline_bike_hours" type="number" min="0" step="0.1" placeholder="Optional">
                    </div>
                    <div>
                      <label for="componentEditorBaselineRides">Bike rides</label>
                      <input id="componentEditorBaselineRides" name="baseline_bike_rides" type="number" min="0" step="1" placeholder="Optional">
                    </div>
                  </div>
                </div>
                <div class="field-hint">Use the live total bike mileage at save time for a fresh installation; set a custom value to establish an original component at a known bike mileage.</div>
              </div>
            </section>

            <section class="components-editor-section">
              <div class="drawer-section-title">Service defaults</div>
              <div class="drawer-field-group drawer-inline-grid">
                <div>
                  <label for="componentEditorMiles">Service miles</label>
                  <input id="componentEditorMiles" name="service_interval_miles" type="number" min="0" step="0.01" placeholder="Optional">
                </div>
                <div>
                  <label for="componentEditorHours">Service hours</label>
                  <input id="componentEditorHours" name="service_interval_hours" type="number" min="0" step="0.01" placeholder="Optional">
                </div>
              </div>
              <div class="drawer-field-group drawer-inline-grid">
                <div>
                  <label for="componentEditorDays">Service days</label>
                  <input id="componentEditorDays" name="service_interval_days" type="number" min="1" step="1" placeholder="Optional">
                </div>
                <div>
                  <label for="componentEditorRides">Service rides</label>
                  <input id="componentEditorRides" name="service_interval_rides" type="number" min="1" step="1" placeholder="Optional">
                </div>
              </div>

              <div class="drawer-advanced-toggle-wrap">
                <button type="button" id="componentEditorAdvancedToggle" class="button-secondary small">Show advanced settings</button>
              </div>

              <div id="componentEditorAdvancedFields" class="drawer-advanced-fields hidden">
                <div class="drawer-field-group drawer-inline-grid">
                  <div>
                    <label for="componentEditorWarning">Warning %</label>
                    <input id="componentEditorWarning" name="warning_percent" type="number" min="0.01" max="100" step="0.01" value="80">
                  </div>
                  <div>
                    <label for="componentEditorOrder">Display order</label>
                    <input id="componentEditorOrder" name="display_order" type="number" min="0" step="1" value="100">
                  </div>
                </div>
                <div class="drawer-field-group">
                  <label for="componentEditorNotes">Notes</label>
                  <textarea id="componentEditorNotes" name="notes" rows="4" placeholder="Optional notes"></textarea>
                </div>
              </div>
            </section>
          </div>
        </form>
      </div>
      <div class="components-editor-footer">
        <button type="button" id="componentEditorCancelBtn" class="button-secondary">Cancel</button>
        <button type="submit" id="componentEditorSaveBtn" class="button-primary" form="componentEditorForm">Save</button>
      </div>
    </div>
  `;

  const form = drawer.querySelector("#componentEditorForm");
  const componentTemplate = form.querySelector("#componentEditorTemplate");
  const advancedToggle = form.querySelector("#componentEditorAdvancedToggle");
  const baselineButtons = form.querySelectorAll(".component-baseline-mode");

  componentTemplate.addEventListener("change", event => {
    const template = event.target.value || "custom";
    applyComponentTemplate(template);
    if (template === "brake_pads") {
      syncBrakePadIdentityFromPosition();
    }
  });

  const positionInput = form.querySelector("#componentEditorPosition");
  if (positionInput) {
    positionInput.addEventListener("input", () => {
      if (componentTemplate.value === "brake_pads") {
        syncBrakePadIdentityFromPosition();
      }
    });
  }

  advancedToggle.addEventListener("click", () => {
    const hidden = form.querySelector("#componentEditorAdvancedFields").classList.contains("hidden");
    setComponentEditorAdvancedVisibility(!hidden);
  });

  baselineButtons.forEach(button => {
    button.addEventListener("click", () => setComponentEditorBaselineMode(button.dataset.mode || "current_snapshot"));
  });

  const closeBtn = drawer.querySelector("#componentEditorCloseBtn");
  const cancelBtn = drawer.querySelector("#componentEditorCancelBtn");
  closeBtn.addEventListener("click", () => closeComponentEditor());
  cancelBtn.addEventListener("click", () => closeComponentEditor());
  drawer.addEventListener("click", event => {
    if (event.target === drawer) {
      closeComponentEditor();
    }
  });

  if (form.dataset.submitBound === "1") {
    return drawer;
  }
  form.dataset.submitBound = "1";
  form.addEventListener("submit", async event => {
    event.preventDefault();
    console.debug("[component-editor] submit received");

    const componentId = drawer.dataset.componentId;
    const selectedGearId = String(window.AppState.componentsSelectedGearId || window.AppState.defaultBikeGearId || "").trim();
    const saveBtn = drawer.querySelector("#componentEditorSaveBtn") || document.getElementById("componentEditorSaveBtn");

    if (!componentId) {
      console.debug("[component-editor] missing componentId; aborting");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const baselineMode = form.querySelector(".component-baseline-mode.active")?.dataset.mode || "current_snapshot";
    const payload = {
      ...(componentId === "new" ? { gear_id: selectedGearId } : {}),
      component_name: String(formData.get("component_name") || "").trim(),
      component_group: String(formData.get("component_group") || "").trim(),
      position: String(formData.get("position") || "").trim() || null,
      component_key: String(formData.get("component_key") || "").trim() || null,
      preferred_metric: String(formData.get("preferred_metric") || "mixed").trim() || "mixed",
      track_life: Boolean(formData.get("track_life")),
      track_service: Boolean(formData.get("track_service")),
      service_interval_miles: formData.get("service_interval_miles") || null,
      service_interval_hours: formData.get("service_interval_hours") || null,
      service_interval_days: formData.get("service_interval_days") || null,
      service_interval_rides: formData.get("service_interval_rides") || null,
      warning_percent: Number(formData.get("warning_percent") || 80),
      display_order: Number(formData.get("display_order") || 100),
      notes: String(formData.get("notes") || "").trim() || null,
      ...(componentId === "new" ? {
        baseline_mode: baselineMode,
        baseline_service_date: String(formData.get("baseline_service_date") || "").trim() || "",
        baseline_bike_miles: formData.get("baseline_bike_miles") || null,
        baseline_bike_hours: formData.get("baseline_bike_hours") || null,
        baseline_bike_rides: formData.get("baseline_bike_rides") || null,
      } : {}),
    };

    if (!payload.component_name || !payload.component_group || (componentId === "new" && !selectedGearId)) {
      console.debug("[component-editor] validation failed", payload);
      setComponentEditorStatus("Component name, group, and bike selection are required.", "error");
      return;
    }

    console.debug("[component-editor] validation passed", { componentId, baselineMode, payload });

    if (saveBtn) {
      saveBtn.disabled = true;
    }
    setComponentEditorStatus("Saving component…", "info");

    try {
      if (componentId === "new") {
        console.debug("[component-editor] request starting");
        const response = await window.api.createComponent(payload);
        console.debug("[component-editor] response received", response);
        setComponentEditorStatus("Component added.", "success");
      } else {
        console.debug("[component-editor] request starting");
        const response = await window.api.updateComponent(componentId, payload);
        console.debug("[component-editor] response received", response);
        setComponentEditorStatus("Component updated.", "success");
      }
      await loadComponents();
      closeComponentEditor();
    } catch (error) {
      console.debug("[component-editor] request failed", error?.message || error);
      setComponentEditorStatus(error.message || "Unable to save component.", "error");
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
      }
    }
  });

  document.body.appendChild(drawer);
  return drawer;
}

async function openComponentEditor(componentId) {
  const drawer = ensureComponentEditorDrawer();
  const form = drawer.querySelector("#componentEditorForm");
  const statusEl = drawer.querySelector("#componentEditorStatus");
  const titleEl = drawer.querySelector("#componentEditorTitle");
  const subtitleEl = drawer.querySelector("#componentEditorSubtitle");
  const rows = Array.isArray(window.AppState.componentsData?.components) ? window.AppState.componentsData.components : [];
  const row = rows.find(item => String(item.gear_component_id) === String(componentId));

  if (!row) {
    window.alert("Component not found.");
    return;
  }

  drawer.dataset.componentId = String(componentId);
  form.reset();
  setComponentEditorBaselineMode("current_snapshot");
  setComponentEditorAdvancedVisibility(false);
  statusEl.textContent = "";
  statusEl.classList.add("hidden");

  document.getElementById("componentEditorTemplate").value = "custom";
  document.getElementById("componentEditorName").value = row.component_name || "";
  document.getElementById("componentEditorGroup").value = row.component_group || "";
  document.getElementById("componentEditorPosition").value = row.position || "";
  document.getElementById("componentEditorKey").value = row.component_key || "";
  document.getElementById("componentEditorMetric").value = row.preferred_metric || "mixed";
  document.getElementById("componentEditorTrackLife").checked = Boolean(row.track_life);
  document.getElementById("componentEditorTrackService").checked = row.track_service !== false;
  document.getElementById("componentEditorMiles").value = row.service_interval_miles ?? "";
  document.getElementById("componentEditorHours").value = row.service_interval_hours ?? "";
  document.getElementById("componentEditorDays").value = row.service_interval_days ?? "";
  document.getElementById("componentEditorRides").value = row.service_interval_rides ?? "";
  document.getElementById("componentEditorWarning").value = row.warning_percent ?? 80;
  document.getElementById("componentEditorOrder").value = row.display_order ?? 100;
  document.getElementById("componentEditorNotes").value = row.notes || "";

  titleEl.textContent = `Edit Component - ${row.component_name || "Component"}`;
  subtitleEl.textContent = "Edit the tracked component configuration without changing history.";
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  setTimeout(() => document.getElementById("componentEditorName").focus(), 50);
}

function closeComponentEditor() {
  const drawer = document.getElementById("componentEditorDrawer");
  if (!drawer) {
    return;
  }
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
  delete drawer.dataset.componentId;
}

function ensureComponentAddControls() {
  const button = document.getElementById("componentsAddButton");
  if (!button) {
    return;
  }

  button.addEventListener("click", () => {
    const drawer = ensureComponentEditorDrawer();
    const form = drawer.querySelector("#componentEditorForm");
    const statusEl = drawer.querySelector("#componentEditorStatus");
    const titleEl = drawer.querySelector("#componentEditorTitle");
    const subtitleEl = drawer.querySelector("#componentEditorSubtitle");
    const selectedGearId = String(window.AppState.componentsSelectedGearId || window.AppState.defaultBikeGearId || "").trim();

    if (!selectedGearId) {
      window.alert("Select a bike before adding a component.");
      return;
    }

      drawer.dataset.componentId = "new";
    form.reset();
    setComponentEditorBaselineMode("current_snapshot");
    setComponentEditorAdvancedVisibility(false);
    statusEl.textContent = "";
    statusEl.classList.add("hidden");
    document.getElementById("componentEditorTemplate").value = "brake_pads";
    applyComponentTemplate("brake_pads");
    document.getElementById("componentEditorWarning").value = 80;
    document.getElementById("componentEditorOrder").value = 100;
    document.getElementById("componentEditorBaselineDate").value = new Date().toISOString().slice(0, 10);

    titleEl.textContent = "Add Component";
    subtitleEl.textContent = "Create a new tracked component for the selected bike.";
    drawer.classList.remove("hidden");
    drawer.setAttribute("aria-hidden", "false");
    setTimeout(() => document.getElementById("componentEditorName").focus(), 50);
  });
}

function initializeComponentsUi() {
  ensureComponentAddControls();
}

initializeComponentsUi();

function ensureComponentServiceDrawer() {
  let drawer = document.getElementById("componentServiceDrawer");
  if (drawer) {
    return drawer;
  }

  drawer = document.createElement("div");
  drawer.id = "componentServiceDrawer";
  drawer.className = "components-service-drawer hidden";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <div class="components-service-panel" role="dialog" aria-modal="true" aria-labelledby="componentServiceTitle">
      <div class="components-service-header">
        <div>
          <div id="componentServiceTitle" class="components-service-title">Record Service</div>
          <div id="componentServiceSubtitle" class="components-service-subtitle">Service details for the selected component</div>
        </div>
        <button type="button" id="componentServiceCloseBtn" class="drawer-close-button" aria-label="Close service drawer">×</button>
      </div>
      <div id="componentServiceStatus" class="components-service-status hidden" aria-live="polite"></div>
      <div class="components-service-body">
        <div id="componentServiceContext" class="components-service-context"></div>
        <form id="componentServiceForm" class="components-service-form">
          <div class="drawer-field-group">
            <label for="componentServiceDate">Service date</label>
            <input id="componentServiceDate" name="service_date" type="date" required>
          </div>
          <div class="drawer-field-group">
            <label for="componentServiceType">Service type</label>
            <select id="componentServiceType" name="service_type" required>
              <option value="">Select a service type</option>
              <option value="Inspection">Inspection</option>
              <option value="Adjustment">Adjustment</option>
              <option value="Cleaning">Cleaning</option>
              <option value="Lubrication">Lubrication</option>
              <option value="Brake Bleed">Brake Bleed</option>
              <option value="Brake Pads">Brake Pads</option>
              <option value="Rotor">Rotor</option>
              <option value="Tire">Tire</option>
              <option value="Sealant">Sealant</option>
              <option value="Suspension Service">Suspension Service</option>
              <option value="Drivetrain">Drivetrain</option>
              <option value="Chain">Chain</option>
              <option value="Bearing">Bearing</option>
              <option value="Wheel">Wheel</option>
              <option value="Replacement">Replacement</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div class="drawer-field-group">
            <label for="componentServiceProvider">Service provider</label>
            <input id="componentServiceProvider" name="service_provider" type="text" placeholder="Optional">
          </div>
          <div class="drawer-field-group">
            <label for="componentServiceCost">Service cost</label>
            <input id="componentServiceCost" name="service_cost" type="number" min="0" step="0.01" placeholder="Optional">
          </div>
          <div class="drawer-field-group">
            <label for="componentServiceNotes">Notes</label>
            <textarea id="componentServiceNotes" name="notes" rows="4" placeholder="Describe the work performed"></textarea>
          </div>
          <div class="drawer-field-group">
            <label>Usage snapshot</label>
            <div id="componentServiceUsage" class="components-service-usage">Unavailable</div>
          </div>
          <div class="drawer-actions">
            <button type="button" id="componentServiceCancelBtn" class="button-secondary">Cancel</button>
            <button type="submit" id="componentServiceSaveBtn" class="button-primary">Save Service</button>
          </div>
        </form>
      </div>
    </div>
  `;

  const closeBtn = drawer.querySelector("#componentServiceCloseBtn");
  const cancelBtn = drawer.querySelector("#componentServiceCancelBtn");
  closeBtn.addEventListener("click", () => closeComponentServiceDrawer());
  cancelBtn.addEventListener("click", () => closeComponentServiceDrawer());
  drawer.addEventListener("click", event => {
    if (event.target === drawer) {
      closeComponentServiceDrawer();
    }
  });

  drawer.querySelector("#componentServiceForm").addEventListener("submit", async event => {
    event.preventDefault();
    const componentId = drawer.dataset.componentId;
    if (!componentId) {
      return;
    }
    const formData = new FormData(event.currentTarget);
    const payload = {
      service_date: formData.get("service_date") || "",
      service_type: formData.get("service_type") || "",
      notes: formData.get("notes") || "",
      service_provider: formData.get("service_provider") || "",
      service_cost: formData.get("service_cost") || null,
      service_location: "",
    };

    if (!payload.service_date || !payload.service_type) {
      setComponentServiceStatus("Service date and service type are required.", "error");
      return;
    }

    const saveBtn = event.currentTarget.querySelector("#componentServiceSaveBtn");
    saveBtn.disabled = true;
    try {
      const saved = await window.api.createComponentService(componentId, payload);
      if (saved && saved.service_event_id) {
        setComponentServiceStatus("Service recorded successfully.", "success");
        window.setTimeout(() => {
          closeComponentServiceDrawer();
          loadComponents();
        }, 300);
      }
    } catch (error) {
      setComponentServiceStatus(error.message || "Unable to save the service record.", "error");
    } finally {
      saveBtn.disabled = false;
    }
  });

  document.body.appendChild(drawer);
  return drawer;
}

function setComponentServiceStatus(message, kind = "info") {
  const statusEl = document.getElementById("componentServiceStatus");
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.remove("hidden", "status-error", "status-success", "status-info");
  statusEl.classList.add(kind === "error" ? "status-error" : kind === "success" ? "status-success" : "status-info");
}

async function openComponentServiceDrawer(componentId, componentName = "") {
  const drawer = ensureComponentServiceDrawer();
  const form = drawer.querySelector("#componentServiceForm");
  const dateInput = drawer.querySelector("#componentServiceDate");
  const typeInput = drawer.querySelector("#componentServiceType");
  const providerInput = drawer.querySelector("#componentServiceProvider");
  const costInput = drawer.querySelector("#componentServiceCost");
  const notesInput = drawer.querySelector("#componentServiceNotes");
  const usageEl = drawer.querySelector("#componentServiceUsage");
  const titleEl = drawer.querySelector("#componentServiceTitle");
  const subtitleEl = drawer.querySelector("#componentServiceSubtitle");
  const statusEl = drawer.querySelector("#componentServiceStatus");

  titleEl.textContent = `Record Service - ${componentName || "Component"}`;
  subtitleEl.textContent = "Capture a newly completed service or maintenance event.";
  statusEl.textContent = "";
  statusEl.classList.add("hidden");
  form.reset();
  drawer.dataset.componentId = String(componentId);

  const today = new Date();
  dateInput.value = today.toISOString().slice(0, 10);
  typeInput.value = "";
  providerInput.value = "";
  costInput.value = "";
  notesInput.value = "";

  try {
    const payload = await window.api.fetchComponentServices(componentId);
    const component = payload && payload.component ? payload.component : null;
    const services = Array.isArray(payload && payload.services) ? payload.services : [];
    const latest = services[0] || null;
    const usageText = latest && (latest.mileage_at_service != null || latest.hours_at_service != null || latest.rides_at_service != null)
      ? [
          latest.mileage_at_service != null ? `${formatComponentNumber(latest.mileage_at_service, 1, "0.0")} mi` : null,
          latest.hours_at_service != null ? `${formatComponentNumber(latest.hours_at_service, 1, "0.0")} hr` : null,
          latest.rides_at_service != null ? `${formatComponentInteger(latest.rides_at_service)} rides` : null,
        ].filter(Boolean).join(" • ")
      : "No usage snapshot available";
    usageEl.textContent = usageText;
    if (component) {
      const context = [
        component.component_name,
        component.component_group,
        component.bike_name ? `Bike: ${component.bike_name}` : null,
      ].filter(Boolean).join(" • ");
      drawer.querySelector("#componentServiceContext").innerHTML = `<div class="components-service-context-row"><strong>Component:</strong> ${componentEscapeHtml(context)}</div>`;
    }
  } catch (error) {
    usageEl.textContent = "No usage snapshot available";
  }

  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  setTimeout(() => typeInput.focus(), 50);
}

function closeComponentServiceDrawer() {
  const drawer = document.getElementById("componentServiceDrawer");
  if (!drawer) {
    return;
  }
  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
  delete drawer.dataset.componentId;
}

function formatServiceHistoryDate(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(`${String(value)}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function displayText(value) {
  if (value === null || value === undefined) {
    return "";
  }

  const text = String(value).trim();
  if (!text || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") {
    return "";
  }

  return text;
}

function formatComponentHistoryHeaderMetadata(component = {}) {
  const bikeName = displayText(component.bike_display_name || component.bike_name || component.brand || component.model_year || "");
  const group = displayText(component.component_group);
  const formattedGroup = group ? group.charAt(0).toUpperCase() + group.slice(1) : "";
  const rawPosition = displayText(component.position);
  const position = rawPosition ? rawPosition.charAt(0).toUpperCase() + rawPosition.slice(1) : "";
  const status = component.active === false ? "Archived" : "Active";

  return [bikeName, formattedGroup, position, status].filter(Boolean).join(" · ");
}

function formatComponentHistoryCost(rawCost) {
  if (rawCost === null || rawCost === undefined || rawCost === "" || String(rawCost).trim() === "") {
    return "Cost not recorded";
  }

  const numberValue = Number(rawCost);
  if (!Number.isFinite(numberValue)) {
    return "Cost not recorded";
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numberValue);
}

function ensureComponentHistoryDrawer() {
  let drawer = document.getElementById("componentHistoryDrawer");
  if (drawer) {
    return drawer;
  }

  drawer = document.createElement("div");
  drawer.id = "componentHistoryDrawer";
  drawer.className = "components-history-drawer hidden";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <div class="components-history-panel" role="dialog" aria-modal="true" aria-labelledby="componentHistoryTitle">
      <div class="components-history-header">
        <div>
          <div id="componentHistoryTitle" class="components-history-title">Service History</div>
          <div id="componentHistorySubtitle" class="components-history-subtitle">Component service log</div>
        </div>
        <div class="components-history-header-actions">
          <button type="button" id="componentHistoryRefreshBtn" class="button-secondary small">Refresh</button>
          <button type="button" id="componentHistoryCloseBtn" class="drawer-close-button" aria-label="Close service history">×</button>
        </div>
      </div>
      <div id="componentHistoryStatus" class="components-history-status hidden" aria-live="polite"></div>
      <div class="components-history-body">
        <div id="componentHistoryLoading" class="components-history-loading">Loading service history…</div>
        <div id="componentHistoryError" class="components-history-error hidden" role="alert"></div>
        <div id="componentHistoryEmpty" class="components-history-empty hidden">No service events have been recorded for this component.</div>
        <div id="componentHistoryList" class="components-history-list"></div>
      </div>
      <div class="components-history-footer">
        <button type="button" id="componentHistoryRetryBtn" class="button-secondary hidden">Retry</button>
        <button type="button" id="componentHistoryDoneBtn" class="button-primary">Close</button>
      </div>
    </div>
  `;

  const closeBtn = drawer.querySelector("#componentHistoryCloseBtn");
  const doneBtn = drawer.querySelector("#componentHistoryDoneBtn");
  const retryBtn = drawer.querySelector("#componentHistoryRetryBtn");
  const refreshBtn = drawer.querySelector("#componentHistoryRefreshBtn");

  closeBtn.addEventListener("click", () => closeComponentHistoryDrawer());
  doneBtn.addEventListener("click", () => closeComponentHistoryDrawer());
  retryBtn.addEventListener("click", async () => {
    const componentId = String(drawer.dataset.componentId || "").trim();
    if (!componentId) {
      return;
    }
    await openComponentHistoryDrawer(componentId, drawer.dataset.componentName || "");
  });
  refreshBtn.addEventListener("click", async () => {
    const componentId = String(drawer.dataset.componentId || "").trim();
    if (!componentId) {
      return;
    }
    await loadComponentHistory(componentId, { componentName: drawer.dataset.componentName || "" });
  });

  drawer.addEventListener("click", event => {
    if (event.target === drawer) {
      closeComponentHistoryDrawer();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !drawer.classList.contains("hidden") && drawer.dataset.componentId) {
      closeComponentHistoryDrawer();
    }
  });

  document.body.appendChild(drawer);
  return drawer;
}

function setComponentHistoryStatus(message, kind = "info") {
  const statusEl = document.getElementById("componentHistoryStatus");
  if (!statusEl) {
    return;
  }
  statusEl.textContent = message;
  statusEl.classList.remove("hidden", "status-error", "status-success", "status-info");
  statusEl.classList.add(kind === "error" ? "status-error" : kind === "success" ? "status-success" : "status-info");
}

function renderComponentHistoryList(services = []) {
  const listEl = document.getElementById("componentHistoryList");
  const emptyEl = document.getElementById("componentHistoryEmpty");
  const loadingEl = document.getElementById("componentHistoryLoading");
  const errorEl = document.getElementById("componentHistoryError");
  const retryBtn = document.getElementById("componentHistoryRetryBtn");

  if (!listEl || !emptyEl || !loadingEl || !errorEl || !retryBtn) {
    return;
  }

  listEl.innerHTML = "";
  loadingEl.classList.add("hidden");
  errorEl.classList.add("hidden");
  retryBtn.classList.add("hidden");

  if (!Array.isArray(services) || services.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }

  emptyEl.classList.add("hidden");

  const items = services.map(service => {
    const serviceType = componentSafe(service.service_type, "Service");
    const notes = displayText(service.notes);
    const provider = displayText(service.service_provider);
    const location = displayText(service.service_location);
    const productText = displayText(service.product_name);
    const manufacturer = displayText(service.manufacturer);
    const model = displayText(service.model);
    const costText = formatComponentHistoryCost(service.cost);

    const snapshotParts = [];
    if (service.mileage_at_service != null && service.mileage_at_service !== "") {
      snapshotParts.push(`${formatComponentNumber(service.mileage_at_service, 1, "0.0")} mi`);
    }
    if (service.hours_at_service != null && service.hours_at_service !== "") {
      snapshotParts.push(`${formatComponentNumber(service.hours_at_service, 1, "0.0")} hr`);
    }
    if (service.rides_at_service != null && service.rides_at_service !== "") {
      snapshotParts.push(`${formatComponentInteger(service.rides_at_service)} rides`);
    }
    if (service.elevation_at_service != null && service.elevation_at_service !== "") {
      snapshotParts.push(`${formatComponentInteger(service.elevation_at_service)} ft`);
    }

    const productMarkup = [];
    if (productText) {
      productMarkup.push(`<div class="components-history-field"><span class="components-history-field-label">Product</span><span>${componentEscapeHtml(productText)}</span></div>`);
    }
    if (manufacturer || model) {
      const productDetail = [manufacturer ? `Manufacturer: ${manufacturer}` : null, model ? `Model: ${model}` : null].filter(Boolean).join(" · ");
      if (productDetail) {
        productMarkup.push(`<div class="components-history-field"><span class="components-history-field-label">Product details</span><span>${componentEscapeHtml(productDetail)}</span></div>`);
      }
    }

    const secondaryMeta = [provider || location ? [provider, location].filter(Boolean).join(" • ") : null].filter(Boolean);

    return `
      <article class="components-history-item">
        <div class="components-history-head">
          <div class="components-history-date">${componentEscapeHtml(formatServiceHistoryDate(service.service_date))}</div>
          <span class="components-history-type">${componentEscapeHtml(serviceType)}</span>
        </div>
        ${productMarkup.length ? `<div class="components-history-product-group">${productMarkup.join("")}</div>` : ""}
        ${snapshotParts.length ? `<div class="components-history-field"><span class="components-history-field-label">Bike snapshot at event</span><span>${componentEscapeHtml(snapshotParts.join(" · "))}</span></div>` : ""}
        <div class="components-history-field"><span class="components-history-field-label">Cost</span><span>${componentEscapeHtml(costText)}</span></div>
        ${notes ? `<div class="components-history-notes"><strong>Notes</strong> ${componentEscapeHtml(notes)}</div>` : ""}
        ${secondaryMeta.length ? `<div class="components-history-meta">${componentEscapeHtml(secondaryMeta.join(" • "))}</div>` : ""}
      </article>
    `;
  }).join("");

  listEl.innerHTML = items;
}

async function loadComponentHistory(componentId, options = {}) {
  const drawer = document.getElementById("componentHistoryDrawer");
  if (!drawer) {
    return;
  }

  const componentName = options.componentName || drawer.dataset.componentName || "";
  const titleEl = drawer.querySelector("#componentHistoryTitle");
  const subtitleEl = drawer.querySelector("#componentHistorySubtitle");
  const listEl = drawer.querySelector("#componentHistoryList");
  const loadingEl = drawer.querySelector("#componentHistoryLoading");
  const errorEl = drawer.querySelector("#componentHistoryError");
  const emptyEl = drawer.querySelector("#componentHistoryEmpty");
  const retryBtn = drawer.querySelector("#componentHistoryRetryBtn");
  const requestId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  drawer.dataset.historyRequestId = requestId;

  if (titleEl) {
    titleEl.textContent = componentName ? `Service History: ${componentName}` : "Service History";
  }
  if (subtitleEl) {
    subtitleEl.textContent = "";
  }

  listEl.innerHTML = "";
  loadingEl.classList.remove("hidden");
  errorEl.classList.add("hidden");
  emptyEl.classList.add("hidden");
  retryBtn.classList.add("hidden");
  setComponentHistoryStatus("Loading service history…", "info");

  try {
    const payload = await window.api.fetchComponentServices(componentId);
    if (String(drawer.dataset.historyRequestId || "") !== String(requestId)) {
      return;
    }

    const component = payload && payload.component ? payload.component : {};
    const services = Array.isArray(payload && payload.services) ? payload.services : [];
    const componentArchived = component.active === false;
    drawer.dataset.componentArchived = componentArchived ? "true" : "false";

    if (subtitleEl) {
      subtitleEl.textContent = formatComponentHistoryHeaderMetadata(component);
    }

    renderComponentHistoryList(services);
    setComponentHistoryStatus(componentArchived ? "Archived component history is read-only." : "Service history loaded.", "info");
  } catch (error) {
    if (String(drawer.dataset.historyRequestId || "") !== String(requestId)) {
      return;
    }

    loadingEl.classList.add("hidden");
    errorEl.textContent = error.message || "Unable to load service history.";
    errorEl.classList.remove("hidden");
    retryBtn.classList.remove("hidden");
    setComponentHistoryStatus("Unable to load service history.", "error");
  }
}

async function openComponentHistoryDrawer(componentId, componentName = "") {
  const drawer = ensureComponentHistoryDrawer();
  const previousFocus = document.activeElement;
  const previousId = previousFocus && previousFocus.id ? previousFocus.id : (previousFocus && previousFocus.dataset && previousFocus.dataset.componentId ? previousFocus.dataset.componentId : "");

  drawer.dataset.componentId = String(componentId || "");
  drawer.dataset.componentName = componentName || "";
  drawer.dataset.componentArchived = "false";
  drawer.dataset.returnFocus = previousId || "";

  const titleEl = drawer.querySelector("#componentHistoryTitle");
  if (titleEl) {
    titleEl.textContent = componentName || "Service History";
  }

  const subtitleEl = drawer.querySelector("#componentHistorySubtitle");
  if (subtitleEl) {
    subtitleEl.textContent = "";
  }

  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");
  const closeBtn = drawer.querySelector("#componentHistoryCloseBtn");
  closeBtn && closeBtn.focus();

  await loadComponentHistory(componentId, { componentName });
}

function closeComponentHistoryDrawer() {
  const drawer = document.getElementById("componentHistoryDrawer");
  if (!drawer) {
    return;
  }

  drawer.classList.add("hidden");
  drawer.setAttribute("aria-hidden", "true");
  delete drawer.dataset.componentId;
  delete drawer.dataset.componentName;
  delete drawer.dataset.componentArchived;
  delete drawer.dataset.historyRequestId;

  const focusTarget = drawer.dataset.returnFocus || "";
  if (focusTarget) {
    const target = document.getElementById(focusTarget) || document.querySelector(`[data-component-id="${CSS.escape(focusTarget)}"]`);
    if (target && typeof target.focus === "function") {
      target.focus();
    }
  }
  delete drawer.dataset.returnFocus;
}

async function loadComponents() {
  const selectedGearId = String(window.AppState.componentsSelectedGearId || window.AppState.defaultBikeGearId || "").trim();

  try {
    const payload = window.api && typeof window.api.fetchComponents === "function"
      ? await window.api.fetchComponents(selectedGearId)
      : await fetch(selectedGearId
          ? `/api/gear/components?gear_id=${encodeURIComponent(selectedGearId)}`
          : "/api/gear/components").then(async response => {
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
            return response.json();
          });

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

window.ComponentsController = {
  load: loadComponents,
  render: renderComponentsTable,
  syncBikeSelect: renderComponentsBikeSelect,
};
