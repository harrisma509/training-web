/*
 * daily.js
 * Daily dashboard feature module.
 * Owns daily-table rendering, health summaries, and the data-loading path for the Daily tab. It interacts with
 * AppState and the shared API layer, but keeps the presentation logic local to this module.
 */
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

  if (Array.isArray(row?.other_activities)) {
    return row.other_activities.some(item => item && typeof item === "object" && typeof item.name === "string" && item.name.trim());
  }

  const otherActivityNames = row.other_activity_names == null ? "" : String(row.other_activity_names).trim();
  return Boolean(otherActivityNames);
}

function renderRideLinkFromFields(name, rideId) {
  const safeName = safe(name);
  if (!safeName) {
    return "";
  }

  const cleanedRideId = rideId == null ? "" : String(rideId).trim();
  const escapedName = escapeHtml(safeName);

  if (/^[0-9]+$/.test(cleanedRideId)) {
    return `<a class="activity-link" href="https://www.strava.com/activities/${cleanedRideId}" target="_blank" rel="noopener noreferrer">${escapedName}</a>`;
  }

  return escapedName;
}

function renderNarrativeToggle(activityId, locationClass) {
  const drawerId = `daily-narrative-drawer-${activityId}`;
  return `<button type="button" class="daily-narrative-toggle ${locationClass}" data-activity-id="${activityId}" aria-label="Show activity notes" aria-expanded="false" aria-controls="${drawerId}"><svg class="daily-narrative-icon" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="M5 3.5h7l3 3V16.5H5zM12 3.5v3h3M7.5 10h5M7.5 13h5"></path></svg></button>`;
}

function hasNarrativeForRow(row) {
  const activityId = row.main_ride_id == null ? "" : String(row.main_ride_id).trim();
  return Boolean(
    (row.main_ride_has_description || row.main_ride_has_private_note)
    && /^[0-9]+$/.test(activityId),
  );
}

function renderMainRideCell(row) {
  if (!hasMainRide(row)) {
    return "";
  }

  const rideLink = renderRideLinkFromFields(row.main_ride_name, row.main_ride_id);
  const activityId = row.main_ride_id == null ? "" : String(row.main_ride_id).trim();
  if (!hasNarrativeForRow(row)) {
    return rideLink;
  }

  return `${rideLink}${renderNarrativeToggle(activityId, "daily-narrative-main-ride-toggle")}`;
}

function renderMobileNarrativeCell(row, value) {
  if (!hasNarrativeForRow(row)) {
    return value;
  }

  const activityId = String(row.main_ride_id).trim();
  return `<span class="daily-load-cell"><span>${value}</span>${renderNarrativeToggle(activityId, "daily-narrative-mobile-toggle")}</span>`;
}

let dailyNarrativeActiveId = "";
let dailyNarrativeRequestId = 0;
const dailyNarrativeCache = new Map();
let dailyDayMenu = null;
let dailyDayMenuButton = null;
let dailyDayOperation = null;
const DAILY_DAY_SUCCESS_DISMISS_DELAY_MS = 10000;
let dailyDayStatusDismissTimer = null;
let dailyDayStatusGeneration = 0;

function dailyDateText(value) {
  const text = value == null ? "" : String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function formatDailyLongDate(dateText) {
  const parsed = new Date(`${dateText}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? dateText
    : parsed.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function closeDailyDayMenu(restoreFocus = false) {
  const button = dailyDayMenuButton;
  button?.setAttribute("aria-expanded", "false");
  dailyDayMenu?.remove();
  dailyDayMenu = null;
  dailyDayMenuButton = null;
  if (restoreFocus) {
    button?.focus();
  }
}

function clearDailyDayStatusTimer() {
  if (dailyDayStatusDismissTimer !== null) {
    window.clearTimeout(dailyDayStatusDismissTimer);
    dailyDayStatusDismissTimer = null;
  }
}

function dismissDailyDayStatus(restoreFocus = false) {
  clearDailyDayStatusTimer();
  dailyDayStatusGeneration += 1;
  const status = document.getElementById("dailyDayResyncStatus");
  const dateText = status?.dataset.date || "";
  status?.remove();
  if (restoreFocus && dateText) {
    document.querySelector(`.daily-day-actions-toggle[data-date="${CSS.escape(dateText)}"]`)?.focus();
  }
}

function showDailyDayStatus(message, state = "", dateText = "") {
  clearDailyDayStatusTimer();
  const generation = ++dailyDayStatusGeneration;
  let status = document.getElementById("dailyDayResyncStatus");
  if (!status) {
    status = document.createElement("div");
    status.id = "dailyDayResyncStatus";
    status.className = "daily-day-resync-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    document.getElementById("dailyPane")?.prepend(status);
  }
  status.className = `daily-day-resync-status ${state}`.trim();
  status.dataset.date = dateText;
  status.replaceChildren();

  const text = document.createElement("span");
  text.className = "daily-day-resync-status-text";
  text.textContent = message;
  status.appendChild(text);

  if (state !== "busy") {
    const dismiss = document.createElement("button");
    dismiss.type = "button";
    dismiss.className = "daily-day-resync-status-dismiss";
    dismiss.setAttribute(
      "aria-label",
      dateText
        ? `Dismiss resync status for ${formatDailyLongDate(dateText)}`
        : "Dismiss resync status",
    );
    dismiss.textContent = "×";
    dismiss.addEventListener("click", event => dismissDailyDayStatus(event.detail === 0));
    status.appendChild(dismiss);
  }

  if (state === "success") {
    dailyDayStatusDismissTimer = window.setTimeout(() => {
      if (generation === dailyDayStatusGeneration) {
        dismissDailyDayStatus();
      }
    }, DAILY_DAY_SUCCESS_DISMISS_DELAY_MS);
  }
}

function removeDailyDayStatus() {
  dismissDailyDayStatus();
}

window.addEventListener("beforeunload", clearDailyDayStatusTimer);

function clearDailyNarrativeCache() {
  dailyNarrativeCache.clear();
  closeDailyNarrative();
}

function closeDailyDayDialog() {
  document.getElementById("dailyDayResyncDialog")?.remove();
}

function showDailyDayDialog(dateText, activityCount) {
  closeDailyDayDialog();
  const dialog = document.createElement("div");
  dialog.id = "dailyDayResyncDialog";
  dialog.className = "daily-day-resync-dialog-backdrop";
  dialog.innerHTML = `
    <section class="daily-day-resync-dialog" role="dialog" aria-modal="true" aria-labelledby="dailyDayResyncTitle">
      <h2 id="dailyDayResyncTitle">Resync ${escapeHtml(formatDailyLongDate(dateText))} from Strava?</h2>
      <p>This will refresh ${activityCount} ${activityCount === 1 ? "activity" : "activities"} recorded on this date.</p>
      <div class="daily-day-resync-dialog-actions">
        <button type="button" class="button-secondary" data-daily-day-cancel>Cancel</button>
        <button type="button" class="button-primary" data-daily-day-confirm>Resync ${activityCount} ${activityCount === 1 ? "activity" : "activities"}</button>
      </div>
    </section>
  `;
  document.body.appendChild(dialog);
  const cancel = dialog.querySelector("[data-daily-day-cancel]");
  const confirm = dialog.querySelector("[data-daily-day-confirm]");
  cancel.focus();
  cancel.addEventListener("click", closeDailyDayDialog);
  dialog.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDailyDayDialog();
    }
  });
  dialog.addEventListener("click", event => {
    if (event.target === dialog) {
      closeDailyDayDialog();
    }
  });
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    try {
      const result = await window.api.resyncDay(dateText);
      closeDailyDayDialog();
      startDailyDayPolling(dateText, result);
    } catch (error) {
      confirm.disabled = false;
      showDailyDayStatus("This day could not be queued. Try again.", "error");
    }
  });
}

async function startDailyDayPolling(dateText, enqueueResult) {
  const requestIds = Array.isArray(enqueueResult?.request_ids) ? enqueueResult.request_ids : [];
  if (!requestIds.length) {
    showDailyDayStatus(`No Strava activities found for ${formatDailyLongDate(dateText)}.`, "empty", dateText);
    return;
  }

  dailyDayOperation = { dateText, requestIds };
  const button = document.querySelector(`.daily-day-actions-toggle[data-date="${CSS.escape(dateText)}"]`);
  if (button) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-label", `Resyncing ${formatDailyLongDate(dateText)}`);
    button.closest(".daily-date-cell")?.classList.add("is-resyncing");
  }
  showDailyDayStatus(`Refreshing ${formatDailyLongDate(dateText)}...`, "busy", dateText);

  const deadline = Date.now() + 10 * 60 * 1000;
  let terminal = null;
  while (Date.now() < deadline && dailyDayOperation?.requestIds === requestIds) {
    try {
      const statuses = await Promise.all(requestIds.map(requestId => window.api.fetchSyncRequestStatus(requestId)));
      if (statuses.every(item => ["completed", "failed"].includes(item.status))) {
        terminal = statuses;
        break;
      }
    } catch (error) {
      terminal = null;
      break;
    }
    await new Promise(resolve => window.setTimeout(resolve, 1500));
  }

  if (dailyDayOperation?.requestIds !== requestIds) {
    return;
  }
  dailyDayOperation = null;
  if (!terminal) {
    showDailyDayStatus(`${formatDailyLongDate(dateText)} could not be refreshed. Try again.`, "error", dateText);
    restoreDailyDayAction(dateText);
    return;
  }

  const completedCount = terminal.filter(item => item.status === "completed").length;
  const failedCount = terminal.length - completedCount;
  clearDailyNarrativeCache();
  const tableWrap = document.querySelector("#dailyPane .table-wrap");
  const scrollLeft = tableWrap?.scrollLeft || 0;
  await loadDaily();
  if (tableWrap) {
    tableWrap.scrollLeft = scrollLeft;
  }
  restoreDailyDayAction(dateText);
  if (failedCount === 0) {
    showDailyDayStatus(`${formatDailyLongDate(dateText)} refreshed from Strava. ${completedCount} ${completedCount === 1 ? "activity" : "activities"} completed.`, "success", dateText);
  } else if (completedCount > 0) {
    showDailyDayStatus(`${formatDailyLongDate(dateText)} partially refreshed. ${completedCount} completed, ${failedCount} failed.`, "error", dateText);
  } else {
    showDailyDayStatus(`${formatDailyLongDate(dateText)} could not be refreshed. Try again.`, "error", dateText);
  }
}

function restoreDailyDayAction(dateText) {
  const button = document.querySelector(`.daily-day-actions-toggle[data-date="${CSS.escape(dateText)}"]`);
  if (!button) {
    return;
  }
  button.disabled = false;
  button.removeAttribute("aria-busy");
  button.setAttribute("aria-label", `Open actions for ${formatDailyLongDate(dateText)}`);
  button.closest(".daily-date-cell")?.classList.remove("is-resyncing");
}

async function handleDailyDayResync(dateText) {
  closeDailyDayMenu();
  removeDailyDayStatus();
  try {
    const preview = await window.api.previewDayResync(dateText);
    const count = Number(preview?.activity_count);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("Invalid preview");
    }
    if (count === 0) {
      showDailyDayStatus(`No Strava activities found for ${formatDailyLongDate(dateText)}.`, "empty", dateText);
      return;
    }
    showDailyDayDialog(dateText, count);
  } catch (error) {
    showDailyDayStatus("Day resync preview is unavailable. Try again.", "error", dateText);
  }
}

function openDailyDayMenu(button) {
  if (dailyDayMenuButton === button) {
    closeDailyDayMenu(true);
    return;
  }
  closeDailyDayMenu();
  dailyDayMenuButton = button;
  button.setAttribute("aria-expanded", "true");
  const menu = document.createElement("div");
  menu.className = "daily-day-actions-menu";
  menu.setAttribute("role", "menu");
  const item = document.createElement("button");
  item.type = "button";
  item.className = "daily-day-actions-item";
  item.setAttribute("role", "menuitem");
  item.textContent = "Resync day from Strava";
  item.addEventListener("click", () => handleDailyDayResync(button.dataset.date));
  menu.appendChild(item);
  document.body.appendChild(menu);
  const bounds = button.getBoundingClientRect();
  menu.style.left = `${Math.min(bounds.left, window.innerWidth - menu.offsetWidth - 8)}px`;
  menu.style.top = `${bounds.bottom + 4}px`;
  dailyDayMenu = menu;
  item.focus();
}

function attachDailyDayActions() {
  const table = dailyNarrativeTable();
  if (!table || table.dataset.dayActionsAttached === "true") {
    return;
  }
  table.addEventListener("click", event => {
    const button = event.target.closest(".daily-day-actions-toggle");
    if (!button) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openDailyDayMenu(button);
  });
  document.addEventListener("click", event => {
    if (!event.target.closest(".daily-day-actions-menu, .daily-day-actions-toggle")) {
      closeDailyDayMenu();
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && dailyDayMenu) {
      event.preventDefault();
      closeDailyDayMenu(true);
    }
  });
  table.dataset.dayActionsAttached = "true";
}

function dailyNarrativeTable() {
  return document.getElementById("dailyTable");
}

function findDailyNarrativeRow(activityId) {
  const table = dailyNarrativeTable();
  if (!table) {
    return null;
  }
  return Array.from(table.querySelectorAll("tbody > tr")).find(
    row => row.dataset.dailyActivityId === String(activityId),
  ) || null;
}

function updateDailyNarrativeButtons() {
  const table = dailyNarrativeTable();
  if (!table) {
    return;
  }
  table.querySelectorAll(".daily-narrative-toggle").forEach(button => {
    const isActive = button.dataset.activityId === dailyNarrativeActiveId;
    button.setAttribute("aria-expanded", String(isActive));
    button.setAttribute("aria-label", isActive ? "Hide activity notes" : "Show activity notes");
  });
}

function removeDailyNarrativeDrawer() {
  dailyNarrativeTable()?.querySelector(".daily-narrative-drawer-row")?.remove();
}

function appendNarrativeSection(parent, label, value, privateNote = false) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return;
  }
  const section = document.createElement("section");
  section.className = privateNote ? "daily-narrative-section daily-narrative-private" : "daily-narrative-section";
  const heading = document.createElement("h4");
  heading.textContent = label;
  const content = document.createElement("div");
  content.className = "daily-narrative-text";
  content.textContent = String(value);
  section.append(heading, content);
  parent.appendChild(section);
}

function renderDailyNarrativeDrawer(activityId, row, state, errorMessage = "") {
  const table = dailyNarrativeTable();
  const sourceRow = row || findDailyNarrativeRow(activityId);
  if (!table || !sourceRow) {
    return;
  }

  removeDailyNarrativeDrawer();
  const drawerRow = document.createElement("tr");
  drawerRow.className = "daily-narrative-drawer-row";
  drawerRow.id = `daily-narrative-drawer-${activityId}`;
  const drawerCell = document.createElement("td");
  drawerCell.colSpan = 16;
  const drawer = document.createElement("div");
  drawer.className = "daily-narrative-drawer";

  const header = document.createElement("div");
  header.className = "daily-narrative-header";
  const title = document.createElement("strong");
  title.textContent = sourceRow.querySelector("td:nth-child(1)")?.textContent || "Activity notes";
  const name = document.createElement("span");
  name.textContent = sourceRow.querySelector(".activity-link")?.textContent || "Main Ride";
  header.append(title, name);
  drawer.appendChild(header);

  if (state === "loading") {
    const loading = document.createElement("div");
    loading.className = "daily-narrative-status";
    loading.textContent = "Loading activity notes...";
    drawer.appendChild(loading);
  } else if (state === "error") {
    const error = document.createElement("div");
    error.className = "daily-narrative-error";
    error.textContent = errorMessage || "Activity notes could not be loaded.";
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "daily-narrative-retry";
    retry.textContent = "Retry";
    retry.addEventListener("click", () => openDailyNarrative(activityId, sourceRow, true));
    drawer.append(error, retry);
  } else {
    appendNarrativeSection(drawer, "Description", state.description);
    appendNarrativeSection(drawer, "Private Note", state.private_note, true);
    if (!state.description && !state.private_note) {
      const empty = document.createElement("div");
      empty.className = "daily-narrative-status";
      empty.textContent = "No activity notes available.";
      drawer.appendChild(empty);
    }
  }

  drawerCell.appendChild(drawer);
  drawerRow.appendChild(drawerCell);
  sourceRow.after(drawerRow);
  updateDailyNarrativeButtons();
}

function closeDailyNarrative() {
  dailyNarrativeActiveId = "";
  dailyNarrativeRequestId += 1;
  removeDailyNarrativeDrawer();
  updateDailyNarrativeButtons();
}

async function openDailyNarrative(activityId, row, retry = false) {
  const normalizedId = String(activityId);
  if (!retry && dailyNarrativeActiveId === normalizedId) {
    closeDailyNarrative();
    return;
  }

  dailyNarrativeActiveId = normalizedId;
  const requestId = ++dailyNarrativeRequestId;
  removeDailyNarrativeDrawer();
  updateDailyNarrativeButtons();

  if (!retry && dailyNarrativeCache.has(normalizedId)) {
    renderDailyNarrativeDrawer(normalizedId, row, dailyNarrativeCache.get(normalizedId));
    return;
  }

  renderDailyNarrativeDrawer(normalizedId, row, "loading");
  try {
    const payload = await window.api.fetchActivityNarrative(normalizedId);
    if (requestId !== dailyNarrativeRequestId || dailyNarrativeActiveId !== normalizedId) {
      return;
    }
    dailyNarrativeCache.set(normalizedId, payload || {});
    renderDailyNarrativeDrawer(normalizedId, row, payload || {});
  } catch (error) {
    if (requestId !== dailyNarrativeRequestId || dailyNarrativeActiveId !== normalizedId) {
      return;
    }
    renderDailyNarrativeDrawer(normalizedId, row, "error", "Activity notes could not be loaded.");
  }
}

function attachDailyNarrativeEvents() {
  const table = dailyNarrativeTable();
  if (!table || table.dataset.narrativeEventsAttached === "true") {
    return;
  }
  table.addEventListener("click", event => {
    const button = event.target.closest(".daily-narrative-toggle");
    if (!button) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const row = button.closest("tr");
    openDailyNarrative(button.dataset.activityId, row);
  });
  table.dataset.narrativeEventsAttached = "true";
}

function resetDailyNarrativeForTableRefresh() {
  dailyNarrativeActiveId = "";
  dailyNarrativeRequestId += 1;
}

function renderStructuredOtherActivities(row) {
  const rawActivities = Array.isArray(row?.other_activities) ? row.other_activities : [];
  const rendered = [];

  for (const item of rawActivities) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const rawName = item.name == null ? "" : String(item.name).trim();
    const rawCategory = item.activity_category == null ? "" : String(item.activity_category).trim();
    const escapedName = escapeHtml(rawName);
    const categoryLabel = rawCategory || "other";

    if (!rawName) {
      continue;
    }

    const cleanedId = item.activity_id == null ? "" : String(item.activity_id).trim();
    const activityLabel = /^[0-9]+$/.test(cleanedId)
      ? `<a class="activity-link" href="https://www.strava.com/activities/${cleanedId}" target="_blank" rel="noopener noreferrer">${escapedName}</a>`
      : escapedName;

    rendered.push(`${activityLabel} (${escapeHtml(categoryLabel)})`);
  }

  if (rendered.length > 0) {
    return rendered.join(" | ");
  }

  return "";
}

function renderOtherActivitiesCell(row) {
  const structuredActivities = renderStructuredOtherActivities(row);
  if (structuredActivities) {
    return structuredActivities;
  }

  const fallbackValue = row.other_activity_names == null ? "" : String(row.other_activity_names);
  return escapeHtml(fallbackValue).replaceAll("\n", "<br>");
}

function formatHrZones(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const escaped = escapeHtml(String(value));
  return escaped.replace(/\b(Z[1-5])\b/g, '<span class="hr-zone-label">$1</span>');
}

function renderDailyTable() {
  resetDailyNarrativeForTableRefresh();
  const rows = (window.AppState.dailyRows || []).map(row => {
    const hasRide = hasMainRide(row);
    const hasOther = hasOtherActivity(row);
    const mainRideLoad = hasRide ? (row.main_ride_load_text || (row.main_ride_load == null ? "" : Number(row.main_ride_load).toFixed(0))) : "";
    return `
      <tr data-daily-activity-id="${hasRide && row.main_ride_id != null ? escapeHtml(String(row.main_ride_id)) : ""}">
        <td><span class="daily-date-cell"><span class="daily-date-value">${safe(row.date)}</span><button type="button" class="daily-day-actions-toggle" data-date="${escapeHtml(dailyDateText(row.date))}" aria-label="Open actions for ${escapeHtml(formatDailyLongDate(dailyDateText(row.date)))}" aria-haspopup="menu" aria-expanded="false"><span aria-hidden="true">⋮</span></button></span></td>
        <td>${row.weight_lb == null ? "" : Number(row.weight_lb).toFixed(1)}</td>
        <td>${formatSleepCell(row.sleep_score, row.total_sleep_hr)}</td>
        <td>${formatCommaInt(row.steps)}</td>
        <td>${safe(row.rhr_bpm)}</td>
        <td>${formatHrvMs(row.hrv_sdnn_ms)}</td>
        <td>${renderMobileNarrativeCell(row, row.total_load == null ? "" : Number(row.total_load).toFixed(0))}</td>
        <td>${hasRide ? safe(row.main_ride_time) : ""}</td>
        <td>${hasRide && row.main_ride_miles != null ? Number(row.main_ride_miles).toFixed(1) : ""}</td>
        <td>${hasRide ? formatCommaInt(row.main_ride_elevation_ft) : ""}</td>
        <td>${renderMainRideCell(row)}</td>
        <td>${hasRide ? safe(row.main_ride_bike_name) : ""}</td>
        <td>${safe(mainRideLoad)}</td>
        <td>${hasRide ? formatHrZones(row.main_ride_hr_zones) : ""}</td>
        <td>${hasOther && row.other_load != null ? Number(row.other_load).toFixed(0) : ""}</td>
        <td>${renderOtherActivitiesCell(row)}</td>
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
        <th>Other Activities</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  `;
  attachDailyNarrativeEvents();
  attachDailyDayActions();
}

let dailySearchRequestId = 0;
let dailySearchDebounceTimer = null;
let dailySearchResultItems = [];
let dailySearchSelectedIndex = -1;
let dailyLoadRequestId = 0;
let dailyLimitListenerBound = false;

function hideDailySearchResults() {
  const results = document.getElementById("dailySearchResults");
  if (!results) {
    return;
  }
  results.classList.add("hidden");
  results.innerHTML = "";
  dailySearchResultItems = [];
  dailySearchSelectedIndex = -1;
}

function showDailySearchResults() {
  const results = document.getElementById("dailySearchResults");
  if (!results) {
    return;
  }
  results.classList.remove("hidden");
}

function formatSearchCount(value) {
  if (!Number.isFinite(Number(value))) {
    return "0";
  }
  return new Intl.NumberFormat("en-US").format(Number(value));
}

function updateDailySearchControls() {
  const input = document.getElementById("dailySearch");
  const applyBtn = document.getElementById("dailySearchApply");
  const dailyLimit = document.getElementById("dailyLimit");
  const searchStatus = document.getElementById("dailySearchStatusWrap");
  const statusText = document.getElementById("dailySearchStatusText");
  const appliedQuery = String(window.AppState.dailyAppliedQuery || "").trim();
  const rawDraftQuery = String(window.AppState.dailyDraftQuery || "");
  const draftQuery = rawDraftQuery.trim();
  const displayedCount = Number(window.AppState.dailySearchMatchCount || 0);
  const totalCount = Number(window.AppState.dailySearchTotalCount || 0);

  if (input) {
    input.value = rawDraftQuery;
  }
  if (applyBtn) {
    applyBtn.disabled = draftQuery.length < 2;
  }
  if (dailyLimit) {
    dailyLimit.disabled = Boolean(appliedQuery);
  }
  if (searchStatus) {
    searchStatus.classList.toggle("hidden", !appliedQuery);
  }
  if (statusText) {
    if (!appliedQuery) {
      statusText.textContent = "";
    } else if (totalCount > 0 && displayedCount < totalCount) {
      statusText.textContent = `Showing ${formatSearchCount(displayedCount)} of ${formatSearchCount(totalCount)} matching days across all history for '${appliedQuery}'`;
    } else {
      statusText.textContent = `Showing ${formatSearchCount(displayedCount)} matching days across all history for '${appliedQuery}'`;
    }
  }
}

function renderDailySearchResults(payload = { rows: [], total_count: 0 }, query = "") {
  const results = document.getElementById("dailySearchResults");
  if (!results) {
    return;
  }

  const rows = Array.isArray(payload && payload.rows) ? payload.rows : [];
  const totalCount = Number(payload && payload.total_count) || 0;
  results.innerHTML = "";
  dailySearchResultItems = [];
  dailySearchSelectedIndex = -1;

  if (!query || String(query).trim().length < 2) {
    hideDailySearchResults();
    return;
  }

  if (!rows.length) {
    showDailySearchResults();
    const empty = document.createElement("div");
    empty.className = "daily-search-empty";
    empty.textContent = "No matching rides found.";
    results.appendChild(empty);
    return;
  }

  const summary = document.createElement("div");
  summary.className = "daily-search-header";
  const dayWord = totalCount === 1 ? "day" : "days";
  const summaryText = totalCount > rows.length
    ? `${totalCount} matching ${dayWord} across all history`
    : `${totalCount} matching ${dayWord} across all history`;
  summary.textContent = summaryText;
  results.appendChild(summary);

  rows.slice(0, 5).forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "daily-search-preview-item";
    item.setAttribute("role", "option");
    item.setAttribute("tabindex", "0");
    item.dataset.index = String(index);

    const topRow = document.createElement("div");
    topRow.className = "daily-search-preview-top";

    const dateCell = document.createElement("div");
    dateCell.className = "daily-search-date";
    dateCell.textContent = row.date || "";

    const nameCell = document.createElement("div");
    nameCell.className = "daily-search-name";
    nameCell.innerHTML = renderRideLinkFromFields(row.main_ride_name, row.main_ride_id);

    topRow.append(dateCell, nameCell);

    const bikeCell = document.createElement("div");
    bikeCell.className = "daily-search-preview-bike";
    bikeCell.textContent = row.main_ride_bike_name || "";

    item.append(topRow, bikeCell);
    item.addEventListener("click", () => {
      const anchor = item.querySelector("a.activity-link");
      if (anchor) {
        anchor.click();
      }
    });
    item.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        const anchor = item.querySelector("a.activity-link");
        if (anchor) {
          anchor.click();
        }
      }
    });
    results.appendChild(item);
    dailySearchResultItems.push(item);
  });

  showDailySearchResults();
}

async function searchDailyRides(query) {
  const cleanedQuery = (query || "").trim();
  const results = document.getElementById("dailySearchResults");
  if (!results) {
    return;
  }

  if (!cleanedQuery || cleanedQuery.length < 2) {
    hideDailySearchResults();
    return;
  }

  const requestId = ++dailySearchRequestId;
  results.classList.remove("hidden");
  results.innerHTML = '<div class="daily-search-status">Searching...</div>';
  dailySearchResultItems = [];
  dailySearchSelectedIndex = -1;

  try {
    const payload = await window.api.fetchRideSearch(cleanedQuery, 5);
    if (requestId !== dailySearchRequestId) {
      return;
    }
    const totalCount = Number(payload && payload.total_count) || 0;
    window.AppState.dailySearchTotalCount = totalCount;
    renderDailySearchResults(payload, cleanedQuery);
  } catch (error) {
    console.error("Ride search failed", error);
    if (requestId !== dailySearchRequestId) {
      return;
    }
    window.AppState.dailySearchTotalCount = 0;
    results.innerHTML = '<div class="daily-search-error">Search failed. Please try again.</div>';
    results.classList.remove("hidden");
  }
}

function handleDailySearchInput(event) {
  const query = String(event.target.value || "");
  window.AppState.dailyDraftQuery = query;
  updateDailySearchControls();

  if (dailySearchDebounceTimer) {
    window.clearTimeout(dailySearchDebounceTimer);
  }

  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    hideDailySearchResults();
    return;
  }

  dailySearchDebounceTimer = window.setTimeout(() => {
    searchDailyRides(trimmed);
  }, 300);
}

function applyDailySearch() {
  const trimmed = String(window.AppState.dailyDraftQuery || "").trim();
  if (trimmed.length < 2) {
    return;
  }

  window.AppState.dailyAppliedQuery = trimmed;
  hideDailySearchResults();
  updateDailySearchControls();
  loadDaily();
}

function clearAppliedDailySearch() {
  window.AppState.dailyAppliedQuery = "";
  window.AppState.dailyDraftQuery = "";
  window.AppState.dailySearchMatchCount = 0;
  window.AppState.dailySearchTotalCount = 0;
  hideDailySearchResults();
  const input = document.getElementById("dailySearch");
  if (input) {
    input.value = "";
  }
  updateDailySearchControls();
  loadDaily();
}

function handleDailySearchKeydown(event) {
  const results = document.getElementById("dailySearchResults");
  const hasOpenResults = results && !results.classList.contains("hidden") && dailySearchResultItems.length > 0;
  const targetTag = event.target && event.target.tagName ? event.target.tagName.toUpperCase() : "";
  const isEditableTarget = ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(targetTag) || (event.target && event.target.isContentEditable);

  if (isEditableTarget && !["Enter", "Escape", "ArrowDown", "ArrowUp"].includes(event.key)) {
    return;
  }

  if (event.key === "Enter") {
    event.preventDefault();
    event.stopPropagation();
    if (hasOpenResults && dailySearchSelectedIndex >= 0) {
      const anchor = dailySearchResultItems[dailySearchSelectedIndex].querySelector("a.activity-link");
      if (anchor) {
        anchor.click();
      }
      return;
    }
    applyDailySearch();
    return;
  }

  if (!hasOpenResults) {
    return;
  }

  if (event.key === "Escape") {
    hideDailySearchResults();
    return;
  }

  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(dailySearchResultItems.length - 1, dailySearchSelectedIndex + delta));
    if (nextIndex === dailySearchSelectedIndex) {
      return;
    }
    dailySearchSelectedIndex = nextIndex;
    dailySearchResultItems.forEach((item, index) => item.classList.toggle("active", index === dailySearchSelectedIndex));
  }
}

function attachDailySearch() {
  const input = document.getElementById("dailySearch");
  const results = document.getElementById("dailySearchResults");
  const applyBtn = document.getElementById("dailySearchApply");
  const clearBtn = document.getElementById("dailyClearSearch");
  if (!input || !results) {
    return;
  }

  input.addEventListener("input", handleDailySearchInput);
  input.addEventListener("keydown", handleDailySearchKeydown);
  input.addEventListener("focus", () => {
    const trimmed = input.value.trim();
    if (trimmed.length >= 2) {
      dailySearchDebounceTimer = window.setTimeout(() => searchDailyRides(trimmed), 300);
    }
  });
  applyBtn?.addEventListener("click", applyDailySearch);
  clearBtn?.addEventListener("click", clearAppliedDailySearch);

  document.addEventListener("click", (event) => {
    const isInside = input.contains(event.target) || results.contains(event.target);
    if (!isInside) {
      hideDailySearchResults();
    }
  });

  updateDailySearchControls();
}

function attachDailyLimitSelector() {
  if (dailyLimitListenerBound) {
    return;
  }

  const dailyLimitSelector = document.getElementById("dailyLimit");
  if (!dailyLimitSelector) {
    return;
  }

  dailyLimitSelector.addEventListener("change", (event) => {
    const nextValue = Number(event.target.value);
    const allowedValues = Array.isArray(window.APP_ROW_LIMITS?.daily) ? window.APP_ROW_LIMITS.daily : [60, 90, 365, 1000];

    if (!Number.isInteger(nextValue) || !allowedValues.includes(nextValue)) {
      event.target.value = String(window.AppState.dailyLimit ?? 60);
      return;
    }

    if (typeof window.updateLimitPreference === "function") {
      window.updateLimitPreference("dailyLimit", nextValue, () => {
        if (window.AppState.activeTab === "daily" && typeof window.loadDaily === "function") {
          window.loadDaily();
        }
      });
      return;
    }

    window.AppState.dailyLimit = nextValue;
    if (typeof window.persistPreferences === "function") {
      window.persistPreferences();
    }
    if (window.AppState.activeTab === "daily" && typeof window.loadDaily === "function") {
      window.loadDaily();
    }
  });

  dailyLimitListenerBound = true;
}

attachDailySearch();
attachDailyLimitSelector();

async function loadDaily() {
  const requestId = ++dailyLoadRequestId;
  const query = String(window.AppState.dailyAppliedQuery || "").trim();
  const limit = query ? 1000 : Number(window.AppState.dailyLimit);
  const dailyLimitSelector = document.getElementById("dailyLimit");

  if (dailyLimitSelector) {
    const isAppliedSearch = Boolean(query);
    const isLoading = true;
    dailyLimitSelector.disabled = isAppliedSearch || isLoading;
  }

  try {
    if (window.api && typeof window.api.fetchDaily === "function") {
      const payload = await window.api.fetchDaily(limit, query);
      if (requestId !== dailyLoadRequestId) {
        return;
      }
      const rows = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.rows) ? payload.rows : []);
      const totalCount = query ? Number((payload && payload.total_count) || rows.length) : 0;
      window.AppState.dailyRows = rows;
      window.AppState.dailySearchTotalCount = query ? totalCount : 0;
    } else {
      const params = new URLSearchParams({ limit: String(limit) });
      if (query) {
        params.set("q", query);
      }
      const payload = await fetch(`/api/daily?${params.toString()}`).then(response => response.json());
      if (requestId !== dailyLoadRequestId) {
        return;
      }
      const rows = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.rows) ? payload.rows : []);
      const totalCount = query ? Number((payload && payload.total_count) || rows.length) : 0;
      window.AppState.dailyRows = rows;
      window.AppState.dailySearchTotalCount = query ? totalCount : 0;
    }
  } catch (error) {
    console.error(error);
    if (requestId !== dailyLoadRequestId) {
      return;
    }
    window.AppState.dailyRows = [];
    window.AppState.dailySearchTotalCount = 0;
  }

  if (requestId !== dailyLoadRequestId) {
    return;
  }

  if (query) {
    window.AppState.dailySearchMatchCount = Array.isArray(window.AppState.dailyRows) ? window.AppState.dailyRows.length : 0;
  } else {
    window.AppState.dailySearchMatchCount = 0;
    window.AppState.dailySearchTotalCount = 0;
  }

  renderDailyTable();
  updateDailySearchControls();

  if (window.AppState.activeTab === "daily") {
    renderHeaderSummary();
  }
}

window.loadDaily = loadDaily;
window.DailyController = {
  load: loadDaily,
  render: renderDailyTable,
};
