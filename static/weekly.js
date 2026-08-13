/*
 * weekly.js
 * Weekly dashboard feature module.
 * Owns weekly row rendering, comment editor/drawer flows, and audit interactions. It works with AppState and the
 * shared API abstraction while keeping all weekly presentation logic in this module.
 */
// Weekly module state
const weeklyState = {
  currentDrawerWeek: null,
  drawerInitialValues: null,
  drawerDirty: false,
};

const weeklyDrawer = document.getElementById("weeklyDrawer");
const weeklyDrawerContent = document.getElementById("weeklyDrawerContent");
const weeklyDrawerContext = document.getElementById("drawerContext");
const drawerCloseBtn = document.getElementById("drawerCloseBtn");
const drawerCancelBtn = document.getElementById("drawerCancelBtn");
const drawerSaveBtn = document.getElementById("drawerSaveBtn");

const weeklyAuditDrawer = createWeeklyAuditDrawer();
const auditDrawerCloseBtn = document.getElementById("auditDrawerCloseBtn");
const auditDrawerTitle = document.getElementById("auditDrawerTitle");
const auditDrawerScore = document.getElementById("auditDrawerScore");
const auditDrawerSummary = document.getElementById("auditDrawerSummary");
const auditDrawerNextAction = document.getElementById("auditDrawerNextAction");
const auditDrawerLoading = document.getElementById("auditDrawerLoading");
const auditDrawerError = document.getElementById("auditDrawerError");
const auditDrawerNoItems = document.getElementById("auditDrawerNoItems");

// Weekly formatting helpers
function formatAuditScoreString(row) {
  if (!row.audit_grade) {
    return "";
  }

  const green = row.audit_green_count == null ? 0 : row.audit_green_count;
  const yellow = row.audit_yellow_count == null ? 0 : row.audit_yellow_count;
  const red = row.audit_red_count == null ? 0 : row.audit_red_count;
  return `${safe(row.audit_grade)} 🟩${green} 🟨${yellow} 🟥${red}`;
}

function auditScoreClass(row) {
  if (row.audit_grade === "G") {
    return "audit-score-green";
  }
  if (row.audit_grade === "Y") {
    return "audit-score-yellow";
  }
  if (row.audit_grade === "R") {
    return "audit-score-red";
  }
  return "";
}

function auditGradeSquare(grade) {
  if (grade === "G") {
    return `<span class="weekly-status-dot green" title="Green audit"></span>`;
  }
  if (grade === "Y") {
    return `<span class="weekly-status-dot yellow" title="Yellow audit"></span>`;
  }
  if (grade === "R") {
    return `<span class="weekly-status-dot red" title="Red audit"></span>`;
  }
  return "";
}

function auditGradeTitle(grade) {
  if (grade === "G") {
    return "Green audit";
  }
  if (grade === "Y") {
    return "Yellow audit";
  }
  if (grade === "R") {
    return "Red audit";
  }
  return "";
}

function formatWeeklyFixed(value, digits = 1) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }

  return parsed.toFixed(digits);
}

function formatWeeklyAcRatio(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }

  const rounded = Number(parsed.toFixed(2));
  return rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toString();
}

function getAcRatioClass(acRatio) {
  const parsed = Number(acRatio);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  if (parsed < window.APP_CONSTANTS.AC_RATIO_TARGET_MIN) {
    return "ac-ratio-low";
  }
  if (parsed <= window.APP_CONSTANTS.AC_RATIO_TARGET_MAX) {
    return "ac-ratio-target";
  }
  if (parsed <= window.APP_CONSTANTS.AC_RATIO_CAUTION_MAX) {
    return "ac-ratio-caution";
  }
  return "ac-ratio-spike";
}

function getAcRatioTitle(acRatio) {
  const parsed = Number(acRatio);
  if (!Number.isFinite(parsed)) {
    return "";
  }
  if (parsed < window.APP_CONSTANTS.AC_RATIO_TARGET_MIN) {
    return "Low: A/C below 0.8. Week is below chronic load.";
  }
  if (parsed <= window.APP_CONSTANTS.AC_RATIO_TARGET_MAX) {
    return "Target: A/C 0.8-1.3. Load matches chronic baseline.";
  }
  if (parsed <= window.APP_CONSTANTS.AC_RATIO_CAUTION_MAX) {
    return "Caution: A/C 1.3-1.5. Elevated load.";
  }
  return "Spike: A/C above 1.5. Load exceeds chronic baseline.";
}

function renderAcRatioCell(acRatio) {
  const cellValue = formatWeeklyAcRatio(acRatio) || safe(acRatio);
  const cssClass = getAcRatioClass(acRatio);
  const titleText = getAcRatioTitle(acRatio);
  const classAttr = cssClass ? ` class="${cssClass}"` : "";
  const titleAttr = titleText ? ` title="${escapeHtml(titleText)}"` : "";
  return `<td${classAttr}${titleAttr}>${cellValue}</td>`;
}

function formatWeeklyInt(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return "";
  }

  return new Intl.NumberFormat("en-US").format(Math.round(parsed));
}

function getWeeklyHoursStatus(hoursValue) {
  const parsed = Number(hoursValue);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  const greenMin = window.APP_CONSTANTS.WEEKLY_HOURS_GREEN_MIN;
  const yellowMin = window.APP_CONSTANTS.WEEKLY_HOURS_YELLOW_MIN;

  if (parsed >= greenMin) {
    return { cssClass: "weekly-hours-green", title: `Hours green: >= ${greenMin}` };
  }
  if (parsed >= yellowMin) {
    return { cssClass: "weekly-hours-yellow", title: `Hours yellow: >= ${yellowMin} and < ${greenMin}` };
  }
  return { cssClass: "weekly-hours-red", title: `Hours red: < ${yellowMin}` };
}

function renderWeeklyHoursCell(hoursValue) {
  const valueText = formatWeeklyFixed(hoursValue, 1);
  if (!valueText) {
    return "";
  }

  const status = getWeeklyHoursStatus(hoursValue);
  if (!status) {
    return valueText;
  }

  const colorName = status.cssClass.replace("weekly-hours-", "");
  return `<span class="weekly-hours-value ${status.cssClass}"><span class="weekly-status-dot ${colorName}" title="${escapeHtml(status.title)}"></span>${valueText}</span>`;
}

// Inline comment editor
function getWeeklyCommentText(weekStart) {
  const row = window.AppState.weeklyRows.find(r => r.week_start === weekStart);
  return row && row.weekly_comment != null ? String(row.weekly_comment) : "";
}

function renderWeeklyCommentDisplay(cell, text) {
  cell.classList.remove("editing", "error", "saving");
  cell.innerHTML = `<div class="weekly-comment-display" title="${escapeHtml(text || "")}">${escapeHtml(truncateText(text || "", 100))}</div>`;
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
      renderWeeklyCommentDisplay(cell, originalText);
      attachWeeklyCommentHandlers(cell);
    }
  });

  textarea.addEventListener("blur", async () => {
    const newValue = textarea.value;
    if (newValue === originalText) {
      renderWeeklyCommentDisplay(cell, originalText);
      attachWeeklyCommentHandlers(cell);
      return;
    }

    cell.classList.add("saving");
    try {
      const result = window.api && typeof window.api.saveWeeklyCommentary === "function"
        ? await window.api.saveWeeklyCommentary(weekStart, { weekly_comment: newValue })
        : await fetch(`/api/weekly-commentary/${weekStart}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ weekly_comment: newValue }),
          }).then(response => {
            if (!response.ok) {
              throw new Error(`Save failed: ${response.status}`);
            }
            return response.json();
          });

      updateWeeklyRowComment(weekStart, result.weekly_comment);
      renderWeeklyCommentDisplay(cell, result.weekly_comment || "");
      attachWeeklyCommentHandlers(cell);
    } catch (error) {
      console.error(error);
      cell.classList.add("error");
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

function updateWeeklyRowComment(weekStart, comment) {
  const row = window.AppState.weeklyRows.find(r => r.week_start === weekStart);
  if (row) {
    row.weekly_comment = comment;
  }
}

// Weekly audit drawer
function createWeeklyAuditDrawer() {
  const markup = `
    <div id="weeklyAuditDrawer" class="audit-drawer hidden" aria-hidden="true">
      <div class="audit-drawer-panel">
        <div class="audit-drawer-header">
          <div>
            <div id="auditDrawerTitle" class="audit-drawer-title">Weekly Audit</div>
            <div id="auditDrawerSubtitle" class="audit-drawer-subtitle">Audit details for the selected week</div>
          </div>
          <button id="auditDrawerCloseBtn" type="button" class="drawer-close-button" aria-label="Close audit drawer">×</button>
        </div>
        <div class="audit-drawer-body">
          <div id="auditDrawerScore" class="audit-score-summary"></div>
          <div id="auditDrawerSummary" class="audit-summary"></div>
          <div id="auditDrawerNextAction" class="audit-next-action"></div>
          <div id="auditDrawerError" class="audit-error hidden"></div>
          <div id="auditDrawerLoading" class="audit-loading">Loading audit details...</div>
          <div id="auditDrawerNoItems" class="audit-no-items hidden">No audit details found for this week.</div>
          <div class="audit-detail-table-wrap hidden">
            <table id="auditDetailTable" class="audit-detail-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Status</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody id="auditDetailTableBody"></tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", markup);

  const drawer = document.getElementById("weeklyAuditDrawer");
  drawer.addEventListener("click", event => {
    if (event.target === drawer) {
      closeWeeklyAuditDrawer();
    }
  });

  return drawer;
}

function openWeeklyAuditDrawer(weekStart) {
  const row = window.AppState.weeklyRows.find(r => r.week_start === weekStart);
  if (!row) {
    return;
  }

  auditDrawerTitle.textContent = `Weekly Audit - ${safe(row.week_start)}`;
  auditDrawerScore.innerHTML = formatAuditScoreString(row);
  auditDrawerScore.className = `audit-score-summary ${auditScoreClass(row)}`;

  if (row.audit_summary) {
    auditDrawerSummary.textContent = row.audit_summary;
    auditDrawerSummary.classList.remove("hidden");
  } else {
    auditDrawerSummary.textContent = "";
    auditDrawerSummary.classList.add("hidden");
  }

  if (row.audit_next_week_action) {
    auditDrawerNextAction.textContent = row.audit_next_week_action;
    auditDrawerNextAction.classList.remove("hidden");
  } else {
    auditDrawerNextAction.textContent = "";
    auditDrawerNextAction.classList.add("hidden");
  }

  auditDrawerError.classList.add("hidden");
  auditDrawerLoading.classList.remove("hidden");
  auditDrawerNoItems.classList.add("hidden");
  document.querySelector(".audit-detail-table-wrap").classList.add("hidden");

  weeklyAuditDrawer.classList.remove("hidden");
  weeklyAuditDrawer.setAttribute("aria-hidden", "false");

  const loadAuditItems = window.api && typeof window.api.fetchWeeklyAuditItems === "function"
    ? window.api.fetchWeeklyAuditItems(weekStart)
    : fetch(`/api/weekly-audit/${weekStart}/items`).then(response => {
        if (!response.ok) {
          throw new Error(`Unable to load audit details: ${response.status}`);
        }
        return response.json();
      });

  loadAuditItems
    .then(items => {
      auditDrawerLoading.classList.add("hidden");
      const body = document.getElementById("auditDetailTableBody");
      body.innerHTML = items.map(item => `
        <tr>
          <td>${escapeHtml(safe(item.item_label))}</td>
          <td>${escapeHtml(safe(item.status))}</td>
          <td>${escapeHtml(safe(item.summary))}</td>
        </tr>
      `).join("");

      if (items.length === 0) {
        auditDrawerNoItems.classList.remove("hidden");
        document.querySelector(".audit-detail-table-wrap").classList.add("hidden");
      } else {
        auditDrawerNoItems.classList.add("hidden");
        document.querySelector(".audit-detail-table-wrap").classList.remove("hidden");
      }
    })
    .catch(error => {
      console.error(error);
      auditDrawerLoading.classList.add("hidden");
      auditDrawerError.textContent = "Unable to load audit details. Please try again.";
      auditDrawerError.classList.remove("hidden");
    });
}

function closeWeeklyAuditDrawer() {
  weeklyAuditDrawer.classList.add("hidden");
  weeklyAuditDrawer.setAttribute("aria-hidden", "true");
}

function attachAuditScoreHandlers() {
  document.querySelectorAll(".audit-score-button").forEach(button => {
    button.addEventListener("click", () => {
      openWeeklyAuditDrawer(button.dataset.weekStart);
    });
  });
}

// Commentary drawer
function openWeeklyDrawer(weekStart) {
  const row = window.AppState.weeklyRows.find(r => r.week_start === weekStart);
  if (!row) {
    return;
  }

  weeklyState.currentDrawerWeek = weekStart;
  weeklyState.drawerInitialValues = getDrawerFormValues(row);
  weeklyState.drawerDirty = false;
  renderDrawerContext(row);
  renderDrawerForm(weeklyState.drawerInitialValues);
  weeklyDrawer.classList.remove("hidden");
  weeklyDrawer.setAttribute("aria-hidden", "false");
}

function closeWeeklyDrawer(force = false) {
  if (!weeklyDrawer.classList.contains("hidden") && weeklyState.drawerDirty && !force) {
    if (!confirm("Discard unsaved changes?")) {
      return;
    }
  }

  weeklyDrawer.classList.add("hidden");
  weeklyDrawer.setAttribute("aria-hidden", "true");
  weeklyState.currentDrawerWeek = null;
  weeklyState.drawerInitialValues = null;
  weeklyState.drawerDirty = false;
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
      weeklyState.drawerDirty = true;
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

// Weekly API calls
async function saveWeeklyDrawer() {
  if (!weeklyState.currentDrawerWeek) {
    return;
  }

  const payload = getDrawerFormPayload();
  drawerSaveBtn.disabled = true;
  drawerCancelBtn.disabled = true;
  drawerCloseBtn.disabled = true;

  try {
    const result = window.api && typeof window.api.saveWeeklyCommentary === "function"
      ? await window.api.saveWeeklyCommentary(weeklyState.currentDrawerWeek, payload)
      : await fetch(`/api/weekly-commentary/${weeklyState.currentDrawerWeek}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }).then(async response => {
          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || `Save failed: ${response.status}`);
          }
          return response.json();
        });

    const row = window.AppState.weeklyRows.find(r => r.week_start === weeklyState.currentDrawerWeek);
    if (row) {
      Object.assign(row, result);
    }

    updateWeeklyRowComment(weeklyState.currentDrawerWeek, result.weekly_comment);
    renderWeeklyTable();
    weeklyState.drawerDirty = false;
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

async function loadWeekly() {
  const limit = Number(window.AppState.weeklyLimit);

  try {
    if (window.api && typeof window.api.fetchWeekly === "function") {
      window.AppState.weeklyRows = await window.api.fetchWeekly(limit);
    } else {
      window.AppState.weeklyRows = await fetch(`/api/weekly?limit=${limit}`).then(response => response.json());
    }
  } catch (error) {
    console.error(error);
    window.AppState.weeklyRows = [];
  }

  renderWeeklyTable();

  if (window.AppState.activeTab === "weekly") {
    renderHeaderSummary();
  }
}

// Weekly table rendering
function renderWeeklyTable() {
  const rows = window.AppState.weeklyRows.map(row => `
    <tr>
      <td>${safe(row.week_start)}</td>
      <td class="weekly-comment-cell" data-week-start="${safe(row.week_start)}" contenteditable="false" tabindex="0">
        <div class="weekly-comment-display" title="${escapeHtml(safe(row.weekly_comment))}">${escapeHtml(truncateText(safe(row.weekly_comment), 100))}</div>
      </td>
      <td class="weekly-audit-cell">
        ${row.audit_grade ? `<button class="audit-score-button ${auditScoreClass(row)}" data-week-start="${safe(row.week_start)}" type="button" title="${auditGradeTitle(row.audit_grade)}" aria-label="View weekly audit details">${auditGradeSquare(row.audit_grade)}</button>` : ""}
      </td>
      <td class="drawer-icon-cell"><button class="drawer-open-button" data-week-start="${safe(row.week_start)}" type="button" aria-label="Edit weekly commentary"></button></td>
      <td>${renderWeeklyHoursCell(row.weekly_total_hours)}</td>
      <td>${formatWeeklyFixed(row.weekly_total_miles, 1)}</td>
      <td>${formatWeeklyInt(row.weekly_total_elevation_ft)}</td>
      <td>${formatWeeklyFixed(row.weekly_avg_weight, 1)}</td>
      <td>${formatWeeklyInt(row.total_load)}</td>
      <td>${formatWeeklyInt(row.chronic_weekly_cw)}</td>
      ${renderAcRatioCell(row.ac_ratio)}
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
        <th>Audit</th>
        <th></th>
        <th>Hours</th>
        <th>Miles</th>
        <th>Ft</th>
        <th>Lbs</th>
        <th>Acute</th>
        <th>Chronic</th>
        <th title="A/C = acute weekly load vs 28-day chronic baseline. Target 0.8-1.3.">A/C</th>
        <th>Ramp</th>
        <th>Status</th>
        <th>Status Text</th>
        <th>Main</th>
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

  attachAuditScoreHandlers();
}

// Initialization and public interface
function registerWeeklyEventHandlers() {
  drawerCloseBtn.addEventListener("click", () => closeWeeklyDrawer());
  drawerCancelBtn.addEventListener("click", () => closeWeeklyDrawer());
  drawerSaveBtn.addEventListener("click", saveWeeklyDrawer);
  auditDrawerCloseBtn.addEventListener("click", () => closeWeeklyAuditDrawer());

  weeklyDrawer.addEventListener("click", event => {
    if (event.target === weeklyDrawer) {
      closeWeeklyDrawer();
    }
  });
}

registerWeeklyEventHandlers();
window.loadWeekly = loadWeekly;
