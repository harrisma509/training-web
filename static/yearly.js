const yearlyMaintenanceYear = document.getElementById("yearlyMaintenanceYear");
const yearlyMaintenanceStatus = document.getElementById("yearlyMaintenanceStatus");
const yearlyMaintenancePreviewSummary = document.getElementById("yearlyMaintenancePreviewSummary");
const yearlyMaintenanceWarnings = document.getElementById("yearlyMaintenanceWarnings");
const yearlyMaintenanceComparisonWrap = document.getElementById("yearlyMaintenanceComparisonWrap");
const yearlyMaintenanceComparisonBody = document.getElementById("yearlyMaintenanceComparisonBody");
const yearlyMaintenanceResult = document.getElementById("yearlyMaintenanceResult");
const yearlyMaintenancePreviewBtn = document.getElementById("yearlyMaintenancePreviewBtn");
const yearlyMaintenanceCalculateBtn = document.getElementById("yearlyMaintenanceCalculateBtn");

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

(function () {
  function initializeYearlyMaintenanceSettings() {
    if (!yearlyMaintenanceYear) {
      return;
    }

    if (typeof populateYearlyMaintenanceYearOptions === "function") {
      populateYearlyMaintenanceYearOptions();
    }

    yearlyMaintenancePreviewBtn?.addEventListener("click", handleYearlyMaintenancePreview);
    yearlyMaintenanceCalculateBtn?.addEventListener("click", handleYearlyMaintenanceCalculate);
  }

  initializeYearlyMaintenanceSettings();
})();
