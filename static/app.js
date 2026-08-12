const state = window.AppState;

const dailyTab = document.getElementById("dailyTab");
const weeklyTab = document.getElementById("weeklyTab");
const zonesTab = document.getElementById("zonesTab");
const gearTab = document.getElementById("gearTab");
const componentsTab = document.getElementById("componentsTab");
const dailyPane = document.getElementById("dailyPane");
const weeklyPane = document.getElementById("weeklyPane");
const zonesPane = document.getElementById("zonesPane");
const gearPane = document.getElementById("gearPane");
const componentsPane = document.getElementById("componentsPane");

const dailyControls = document.getElementById("dailyControls");
const weeklyControls = document.getElementById("weeklyControls");
const zonesControls = document.getElementById("zonesControls");
const gearControls = document.getElementById("gearControls");
const componentsControls = document.getElementById("componentsControls");

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
const componentsBikeSelect = document.getElementById("componentsBikeSelect");
const settingsBtn = document.getElementById("settingsBtn");
const settingsDrawer = document.getElementById("settingsDrawer");
const settingsCloseBtn = document.getElementById("settingsCloseBtn");
const rememberLastTab = document.getElementById("rememberLastTab");
const startupTab = document.getElementById("startupTab");
const startupTabRow = document.getElementById("startupTabRow");
const settingsDailyLimit = document.getElementById("settingsDailyLimit");
const settingsWeeklyLimit = document.getElementById("settingsWeeklyLimit");
const settingsZonesLimit = document.getElementById("settingsZonesLimit");
const appearanceInputs = Array.from(document.querySelectorAll('input[name="appearance"]'));
const settingsHideShoes = document.getElementById("settingsHideShoes");
const settingsHideRetired = document.getElementById("settingsHideRetired");
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
  next.activeTab = ["daily", "weekly", "zones", "gear", "components"].includes(next.activeTab) ? next.activeTab : "daily";
  next.rememberLastTab = next.rememberLastTab !== false;
  next.startupTab = ["daily", "weekly", "zones", "gear", "components"].includes(next.startupTab) ? next.startupTab : "daily";
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
    componentsSelectedGearId: state.componentsSelectedGearId,
    hideShoes: state.hideShoes,
    hideRetired: state.hideRetired,
    dailyLimit: state.dailyLimit,
    weeklyLimit: state.weeklyLimit,
    zonesLimit: state.zonesLimit,
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

function restorePreferences() {
  const saved = loadSavedPreferences();
  Object.assign(window.AppState, saved);
  if (window.AppState.rememberLastTab === false) {
    window.AppState.activeTab = window.AppState.startupTab || "daily";
  }
  applyAppearancePreference();
  syncLimitSelects();
  syncFormCheckboxes();
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
dailyRefresh.addEventListener("click", loadDaily);
weeklyRefresh.addEventListener("click", loadWeekly);
zonesRefresh.addEventListener("click", loadZones);
gearRefresh.addEventListener("click", loadGear);
componentsRefresh?.addEventListener("click", () => loadComponents());
componentsBikeSelect?.addEventListener("change", event => {
  const selectedGearId = String(event.target.value || "").trim();
  window.AppState.componentsSelectedGearId = selectedGearId;
  persistPreferences();
  loadComponents();
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
  if (!["daily", "weekly", "zones", "gear", "components"].includes(selectedTab)) {
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

function showTab(tab) {
  state.activeTab = tab;
  persistPreferences();

  const isDaily = tab === "daily";
  const isWeekly = tab === "weekly";
  const isZones = tab === "zones";
  const isGear = tab === "gear";
  const isComponents = tab === "components";

  dailyPane.classList.toggle("hidden", !isDaily);
  weeklyPane.classList.toggle("hidden", !isWeekly);
  zonesPane.classList.toggle("hidden", !isZones);
  gearPane.classList.toggle("hidden", !isGear);
  componentsPane.classList.toggle("hidden", !isComponents);

  dailyControls.classList.toggle("hidden", !isDaily);
  weeklyControls.classList.toggle("hidden", !isWeekly);
  zonesControls.classList.toggle("hidden", !isZones);
  gearControls.classList.toggle("hidden", !isGear);
  componentsControls.classList.toggle("hidden", !isComponents);

  dailyTab.classList.toggle("active", isDaily);
  weeklyTab.classList.toggle("active", isWeekly);
  zonesTab.classList.toggle("active", isZones);
  gearTab.classList.toggle("active", isGear);
  componentsTab.classList.toggle("active", isComponents);
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
    loadComponents()
  ]);

  renderHeaderSummary();
  loadSyncStatus();
  loadSystemStatus();
}

setInterval(loadSyncStatus, 60000);
showTab(window.AppState.activeTab || "daily");
loadData();