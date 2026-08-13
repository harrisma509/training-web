const state = window.AppState;

const dailyTab = document.getElementById("dailyTab");
const weeklyTab = document.getElementById("weeklyTab");
const zonesTab = document.getElementById("zonesTab");
const gearTab = document.getElementById("gearTab");
const componentsTab = document.getElementById("componentsTab");
const yearlyTab = document.getElementById("yearlyTab");
const yearlyAnnualTab = document.getElementById("yearlyAnnualTab");
const yearlyMonthlyTab = document.getElementById("yearlyMonthlyTab");
const dailyPane = document.getElementById("dailyPane");
const weeklyPane = document.getElementById("weeklyPane");
const zonesPane = document.getElementById("zonesPane");
const gearPane = document.getElementById("gearPane");
const componentsPane = document.getElementById("componentsPane");
const yearlyPane = document.getElementById("yearlyPane");
const yearlyAnnualView = document.getElementById("yearlyAnnualView");
const yearlyMonthlyView = document.getElementById("yearlyMonthlyView");

const dailyControls = document.getElementById("dailyControls");
const weeklyControls = document.getElementById("weeklyControls");
const zonesControls = document.getElementById("zonesControls");
const gearControls = document.getElementById("gearControls");
const componentsControls = document.getElementById("componentsControls");
const yearlyControls = document.getElementById("yearlyControls");

const dailyLimit = document.getElementById("dailyLimit");
const weeklyLimit = document.getElementById("weeklyLimit");
const zonesLimit = document.getElementById("zonesLimit");
const hideShoesCheckbox = document.getElementById("hideShoesCheckbox");
const hideRetiredCheckbox = document.getElementById("hideRetiredCheckbox");
const dailyRefresh = document.getElementById("dailyRefresh");
const weeklyRefresh = document.getElementById("weeklyRefresh");
const zonesRefresh = document.getElementById("zonesRefresh");
const gearRefresh = document.getElementById("gearRefresh");
const componentsRefresh = document.getElementById("componentsRefresh");
const yearlyRefresh = document.getElementById("yearlyRefresh");
const componentsBikeSelect = document.getElementById("componentsBikeSelect");
const settingsBtn = document.getElementById("settingsBtn");
const settingsDrawer = document.getElementById("settingsDrawer");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const rememberLastTab = document.getElementById("rememberLastTab");
const startupTab = document.getElementById("startupTab");
const startupTabRow = document.getElementById("startupTabRow");
const settingsDefaultBike = document.getElementById("settingsDefaultBike");
const settingsDailyLimit = document.getElementById("settingsDailyLimit");
const settingsWeeklyLimit = document.getElementById("settingsWeeklyLimit");
const settingsZonesLimit = document.getElementById("settingsZonesLimit");
const appearanceInputs = Array.from(document.querySelectorAll('input[name="appearance"]'));
const settingsHideShoes = document.getElementById("settingsHideShoes");
const settingsHideRetired = document.getElementById("settingsHideRetired");
const settingsTabButtons = Array.from(document.querySelectorAll(".settings-tab"));
const settingsTabPanels = {
  general: document.getElementById("settingsGeneralTab"),
  yearly: document.getElementById("settingsYearlyTab"),
};
const yearlyMaintenanceYear = document.getElementById("yearlyMaintenanceYear");
const yearlyMaintenancePreviewBtn = document.getElementById("yearlyMaintenancePreviewBtn");
const yearlyMaintenanceCalculateBtn = document.getElementById("yearlyMaintenanceCalculateBtn");
const yearlyMaintenanceStatus = document.getElementById("yearlyMaintenanceStatus");
const yearlyMaintenancePreviewSummary = document.getElementById("yearlyMaintenancePreviewSummary");
const yearlyMaintenanceWarnings = document.getElementById("yearlyMaintenanceWarnings");
const yearlyMaintenanceComparisonWrap = document.getElementById("yearlyMaintenanceComparisonWrap");
const yearlyMaintenanceComparisonBody = document.getElementById("yearlyMaintenanceComparisonBody");
const yearlyMaintenanceResult = document.getElementById("yearlyMaintenanceResult");
const settingsStatusSummary = document.getElementById("settingsStatusSummary");
const refreshStatusBtn = document.getElementById("refreshStatusBtn");
const copyDiagnosticsBtn = document.getElementById("copyDiagnosticsBtn");

const syncNowBtn = document.getElementById("syncNowBtn");
const systemThemeMedia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: light)") : null;

const VALID_ROW_LIMITS = {
  daily: [60, 90, 365, 1000],
  weekly: [26, 60, 260],
  zones: [26, 60, 260],
};

function normalizeStoredPreference(value, fallback, allowedValues) {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  const asString = String(value).trim();
  if (allowedValues && allowedValues.length > 0) {
    const parsed = Number(asString);
    if (Number.isInteger(parsed) && allowedValues.includes(parsed)) {
      return parsed;
    }
    return fallback;
  }

  return fallback;
}

function sanitizePreferences(rawPreferences = {}) {
  const next = { ...window.DEFAULT_PREFERENCES, ...(rawPreferences || {}) };

  next.appearance = ["system", "light", "dark"].includes(next.appearance) ? next.appearance : "system";
  next.activeTab = ["daily", "weekly", "zones", "gear", "components", "yearly"].includes(next.activeTab) ? next.activeTab : "daily";
  next.rememberLastTab = next.rememberLastTab !== false;
  next.startupTab = ["daily", "weekly", "zones", "gear", "components", "yearly"].includes(next.startupTab) ? next.startupTab : "daily";
  next.yearlyView = ["annual", "monthly"].includes(next.yearlyView) ? next.yearlyView : "annual";
  next.defaultBikeGearId = next.defaultBikeGearId == null ? "" : String(next.defaultBikeGearId).trim();
  next.componentsSelectedGearId = next.componentsSelectedGearId == null ? "" : String(next.componentsSelectedGearId).trim();
  next.hideShoes = Boolean(next.hideShoes);
  next.hideRetired = Boolean(next.hideRetired);
  next.dailyLimit = normalizeStoredPreference(next.dailyLimit, 60, VALID_ROW_LIMITS.daily);
  next.weeklyLimit = normalizeStoredPreference(next.weeklyLimit, 60, VALID_ROW_LIMITS.weekly);
  next.zonesLimit = normalizeStoredPreference(next.zonesLimit, 60, VALID_ROW_LIMITS.zones);
  delete next.gearLimit;

  return next;
}

function loadSavedPreferences() {
  try {
    const storageValue = window.localStorage.getItem(window.APP_PREFERENCES_KEY);
    if (!storageValue) {
      return sanitizePreferences();
    }
    const parsed = JSON.parse(storageValue);
    return sanitizePreferences(parsed);
  } catch (error) {
    return sanitizePreferences();
  }
}

function persistPreferences() {
  const snapshot = {
    appearance: state.appearance,
    activeTab: state.activeTab,
    rememberLastTab: state.rememberLastTab,
    startupTab: state.startupTab,
    defaultBikeGearId: state.defaultBikeGearId,
    componentsSelectedGearId: state.componentsSelectedGearId,
    hideShoes: state.hideShoes,
    hideRetired: state.hideRetired,
    dailyLimit: state.dailyLimit,
    weeklyLimit: state.weeklyLimit,
    zonesLimit: state.zonesLimit,
    yearlyView: state.yearlyView,
  };

  try {
    window.localStorage.setItem(window.APP_PREFERENCES_KEY, JSON.stringify(snapshot));
  } catch (error) {
    console.warn("Unable to persist preferences.", error);
  }
}

function syncFormCheckboxes() {
  if (hideShoesCheckbox) {
    hideShoesCheckbox.checked = Boolean(window.AppState.hideShoes);
  }
  if (hideRetiredCheckbox) {
    hideRetiredCheckbox.checked = Boolean(window.AppState.hideRetired);
  }
  if (settingsHideShoes) {
    settingsHideShoes.checked = Boolean(window.AppState.hideShoes);
  }
  if (settingsHideRetired) {
    settingsHideRetired.checked = Boolean(window.AppState.hideRetired);
  }
  if (rememberLastTab) {
    rememberLastTab.checked = window.AppState.rememberLastTab !== false;
  }
}

function syncDefaultBikeSelect() {
  if (!settingsDefaultBike) {
    return;
  }

  const bikes = Array.isArray(window.AppState.componentsData?.available_bikes) ? window.AppState.componentsData.available_bikes : [];
  const value = String(window.AppState.defaultBikeGearId || "").trim();

  if (bikes.length === 0) {
    settingsDefaultBike.innerHTML = '<option value="">No bikes</option>';
    settingsDefaultBike.value = "";
    settingsDefaultBike.disabled = true;
    return;
  }

  const options = bikes.map(bike => {
    const bikeId = String(bike?.gear_id ?? "").trim();
    const label = String(bike?.display_name || bike?.gear_name || bikeId || "Bike").trim();
    return `<option value="${bikeId}">${label}</option>`;
  }).join("");

  settingsDefaultBike.innerHTML = `<option value="">Use last selected bike</option>${options}`;
  settingsDefaultBike.disabled = false;

  if (value && bikes.some(bike => String(bike?.gear_id ?? "").trim() === value)) {
    settingsDefaultBike.value = value;
  } else {
    settingsDefaultBike.value = "";
  }
}

window.syncDefaultBikeSelect = syncDefaultBikeSelect;

function syncLimitSelects() {
  const selects = {
    dailyLimit: window.AppState.dailyLimit,
    weeklyLimit: window.AppState.weeklyLimit,
    zonesLimit: window.AppState.zonesLimit,
  };

  Object.entries(selects).forEach(([elementId, value]) => {
    const select = document.getElementById(elementId);
    if (!select) {
      return;
    }
    select.value = String(value);
  });

  if (settingsDefaultBike) {
    syncDefaultBikeSelect();
  }
  if (settingsDailyLimit) {
    settingsDailyLimit.value = String(window.AppState.dailyLimit);
  }
  if (settingsWeeklyLimit) {
    settingsWeeklyLimit.value = String(window.AppState.weeklyLimit);
  }
  if (settingsZonesLimit) {
    settingsZonesLimit.value = String(window.AppState.zonesLimit);
  }
  if (startupTab) {
    startupTab.value = window.AppState.startupTab || "daily";
  }
  if (rememberLastTab) {
    rememberLastTab.checked = window.AppState.rememberLastTab !== false;
  }
  if (startupTabRow) {
    startupTabRow.classList.toggle("hidden", window.AppState.rememberLastTab !== false);
  }
}

function updateStartupTabVisibility() {
  if (!rememberLastTab || !startupTabRow) {
    return;
  }

  const shouldHide = window.AppState.rememberLastTab !== false;
  startupTabRow.classList.toggle("hidden", shouldHide);
  rememberLastTab.checked = window.AppState.rememberLastTab !== false;
}

function applyAppearancePreference() {
  if (!document.documentElement) {
    return;
  }

  if (window.AppState.appearance === "light") {
    document.documentElement.setAttribute("data-theme", "light");
    return;
  }

  if (window.AppState.appearance === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
    return;
  }

  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
}

function handleSystemAppearanceChange() {
  if (window.AppState.appearance === "system") {
    applyAppearancePreference();
  }
}

function formatYearlyMaintenanceValue(value) {
  if (value === null || value === undefined || value === "") {
    return "No entry recorded.";
  }
  if (typeof value === "string" && value.trim() === "") {
    return "No entry recorded.";
  }
  return String(value);
}

function formatYearlyMaintenanceDifference(value) {
  if (value === null || value === undefined || value === "") {
    return "No entry recorded.";
  }
  if (typeof value === "string" && value.trim() === "") {
    return "No entry recorded.";
  }
  return String(value);
}

function populateYearlyMaintenanceYearOptions() {
  if (!yearlyMaintenanceYear) {
    return;
  }

  const currentYear = new Date().getFullYear();
  const years = [];
  for (let year = 2013; year <= currentYear; year += 1) {
    years.push(year);
  }

  yearlyMaintenanceYear.innerHTML = years.map(year => `<option value="${year}">${year}</option>`).join("");
  yearlyMaintenanceYear.value = String(currentYear);
  yearlyMaintenanceYear.disabled = years.length === 0;
  yearlyMaintenanceCalculateBtn.disabled = true;
}

function renderYearlyMaintenancePreviewSummary(payload) {
  if (!yearlyMaintenancePreviewSummary) {
    return;
  }

  const status = payload?.coverage_status || "N/A";
  const sourceStart = payload?.source_first_date || "No data";
  const sourceEnd = payload?.source_last_date || "No data";
  const missing = Array.isArray(payload?.missing_months) ? payload.missing_months : [];
  const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];

  const warningMarkup = warnings.length > 0
    ? warnings.map(warning => `<li>${escapeHtml(String(warning))}</li>`).join("")
    : "<li>No warnings.</li>";

  const missingMarkup = missing.length > 0
    ? missing.map(month => `<span class="yearly-maintenance-chip">${escapeHtml(String(month))}</span>`).join("")
    : "<span class=\"yearly-maintenance-chip subtle\">None</span>";

  yearlyMaintenancePreviewSummary.innerHTML = `
    <div class="yearly-maintenance-stat-grid">
      <div class="yearly-maintenance-stat-item"><span>Coverage Status</span><strong>${escapeHtml(String(status))}</strong></div>
      <div class="yearly-maintenance-stat-item"><span>Activity Count</span><strong>${escapeHtml(String(payload?.activity_count ?? "0"))}</strong></div>
      <div class="yearly-maintenance-stat-item"><span>Months With Activity</span><strong>${escapeHtml(String(payload?.months_with_activity ?? "0"))}</strong></div>
      <div class="yearly-maintenance-stat-item"><span>Source Range</span><strong>${escapeHtml(String(sourceStart))} → ${escapeHtml(String(sourceEnd))}</strong></div>
    </div>
    <div class="yearly-maintenance-section-block">
      <div class="yearly-maintenance-label">Missing Months</div>
      <div class="yearly-maintenance-chip-list">${missingMarkup}</div>
    </div>
    <div class="yearly-maintenance-section-block yearly-maintenance-warning-group">
      <div class="yearly-maintenance-label">Warnings</div>
      <ul class="yearly-maintenance-warning-list">${warningMarkup}</ul>
    </div>
  `;

  if (yearlyMaintenanceWarnings) {
    yearlyMaintenanceWarnings.innerHTML = warnings.length > 0
      ? `<ul class="yearly-maintenance-warning-list">${warningMarkup}</ul>`
      : "<div class=\"yearly-maintenance-no-data\">No warnings yet.</div>";
  }
}

function renderYearlyMaintenanceComparison(payload) {
  if (!yearlyMaintenanceComparisonWrap || !yearlyMaintenanceComparisonBody) {
    return;
  }

  const currentValues = payload?.current_values || {};
  const proposedValues = payload?.proposed_annual_values || {};
  const differences = payload?.differences || {};
  const metricNames = Array.from(new Set([
    ...Object.keys(currentValues),
    ...Object.keys(proposedValues),
    ...Object.keys(differences),
  ])).sort();

  if (metricNames.length === 0) {
    yearlyMaintenanceComparisonWrap.classList.add("hidden");
    yearlyMaintenanceComparisonBody.innerHTML = "";
    return;
  }

  yearlyMaintenanceComparisonWrap.classList.remove("hidden");
  yearlyMaintenanceComparisonBody.innerHTML = metricNames.map(metric => {
    const storedValue = currentValues[metric];
    const proposedValue = proposedValues[metric];
    const differenceValue = differences[metric]?.difference;
    return `
      <tr>
        <td>${escapeHtml(String(metric))}</td>
        <td>${escapeHtml(formatYearlyMaintenanceValue(storedValue))}</td>
        <td>${escapeHtml(formatYearlyMaintenanceValue(proposedValue))}</td>
        <td>${escapeHtml(formatYearlyMaintenanceDifference(differenceValue))}</td>
      </tr>
    `;
  }).join("");
}

function resetYearlyMaintenanceState(message = "Select a year to preview.") {
  if (yearlyMaintenanceStatus) {
    yearlyMaintenanceStatus.textContent = message;
  }
  if (yearlyMaintenancePreviewSummary) {
    yearlyMaintenancePreviewSummary.innerHTML = "";
  }
  if (yearlyMaintenanceWarnings) {
    yearlyMaintenanceWarnings.innerHTML = "No warnings yet.";
  }
  if (yearlyMaintenanceComparisonWrap) {
    yearlyMaintenanceComparisonWrap.classList.add("hidden");
  }
  if (yearlyMaintenanceComparisonBody) {
    yearlyMaintenanceComparisonBody.innerHTML = "";
  }
  if (yearlyMaintenanceResult) {
    yearlyMaintenanceResult.innerHTML = "";
  }
  if (yearlyMaintenanceCalculateBtn) {
    yearlyMaintenanceCalculateBtn.disabled = true;
  }
}

async function handleYearlyMaintenancePreview() {
  const selectedYear = Number(yearlyMaintenanceYear?.value);
  if (!selectedYear || Number.isNaN(selectedYear)) {
    resetYearlyMaintenanceState("Please select a valid year.");
    return;
  }

  if (yearlyMaintenanceStatus) {
    yearlyMaintenanceStatus.textContent = "Requesting preview...";
  }
  if (yearlyMaintenanceResult) {
    yearlyMaintenanceResult.innerHTML = "";
  }

  try {
    const response = await fetch("/api/yearly/calculate/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendar_year: selectedYear }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const detail = payload?.detail || `Preview failed: ${response.status}`;
      resetYearlyMaintenanceState(detail);
      return;
    }

    if (yearlyMaintenanceStatus) {
      yearlyMaintenanceStatus.textContent = "Preview completed successfully.";
    }
    renderYearlyMaintenancePreviewSummary(payload);
    renderYearlyMaintenanceComparison(payload);
    if (yearlyMaintenanceCalculateBtn) {
      yearlyMaintenanceCalculateBtn.disabled = false;
    }
  } catch (error) {
    console.error(error);
    resetYearlyMaintenanceState("Unable to preview yearly data. Please try again.");
  }
}

async function handleYearlyMaintenanceCalculate() {
  const selectedYear = Number(yearlyMaintenanceYear?.value);
  if (!selectedYear || Number.isNaN(selectedYear)) {
    if (yearlyMaintenanceResult) {
      yearlyMaintenanceResult.innerHTML = "<div class=\"yearly-maintenance-error\">Select a valid year.</div>";
    }
    return;
  }

  if (yearlyMaintenanceCalculateBtn) {
    yearlyMaintenanceCalculateBtn.disabled = true;
  }
  if (yearlyMaintenanceStatus) {
    yearlyMaintenanceStatus.textContent = "Calculating year...";
  }

  try {
    const response = await fetch("/api/yearly/calculate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ calendar_year: selectedYear }),
    });

    const payload = await response.json();
    if (!response.ok) {
      const detail = payload?.detail || `Calculation failed: ${response.status}`;
      if (yearlyMaintenanceResult) {
        yearlyMaintenanceResult.innerHTML = `<div class="yearly-maintenance-error">${escapeHtml(String(detail))}</div>`;
      }
      if (yearlyMaintenanceStatus) {
        yearlyMaintenanceStatus.textContent = "Calculation failed.";
      }
      if (yearlyMaintenanceCalculateBtn) {
        yearlyMaintenanceCalculateBtn.disabled = false;
      }
      return;
    }

    const warnings = Array.isArray(payload?.warnings) ? payload.warnings : [];
    const warningMarkup = warnings.length > 0
      ? warnings.map(warning => `<li>${escapeHtml(String(warning))}</li>`).join("")
      : "<li>No warnings.</li>";

    if (yearlyMaintenanceResult) {
      yearlyMaintenanceResult.innerHTML = `
        <div class="yearly-maintenance-success-row">
          <span class="yearly-maintenance-success-badge">Success</span>
          <span>Run ID: ${escapeHtml(String(payload?.training_year_run_id ?? "N/A"))}</span>
        </div>
        <div class="yearly-maintenance-stat-grid small-grid">
          <div class="yearly-maintenance-stat-item"><span>Coverage Status</span><strong>${escapeHtml(String(payload?.coverage_status ?? "N/A"))}</strong></div>
          <div class="yearly-maintenance-stat-item"><span>Activity Count</span><strong>${escapeHtml(String(payload?.activity_count ?? "0"))}</strong></div>
          <div class="yearly-maintenance-stat-item"><span>Months With Activity</span><strong>${escapeHtml(String(payload?.months_with_activity ?? "0"))}</strong></div>
        </div>
        <div class="yearly-maintenance-section-block">
          <div class="yearly-maintenance-label">Warnings</div>
          <ul class="yearly-maintenance-warning-list">${warningMarkup}</ul>
        </div>
      `;
    }
    if (yearlyMaintenanceStatus) {
      yearlyMaintenanceStatus.textContent = "Calculation completed successfully.";
    }
    if (yearlyMaintenanceCalculateBtn) {
      yearlyMaintenanceCalculateBtn.disabled = false;
    }
  } catch (error) {
    console.error(error);
    if (yearlyMaintenanceResult) {
      yearlyMaintenanceResult.innerHTML = '<div class="yearly-maintenance-error">Unable to calculate yearly data.</div>';
    }
    if (yearlyMaintenanceStatus) {
      yearlyMaintenanceStatus.textContent = "Calculation failed.";
    }
    if (yearlyMaintenanceCalculateBtn) {
      yearlyMaintenanceCalculateBtn.disabled = false;
    }
  }
}

function restorePreferences() {
  const saved = loadSavedPreferences();
  Object.assign(window.AppState, saved);
  if (window.AppState.rememberLastTab === false) {
    window.AppState.activeTab = window.AppState.startupTab || "daily";
  }
  applyAppearancePreference();
  syncLimitSelects();
  syncFormCheckboxes();
  populateYearlyMaintenanceYearOptions();
  if (appearanceInputs.length > 0) {
    appearanceInputs.forEach(input => {
      input.checked = input.value === window.AppState.appearance;
    });
  }
}

function updatePreferenceState(newState) {
  Object.assign(window.AppState, newState);
  persistPreferences();
  applyAppearancePreference();
  syncLimitSelects();
  syncFormCheckboxes();
  renderGearTable();
}

function updateLimitPreference(key, value, reloadFn) {
  const allowedValues = VALID_ROW_LIMITS[key.replace(/Limit$/, "")];
  if (!allowedValues || !Number.isInteger(value) || !allowedValues.includes(value)) {
    return;
  }

  window.AppState[key] = value;
  syncLimitSelects();
  persistPreferences();

  if (typeof reloadFn === "function") {
    reloadFn();
  }
}

dailyTab.addEventListener("click", () => showTab("daily"));
weeklyTab.addEventListener("click", () => showTab("weekly"));
zonesTab.addEventListener("click", () => showTab("zones"));
gearTab.addEventListener("click", () => showTab("gear"));
componentsTab.addEventListener("click", () => showTab("components"));
yearlyTab.addEventListener("click", () => showTab("yearly"));
yearlyAnnualTab?.addEventListener("click", () => showYearlyView("annual"));
yearlyMonthlyTab?.addEventListener("click", () => showYearlyView("monthly"));
dailyRefresh.addEventListener("click", loadDaily);
weeklyRefresh.addEventListener("click", loadWeekly);
zonesRefresh.addEventListener("click", loadZones);
gearRefresh.addEventListener("click", loadGear);
componentsRefresh?.addEventListener("click", () => loadComponents());
yearlyRefresh?.addEventListener("click", loadYearly);
componentsBikeSelect?.addEventListener("change", event => {
  const selectedGearId = String(event.target.value || "").trim();
  window.AppState.componentsSelectedGearId = selectedGearId;
  persistPreferences();
  loadComponents();
});
settingsDefaultBike?.addEventListener("change", event => {
  const selectedGearId = String(event.target.value || "").trim();
  window.AppState.defaultBikeGearId = selectedGearId;
  if (selectedGearId) {
    window.AppState.componentsSelectedGearId = selectedGearId;
  }
  persistPreferences();
  if (selectedGearId) {
    loadComponents();
  }
});
hideShoesCheckbox?.addEventListener("change", event => {
  const checked = event.target.checked;
  window.AppState.hideShoes = checked;
  if (settingsHideShoes) {
    settingsHideShoes.checked = checked;
  }
  persistPreferences();
  renderGearTable();
});
hideRetiredCheckbox?.addEventListener("change", event => {
  const checked = event.target.checked;
  window.AppState.hideRetired = checked;
  if (settingsHideRetired) {
    settingsHideRetired.checked = checked;
  }
  persistPreferences();
  renderGearTable();
});
settingsBtn?.addEventListener("click", () => {
  settingsDrawer?.classList.remove("hidden");
  settingsDrawer?.setAttribute("aria-hidden", "false");
  loadSystemStatus();
});
settingsCloseBtn?.addEventListener("click", () => {
  settingsDrawer?.classList.add("hidden");
  settingsDrawer?.setAttribute("aria-hidden", "true");
});
settingsTabButtons.forEach(button => {
  button.addEventListener("click", () => {
    const selectedTab = button.dataset.settingsTab;
    if (!selectedTab || !settingsTabPanels[selectedTab]) {
      return;
    }

    settingsTabButtons.forEach(tabButton => {
      const isActive = tabButton === button;
      tabButton.classList.toggle("active", isActive);
      tabButton.setAttribute("aria-selected", String(isActive));
    });

    Object.entries(settingsTabPanels).forEach(([tabName, panel]) => {
      if (!panel) {
        return;
      }
      panel.classList.toggle("hidden", tabName !== selectedTab);
    });
  });
});
settingsDrawer?.addEventListener("click", event => {
  if (event.target === settingsDrawer) {
    settingsCloseBtn?.click();
  }
});
appearanceInputs.forEach(input => {
  input.addEventListener("change", event => {
    const selectedAppearance = event.target.value;
    window.AppState.appearance = selectedAppearance;
    persistPreferences();
    applyAppearancePreference();
  });
});
rememberLastTab?.addEventListener("change", event => {
  const checked = Boolean(event.target.checked);
  window.AppState.rememberLastTab = checked;
  if (!checked) {
    window.AppState.startupTab = window.AppState.startupTab || "daily";
    window.AppState.activeTab = window.AppState.startupTab;
    showTab(window.AppState.activeTab);
  }
  persistPreferences();
  updateStartupTabVisibility();
});
startupTab?.addEventListener("change", event => {
  const selectedTab = event.target.value;
  if (!["daily", "weekly", "zones", "gear", "components", "yearly"].includes(selectedTab)) {
    return;
  }

  window.AppState.startupTab = selectedTab;
  if (window.AppState.rememberLastTab === false) {
    window.AppState.activeTab = selectedTab;
    showTab(selectedTab);
  }
  persistPreferences();
});
settingsHideShoes?.addEventListener("change", event => {
  const checked = event.target.checked;
  window.AppState.hideShoes = checked;
  if (hideShoesCheckbox) {
    hideShoesCheckbox.checked = checked;
  }
  persistPreferences();
  renderGearTable();
});
settingsHideRetired?.addEventListener("change", event => {
  const checked = event.target.checked;
  window.AppState.hideRetired = checked;
  if (hideRetiredCheckbox) {
    hideRetiredCheckbox.checked = checked;
  }
  persistPreferences();
  renderGearTable();
});
yearlyMaintenanceYear?.addEventListener("change", () => {
  resetYearlyMaintenanceState("Select a year to preview.");
});
yearlyMaintenancePreviewBtn?.addEventListener("click", handleYearlyMaintenancePreview);
yearlyMaintenanceCalculateBtn?.addEventListener("click", handleYearlyMaintenanceCalculate);
refreshStatusBtn?.addEventListener("click", loadSystemStatus);
copyDiagnosticsBtn?.addEventListener("click", copySystemDiagnostics);
syncNowBtn.addEventListener("click", handleSyncNow);

if (dailyLimit) {
  dailyLimit.addEventListener("change", event => {
    const value = Number(event.target.value);
    updateLimitPreference("dailyLimit", value, loadDaily);
  });
}
if (weeklyLimit) {
  weeklyLimit.addEventListener("change", event => {
    const value = Number(event.target.value);
    updateLimitPreference("weeklyLimit", value, loadWeekly);
  });
}
if (zonesLimit) {
  zonesLimit.addEventListener("change", event => {
    const value = Number(event.target.value);
    updateLimitPreference("zonesLimit", value, loadZones);
  });
}
if (settingsDailyLimit) {
  settingsDailyLimit.addEventListener("change", event => {
    const value = Number(event.target.value);
    updateLimitPreference("dailyLimit", value, () => {
      if (window.AppState.activeTab === "daily") {
        loadDaily();
      }
    });
  });
}
if (settingsWeeklyLimit) {
  settingsWeeklyLimit.addEventListener("change", event => {
    const value = Number(event.target.value);
    updateLimitPreference("weeklyLimit", value, () => {
      if (window.AppState.activeTab === "weekly") {
        loadWeekly();
      }
    });
  });
}
if (settingsZonesLimit) {
  settingsZonesLimit.addEventListener("change", event => {
    const value = Number(event.target.value);
    updateLimitPreference("zonesLimit", value, () => {
      if (window.AppState.activeTab === "zones") {
        loadZones();
      }
    });
  });
}

if (systemThemeMedia && typeof systemThemeMedia.addEventListener === "function") {
  systemThemeMedia.addEventListener("change", handleSystemAppearanceChange);
} else if (systemThemeMedia && typeof systemThemeMedia.addListener === "function") {
  systemThemeMedia.addListener(handleSystemAppearanceChange);
}

restorePreferences();

if (hideShoesCheckbox) {
  hideShoesCheckbox.checked = window.AppState.hideShoes;
}
if (hideRetiredCheckbox) {
  hideRetiredCheckbox.checked = window.AppState.hideRetired;
}
if (settingsHideShoes) {
  settingsHideShoes.checked = window.AppState.hideShoes;
}
if (settingsHideRetired) {
  settingsHideRetired.checked = window.AppState.hideRetired;
}

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

function showYearlyView(view) {
  const nextView = ["annual", "monthly"].includes(view) ? view : "annual";
  state.yearlyView = nextView;
  persistPreferences();

  if (yearlyAnnualView) {
    yearlyAnnualView.classList.toggle("hidden", nextView !== "annual");
  }
  if (yearlyMonthlyView) {
    yearlyMonthlyView.classList.toggle("hidden", nextView !== "monthly");
  }
  if (yearlyAnnualTab) {
    yearlyAnnualTab.classList.toggle("active", nextView === "annual");
  }
  if (yearlyMonthlyTab) {
    yearlyMonthlyTab.classList.toggle("active", nextView === "monthly");
  }
}

function showTab(tab) {
  state.activeTab = tab;
  persistPreferences();

  const isDaily = tab === "daily";
  const isWeekly = tab === "weekly";
  const isZones = tab === "zones";
  const isGear = tab === "gear";
  const isComponents = tab === "components";
  const isYearly = tab === "yearly";

  dailyPane.classList.toggle("hidden", !isDaily);
  weeklyPane.classList.toggle("hidden", !isWeekly);
  zonesPane.classList.toggle("hidden", !isZones);
  gearPane.classList.toggle("hidden", !isGear);
  componentsPane.classList.toggle("hidden", !isComponents);
  yearlyPane.classList.toggle("hidden", !isYearly);

  dailyControls.classList.toggle("hidden", !isDaily);
  weeklyControls.classList.toggle("hidden", !isWeekly);
  zonesControls.classList.toggle("hidden", !isZones);
  gearControls.classList.toggle("hidden", !isGear);
  componentsControls.classList.toggle("hidden", !isComponents);
  yearlyControls.classList.toggle("hidden", !isYearly);

  dailyTab.classList.toggle("active", isDaily);
  weeklyTab.classList.toggle("active", isWeekly);
  zonesTab.classList.toggle("active", isZones);
  gearTab.classList.toggle("active", isGear);
  componentsTab.classList.toggle("active", isComponents);
  yearlyTab.classList.toggle("active", isYearly);

  if (isYearly) {
    showYearlyView(state.yearlyView || "annual");
  }
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


function renderDailyTable() {
  const rows = state.dailyRows.map(row => {
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

function formatAnnualNumber(value, digits = 0) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }

  const formatter = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });

  return formatter.format(parsed);
}

function formatMonthlyHours(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return "";
  }

  const totalMinutes = Math.round(numeric * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}`;
}

function formatRecordCell(value, digits = 0, isRecord = false) {
  const formatted = value === null || value === undefined || value === "" ? "" : formatAnnualNumber(Number(value), digits);
  if (!formatted) {
    return "";
  }
  if (!isRecord) {
    return formatted;
  }
  return `<span class="record-trophy" aria-label="Record">🏆</span> ${formatted}`;
}

function getYearlyCommentText(value) {
  if (value === null || value === undefined || value === "") {
    return "No entry recorded.";
  }
  return String(value);
}

function ensureYearlyCommentaryDrawer() {
  let drawer = document.getElementById("yearlyCommentaryDrawer");
  if (drawer) {
    return drawer;
  }

  drawer = document.createElement("div");
  drawer.id = "yearlyCommentaryDrawer";
  drawer.className = "yearly-commentary-drawer hidden";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <div class="yearly-commentary-panel">
      <div class="yearly-commentary-header">
        <div>
          <div class="drawer-title">Yearly Commentary</div>
          <div class="drawer-subtitle">Annual notes for the selected year</div>
        </div>
        <button type="button" class="drawer-close-button" aria-label="Close yearly commentary drawer">×</button>
      </div>
      <div class="yearly-commentary-body">
        <div class="yearly-commentary-section">
          <div class="yearly-commentary-label">Year</div>
          <div id="yearlyCommentaryYear" class="yearly-commentary-value"></div>
        </div>
        <div class="yearly-commentary-section">
          <div class="yearly-commentary-label">✅ Good</div>
          <div id="yearlyCommentaryGood" class="yearly-commentary-value"></div>
        </div>
        <div class="yearly-commentary-section">
          <div class="yearly-commentary-label">⚠ Bad</div>
          <div id="yearlyCommentaryBad" class="yearly-commentary-value"></div>
        </div>
        <div class="yearly-commentary-section">
          <div class="yearly-commentary-label">📝 Annual Summary</div>
          <div id="yearlyCommentaryAnnual" class="yearly-commentary-value"></div>
        </div>
      </div>
    </div>
  `;

  drawer.addEventListener("click", event => {
    if (event.target === drawer) {
      drawer.classList.add("hidden");
      drawer.setAttribute("aria-hidden", "true");
    }
  });

  const closeButton = drawer.querySelector(".drawer-close-button");
  closeButton.addEventListener("click", () => {
    drawer.classList.add("hidden");
    drawer.setAttribute("aria-hidden", "true");
  });

  document.body.appendChild(drawer);
  return drawer;
}

async function openYearlyCommentaryDrawer(calendarYear) {
  const drawer = ensureYearlyCommentaryDrawer();
  const yearNode = document.getElementById("yearlyCommentaryYear");
  const goodNode = document.getElementById("yearlyCommentaryGood");
  const badNode = document.getElementById("yearlyCommentaryBad");
  const annualNode = document.getElementById("yearlyCommentaryAnnual");

  yearNode.textContent = String(calendarYear);
  goodNode.textContent = "Loading...";
  badNode.textContent = "Loading...";
  annualNode.textContent = "Loading...";
  drawer.classList.remove("hidden");
  drawer.setAttribute("aria-hidden", "false");

  try {
    const response = await fetch(`/api/yearly/commentary/${calendarYear}`);
    if (!response.ok) {
      const detail = response.status === 404 ? "No commentary exists for this year." : `Request failed: ${response.status}`;
      goodNode.textContent = detail;
      badNode.textContent = "No entry recorded.";
      annualNode.textContent = "No entry recorded.";
      return;
    }

    const payload = await response.json();
    goodNode.textContent = getYearlyCommentText(payload.good_summary);
    badNode.textContent = getYearlyCommentText(payload.bad_summary);
    annualNode.textContent = getYearlyCommentText(payload.annual_summary);
  } catch (error) {
    console.error(error);
    goodNode.textContent = "No entry recorded.";
    badNode.textContent = "No entry recorded.";
    annualNode.textContent = "No entry recorded.";
  }
}

function renderYearlyTable() {
  const rows = (window.AppState.yearlyRows || []).map(row => {
    const isYtd = row.is_ytd === true || row.is_ytd === "true" || row.is_ytd === 1 || row.is_ytd === "1";

    return `
      <tr data-calendar-year="${safe(row.calendar_year)}" class="yearly-metric-row" tabindex="0" aria-label="View commentary for ${safe(row.calendar_year)}">
        <td>${safe(row.calendar_year)}</td>
        <td>${formatRecordCell(row.training_hours, 1, Boolean(row.training_hours_record))}</td>
        <td>${formatRecordCell(row.active_days, 0, Boolean(row.active_days_record))}</td>
        <td>${formatRecordCell(row.cycling_distance_mi, 1, Boolean(row.cycling_distance_mi_record))}</td>
        <td>${formatRecordCell(row.total_elevation_ft, 0, Boolean(row.total_elevation_ft_record))}</td>
        <td>${formatRecordCell(row.bike_elevation_ft, 0, Boolean(row.bike_elevation_ft_record))}</td>
        <td>${formatRecordCell(row.ride_count, 0, Boolean(row.ride_count_record))}</td>
        <td>${formatRecordCell(row.ski_days, 0, Boolean(row.ski_days_record))}</td>
        <td>${isYtd ? '<span class="status-pill status-active">YTD</span>' : ""}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("yearlyTable").innerHTML = `
    <thead>
      <tr>
        <th>Year</th>
        <th>Hours</th>
        <th>Active Days</th>
        <th>Cycling Distance</th>
        <th>Total Elevation</th>
        <th>Bike Elev.</th>
        <th>Ride Count</th>
        <th>Ski Days</th>
        <th>Coverage</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  `;

  document.querySelectorAll("#yearlyTable tbody tr[data-calendar-year]").forEach(row => {
    row.addEventListener("click", () => {
      openYearlyCommentaryDrawer(row.dataset.calendarYear);
    });
    row.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openYearlyCommentaryDrawer(row.dataset.calendarYear);
      }
    });
  });
}

function renderYearlyMonthlyTable() {
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const rows = (window.AppState.yearlyMonthlyRows || []).map(row => {
    const cells = monthNames.map((month, index) => {
      const monthKey = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"][index];
      const value = row[monthKey];
      const record = Boolean(row[`${monthKey}_record`]);

      return `
        <td class="yearly-month-cell ${record ? "record-cell" : ""}">
          ${value === null || value === undefined || value === "" ? "" : `${record ? '<span class="record-trophy" aria-label="Record">🏆</span> ' : ""}${formatMonthlyHours(value)}`}
        </td>
      `;
    }).join("");

    return `
      <tr>
        <td>${safe(row.calendar_year)}</td>
        ${cells}
        <td>${row.total === null || row.total === undefined || row.total === "" ? "" : formatMonthlyHours(row.total)}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("yearlyMonthlyTable").innerHTML = `
    <thead>
      <tr>
        <th>Year</th>
        ${monthNames.map(month => `<th>${month}</th>`).join("")}
        <th>Total</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  `;
}

async function loadYearly() {
  try {
    const response = await fetch("/api/yearly");
    if (!response.ok) {
      throw new Error(`Yearly endpoint failed: ${response.status}`);
    }

    const payload = await response.json();
    const annualRows = Array.isArray(payload) ? payload : (payload.annual_metrics || []);
    const monthlyRows = Array.isArray(payload.monthly_hours) ? payload.monthly_hours : [];
    window.AppState.yearlyRows = annualRows;
    window.AppState.yearlyMonthlyRows = monthlyRows;
  } catch (error) {
    console.error(error);
    window.AppState.yearlyRows = [];
    window.AppState.yearlyMonthlyRows = [];
  }

  renderYearlyTable();
  renderYearlyMonthlyTable();
  if (window.AppState.activeTab === "yearly") {
    showYearlyView(window.AppState.yearlyView || "annual");
  }
}

async function loadDaily() {
  const limit = Number(window.AppState.dailyLimit);
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

function formatDisplayTimestamp(value) {
  if (!value) {
    return "n/a";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return String(value);
  }

  return parsed.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatRequestDuration(value) {
  if (value == null || value === "" || Number.isNaN(Number(value))) {
    return "n/a";
  }

  const totalSeconds = Number(value);
  if (!Number.isFinite(totalSeconds) || totalSeconds < 0) {
    return "n/a";
  }

  const wholeSeconds = Math.floor(totalSeconds);
  if (wholeSeconds < 60) {
    return `${wholeSeconds} sec`;
  }

  const minutes = Math.floor(wholeSeconds / 60);
  const seconds = wholeSeconds % 60;
  return `${minutes} min ${seconds} sec`;
}

function renderSystemStatusSummary(data) {
  const requestDurationSeconds = data.duration_seconds ?? data.latest_request_duration_seconds ?? null;
  const rows = [
    { label: "Status", value: data.health || "unknown" },
    { label: "Sync status", value: data.status || "unknown" },
    { label: "Latest request duration", value: requestDurationSeconds == null ? "n/a" : formatRequestDuration(requestDurationSeconds) },
    { label: "Last sync", value: formatDisplayTimestamp(data.latest_sync_run_at_utc) },
    { label: "Last good sync", value: formatDisplayTimestamp(data.last_good_sync_run_at_utc) },
    { label: "Hours since good sync", value: data.hours_since_good_sync == null ? "n/a" : `${data.hours_since_good_sync} h` },
    { label: "Warnings", value: data.warning_count ?? 0 },
    { label: "Daily rows", value: data.daily_rows ?? "n/a" },
    { label: "Weekly rows", value: data.weekly_rows ?? "n/a" },
    { label: "Request status", value: data.latest_request_status || "n/a" },
    { label: "Request time", value: formatDisplayTimestamp(data.latest_request_requested_at_utc) },
  ];

  const html = rows.map(row => `
    <div class="settings-status-row">
      <span class="settings-status-label">${escapeHtml(String(row.label))}</span>
      <span class="settings-status-value">${escapeHtml(String(row.value))}</span>
    </div>
  `).join("");

  settingsStatusSummary.innerHTML = `<div class="settings-status-list">${html}</div>`;
}

async function loadSystemStatus() {
  if (!settingsStatusSummary) {
    return;
  }

  settingsStatusSummary.textContent = "Loading...";

  try {
    const response = await fetch("/api/system-status");
    if (!response.ok) {
      throw new Error(`System status failed: ${response.status}`);
    }

    const data = await response.json();
    renderSystemStatusSummary(data);
  } catch (error) {
    console.error(error);
    settingsStatusSummary.textContent = "Unable to load system status.";
  }
}

async function copySystemDiagnostics() {
  if (!settingsStatusSummary || !copyDiagnosticsBtn) {
    return;
  }

  const originalLabel = copyDiagnosticsBtn.textContent.trim();
  const normalizeText = (value) => String(value || "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

  const text = normalizeText(settingsStatusSummary.innerText || settingsStatusSummary.textContent || "");
  if (!text) {
    copyDiagnosticsBtn.textContent = "Unable to copy diagnostics";
    window.clearTimeout(copyDiagnosticsBtn.feedbackTimer);
    copyDiagnosticsBtn.feedbackTimer = window.setTimeout(() => {
      copyDiagnosticsBtn.textContent = originalLabel;
    }, 1800);
    return;
  }

  const showFeedback = (label) => {
    copyDiagnosticsBtn.textContent = label;
    window.clearTimeout(copyDiagnosticsBtn.feedbackTimer);
    copyDiagnosticsBtn.feedbackTimer = window.setTimeout(() => {
      copyDiagnosticsBtn.textContent = originalLabel;
    }, 1800);
  };

  try {
    const canUseClipboard = typeof navigator !== "undefined"
      && navigator.clipboard
      && typeof navigator.clipboard.writeText === "function"
      && window.isSecureContext;

    if (canUseClipboard) {
      await navigator.clipboard.writeText(text);
    } else {
      const tempElement = document.createElement("textarea");
      tempElement.value = text;
      tempElement.setAttribute("readonly", "");
      tempElement.style.position = "fixed";
      tempElement.style.top = "-9999px";
      tempElement.style.left = "-9999px";
      tempElement.style.opacity = "0";
      document.body.appendChild(tempElement);
      tempElement.focus();
      tempElement.select();

      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch (error) {
        copied = false;
      }

      document.body.removeChild(tempElement);

      if (!copied) {
        throw new Error("Clipboard fallback copy failed.");
      }
    }

    showFeedback("Diagnostics copied");
  } catch (error) {
    console.warn("Clipboard unavailable.", error);
    showFeedback("Unable to copy diagnostics");
  }
}

async function loadData() {
  await Promise.all([
    loadDaily(),
    loadWeekly(),
    loadZones(),
    loadGear(),
    loadComponents(),
    loadYearly()
  ]);

  renderHeaderSummary();
  loadSyncStatus();
  loadSystemStatus();
}

setInterval(loadSyncStatus, 60000);
showTab(window.AppState.activeTab || "daily");
loadData();