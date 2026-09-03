(function () {
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const PLAN_LOAD_REQUESTS = { current: 0 };
  const PLAN_WEEK_COLLAPSE_STATE = new Map();
  const PLAN_EXPANDED_DAY_KEYS = new Set();
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

  function togglePlanWeekCollapse(weekKey) {
    const nextState = !(PLAN_WEEK_COLLAPSE_STATE.get(weekKey) === true);
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
        if (!weekKey) {
          return;
        }
        togglePlanWeekCollapse(weekKey);
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

  function getCurrentWeekDates() {
    return getWeekDates(getWeekStart(new Date()));
  }

  function getPreviousWeekDates() {
    const currentWeekStart = getWeekStart(new Date());
    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(currentWeekStart.getDate() - 7);
    return getWeekDates(previousWeekStart);
  }

  function getOlderWeekDates() {
    const currentWeekStart = getWeekStart(new Date());
    const previousWeekStart = new Date(currentWeekStart);
    previousWeekStart.setDate(currentWeekStart.getDate() - 7);
    const olderWeekStart = new Date(previousWeekStart);
    olderWeekStart.setDate(previousWeekStart.getDate() - 7);
    return getWeekDates(olderWeekStart);
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
    const currentWeekDates = getCurrentWeekDates();
    const previousWeekDates = getPreviousWeekDates();
    const olderWeekDates = getOlderWeekDates();
    const olderWeekKey = getPlanWeekKey(olderWeekDates[0]);

    const html = [
      renderPlanWeekRow(currentWeekDates[0], rowMap, weeklyRowMap, false),
      renderPlanWeekRow(previousWeekDates[0], rowMap, weeklyRowMap, false),
      renderPlanWeekRow(olderWeekDates[0], rowMap, weeklyRowMap, !PLAN_WEEK_COLLAPSE_STATE.has(olderWeekKey)),
    ].join("");

    strip.innerHTML = html;
    setupPlanToggleHandlers();
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
      return;
    }

    strip.innerHTML = '<div class="plan-empty-state">Loading plan…</div>';

    try {
      if (!window.api || typeof window.api.fetchDaily !== "function") {
        throw new Error("Daily API unavailable");
      }

      const payload = await window.api.fetchDaily(21);
      const rows = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.rows) ? payload.rows : []);
      if (requestId !== PLAN_LOAD_REQUESTS.current) {
        return;
      }
      window.AppState.dailyRows = rows;
      window.AppState.planRows = rows;
      await ensurePlanWeeklyRows();
      renderPlanStrip();
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
