let dailyRows = [];
let weeklyRows = [];
let activeTab = "daily";

const dailyTab = document.getElementById("dailyTab");
const weeklyTab = document.getElementById("weeklyTab");
const dailyPane = document.getElementById("dailyPane");
const weeklyPane = document.getElementById("weeklyPane");

const dailyControls = document.getElementById("dailyControls");
const weeklyControls = document.getElementById("weeklyControls");

const dailyLimit = document.getElementById("dailyLimit");
const weeklyLimit = document.getElementById("weeklyLimit");
const dailyRefresh = document.getElementById("dailyRefresh");
const weeklyRefresh = document.getElementById("weeklyRefresh");


const syncStatus = document.getElementById("syncStatus");
const syncNowBtn = document.getElementById("syncNowBtn");

dailyTab.addEventListener("click", () => showTab("daily"));
weeklyTab.addEventListener("click", () => showTab("weekly"));
dailyRefresh.addEventListener("click", loadDaily);
weeklyRefresh.addEventListener("click", loadWeekly);
syncNowBtn.addEventListener("click", handleSyncNow);

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
  activeTab = tab;

  const isDaily = tab === "daily";

  dailyPane.classList.toggle("hidden", !isDaily);
  weeklyPane.classList.toggle("hidden", isDaily);

  dailyControls.classList.toggle("hidden", !isDaily);
  weeklyControls.classList.toggle("hidden", isDaily);

  dailyTab.classList.toggle("active", isDaily);
  weeklyTab.classList.toggle("active", !isDaily);
}

function renderHeaderSummary() {
  return;
}


function renderDailyTable() {
  const rows = dailyRows.map(row => `
    <tr>
      <td>${safe(row.date)}</td>
      <td>${row.weight_lb == null ? "" : Number(row.weight_lb).toFixed(1)}</td>
      <td>${safe(row.sleep_score)}</td>
      <td>${safe(row.steps)}</td>
      <td>${safe(row.rhr_bpm)}</td>
      <td>${row.hrv_sdnn_ms == null ? "" : Number(row.hrv_sdnn_ms).toFixed(0)}</td>
      <td>${safe(row.activity_categories)}</td>
      <td>${safe(row.main_ride_name)}</td>
      <td>${safe(row.main_ride_bike_name)}</td>
      <td>${safe(row.main_ride_load)}</td>
      <td>${safe(row.main_ride_band)}</td>
      <td>${safe(row.other_load)}</td>
      <td>${safe(row.total_load)}</td>
      <td>${safe(row.other_activity_names).replaceAll("\\n", "<br>")}</td>
    </tr>
  `).join("");

  document.getElementById("dailyTable").innerHTML = `
    <thead>
      <tr>
        <th>Date</th>
        <th>Weight</th>
        <th>Sleep</th>
        <th>Steps</th>
        <th>RHR</th>
        <th>HRV</th>
        <th>Count</th>
        <th>Main Ride</th>
        <th>Bike</th>
        <th>Main Load</th>
        <th>Band</th>
        <th>Other Load</th>
        <th>Total</th>
        <th>Other Activities</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  `;
}

async function loadDaily() {
  const limit = dailyLimit.value;
  dailyRows = await fetch(`/api/daily?limit=${limit}`).then(response => response.json());
  renderDailyTable();

  if (activeTab === "daily") {
    renderHeaderSummary();
  }
}

async function loadWeekly() {
  const limit = weeklyLimit.value;
  weeklyRows = await fetch(`/api/weekly?limit=${limit}`).then(response => response.json());
  renderWeeklyTable();

  if (activeTab === "weekly") {
    renderHeaderSummary();
  }
}

function createWeeklyCommentEditor(cell) {
  const weekStart = cell.dataset.weekStart;
  const originalText = getWeeklyCommentText(weekStart);
  const textarea = document.createElement("textarea");
  textarea.className = "weekly-comment-input";
  textarea.value = originalText;
  textarea.rows = 4;
  textarea.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      cell.classList.remove("editing");
      cell.innerHTML = `<div class="weekly-comment-display" title="${escapeHtml(originalText)}">${escapeHtml(truncateText(originalText, 100))}</div>`;
      attachWeeklyCommentHandlers(cell);
    }
  });

  textarea.addEventListener("blur", async () => {
    const newValue = textarea.value;
    if (newValue === originalText) {
      cell.classList.remove("editing");
      cell.innerHTML = `<div class="weekly-comment-display" title="${escapeHtml(originalText)}">${escapeHtml(truncateText(originalText, 100))}</div>`;
      attachWeeklyCommentHandlers(cell);
      return;
    }

    cell.classList.add("saving");
    try {
      const response = await fetch(`/api/weekly-commentary/${weekStart}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ weekly_comment: newValue }),
      });

      if (!response.ok) {
        throw new Error(`Save failed: ${response.status}`);
      }

      const result = await response.json();
      updateWeeklyRowComment(weekStart, result.weekly_comment);
      cell.classList.remove("editing", "error");
      cell.innerHTML = `<div class="weekly-comment-display" title="${escapeHtml(result.weekly_comment || "")}">${escapeHtml(truncateText(result.weekly_comment || "", 100))}</div>`;
      attachWeeklyCommentHandlers(cell);
    } catch (error) {
      console.error(error);
      cell.classList.add("error");
      // Leave textarea visible so user can retry or correct
    } finally {
      cell.classList.remove("saving");
    }
  });

  cell.classList.add("editing");
  cell.innerHTML = "";
  cell.appendChild(textarea);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function attachWeeklyCommentHandlers(cell) {
  cell.addEventListener("click", () => {
    if (!cell.classList.contains("editing")) {
      createWeeklyCommentEditor(cell);
    }
  }, { once: true });
}

let currentDrawerWeek = null;
let drawerInitialValues = null;
let drawerDirty = false;

const weeklyDrawer = document.getElementById("weeklyDrawer");
const weeklyDrawerContent = document.getElementById("weeklyDrawerContent");
const weeklyDrawerContext = document.getElementById("drawerContext");
const drawerCloseBtn = document.getElementById("drawerCloseBtn");
const drawerCancelBtn = document.getElementById("drawerCancelBtn");
const drawerSaveBtn = document.getElementById("drawerSaveBtn");

function openWeeklyDrawer(weekStart) {
  const row = weeklyRows.find(r => r.week_start === weekStart);
  if (!row) {
    return;
  }

  currentDrawerWeek = weekStart;
  drawerInitialValues = getDrawerFormValues(row);
  drawerDirty = false;
  renderDrawerContext(row);
  renderDrawerForm(drawerInitialValues);
  weeklyDrawer.classList.remove("hidden");
  weeklyDrawer.setAttribute("aria-hidden", "false");
}

function closeWeeklyDrawer(force = false) {
  if (!weeklyDrawer.classList.contains("hidden") && drawerDirty && !force) {
    if (!confirm("Discard unsaved changes?")) {
      return;
    }
  }
  weeklyDrawer.classList.add("hidden");
  weeklyDrawer.setAttribute("aria-hidden", "true");
  currentDrawerWeek = null;
  drawerInitialValues = null;
  drawerDirty = false;
}

function renderDrawerContext(row) {
  weeklyDrawerContext.innerHTML = `
    <div class="drawer-context-row"><strong>Week:</strong> ${safe(row.week_start)}</div>
    <div class="drawer-context-row"><strong>Week End:</strong> ${safe(row.week_end)}</div>
    <div class="drawer-context-row"><strong>Total Load:</strong> ${safe(row.total_load)}</div>
    <div class="drawer-context-row"><strong>Status:</strong> ${safe(row.status_level)}</div>
    <div class="drawer-context-row"><strong>Status Text:</strong> ${safe(row.status_text)}</div>
  `;
}

function getDrawerFormValues(row) {
  return {
    week_type: safe(row.week_type),
    event: safe(row.event),
    planned_focus: safe(row.planned_focus),
    actual_focus: safe(row.actual_focus),
    weekly_comment: safe(row.weekly_comment),
    risk_note: safe(row.risk_note),
    coach_note: safe(row.coach_note),
    task_note: safe(row.task_note),
    lesson_learned: safe(row.lesson_learned),
    status_override: safe(row.status_override),
    is_travel_week: !!row.is_travel_week,
    is_sick_week: !!row.is_sick_week,
    is_injury_week: !!row.is_injury_week,
    is_bike_park_week: !!row.is_bike_park_week,
    is_recovery_week: !!row.is_recovery_week,
    is_goal_week: !!row.is_goal_week,
    hide_from_dashboard: !!row.hide_from_dashboard,
    display_priority: row.display_priority != null ? row.display_priority : 0,
  };
}

function renderDrawerForm(values) {
  weeklyDrawerContent.innerHTML = `
    <div class="drawer-field-group">
      <label>Week Type</label>
      <input id="drawer-week_type" class="drawer-input" type="text" value="${escapeHtml(values.week_type)}">
    </div>
    <div class="drawer-field-group">
      <label>Event</label>
      <input id="drawer-event" class="drawer-input" type="text" value="${escapeHtml(values.event)}">
    </div>
    <div class="drawer-field-group">
      <label>Planned Focus</label>
      <textarea id="drawer-planned_focus" class="drawer-textarea" rows="3">${escapeHtml(values.planned_focus)}</textarea>
    </div>
    <div class="drawer-field-group">
      <label>Actual Focus</label>
      <textarea id="drawer-actual_focus" class="drawer-textarea" rows="3">${escapeHtml(values.actual_focus)}</textarea>
    </div>
    <div class="drawer-field-group">
      <label>Weekly Comment</label>
      <textarea id="drawer-weekly_comment" class="drawer-textarea" rows="4">${escapeHtml(values.weekly_comment)}</textarea>
    </div>
    <div class="drawer-field-group">
      <label>Risk Note</label>
      <textarea id="drawer-risk_note" class="drawer-textarea" rows="2">${escapeHtml(values.risk_note)}</textarea>
    </div>
    <div class="drawer-field-group">
      <label>Coach Note</label>
      <textarea id="drawer-coach_note" class="drawer-textarea" rows="2">${escapeHtml(values.coach_note)}</textarea>
    </div>
    <div class="drawer-field-group">
      <label>Task Note</label>
      <textarea id="drawer-task_note" class="drawer-textarea" rows="2">${escapeHtml(values.task_note)}</textarea>
    </div>
    <div class="drawer-field-group">
      <label>Lesson Learned</label>
      <textarea id="drawer-lesson_learned" class="drawer-textarea" rows="2">${escapeHtml(values.lesson_learned)}</textarea>
    </div>
    <div class="drawer-field-group">
      <label>Status Override</label>
      <input id="drawer-status_override" class="drawer-input" type="text" value="${escapeHtml(values.status_override)}">
    </div>
    <div class="drawer-checkbox-group">
      <label><input id="drawer-is_travel_week" type="checkbox" ${values.is_travel_week ? "checked" : ""}> Travel Week</label>
      <label><input id="drawer-is_sick_week" type="checkbox" ${values.is_sick_week ? "checked" : ""}> Sick Week</label>
      <label><input id="drawer-is_injury_week" type="checkbox" ${values.is_injury_week ? "checked" : ""}> Injury Week</label>
      <label><input id="drawer-is_bike_park_week" type="checkbox" ${values.is_bike_park_week ? "checked" : ""}> Bike Park Week</label>
      <label><input id="drawer-is_recovery_week" type="checkbox" ${values.is_recovery_week ? "checked" : ""}> Recovery Week</label>
      <label><input id="drawer-is_goal_week" type="checkbox" ${values.is_goal_week ? "checked" : ""}> Goal Week</label>
      <label><input id="drawer-hide_from_dashboard" type="checkbox" ${values.hide_from_dashboard ? "checked" : ""}> Hide from Dashboard</label>
    </div>
    <div class="drawer-field-group">
      <label>Display Priority</label>
      <input id="drawer-display_priority" class="drawer-input" type="number" value="${escapeHtml(String(values.display_priority))}">
    </div>
    <div id="drawerError" class="drawer-error hidden"></div>
  `;

  const fields = weeklyDrawerContent.querySelectorAll("input, textarea");
  fields.forEach(field => {
    field.addEventListener("input", () => {
      drawerDirty = true;
      const error = document.getElementById("drawerError");
      if (error) {
        error.classList.add("hidden");
      }
    });
  });
}

function getDrawerFormPayload() {
  const textField = id => {
    const element = document.getElementById(id);
    return element ? (element.value.trim() || null) : null;
  };

  const numberField = id => {
    const element = document.getElementById(id);
    if (!element) {
      return null;
    }
    const value = element.value.trim();
    return value === "" ? null : Number(value);
  };

  const checkboxField = id => {
    const element = document.getElementById(id);
    return element ? element.checked : false;
  };

  return {
    week_type: textField("drawer-week_type"),
    event: textField("drawer-event"),
    planned_focus: textField("drawer-planned_focus"),
    actual_focus: textField("drawer-actual_focus"),
    weekly_comment: textField("drawer-weekly_comment"),
    risk_note: textField("drawer-risk_note"),
    coach_note: textField("drawer-coach_note"),
    task_note: textField("drawer-task_note"),
    lesson_learned: textField("drawer-lesson_learned"),
    status_override: textField("drawer-status_override"),
    is_travel_week: checkboxField("drawer-is_travel_week"),
    is_sick_week: checkboxField("drawer-is_sick_week"),
    is_injury_week: checkboxField("drawer-is_injury_week"),
    is_bike_park_week: checkboxField("drawer-is_bike_park_week"),
    is_recovery_week: checkboxField("drawer-is_recovery_week"),
    is_goal_week: checkboxField("drawer-is_goal_week"),
    hide_from_dashboard: checkboxField("drawer-hide_from_dashboard"),
    display_priority: numberField("drawer-display_priority"),
  };
}

function setDrawerError(message) {
  const error = document.getElementById("drawerError");
  if (!error) {
    return;
  }
  error.textContent = message;
  error.classList.remove("hidden");
}

async function saveWeeklyDrawer() {
  if (!currentDrawerWeek) {
    return;
  }

  const payload = getDrawerFormPayload();
  drawerSaveBtn.disabled = true;
  drawerCancelBtn.disabled = true;
  drawerCloseBtn.disabled = true;

  try {
    const response = await fetch(`/api/weekly-commentary/${currentDrawerWeek}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || `Save failed: ${response.status}`);
    }

    const result = await response.json();
    const row = weeklyRows.find(r => r.week_start === currentDrawerWeek);
    if (row) {
      Object.assign(row, result);
    }

    updateWeeklyRowComment(currentDrawerWeek, result.weekly_comment);
    renderWeeklyTable();
    drawerDirty = false;
    closeWeeklyDrawer(true);
  } catch (error) {
    console.error(error);
    setDrawerError("Unable to save commentary. Please try again.");
  } finally {
    drawerSaveBtn.disabled = false;
    drawerCancelBtn.disabled = false;
    drawerCloseBtn.disabled = false;
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

function renderWeeklyTable() {
  const rows = weeklyRows.map(row => `
    <tr>
      <td>${safe(row.week_start)}</td>
      <td class="weekly-comment-cell" data-week-start="${safe(row.week_start)}" contenteditable="false" tabindex="0">
        <div class="weekly-comment-display" title="${escapeHtml(safe(row.weekly_comment))}">${escapeHtml(truncateText(safe(row.weekly_comment), 100))}</div>
      </td>
      <td class="drawer-icon-cell"><button class="drawer-open-button" data-week-start="${safe(row.week_start)}" type="button" aria-label="Edit weekly commentary"></button></td>
      <td>${safe(row.total_load)}</td>
      <td>${safe(row.chronic_weekly_cw)}</td>
      <td>${safe(row.ac_ratio)}</td>
      <td>${safe(row.ramp_pct_display)}</td>
      <td>${statusPill(row.status_level)}</td>
      <td>${safe(row.status_text)}</td>
      <td>${safe(row.main_ride_load)}</td>
      <td>${safe(row.other_load)}</td>
      <td>${safe(row.activity_days)}</td>
      <td>${safe(row.ride_count)}</td>
      <td>${safe(row.walk_count)}</td>
      <td>${safe(row.hike_count)}</td>
      <td>${safe(row.strength_count)}</td>
      <td>${safe(row.very_hard_epic_days)}</td>
      <td>${row.vo2max == null ? "" : Number(row.vo2max).toFixed(1)}</td>
      <td>${safe(row.falls)}</td>
    </tr>
  `).join("");

  document.getElementById("weeklyTable").innerHTML = `
    <thead>
      <tr>
        <th>Week Start</th>
        <th>Weekly Comment</th>
        <th></th>
        <th>Total Load</th>
        <th>Chronic</th>
        <th>A/C</th>
        <th>Ramp</th>
        <th>Status</th>
        <th>Status Text</th>
        <th>Main Ride</th>
        <th>Other</th>
        <th>Days</th>
        <th>Rides</th>
        <th>Walks</th>
        <th>Hikes</th>
        <th>Strength</th>
        <th>VH Days</th>
        <th>VO2 Max</th>
        <th>Falls</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  `;

  document.querySelectorAll(".weekly-comment-cell").forEach(cell => {
    attachWeeklyCommentHandlers(cell);
  });

  document.querySelectorAll(".drawer-open-button").forEach(button => {
    button.addEventListener("click", event => {
      openWeeklyDrawer(button.dataset.weekStart);
      event.stopPropagation();
    });
  });
}

function updateWeeklyRowComment(weekStart, comment) {
  const row = weeklyRows.find(r => r.week_start === weekStart);
  if (row) {
    row.weekly_comment = comment;
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function loadData() {
  await Promise.all([
    loadDaily(),
    loadWeekly()
  ]);

  renderHeaderSummary();
  loadSyncStatus();
}

setInterval(loadSyncStatus, 60000);

drawerCloseBtn.addEventListener("click", () => closeWeeklyDrawer());
drawerCancelBtn.addEventListener("click", () => closeWeeklyDrawer());
drawerSaveBtn.addEventListener("click", saveWeeklyDrawer);
weeklyDrawer.addEventListener("click", event => {
  if (event.target === weeklyDrawer) {
    closeWeeklyDrawer();
  }
});

function renderSyncStatusPlaceholder() {
  syncStatus.className = "sync-pill sync-muted";
  syncStatus.innerHTML = `
    <span class="sync-dot"></span>
    <span>Sync status not wired</span>
  `;
}

function formatSyncTime(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit"
  });
}

async function loadSyncStatus() {
  try {
    const data = await fetch("/api/sync-status").then(response => response.json());
    renderSyncStatus(data);
  } catch (error) {
    syncStatus.className = "sync-pill sync-failed";
    syncStatus.innerHTML = `
      <span class="sync-dot"></span>
      <span>Sync status error</span>
    `;
  }
}
function renderSyncStatus(data) {
  const health = data.health || "unknown";

  const statusClass = health === "healthy"
    ? "sync-healthy"
    : health === "stale"
      ? "sync-stale"
      : health === "failed"
        ? "sync-failed"
        : health === "pending" || health === "running"
          ? "sync-running"
          : "sync-muted";

  const label = data.label || "Sync status unknown";
  const syncTime = formatSyncTime(data.last_sync_time_utc);
  const requestTime = formatSyncTime(data.sync_request_time_utc);
  const hours = data.hours_since_good_sync;

  let detail = label;

  if (health === "pending") {
    detail = requestTime
      ? `Sync requested · ${requestTime}`
      : "Sync requested";
  } else if (health === "running") {
    detail = requestTime
      ? `Sync running · requested ${requestTime}`
      : "Sync running";
  } else {
    if (syncTime) {
      detail = `${detail} · ${syncTime}`;
    }

    if (hours !== null && hours !== undefined) {
      detail = `${detail} · ${hours}h ago`;
    }

    if ((data.warning_count ?? 0) > 0) {
      detail = `${detail} · ${data.warning_count} warn`;
    }
  }

  syncStatus.className = `sync-pill ${statusClass}`;
  syncStatus.innerHTML = `
    <span class="sync-dot"></span>
    <span>${detail}</span>
  `;
}

async function handleSyncNow() {
  syncNowBtn.disabled = true;
  syncNowBtn.textContent = "Requesting...";

  try {
    const response = await fetch("/api/sync-request", {
      method: "POST"
    });

    if (!response.ok) {
      throw new Error("Sync request failed");
    }

    const result = await response.json();

    syncNowBtn.textContent = result.created ? "Requested" : "Already Queued";

    await loadSyncStatus();

    window.setTimeout(() => {
      syncNowBtn.disabled = false;
      syncNowBtn.textContent = "Sync Now";
    }, 4000);
  } catch (error) {
    syncStatus.className = "sync-pill sync-failed";
    syncStatus.innerHTML = `
      <span class="sync-dot"></span>
      <span>Sync request failed</span>
    `;

    syncNowBtn.disabled = false;
    syncNowBtn.textContent = "Sync Now";
  }
}
showTab("daily");
loadData();