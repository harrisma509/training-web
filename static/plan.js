(function () {
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const PLAN_LOAD_REQUESTS = { current: 0 };
  const PLAN_WEEK_COLLAPSE_STATE = new Map();
  const PLAN_EXPANDED_DAY_KEYS = new Set();
  const PLAN_CHECKIN_ROWS = new Map();
  const PLAN_CHECKIN_LOAD_REQUESTS = { current: 0 };
  const PLAN_CHECKIN_FLAGS = [
    ["Travel", "is_travel"],
    ["Sick", "is_sick"],
    ["Injury", "is_injury"],
    ["Bike park", "is_bike_park"],
    ["Recovery", "is_recovery"],
    ["Goal or event", "is_goal_event"],
    ["Bad weather", "is_bad_weather"],
    ["Heavy life stress", "is_high_life_stress"],
    ["Lost", "is_lost"],
    ["Gear", "is_gear"],
    ["Crash", "is_crash"],
    ["Group ride", "is_group_ride"],
    ["Sore", "is_sore"],
    ["Tired", "is_tired"],
    ["Didn't sleep well", "is_poor_sleep"],
  ];
  const PLAN_CHECKIN_OPTIONAL_FIELDS = ["readiness", "energy", "soreness", "pain", "physical_labor", "handling_quality"];
  let planCheckinState = {
    selectedDate: null,
    draft: null,
    original: null,
    dirty: false,
    saving: false,
    deleting: false,
    origin: null,
  };
  let planCheckinDrawer = null;
  const PLAN_VISIBLE_ACTIVITY_LIMIT = 5;
  const PLAN_LOAD_GAUGE_CONFIG = Object.freeze({
    maxRatio: 1.5,
    chronicMarkerRatio: 1.0,
    completedLowRampThreshold: -0.2,
    completedHighRampThreshold: 0.2,
    currentWeekLowRatio: 0.8,
    currentWeekHighRatio: 1.2,
  });
  const ACTIVITY_ICON_MAP = Object.freeze({
    emountainbikeride: "🚵",
    ebikeride: "⚡",
    mountainbikeride: "⛰️",
    ride: "🚴",
    virtualride: "🚴",
    gravelride: "🚴",
    walk: "🚶",
    hike: "🥾",
    run: "🏃",
    trailrun: "🏃",
    alpineski: "⛷️",
    backcountryski: "⛷️",
    downhillski: "⛷️",
    ski: "⛷️",
    swim: "🏊",
    standuppaddling: "🏄",
    canoeing: "🏄",
    kayaking: "🏄",
    paddle: "🏄",
    sup: "🏄",
    strength: "💪",
    workout: "💪",
    mobility: "🧘",
    prehab: "🧘",
    other: "●",
  });

  function normalizeActivityToken(value) {
    return String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  }

  function resolveActivityIcon(name, sportType, category) {
    const normalizedName = String(name == null ? "" : name).trim().toLowerCase();

    if (normalizedName.includes("bike park")) {
      return "🚀";
    }
    if (normalizedName.includes("prehab")) {
      return "🧘";
    }
    if (normalizedName.includes("mobility")) {
      return "🧘";
    }

    const normalizedSport = normalizeActivityToken(sportType);
    if (ACTIVITY_ICON_MAP[normalizedSport]) {
      return ACTIVITY_ICON_MAP[normalizedSport];
    }

    const normalizedCategory = normalizeActivityToken(category);
    if (ACTIVITY_ICON_MAP[normalizedCategory]) {
      return ACTIVITY_ICON_MAP[normalizedCategory];
    }

    return "●";
  }

  function renderActivityWithIcon(name, sportType, category) {
    const safeName = name == null ? "" : String(name).trim();
    if (!safeName) {
      return "";
    }
    const icon = resolveActivityIcon(safeName, sportType, category);
    return `${icon} ${escapeHtml(safeName)}`;
  }

  function getWeekStart(date) {
    const localDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayOfWeek = localDate.getDay();
    const diffToMonday = (dayOfWeek + 6) % 7;
    localDate.setDate(localDate.getDate() - diffToMonday);
    return localDate;
  }

  function toLocalDateKey(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function formatPlanDay(dateValue) {
    if (!dateValue || Number.isNaN(dateValue.getTime())) {
      return { weekday: "", month: "", date: "" };
    }
    const weekday = DAY_NAMES[(dateValue.getDay() + 6) % 7];
    const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(dateValue);
    const date = dateValue.getDate();
    return { weekday, month: month.toUpperCase(), date: String(date) };
  }

  function formatPlanHeaderLoad(value) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "—";
    }
    return `${Math.round(numeric)}`;
  }

  function formatPlanCompactLoad(value, prefix = "") {
    if (value === null || value === undefined || value === "") {
      return prefix ? `${prefix}—` : "—";
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return prefix ? `${prefix}—` : "—";
    }
    return `${prefix}${Math.round(numeric)}`;
  }

  function getPlanWeekKey(dateValue) {
    const weekStart = getWeekStart(dateValue);
    return toLocalDateKey(weekStart);
  }

  function getPlanWeeklyRows() {
    if (Array.isArray(window.AppState?.weeklyRows) && window.AppState.weeklyRows.length > 0) {
      return window.AppState.weeklyRows;
    }
    return [];
  }

  function buildPlanWeeklyRowMap(rows) {
    const map = new Map();
    for (const row of rows || []) {
      const weekStart = row?.week_start == null ? "" : String(row.week_start).trim();
      if (!weekStart) {
        continue;
      }
      const parsedDate = new Date(`${weekStart}T00:00:00`);
      if (Number.isNaN(parsedDate.getTime())) {
        continue;
      }
      map.set(getPlanWeekKey(parsedDate), row);
    }
    return map;
  }

  function parsePlanNumericValue(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return null;
    }
    return numeric;
  }

  function getPlanMetricColorClass(ratio) {
    if (ratio === null || !Number.isFinite(ratio)) {
      return "plan-load-gauge-unavailable";
    }
    if (ratio < PLAN_LOAD_GAUGE_CONFIG.currentWeekLowRatio) {
      return "plan-load-gauge-low";
    }
    if (ratio <= PLAN_LOAD_GAUGE_CONFIG.currentWeekHighRatio) {
      return "plan-load-gauge-target";
    }
    return "plan-load-gauge-high";
  }

  function normalizePlanRampRatio(rawRamp) {
    return parsePlanNumericValue(rawRamp);
  }

  function getPlanGaugeColorClass(weeklyRow, ratio, isCurrentWeek) {
    if (isCurrentWeek) {
      return getPlanMetricColorClass(ratio);
    }

    const rawRamp = weeklyRow?.ramp_pct;
    const normalizedRampRatio = normalizePlanRampRatio(rawRamp);
    if (!Number.isFinite(normalizedRampRatio)) {
      return "plan-load-gauge-unavailable";
    }

    if (normalizedRampRatio < PLAN_LOAD_GAUGE_CONFIG.completedLowRampThreshold) {
      return "plan-load-gauge-low";
    }
    if (normalizedRampRatio <= PLAN_LOAD_GAUGE_CONFIG.completedHighRampThreshold) {
      return "plan-load-gauge-target";
    }
    return "plan-load-gauge-high";
  }

  function getPlanMeterRatio(acuteValue, chronicValue, authoritativeRatioValue) {
    const acute = parsePlanNumericValue(acuteValue);
    const chronic = parsePlanNumericValue(chronicValue);
    const authoritativeRatio = parsePlanNumericValue(authoritativeRatioValue);

    if (acute === null || chronic === null || chronic <= 0) {
      return null;
    }

    if (Number.isFinite(authoritativeRatio)) {
      return authoritativeRatio;
    }

    const directRatio = acute / chronic;
    return Number.isFinite(directRatio) ? directRatio : null;
  }

  function getPlanGaugeFillPercent(ratio) {
    if (ratio === null || !Number.isFinite(ratio) || ratio < 0) {
      return 0;
    }
    const scaled = (ratio / PLAN_LOAD_GAUGE_CONFIG.maxRatio) * 100;
    return Math.min(Math.max(scaled, 0), 100);
  }

  function buildPlanGaugeAccessibleText(weekLabel, acuteValue, chronicValue, authoritativeRatio, rawRamp, isCurrentWeek) {
    const acuteText = acuteValue === null
      ? "Acute load unavailable"
      : `${isCurrentWeek ? "Week-to-date acute load" : "Acute load"} ${Math.round(acuteValue)}`;
    const chronicText = chronicValue === null || chronicValue <= 0
      ? "Chronic load unavailable"
      : `Chronic load ${Math.round(chronicValue)}`;
    const ratioText = Number.isFinite(authoritativeRatio)
      ? `Acute-to-chronic ratio ${Number(authoritativeRatio).toFixed(2)}`
      : "";

    let statusText;
    if (isCurrentWeek) {
      statusText = "Current week is incomplete.";
    } else {
      const normalizedRampRatio = normalizePlanRampRatio(rawRamp);
      if (Number.isFinite(normalizedRampRatio)) {
        const rampPercentText = `${normalizedRampRatio >= 0 ? "plus" : "minus"} ${Math.abs(Math.round(normalizedRampRatio * 100))} percent`;
        statusText = normalizedRampRatio > PLAN_LOAD_GAUGE_CONFIG.completedHighRampThreshold
          ? `Ramp ${rampPercentText}, above the 20 percent limit.`
          : normalizedRampRatio < PLAN_LOAD_GAUGE_CONFIG.completedLowRampThreshold
            ? `Ramp ${rampPercentText}, below the negative 20 percent limit.`
            : `Ramp ${rampPercentText}, within the target band.`;
      } else {
        statusText = "Ramp unavailable.";
      }
    }

    return [`Week of ${weekLabel}.`, acuteText + ".", chronicText + ".", ratioText ? ratioText + "." : "", statusText]
      .filter(Boolean)
      .join(" ");
  }

  function renderPlanWeeklyLoadGauge(weekKey, weeklyRow, isCurrentWeek) {
    const acuteValue = parsePlanNumericValue(weeklyRow?.total_load);
    const chronicValue = parsePlanNumericValue(weeklyRow?.chronic_weekly_cw);
    const authoritativeRatio = parsePlanNumericValue(weeklyRow?.ac_ratio);
    const rawRamp = weeklyRow?.ramp_pct;
    const ratio = getPlanMeterRatio(acuteValue, chronicValue, authoritativeRatio);
    const isMissingWeeklyRecord = !weeklyRow;
    const weekDate = weekKey ? new Date(`${weekKey}T00:00:00`) : null;
    const weekLabel = weekDate && !Number.isNaN(weekDate.getTime())
      ? new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(weekDate)
      : "this week";
    const chronicMarkerPercent = (PLAN_LOAD_GAUGE_CONFIG.chronicMarkerRatio / PLAN_LOAD_GAUGE_CONFIG.maxRatio) * 100;
    const chronicDisplay = formatPlanCompactLoad(chronicValue);
    const acuteDisplay = formatPlanCompactLoad(acuteValue);
    const missingGaugeData = isMissingWeeklyRecord || acuteValue === null || chronicValue === null || chronicValue <= 0 || !Number.isFinite(ratio);
    const fillPercent = missingGaugeData ? 0 : getPlanGaugeFillPercent(ratio);
    const fillClass = missingGaugeData ? "plan-load-gauge-unavailable" : getPlanGaugeColorClass(weeklyRow, ratio, isCurrentWeek);
    const accessibleText = buildPlanGaugeAccessibleText(weekLabel, acuteValue, chronicValue, authoritativeRatio, rawRamp, isCurrentWeek);
    const fillHtml = missingGaugeData
      ? ""
      : `<div class="plan-load-gauge-fill ${fillClass}" style="height: ${fillPercent}%"></div>`;
    const trackClassName = missingGaugeData ? "plan-load-gauge-track plan-load-gauge-unavailable" : "plan-load-gauge-track";

    return `
      <div class="plan-load-gauge" role="img" aria-label="${escapeHtml(accessibleText)}" title="${escapeHtml(accessibleText)}" style="--plan-chronic-marker-percent: ${chronicMarkerPercent}%">
        <div class="plan-load-gauge-chronic" aria-hidden="true">${escapeHtml(chronicDisplay)}</div>
        <div class="${trackClassName}">
          ${fillHtml}
          <div class="plan-load-gauge-marker" style="bottom: ${chronicMarkerPercent}%"></div>
        </div>
        <div class="plan-load-gauge-acute" aria-hidden="true">${escapeHtml(acuteDisplay)}</div>
      </div>
    `;
  }

  function isPlanWeekCollapsed(weekKey, defaultCollapsed) {
    if (PLAN_WEEK_COLLAPSE_STATE.has(weekKey)) {
      return PLAN_WEEK_COLLAPSE_STATE.get(weekKey) === true;
    }
    return Boolean(defaultCollapsed);
  }

  function togglePlanWeekCollapse(weekKey, currentlyCollapsed) {
    const nextState = !Boolean(currentlyCollapsed);
    PLAN_WEEK_COLLAPSE_STATE.set(weekKey, nextState);
    renderPlanStrip();
  }

  function togglePlanDayActivities(dayKey) {
    if (!dayKey) {
      return;
    }
    if (PLAN_EXPANDED_DAY_KEYS.has(dayKey)) {
      PLAN_EXPANDED_DAY_KEYS.delete(dayKey);
    } else {
      PLAN_EXPANDED_DAY_KEYS.add(dayKey);
    }
    renderPlanStrip();
  }

  function setupPlanToggleHandlers() {
    const strip = document.getElementById("planStrip");
    if (!strip || strip.dataset.planToggleBound === "true") {
      return;
    }

    strip.addEventListener("click", (event) => {
      const weekButton = event.target.closest("[data-plan-week-toggle]");
      if (weekButton) {
        const weekKey = weekButton.getAttribute("data-plan-week-toggle");
        const currentlyCollapsed = weekButton.getAttribute("aria-expanded") === "false";
        if (!weekKey) {
          return;
        }
        togglePlanWeekCollapse(weekKey, currentlyCollapsed);
        return;
      }

      const dayButton = event.target.closest("[data-plan-day-toggle]");
      if (!dayButton) {
        return;
      }
      const dayKey = dayButton.getAttribute("data-plan-day-toggle");
      if (!dayKey) {
        return;
      }
      togglePlanDayActivities(dayKey);
    });

    strip.dataset.planToggleBound = "true";
  }

  function formatPlanDuration(value) {
    if (value === null || value === undefined || value === "") {
      return "";
    }
    const asString = String(value).trim();
    if (!asString) {
      return "";
    }
    return asString;
  }

  function getStructuredOtherActivities(row) {
    if (!row || !Array.isArray(row.other_activities)) {
      return [];
    }
    return row.other_activities.filter((item) => item && typeof item === "object").map((item) => {
      const name = item.name == null ? "" : String(item.name).trim();
      if (!name) {
        return null;
      }

      return {
        name,
        sport_type: item.sport_type == null ? "" : String(item.sport_type),
        activity_category: item.activity_category == null ? "" : String(item.activity_category),
      };
    }).filter(Boolean);
  }

  function getStructuredActivityNames(row) {
    return getStructuredOtherActivities(row).map((item) => item.name);
  }

  function getSupportActivityNames(row) {
    const structured = getStructuredActivityNames(row);
    if (structured.length > 0) {
      return structured;
    }

    const fallback = row?.other_activity_names == null ? "" : String(row.other_activity_names).trim();
    if (!fallback) {
      return [];
    }

    return fallback
      .split(/\n|\|/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 10);
  }

  function formatPlanSupportNames(row) {
    const names = getSupportActivityNames(row);
    return names.slice(0, 2).map((name) => escapeHtml(name));
  }

  function getPlanRows() {
    if (Array.isArray(window.AppState?.planRows) && window.AppState.planRows.length > 0) {
      return window.AppState.planRows;
    }
    if (Array.isArray(window.AppState?.dailyRows)) {
      return window.AppState.dailyRows;
    }
    return [];
  }

  function getDayRow(dateKey) {
    const rows = getPlanRows();
    return rows.find((row) => {
      const rowDate = row?.date == null ? "" : String(row.date).trim();
      if (!rowDate) {
        return false;
      }
      const parsedDate = new Date(`${rowDate}T00:00:00`);
      return !Number.isNaN(parsedDate.getTime()) && toLocalDateKey(parsedDate) === dateKey;
    });
  }

  function renderPlanSupportToggle(dayKey, dateLabel, hiddenCount, isExpanded) {
    if (!dayKey || hiddenCount <= 0) {
      return "";
    }

    const buttonText = isExpanded ? "Show less" : `+${hiddenCount} more`;
    const noun = hiddenCount === 1 ? "activity" : "activities";
    const accessibleLabel = isExpanded
      ? `Show fewer activities for ${dateLabel}`
      : `Show ${hiddenCount} more ${noun} for ${dateLabel}`;

    return `<button type="button" class="plan-support-toggle" data-plan-day-toggle="${escapeHtml(dayKey)}" aria-expanded="${isExpanded ? "true" : "false"}" aria-label="${escapeHtml(accessibleLabel)}">${escapeHtml(buttonText)}</button>`;
  }

  function formatPlanCheckinStatus(status) {
    return status ? status.charAt(0).toUpperCase() + status.slice(1) : "";
  }

  function getPlanCheckinFlagLabels(checkin) {
    return PLAN_CHECKIN_FLAGS.filter(([, field]) => checkin && checkin[field] === true).map(([label]) => label);
  }

  function renderPlanCheckinSummary(dateKey) {
    const checkin = PLAN_CHECKIN_ROWS.get(dateKey);
    if (!checkin) {
      return `<span class="plan-checkin-empty">+ Check-in</span>`;
    }

    const labels = getPlanCheckinFlagLabels(checkin);
    const visibleLabels = labels.slice(0, 2);
    const extraCount = labels.length - visibleLabels.length;
    const details = visibleLabels.length > 0 ? ` · ${visibleLabels.join(" · ")}` : "";
    const extra = extraCount > 0 ? ` +${extraCount}` : "";
    return `${escapeHtml(formatPlanCheckinStatus(checkin.overall_status))}${escapeHtml(details)}${escapeHtml(extra)}`;
  }

  function renderPlanCheckinControl(dateKey, dateLabel) {
    const hasCheckin = PLAN_CHECKIN_ROWS.has(dateKey);
    const accessibleLabel = hasCheckin ? `Edit Daily Check-in for ${dateLabel}` : `Add Daily Check-in for ${dateLabel}`;
    return `<button type="button" class="plan-checkin-control${hasCheckin ? " has-checkin" : ""}" data-plan-checkin-date="${escapeHtml(dateKey)}" aria-label="${escapeHtml(accessibleLabel)}"><span class="plan-checkin-label">${renderPlanCheckinSummary(dateKey)}</span></button>`;
  }

  function ensurePlanCheckinStatus() {
    const shell = document.querySelector("#planPane .plan-shell");
    if (!shell) {
      return null;
    }
    let status = document.getElementById("planCheckinStatus");
    if (!status) {
      status = document.createElement("div");
      status.id = "planCheckinStatus";
      status.className = "plan-checkin-status hidden";
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      shell.insertBefore(status, shell.firstChild);
    }
    return status;
  }

  function setPlanCheckinStatus(message, isError = false) {
    const status = ensurePlanCheckinStatus();
    if (!status) {
      return;
    }
    status.textContent = message || "";
    status.classList.toggle("hidden", !message);
    status.classList.toggle("is-error", Boolean(isError));
  }

  function getPlanCheckinDateRange() {
    const start = getWeekDatesOffset(3)[0];
    const end = getCurrentWeekDates()[6];
    return { start: toLocalDateKey(start), end: toLocalDateKey(end) };
  }

  async function loadPlanCheckins() {
    const requestId = ++PLAN_CHECKIN_LOAD_REQUESTS.current;
    const range = getPlanCheckinDateRange();
    if (!window.api || typeof window.api.fetchDailyCheckins !== "function") {
      setPlanCheckinStatus("Check-ins unavailable.", true);
      return;
    }

    setPlanCheckinStatus("");
    try {
      const payload = await window.api.fetchDailyCheckins(range.start, range.end);
      if (requestId !== PLAN_CHECKIN_LOAD_REQUESTS.current) {
        return;
      }
      PLAN_CHECKIN_ROWS.clear();
      for (const row of Array.isArray(payload) ? payload : []) {
        const dateKey = typeof row?.checkin_date === "string" ? row.checkin_date : "";
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          PLAN_CHECKIN_ROWS.set(dateKey, row);
        }
      }
      renderPlanStrip();
    } catch (error) {
      if (requestId !== PLAN_CHECKIN_LOAD_REQUESTS.current) {
        return;
      }
      console.warn("Plan check-ins unavailable.", error);
      setPlanCheckinStatus("Check-ins unavailable. Retry", true);
    }
  }

  function createPlanCheckinDrawer() {
    if (planCheckinDrawer) {
      return planCheckinDrawer;
    }
    document.body.insertAdjacentHTML("beforeend", `
      <div id="planCheckinDrawer" class="plan-checkin-drawer hidden" role="dialog" aria-modal="true" aria-labelledby="planCheckinTitle" aria-describedby="planCheckinError">
        <div class="plan-checkin-panel">
          <div class="plan-checkin-header">
            <div>
              <div id="planCheckinTitle" class="drawer-title">Daily Check-in</div>
              <div id="planCheckinDateLabel" class="drawer-subtitle"></div>
            </div>
            <button id="planCheckinClose" type="button" class="drawer-close-button" aria-label="Close Daily Check-in">×</button>
          </div>
          <form id="planCheckinForm" class="plan-checkin-body">
            <div id="planCheckinError" class="drawer-error hidden" role="alert" aria-live="assertive"></div>
            <fieldset class="plan-checkin-section">
              <legend>How are you Feeling?</legend>
              <div class="plan-checkin-status-options" role="radiogroup" aria-label="Overall status">
                <label><input type="radio" name="planCheckinStatus" value="good" required> Good</label>
                <label><input type="radio" name="planCheckinStatus" value="mixed"> Mixed</label>
                <label><input type="radio" name="planCheckinStatus" value="poor"> Poor</label>
              </div>
              <label class="plan-checkin-field" for="planCheckinNote">Note <span>(required)</span></label>
              <textarea id="planCheckinNote" rows="5" maxlength="1000" required aria-describedby="planCheckinNoteCount"></textarea>
              <div id="planCheckinNoteCount" class="plan-checkin-count">0 / 1,000</div>
            </fieldset>
            <fieldset class="plan-checkin-section">
              <legend>How you felt</legend>
              <div class="plan-checkin-grid">
                <label for="planCheckinReadiness">Readiness</label><select id="planCheckinReadiness"><option value="">Not answered</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
                <label for="planCheckinEnergy">Energy</label><select id="planCheckinEnergy"><option value="">Not answered</option><option>1</option><option>2</option><option>3</option><option>4</option><option>5</option></select>
                <label for="planCheckinSoreness">Soreness</label><select id="planCheckinSoreness"><option value="">Not answered</option><option>0</option><option>1</option><option>2</option><option>3</option><option>4</option></select>
                <label for="planCheckinPain">Pain</label><select id="planCheckinPain"><option value="">Not answered</option><option>0</option><option>1</option><option>2</option><option>3</option><option>4</option></select>
              </div>
            </fieldset>
            <fieldset class="plan-checkin-section">
              <legend>Context</legend>
              <div class="plan-checkin-grid">
                <label for="planCheckinPhysicalLabor">Physical labor</label><select id="planCheckinPhysicalLabor"><option value="">Not answered</option><option value="none">None</option><option value="light">Light</option><option value="moderate">Moderate</option><option value="heavy">Heavy</option></select>
                <label for="planCheckinHandlingQuality">Handling quality</label><select id="planCheckinHandlingQuality"><option value="">Not answered</option><option value="sharp">Sharp</option><option value="normal">Normal</option><option value="off">Off</option></select>
              </div>
              <div class="plan-checkin-flags">${PLAN_CHECKIN_FLAGS.map(([label, field]) => `<label><input type="checkbox" data-plan-checkin-flag="${field}"> ${escapeHtml(label)}</label>`).join("")}</div>
            </fieldset>
            <div class="plan-checkin-actions">
              <button id="planCheckinDelete" type="button" class="button-danger hidden">Delete Check-in</button>
              <span></span>
              <button id="planCheckinCancel" type="button" class="button-secondary">Cancel</button>
              <button id="planCheckinSave" type="submit" class="button-primary">Save</button>
            </div>
          </form>
        </div>
      </div>
    `);
    planCheckinDrawer = document.getElementById("planCheckinDrawer");
    document.getElementById("planCheckinClose").addEventListener("click", () => closePlanCheckinDrawer());
    document.getElementById("planCheckinCancel").addEventListener("click", () => closePlanCheckinDrawer());
    document.getElementById("planCheckinDelete").addEventListener("click", () => deletePlanCheckin());
    document.getElementById("planCheckinForm").addEventListener("submit", event => {
      event.preventDefault();
      savePlanCheckin();
    });
    document.getElementById("planCheckinNote").addEventListener("input", () => {
      planCheckinState.dirty = true;
      updatePlanCheckinCount();
      clearPlanCheckinError();
    });
    planCheckinDrawer.addEventListener("keydown", event => {
      if (event.key === "Escape") {
        event.preventDefault();
        closePlanCheckinDrawer();
      }
    });
    planCheckinDrawer.addEventListener("click", event => {
      if (event.target === planCheckinDrawer) {
        closePlanCheckinDrawer();
      }
    });
    planCheckinDrawer.querySelectorAll("input, select, textarea").forEach(input => {
      input.addEventListener("change", () => {
        planCheckinState.dirty = true;
        clearPlanCheckinError();
      });
    });
    return planCheckinDrawer;
  }

  function updatePlanCheckinCount() {
    const note = document.getElementById("planCheckinNote");
    const count = document.getElementById("planCheckinNoteCount");
    if (note && count) {
      count.textContent = `${note.value.length.toLocaleString()} / 1,000`;
    }
  }

  function clearPlanCheckinError() {
    const error = document.getElementById("planCheckinError");
    if (error) {
      error.textContent = "";
      error.classList.add("hidden");
    }
  }

  function setPlanCheckinError(message) {
    const error = document.getElementById("planCheckinError");
    if (error) {
      error.textContent = message || "Unable to save Daily Check-in. Please try again.";
      error.classList.remove("hidden");
    }
  }

  function getPlanCheckinErrorMessage(error, fallback = "Unable to save Daily Check-in. Please try again.") {
    const status = Number(error?.status);
    if (status >= 400 && status < 500) {
      return status === 422 ? "Check-in details are invalid. Please review the form." : "The check-in could not be saved. Please review the form.";
    }
    if (status >= 500) {
      return "Check-in storage is unavailable. Please try again.";
    }
    return fallback;
  }

  function getPlanCheckinDraft() {
    const selected = document.querySelector('input[name="planCheckinStatus"]:checked');
    const numberValue = id => {
      const value = document.getElementById(id)?.value || "";
      return value === "" ? null : Number(value);
    };
    const draft = {
      overall_status: selected ? selected.value : "",
      note: document.getElementById("planCheckinNote")?.value || "",
      readiness: numberValue("planCheckinReadiness"),
      energy: numberValue("planCheckinEnergy"),
      soreness: numberValue("planCheckinSoreness"),
      pain: numberValue("planCheckinPain"),
      physical_labor: document.getElementById("planCheckinPhysicalLabor")?.value || null,
      handling_quality: document.getElementById("planCheckinHandlingQuality")?.value || null,
    };
    PLAN_CHECKIN_FLAGS.forEach(([, field]) => {
      draft[field] = document.querySelector(`[data-plan-checkin-flag="${field}"]`)?.checked === true;
    });
    return draft;
  }

  function hydratePlanCheckinDraft(checkin) {
    const values = checkin || { overall_status: "", note: "" };
    document.querySelectorAll('input[name="planCheckinStatus"]').forEach(input => {
      input.checked = input.value === values.overall_status;
    });
    document.getElementById("planCheckinNote").value = values.note || "";
    const setSelect = (id, value) => { document.getElementById(id).value = value == null ? "" : String(value); };
    setSelect("planCheckinReadiness", values.readiness);
    setSelect("planCheckinEnergy", values.energy);
    setSelect("planCheckinSoreness", values.soreness);
    setSelect("planCheckinPain", values.pain);
    setSelect("planCheckinPhysicalLabor", values.physical_labor);
    setSelect("planCheckinHandlingQuality", values.handling_quality);
    PLAN_CHECKIN_FLAGS.forEach(([, field]) => {
      const input = document.querySelector(`[data-plan-checkin-flag="${field}"]`);
      if (input) input.checked = values[field] === true;
    });
    updatePlanCheckinCount();
  }

  function openPlanCheckinDrawer(dateKey, origin) {
    createPlanCheckinDrawer();
    const date = new Date(`${dateKey}T00:00:00`);
    const dateLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }).format(date);
    const saved = PLAN_CHECKIN_ROWS.get(dateKey) || null;
    planCheckinState = { selectedDate: dateKey, draft: saved, original: saved, dirty: false, saving: false, deleting: false, origin };
    setPlanCheckinBusy(false);
    document.getElementById("planCheckinDateLabel").textContent = dateLabel;
    hydratePlanCheckinDraft(saved);
    document.getElementById("planCheckinDelete").classList.toggle("hidden", !saved);
    clearPlanCheckinError();
    planCheckinDrawer.classList.remove("hidden");
    document.getElementById("planCheckinNote").focus();
  }

  function closePlanCheckinDrawer(force = false) {
    if (!planCheckinDrawer || planCheckinDrawer.classList.contains("hidden")) return;
    if (!force && planCheckinState.dirty && !confirm("Discard unsaved Daily Check-in changes?")) return;
    planCheckinDrawer.classList.add("hidden");
    const origin = planCheckinState.origin;
    planCheckinState = { selectedDate: null, draft: null, original: null, dirty: false, saving: false, deleting: false, origin: null };
    if (origin && typeof origin.focus === "function") origin.focus();
  }

  function setPlanCheckinBusy(busy, deleting = false) {
    ["planCheckinSave", "planCheckinCancel", "planCheckinClose", "planCheckinDelete"].forEach(id => {
      const button = document.getElementById(id);
      if (button) button.disabled = busy;
    });
    const save = document.getElementById("planCheckinSave");
    if (save) save.textContent = busy ? (deleting ? "Deleting…" : "Saving…") : "Save";
  }

  async function savePlanCheckin() {
    if (planCheckinState.saving || planCheckinState.deleting) return;
    const payload = getPlanCheckinDraft();
    payload.note = payload.note.trim();
    if (!payload.overall_status || !payload.note) return setPlanCheckinError("Choose an overall status and enter a note.");
    if (payload.note.length > 1000) return setPlanCheckinError("Note must be 1,000 characters or fewer.");
    planCheckinState.saving = true;
    setPlanCheckinBusy(true);
    try {
      const saved = await window.api.saveDailyCheckin(planCheckinState.selectedDate, payload);
      PLAN_CHECKIN_ROWS.set(planCheckinState.selectedDate, saved);
      renderPlanStrip();
      setPlanCheckinBusy(false);
      closePlanCheckinDrawer(true);
    } catch (error) {
      setPlanCheckinError(getPlanCheckinErrorMessage(error));
    } finally {
      planCheckinState.saving = false;
      setPlanCheckinBusy(false);
    }
  }

  async function deletePlanCheckin() {
    if (planCheckinState.saving || planCheckinState.deleting) return;
    const selectedDate = planCheckinState.selectedDate;
    if (!selectedDate || !confirm(`Delete Daily Check-in for ${selectedDate}?`)) return;
    planCheckinState.deleting = true;
    setPlanCheckinBusy(true, true);
    try {
      await window.api.deleteDailyCheckin(selectedDate);
      PLAN_CHECKIN_ROWS.delete(selectedDate);
      renderPlanStrip();
      closePlanCheckinDrawer(true);
    } catch (error) {
      setPlanCheckinError(getPlanCheckinErrorMessage(error, "Unable to delete Daily Check-in. Please try again."));
    } finally {
      planCheckinState.deleting = false;
      setPlanCheckinBusy(false);
    }
  }

  function setupPlanCheckinHandlers() {
    const strip = document.getElementById("planStrip");
    if (!strip || strip.dataset.planCheckinBound === "true") return;
    strip.addEventListener("click", event => {
      const button = event.target.closest("[data-plan-checkin-date]");
      if (!button) return;
      event.stopPropagation();
      openPlanCheckinDrawer(button.getAttribute("data-plan-checkin-date"), button);
    });
    strip.dataset.planCheckinBound = "true";
  }

  function renderPlanDayCell(date, row, isWeekCollapsed) {
    const label = formatPlanDay(date);
    const dayKey = toLocalDateKey(date);
    const isDayExpanded = PLAN_EXPANDED_DAY_KEYS.has(dayKey);
    const formattedDateLabel = [label.weekday, label.month, label.date].filter(Boolean).join(" ").trim() || "this day";
    const mainRideName = row?.main_ride_name == null ? "" : String(row.main_ride_name).trim();
    const mainRideTime = row?.main_ride_time == null ? "" : String(row.main_ride_time).trim();
    const loadDisplay = formatPlanHeaderLoad(row?.total_load);
    const loadLabel = loadDisplay === "—" ? "No daily load" : `${loadDisplay} daily load`;
    const structuredItems = getStructuredOtherActivities(row);
    const supportNames = getSupportActivityNames(row);
    const hasRow = !!row;
    const hasMainRide = Boolean(mainRideName);
    const hasStructuredSupport = structuredItems.length > 0;
    const hasSupport = supportNames.length > 0;
    const supportVisibleLimit = Math.max(0, PLAN_VISIBLE_ACTIVITY_LIMIT - 1);

    let bodyHtml = "";
    if (!hasRow) {
      bodyHtml = '<div class="plan-empty-state">No activity</div>';
    } else if (hasMainRide) {
      bodyHtml += `<div class="plan-primary-name">${renderActivityWithIcon(mainRideName, row?.main_ride_sport_type, row?.main_ride_category)}</div>`;
      if (mainRideTime) {
        bodyHtml += `<div class="plan-metric">${escapeHtml(mainRideTime)}</div>`;
      }
      if (hasSupport) {
        const supportItems = structuredItems.length > 0 ? structuredItems : supportNames.map((name) => ({ name, activity_category: "", sport_type: "" }));
        const visibleSupport = isDayExpanded ? supportItems : supportItems.slice(0, supportVisibleLimit);
        const supportHtml = visibleSupport.map((item) => `<div class="plan-support-name">${renderActivityWithIcon(item.name, item.sport_type, item.activity_category)}</div>`).join("");
        const hiddenCount = Math.max(0, supportItems.length + 1 - PLAN_VISIBLE_ACTIVITY_LIMIT);
        bodyHtml += `<div class="plan-support-list">${supportHtml}${hiddenCount > 0 ? renderPlanSupportToggle(dayKey, formattedDateLabel, hiddenCount, isDayExpanded) : ""}</div>`;
      }
    } else if (hasStructuredSupport) {
      const primaryItem = structuredItems[0];
      const remainingSupport = structuredItems.slice(1);
      const visibleSupport = isDayExpanded ? remainingSupport : remainingSupport.slice(0, supportVisibleLimit);
      const hiddenCount = Math.max(0, remainingSupport.length + 1 - PLAN_VISIBLE_ACTIVITY_LIMIT);

      bodyHtml += `<div class="plan-primary-name">${renderActivityWithIcon(primaryItem.name, primaryItem.sport_type, primaryItem.activity_category)}</div>`;
      if (visibleSupport.length > 0 || hiddenCount > 0) {
        const supportHtml = visibleSupport.map((item) => `<div class="plan-support-name">${renderActivityWithIcon(item.name, item.sport_type, item.activity_category)}</div>`).join("");
        bodyHtml += `<div class="plan-support-list">${supportHtml}${hiddenCount > 0 ? renderPlanSupportToggle(dayKey, formattedDateLabel, hiddenCount, isDayExpanded) : ""}</div>`;
      }
    } else if (hasSupport) {
      const primaryName = supportNames[0];
      const remainingSupport = supportNames.slice(1);
      const visibleSupport = isDayExpanded ? remainingSupport : remainingSupport.slice(0, supportVisibleLimit);
      const hiddenCount = Math.max(0, remainingSupport.length + 1 - PLAN_VISIBLE_ACTIVITY_LIMIT);

      bodyHtml += `<div class="plan-primary-name">${renderActivityWithIcon(primaryName, "", "")}</div>`;
      if (visibleSupport.length > 0 || hiddenCount > 0) {
        const supportHtml = visibleSupport.map((name) => `<div class="plan-support-name">${renderActivityWithIcon(name, "", "")}</div>`).join("");
        bodyHtml += `<div class="plan-support-list">${supportHtml}${hiddenCount > 0 ? renderPlanSupportToggle(dayKey, formattedDateLabel, hiddenCount, isDayExpanded) : ""}</div>`;
      }
    } else {
      bodyHtml = '<div class="plan-empty-state">No activity details</div>';
    }

    return `
      <div class="plan-day ${isWeekCollapsed ? "is-collapsed" : ""}">
        <div class="plan-day-header">
          <span class="plan-weekday">${escapeHtml(label.weekday || "")}</span>
          <span class="plan-day-load" aria-label="${escapeHtml(loadLabel)}" title="${escapeHtml(loadLabel)}">${escapeHtml(loadDisplay)}</span>
          <span class="plan-date">${escapeHtml(label.month || "")} ${escapeHtml(label.date || "")}</span>
        </div>
        <div class="plan-day-body" ${isWeekCollapsed ? "hidden" : ""}>
          ${bodyHtml || '<div class="plan-empty-state">No activity</div>'}
          ${isWeekCollapsed ? "" : renderPlanCheckinControl(dayKey, formattedDateLabel)}
        </div>
      </div>
    `;
  }

  function getWeekDates(startDate) {
    const start = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      return date;
    });
  }

  function getWeekDatesOffset(weeksBack) {
    const currentWeekStart = getWeekStart(new Date());
    const targetWeekStart = new Date(currentWeekStart);
    targetWeekStart.setDate(currentWeekStart.getDate() - (weeksBack * 7));
    return getWeekDates(targetWeekStart);
  }

  function getCurrentWeekDates() {
    return getWeekDatesOffset(0);
  }

  function buildPlanRowMap(rows) {
    const map = new Map();
    for (const row of rows || []) {
      const rowDate = row?.date == null ? "" : String(row.date).trim();
      if (!rowDate) {
        continue;
      }
      const parsedDate = new Date(`${rowDate}T00:00:00`);
      if (Number.isNaN(parsedDate.getTime())) {
        continue;
      }
      map.set(toLocalDateKey(parsedDate), row);
    }
    return map;
  }

  function renderPlanWeekRow(weekStartDate, rowMap, weeklyRowMap, defaultCollapsed) {
    const weekKey = getPlanWeekKey(weekStartDate);
    const collapsed = isPlanWeekCollapsed(weekKey, defaultCollapsed);
    const weekLabel = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric" }).format(weekStartDate);
    const weeklyRecord = weeklyRowMap.get(weekKey) || null;
    const isCurrentWeek = weekKey === getPlanWeekKey(new Date());
    const dates = getWeekDates(weekStartDate);
    const html = dates.map((date) => {
      const key = toLocalDateKey(date);
      const row = rowMap.get(key) || null;
      return renderPlanDayCell(date, row, collapsed);
    }).join("");

    return `
      <div class="plan-week-row ${collapsed ? "collapsed" : "expanded"}">
        <div class="plan-week-toggle-cell">
          <button type="button" class="plan-week-toggle" data-plan-week-toggle="${escapeHtml(weekKey || "")}" aria-expanded="${collapsed ? "false" : "true"}" aria-label="${escapeHtml(collapsed ? `Expand week of ${weekLabel}` : `Collapse week of ${weekLabel}`)}">${collapsed ? "+" : "−"}</button>
          ${renderPlanWeeklyLoadGauge(weekKey, weeklyRecord, isCurrentWeek)}
        </div>
        <div class="plan-strip">${html}</div>
      </div>
    `;
  }

  function renderPlanStrip() {
    const strip = document.getElementById("planStrip");
    if (!strip) {
      return;
    }

    const rows = getPlanRows();
    const rowMap = buildPlanRowMap(rows);
    const weeklyRows = getPlanWeeklyRows();
    const weeklyRowMap = buildPlanWeeklyRowMap(weeklyRows);
    const weekOffsets = [0, 1, 2, 3];

    const html = weekOffsets.map((weeksBack) => {
      const weekDates = getWeekDatesOffset(weeksBack);
      const weekKey = getPlanWeekKey(weekDates[0]);
      const defaultCollapsed = weeksBack >= 2 ? !PLAN_WEEK_COLLAPSE_STATE.has(weekKey) : false;
      return renderPlanWeekRow(weekDates[0], rowMap, weeklyRowMap, defaultCollapsed);
    }).join("");

    strip.innerHTML = html;
    setupPlanToggleHandlers();
    setupPlanCheckinHandlers();
  }

  async function ensurePlanWeeklyRows() {
    if (Array.isArray(window.AppState?.weeklyRows) && window.AppState.weeklyRows.length > 0) {
      return;
    }

    if (!window.api || typeof window.api.fetchWeekly !== "function") {
      return;
    }

    try {
      const payload = await window.api.fetchWeekly(52);
      const rows = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.rows) ? payload.rows : []);
      window.AppState.weeklyRows = rows;
    } catch (error) {
      console.warn("Plan weekly data unavailable.", error);
      window.AppState.weeklyRows = [];
    }
  }

  async function loadPlan() {
    const strip = document.getElementById("planStrip");
    if (!strip) {
      return;
    }

    const requestId = ++PLAN_LOAD_REQUESTS.current;

    if (Array.isArray(window.AppState?.dailyRows) && window.AppState.dailyRows.length > 0) {
      window.AppState.planRows = window.AppState.dailyRows;
      await ensurePlanWeeklyRows();
      renderPlanStrip();
      await loadPlanCheckins();
      return;
    }

    strip.innerHTML = '<div class="plan-empty-state">Loading plan…</div>';

    try {
      if (!window.api || typeof window.api.fetchDaily !== "function") {
        throw new Error("Daily API unavailable");
      }

      const payload = await window.api.fetchDaily(28);
      const rows = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.rows) ? payload.rows : []);
      if (requestId !== PLAN_LOAD_REQUESTS.current) {
        return;
      }
      window.AppState.dailyRows = rows;
      window.AppState.planRows = rows;
      await ensurePlanWeeklyRows();
      renderPlanStrip();
      await loadPlanCheckins();
    } catch (error) {
      console.error(error);
      if (requestId !== PLAN_LOAD_REQUESTS.current) {
        return;
      }
      window.AppState.planRows = [];
      strip.innerHTML = '<div class="plan-empty-state">Plan unavailable</div>';
    }
  }

  function buildPlanController() {
    return {
      load: loadPlan,
      render: renderPlanStrip,
    };
  }

  window.loadPlan = loadPlan;
  window.PlanController = buildPlanController();

  document.addEventListener("DOMContentLoaded", () => {
    renderPlanStrip();
  });
})();
