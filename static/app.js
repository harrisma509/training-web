/*
 * app.js
 * Shell/bootstrap layer for the dashboard.
 * Owns tab switching, shared header behavior, and app-level wiring; it delegates feature data loading to
 * module functions and relies on AppState plus the shared API layer for runtime state and fetch logic.
 */
const state = window.AppState;

window.TrainingApp = window.TrainingApp || {
  state: window.AppState,
  api: window.api,
  utils: window.AppUtils,
  features: {},
};
window.TrainingApp.state = window.AppState;
window.TrainingApp.api = window.api;
window.TrainingApp.utils = window.AppUtils;
window.TrainingApp.features = window.TrainingApp.features || {};

if (window.PlanController) {
  window.TrainingApp.features.plan = window.PlanController;
}
if (window.GoalsController) {
  window.TrainingApp.features.goals = window.GoalsController;
}
if (window.KPIsController) {
  window.TrainingApp.features.kpis = window.KPIsController;
}
if (window.ChartsController) {
  window.TrainingApp.features.charts = window.ChartsController;
}
if (window.DailyController) {
  window.TrainingApp.features.daily = window.DailyController;
}
if (window.WeeklyController) {
  window.TrainingApp.features.weekly = window.WeeklyController;
}
if (window.GearController) {
  window.TrainingApp.features.gear = window.GearController;
}
if (window.SettingsController) {
  window.TrainingApp.features.settings = window.SettingsController;
}
if (window.YearlyController) {
  window.TrainingApp.features.yearly = window.YearlyController;
}
if (window.ZonesController) {
  window.TrainingApp.features.zones = window.ZonesController;
}
if (window.ComponentsController) {
  window.TrainingApp.features.components = window.ComponentsController;
}
if (window.SyncController) {
  window.TrainingApp.features.sync = window.SyncController;
}

const planTab = document.getElementById("planTab");
const goalsTab = document.getElementById("goalsTab");
const kpisTab = document.getElementById("kpisTab");
const chartsTab = document.getElementById("chartsTab");
const chartsLoadTab = document.getElementById("chartsLoadTab");
const chartsHealthTab = document.getElementById("chartsHealthTab");
const chartsVolumeTab = document.getElementById("chartsVolumeTab");
const dailyTab = document.getElementById("dailyTab");
const weeklyTab = document.getElementById("weeklyTab");
const zonesTab = document.getElementById("zonesTab");
const gearTab = document.getElementById("gearTab");
const componentsTab = document.getElementById("componentsTab");
const yearlyTab = document.getElementById("yearlyTab");
const yearlyAnnualTab = document.getElementById("yearlyAnnualTab");
const yearlyMonthlyTab = document.getElementById("yearlyMonthlyTab");
const planPane = document.getElementById("planPane");
const goalsPane = document.getElementById("goalsPane");
const kpisPane = document.getElementById("kpisPane");
const chartsPane = document.getElementById("chartsPane");
const chartsLoadPanel = document.getElementById("chartsLoadPanel");
const chartsHealthPanel = document.getElementById("chartsHealthPanel");
const chartsVolumePanel = document.getElementById("chartsVolumePanel");
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

const weeklyLimit = document.getElementById("weeklyLimit");
const zonesLimit = document.getElementById("zonesLimit");
const hideShoesCheckbox = document.getElementById("hideShoesCheckbox");
const hideRetiredCheckbox = document.getElementById("hideRetiredCheckbox");
const gearRefresh = document.getElementById("gearRefresh");
const componentsRefresh = document.getElementById("componentsRefresh");
const yearlyRefresh = document.getElementById("yearlyRefresh");
const componentsBikeSelect = document.getElementById("componentsBikeSelect");

const syncNowBtn = document.getElementById("syncNowBtn");

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

planTab?.addEventListener("click", () => showTab("plan"));
goalsTab?.addEventListener("click", () => showTab("goals"));
kpisTab?.addEventListener("click", () => showTab("kpis"));
chartsTab?.addEventListener("click", () => showTab("charts"));
dailyTab.addEventListener("click", () => showTab("daily"));
weeklyTab.addEventListener("click", () => showTab("weekly"));
zonesTab.addEventListener("click", () => showTab("zones"));
gearTab.addEventListener("click", () => showTab("gear"));
componentsTab.addEventListener("click", () => showTab("components"));
yearlyTab.addEventListener("click", () => showTab("yearly"));
yearlyAnnualTab?.addEventListener("click", () => showYearlyView("annual"));
yearlyMonthlyTab?.addEventListener("click", () => showYearlyView("monthly"));
gearRefresh.addEventListener("click", loadGear);
componentsRefresh?.addEventListener("click", () => loadComponents());
yearlyRefresh?.addEventListener("click", loadYearly);
componentsBikeSelect?.addEventListener("change", event => {
  const selectedGearId = String(event.target.value || "").trim();
  window.AppState.componentsSelectedGearId = selectedGearId;
  persistPreferences();
  loadComponents();
});
syncNowBtn.addEventListener("click", handleSyncNow);

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

function normalizeChartsCategory(category) {
  const normalized = String(category || "").trim().toLowerCase();
  return ["load", "health", "volume"].includes(normalized) ? normalized : "load";
}

function getChartsCategory() {
  const savedValue = window.AppState && typeof window.AppState.chartsCategory !== "undefined"
    ? normalizeChartsCategory(window.AppState.chartsCategory)
    : "load";

  if (window.AppState && window.AppState.chartsCategory !== savedValue) {
    window.AppState.chartsCategory = savedValue;
    persistPreferences();
  }

  return savedValue;
}

function showChartsCategory(category) {
  const nextCategory = normalizeChartsCategory(category);

  if (window.AppState) {
    window.AppState.chartsCategory = nextCategory;
    persistPreferences();
  }

  const panels = {
    load: chartsLoadPanel,
    health: chartsHealthPanel,
    volume: chartsVolumePanel,
  };

  const tabs = {
    load: chartsLoadTab,
    health: chartsHealthTab,
    volume: chartsVolumeTab,
  };

  Object.entries(panels).forEach(([name, panel]) => {
    if (panel) {
      panel.classList.toggle("hidden", name !== nextCategory);
      panel.setAttribute("aria-hidden", String(name !== nextCategory));
    }
  });

  Object.entries(tabs).forEach(([name, tab]) => {
    if (tab) {
      const selected = name === nextCategory;
      tab.classList.toggle("active", selected);
      tab.setAttribute("aria-selected", String(selected));
      tab.setAttribute("aria-controls", `${name === "load" ? "chartsLoadPanel" : name === "health" ? "chartsHealthPanel" : "chartsVolumePanel"}`);
    }
  });

  if (window.ChartsController) {
    if (nextCategory === "load" && typeof window.ChartsController.loadFitnessFatigue === "function") {
      window.ChartsController.loadFitnessFatigue();
    }
    if (nextCategory === "health" && typeof window.ChartsController.load === "function") {
      window.ChartsController.load();
    }
  }
}

window.showChartsCategory = showChartsCategory;

chartsLoadTab?.addEventListener("click", () => showChartsCategory("load"));
chartsHealthTab?.addEventListener("click", () => showChartsCategory("health"));
chartsVolumeTab?.addEventListener("click", () => showChartsCategory("volume"));

window.showYearlyView = showYearlyView;

function showTab(tab) {
  const normalizedTab = ["plan", "goals", "kpis", "charts", "daily", "weekly", "zones", "gear", "components", "yearly"].includes(tab) ? tab : "daily";
  state.activeTab = normalizedTab;
  persistPreferences();

  const isPlan = normalizedTab === "plan";
  const isGoals = normalizedTab === "goals";
  const isKpis = normalizedTab === "kpis";
  const isCharts = normalizedTab === "charts";
  const isDaily = normalizedTab === "daily";
  const isWeekly = normalizedTab === "weekly";
  const isZones = normalizedTab === "zones";
  const isGear = normalizedTab === "gear";
  const isComponents = normalizedTab === "components";
  const isYearly = normalizedTab === "yearly";

  planPane.classList.toggle("hidden", !isPlan);
  goalsPane.classList.toggle("hidden", !isGoals);
  kpisPane.classList.toggle("hidden", !isKpis);
  chartsPane.classList.toggle("hidden", !isCharts);
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

  planTab?.classList.toggle("active", isPlan);
  goalsTab?.classList.toggle("active", isGoals);
  kpisTab?.classList.toggle("active", isKpis);
  chartsTab?.classList.toggle("active", isCharts);
  dailyTab.classList.toggle("active", isDaily);
  weeklyTab.classList.toggle("active", isWeekly);
  zonesTab.classList.toggle("active", isZones);
  gearTab.classList.toggle("active", isGear);
  componentsTab.classList.toggle("active", isComponents);
  yearlyTab.classList.toggle("active", isYearly);

  if (isPlan && typeof window.loadPlan === "function") {
    window.loadPlan();
  }

  if (isCharts) {
    showChartsCategory(getChartsCategory());
  }

  if (isYearly) {
    showYearlyView(state.yearlyView || "annual");
  }
}

function renderHeaderSummary() {
  return;
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
    const payload = window.api && typeof window.api.fetchYearlyCommentary === "function"
      ? await window.api.fetchYearlyCommentary(calendarYear)
      : await fetch(`/api/yearly/commentary/${calendarYear}`).then(async response => {
        if (!response.ok) {
          const detail = response.status === 404 ? "No commentary exists for this year." : `Request failed: ${response.status}`;
          goodNode.textContent = detail;
          badNode.textContent = "No entry recorded.";
          annualNode.textContent = "No entry recorded.";
          throw new Error(detail);
        }
        return response.json();
      });

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
    const payload = window.api && typeof window.api.fetchYearly === "function"
      ? await window.api.fetchYearly()
      : await fetch("/api/yearly").then(async response => {
        if (!response.ok) {
          throw new Error(`Yearly endpoint failed: ${response.status}`);
        }
        return response.json();
      });

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
}

setInterval(loadSyncStatus, 60000);
showTab(window.AppState.activeTab || "daily");
loadData();