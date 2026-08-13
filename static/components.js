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
    const rowId = row.gear_component_id;

    return `
      <tr data-component-id="${componentEscapeHtml(String(rowId || ""))}">
        <td>${componentEscapeHtml(componentSafe(row.component_name, ""))}</td>
        <td>${componentEscapeHtml(componentSafe(row.component_group, "-"))}</td>
        <td>${componentEscapeHtml(componentSafe(row.position, "-"))}</td>
        <td>${componentEscapeHtml(componentSafe(latestEvent ? latestEvent.service_date : null, "-"))}</td>
        <td>
          <div class="components-action-stack">
            <span>${componentEscapeHtml(formatLatestAction(latestEvent))}</span>
            <button type="button" class="components-record-service-button" data-component-id="${componentEscapeHtml(String(rowId || ""))}" data-component-name="${componentEscapeHtml(componentSafe(row.component_name, ""))}" aria-label="Record service for ${componentEscapeHtml(componentSafe(row.component_name, ""))}">Record Service</button>
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

  table.querySelectorAll(".components-record-service-button").forEach(button => {
    button.addEventListener("click", async event => {
      const componentId = String(event.currentTarget.dataset.componentId || "").trim();
      if (!componentId) {
        return;
      }
      await openComponentServiceDrawer(componentId, event.currentTarget.dataset.componentName || "");
    });
  });
}

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
