(function () {
  const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const OVERVIEW_LOAD_REQUESTS = { current: 0 };
  const ACTIVITY_ICON_MAP = Object.freeze({
    emountainbikeride: "⚡",
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

  function formatOverviewDay(dateValue) {
    if (!dateValue || Number.isNaN(dateValue.getTime())) {
      return { weekday: "", month: "", date: "" };
    }
    const weekday = DAY_NAMES[(dateValue.getDay() + 6) % 7];
    const month = new Intl.DateTimeFormat("en-US", { month: "short" }).format(dateValue);
    const date = dateValue.getDate();
    return { weekday, month: month.toUpperCase(), date: String(date) };
  }

  function formatOverviewLoad(value) {
    if (value === null || value === undefined || value === "") {
      return "";
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "";
    }
    return `${Math.round(numeric)} load`;
  }

  function formatOverviewDuration(value) {
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

  function formatOverviewSupportNames(row) {
    const names = getSupportActivityNames(row);
    return names.slice(0, 2).map((name) => escapeHtml(name));
  }

  function getOverviewRows() {
    if (Array.isArray(window.AppState?.overviewRows) && window.AppState.overviewRows.length > 0) {
      return window.AppState.overviewRows;
    }
    if (Array.isArray(window.AppState?.dailyRows)) {
      return window.AppState.dailyRows;
    }
    return [];
  }

  function getDayRow(dateKey) {
    const rows = getOverviewRows();
    return rows.find((row) => {
      const rowDate = row?.date == null ? "" : String(row.date).trim();
      if (!rowDate) {
        return false;
      }
      const parsedDate = new Date(`${rowDate}T00:00:00`);
      return !Number.isNaN(parsedDate.getTime()) && toLocalDateKey(parsedDate) === dateKey;
    });
  }

  function renderOverviewDayCell(date, row) {
    const label = formatOverviewDay(date);
    const mainRideName = row?.main_ride_name == null ? "" : String(row.main_ride_name).trim();
    const mainRideTime = row?.main_ride_time == null ? "" : String(row.main_ride_time).trim();
    const totalLoad = formatOverviewLoad(row?.total_load);
    const structuredItems = getStructuredOtherActivities(row);
    const supportNames = getSupportActivityNames(row);
    const hasRow = !!row;
    const hasMainRide = Boolean(mainRideName);
    const hasStructuredSupport = structuredItems.length > 0;
    const hasSupport = supportNames.length > 0;

    let bodyHtml = "";
    if (!hasRow) {
      bodyHtml = '<div class="overview-empty-state">No activity</div>';
    } else if (hasMainRide) {
      bodyHtml += `<div class="overview-primary-name">${renderActivityWithIcon(mainRideName, row?.main_ride_sport_type, row?.main_ride_category)}</div>`;
      if (mainRideTime) {
        bodyHtml += `<div class="overview-metric">${escapeHtml(mainRideTime)}</div>`;
      }
      if (totalLoad) {
        bodyHtml += `<div class="overview-metric">${escapeHtml(totalLoad)}</div>`;
      }
      if (hasSupport) {
        const visibleSupport = structuredItems.slice(0, 2).length > 0 ? structuredItems.slice(0, 2) : supportNames.slice(0, 2).map((name) => ({ name, activity_category: "", sport_type: "" }));
        const supportHtml = visibleSupport.map((item) => `<div class="overview-support-name">${renderActivityWithIcon(item.name, item.sport_type, item.activity_category)}</div>`).join("");
        const remainingAfterVisible = Math.max(0, Math.max(structuredItems.length, supportNames.length) - visibleSupport.length);
        bodyHtml += `<div class="overview-support-list">${supportHtml}${remainingAfterVisible > 0 ? `<div class="overview-support-more">+${remainingAfterVisible} more</div>` : ""}</div>`;
      }
    } else if (hasStructuredSupport) {
      const primaryItem = structuredItems[0];
      const remainingSupport = structuredItems.slice(1);
      const visibleSupport = remainingSupport.slice(0, 2);
      const remainingAfterVisible = Math.max(0, remainingSupport.length - visibleSupport.length);

      bodyHtml += `<div class="overview-primary-name">${renderActivityWithIcon(primaryItem.name, primaryItem.sport_type, primaryItem.activity_category)}</div>`;
      if (totalLoad) {
        bodyHtml += `<div class="overview-metric">${escapeHtml(totalLoad)}</div>`;
      }
      if (visibleSupport.length > 0 || remainingAfterVisible > 0) {
        const supportHtml = visibleSupport.map((item) => `<div class="overview-support-name">${renderActivityWithIcon(item.name, item.sport_type, item.activity_category)}</div>`).join("");
        bodyHtml += `<div class="overview-support-list">${supportHtml}${remainingAfterVisible > 0 ? `<div class="overview-support-more">+${remainingAfterVisible} more</div>` : ""}</div>`;
      }
    } else if (hasSupport) {
      const primaryName = supportNames[0];
      const remainingSupport = supportNames.slice(1);
      const visibleSupport = remainingSupport.slice(0, 2);
      const remainingAfterVisible = Math.max(0, remainingSupport.length - visibleSupport.length);

      bodyHtml += `<div class="overview-primary-name">${renderActivityWithIcon(primaryName, "", "")}</div>`;
      if (totalLoad) {
        bodyHtml += `<div class="overview-metric">${escapeHtml(totalLoad)}</div>`;
      }
      if (visibleSupport.length > 0 || remainingAfterVisible > 0) {
        const supportHtml = visibleSupport.map((name) => `<div class="overview-support-name">${renderActivityWithIcon(name, "", "")}</div>`).join("");
        bodyHtml += `<div class="overview-support-list">${supportHtml}${remainingAfterVisible > 0 ? `<div class="overview-support-more">+${remainingAfterVisible} more</div>` : ""}</div>`;
      }
    } else {
      bodyHtml = '<div class="overview-empty-state">No activity details</div>';
    }

    return `
      <div class="overview-day">
        <div class="overview-day-header">
          <span class="overview-weekday">${escapeHtml(label.weekday || "")}</span>
          <span class="overview-date">${escapeHtml(label.month || "")} ${escapeHtml(label.date || "")}</span>
        </div>
        <div class="overview-day-body">
          ${bodyHtml || '<div class="overview-empty-state">No activity</div>'}
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

  function buildOverviewRowMap(rows) {
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

  function renderOverviewWeekRow(weekStartDate, rowMap) {
    const dates = getWeekDates(weekStartDate);
    const html = dates.map((date) => {
      const key = toLocalDateKey(date);
      const row = rowMap.get(key) || null;
      return renderOverviewDayCell(date, row);
    }).join("");

    return `
      <div class="overview-week-row">
        <div class="overview-strip">${html}</div>
      </div>
    `;
  }

  function renderOverviewStrip() {
    const strip = document.getElementById("overviewStrip");
    if (!strip) {
      return;
    }

    const rows = getOverviewRows();
    const rowMap = buildOverviewRowMap(rows);
    const currentWeekDates = getCurrentWeekDates();
    const previousWeekDates = getPreviousWeekDates();
    const html = [
      renderOverviewWeekRow(currentWeekDates[0], rowMap),
      renderOverviewWeekRow(previousWeekDates[0], rowMap),
    ].join("");

    strip.innerHTML = html;
  }

  async function loadOverview() {
    const strip = document.getElementById("overviewStrip");
    if (!strip) {
      return;
    }

    const requestId = ++OVERVIEW_LOAD_REQUESTS.current;

    if (Array.isArray(window.AppState?.dailyRows) && window.AppState.dailyRows.length > 0) {
      window.AppState.overviewRows = window.AppState.dailyRows;
      renderOverviewStrip();
      return;
    }

    strip.innerHTML = '<div class="overview-empty-state">Loading overview…</div>';

    try {
      if (!window.api || typeof window.api.fetchDaily !== "function") {
        throw new Error("Daily API unavailable");
      }

      const payload = await window.api.fetchDaily(14);
      const rows = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.rows) ? payload.rows : []);
      if (requestId !== OVERVIEW_LOAD_REQUESTS.current) {
        return;
      }
      window.AppState.dailyRows = rows;
      window.AppState.overviewRows = rows;
      renderOverviewStrip();
    } catch (error) {
      console.error(error);
      if (requestId !== OVERVIEW_LOAD_REQUESTS.current) {
        return;
      }
      window.AppState.overviewRows = [];
      strip.innerHTML = '<div class="overview-empty-state">Overview unavailable</div>';
    }
  }

  function buildOverviewController() {
    return {
      load: loadOverview,
      render: renderOverviewStrip,
    };
  }

  window.loadOverview = loadOverview;
  window.OverviewController = buildOverviewController();

  document.addEventListener("DOMContentLoaded", () => {
    renderOverviewStrip();
  });
})();
