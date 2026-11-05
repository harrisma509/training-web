(function initializePlanWeather(global) {
  const TIME_ZONE = "America/Denver";
  const FORECAST_DAYS = 16;
  const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const CONDITIONS = {
    clear: { icon: "☀", label: "Clear" },
    partly_cloudy: { icon: "◐", label: "Partly cloudy" },
    cloudy: { icon: "☁", label: "Cloudy" },
    fog: { icon: "≋", label: "Fog" },
    rain: { icon: "☂", label: "Rain" },
    snow: { icon: "❄", label: "Snow" },
    storm: { icon: "⚡", label: "Storm" },
    unknown: { icon: "·", label: "Conditions unknown" },
  };
  const state = {
    forecastByLocation: new Map(),
    home: { status: "idle", location: null, promise: null },
    selectionsByDate: new Map(),
    generation: 0,
    detailGeneration: 0,
    activeDetail: null,
    onChange: null,
    initialized: false,
    strip: null,
    dialog: null,
    dialogTitle: null,
    dialogBody: null,
    closeButton: null,
    surface: null,
  };

  function escapeHtml(value) {
    if (typeof global.escapeHtml === "function") {
      return global.escapeHtml(value);
    }
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]));
  }

  function isDateKey(value) {
    if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }

  function addDays(dateKey, days) {
    const date = new Date(`${dateKey}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function isInForecastWindow(dateKey, todayKey) {
    return isDateKey(dateKey)
      && isDateKey(todayKey)
      && dateKey >= todayKey
      && dateKey <= addDays(todayKey, FORECAST_DAYS - 1);
  }

  function normalizeLocation(location) {
    if (!location || location.location_id === null || location.location_id === undefined) {
      return null;
    }
    const displayName = typeof location.display_name === "string"
      && location.display_name.trim()
      ? location.display_name.trim()
      : "Saved location";
    return {
      location_id: location.location_id,
      display_name: displayName,
      is_home: location.is_home === true,
    };
  }

  function locationFromItem(item) {
    if (item?.saved_location_id === null || item?.saved_location_id === undefined) {
      return null;
    }
    return normalizeLocation({
      location_id: item.saved_location_id,
      display_name: item.saved_location?.display_name,
      is_home: item.saved_location?.is_home,
    });
  }

  function durationValue(item) {
    const value = item?.prescription?.target_duration_min;
    if (value === null || value === undefined || value === "" || typeof value === "boolean") {
      return null;
    }
    const duration = Number(value);
    return Number.isFinite(duration) && duration >= 0 ? duration : null;
  }

  function selectLocationsForDate(items, homeLocation = null) {
    const candidates = [];
    for (const item of Array.isArray(items) ? items : []) {
      if (item?.item_state === "cancelled" || item?.item_state === "deleted") continue;
      if (item?.environment !== "outdoor") continue;
      const location = locationFromItem(item);
      if (!location) continue;
      candidates.push({ item, location, duration: durationValue(item) });
    }

    if (!candidates.length) {
      const home = normalizeLocation(homeLocation);
      return {
        primary: home,
        locations: home ? [home] : [],
        additionalCount: 0,
        needsHome: true,
      };
    }

    let primaryCandidate = candidates[0];
    for (const candidate of candidates.slice(1)) {
      if (
        candidate.duration !== null
        && (primaryCandidate.duration === null || candidate.duration > primaryCandidate.duration)
      ) {
        primaryCandidate = candidate;
      }
    }

    const uniqueLocations = [];
    const seenIds = new Set();
    for (const candidate of candidates) {
      const key = String(candidate.location.location_id);
      if (seenIds.has(key)) continue;
      seenIds.add(key);
      uniqueLocations.push(candidate.location);
    }
    const primary = primaryCandidate.location;
    const locations = [
      primary,
      ...uniqueLocations.filter(
        location => String(location.location_id) !== String(primary.location_id),
      ),
    ];
    return {
      primary,
      locations,
      additionalCount: locations.length - 1,
      needsHome: false,
    };
  }

  function notifyChange() {
    if (typeof state.onChange === "function") {
      state.onChange();
    }
  }

  function ensureHome() {
    if (state.home.status !== "idle") return state.home.promise;
    const generation = state.generation;
    state.home.status = "loading";
    state.home.promise = Promise.resolve()
      .then(() => global.api.fetchSavedLocations())
      .then(payload => {
        if (!Array.isArray(payload?.locations)) {
          throw new Error("Saved locations response is invalid.");
        }
        const row = payload.locations.find(
          location => location?.is_home === true && location?.lifecycle_state === "active",
        );
        if (generation !== state.generation) return null;
        state.home = {
          status: "ready",
          location: normalizeLocation(row),
          promise: null,
        };
        notifyChange();
        return state.home.location;
      })
      .catch(() => {
        if (generation !== state.generation) return null;
        state.home = { status: "error", location: null, promise: null };
        notifyChange();
        return null;
      });
    return state.home.promise;
  }

  function validForecast(payload) {
    return payload
      && isDateKey(payload.available_start_date)
      && isDateKey(payload.available_end_date)
      && payload.available_start_date <= payload.available_end_date
      && Array.isArray(payload.daily);
  }

  function ensureForecast(location) {
    const key = String(location.location_id);
    const existing = state.forecastByLocation.get(key);
    if (existing) return existing;

    const generation = state.generation;
    const entry = { status: "loading", payload: null, errorStatus: null, promise: null };
    entry.promise = Promise.resolve()
      .then(() => global.api.fetchWeatherForecast(location.location_id))
      .then(payload => {
        if (!validForecast(payload)) {
          throw new Error("Weather forecast response is invalid.");
        }
        if (generation === state.generation) {
          entry.status = "ready";
          entry.payload = payload;
          notifyChange();
        }
        return entry;
      })
      .catch(error => {
        if (generation === state.generation) {
          entry.status = "error";
          entry.errorStatus = Number.isInteger(error?.status) ? error.status : null;
          notifyChange();
        }
        return entry;
      });
    state.forecastByLocation.set(key, entry);
    return entry;
  }

  function dateInResponseRange(payload, dateKey) {
    return dateKey >= payload.available_start_date && dateKey <= payload.available_end_date;
  }

  function dailyForDate(payload, dateKey) {
    return payload.daily.find(row => row?.date === dateKey) || null;
  }

  function finiteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
  }

  function rounded(value) {
    return finiteNumber(value) ? String(Math.round(value)) : "";
  }

  function degrees(value) {
    const result = rounded(value);
    return result ? `${result}°` : "";
  }

  function dailyTemperature(daily) {
    const high = degrees(daily.temperature_high_f);
    const low = degrees(daily.temperature_low_f);
    if (high && low) return `${high}/${low}`;
    if (high) return `H ${high}`;
    if (low) return `L ${low}`;
    return "";
  }

  function compassDirection(value) {
    if (!finiteNumber(value)) return "";
    const directions = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    const index = Math.round(((value % 360) + 360) % 360 / 45) % directions.length;
    return directions[index];
  }

  function conditionPresentation(condition) {
    return CONDITIONS[condition] || CONDITIONS.unknown;
  }

  function fullDateLabel(dateKey) {
    if (!isDateKey(dateKey)) return dateKey;
    return new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      weekday: "long",
      month: "long",
      day: "numeric",
    }).format(new Date(`${dateKey}T12:00:00Z`));
  }

  function triggerLabel(selection, dateKey, unavailable = false) {
    const additional = selection.additionalCount
      ? `, ${selection.additionalCount} additional location${selection.additionalCount === 1 ? "" : "s"}`
      : "";
    const status = unavailable ? ". Forecast unavailable" : "";
    return `Open hourly weather for ${selection.primary.display_name} on ${fullDateLabel(dateKey)}${additional}${status}`;
  }

  function renderLoading() {
    return '<span class="plan-weather-loading" role="status">Weather loading</span>';
  }

  function renderUnavailableStatus() {
    return '<span class="plan-weather-unavailable" role="status">Forecast unavailable</span>';
  }

  function renderTrigger(dateKey, selection, daily) {
    const presentation = conditionPresentation(daily.condition);
    const temperature = dailyTemperature(daily);
    const gust = daily.wind_gust_max_mph;
    const gustAlert = finiteNumber(gust) && gust >= 25
      ? {
        className: gust >= 35 ? "is-warning" : "is-caution",
        label: gust >= 35
          ? `High wind: maximum gust ${gust} mph`
          : `Gusty: maximum gust ${gust} mph`,
      }
      : null;
    const accessibleLabel = [
      triggerLabel(selection, dateKey),
      gustAlert?.label,
    ].filter(Boolean).join(". ");
    return `<button type="button" class="plan-weather-trigger" data-plan-weather-trigger="${dateKey}" aria-label="${escapeHtml(accessibleLabel)}" title="${escapeHtml(accessibleLabel)}"><span class="plan-weather-icon" aria-hidden="true">${presentation.icon}</span>${temperature ? `<span class="plan-weather-temperature" aria-hidden="true">${escapeHtml(temperature)}</span>` : ""}${gustAlert ? `<span class="plan-weather-alert ${gustAlert.className}" aria-hidden="true">💨</span>` : ""}${selection.additionalCount ? `<span class="plan-weather-more" aria-hidden="true">+${selection.additionalCount}</span>` : ""}</button>`;
  }

  function renderUnavailableTrigger(dateKey, selection) {
    const accessibleLabel = triggerLabel(selection, dateKey, true);
    return `<button type="button" class="plan-weather-trigger is-unavailable" data-plan-weather-trigger="${dateKey}" aria-label="${escapeHtml(accessibleLabel)}" title="${escapeHtml(accessibleLabel)}"><span class="plan-weather-unavailable">Forecast unavailable</span>${selection.additionalCount ? `<span class="plan-weather-more" aria-hidden="true">+${selection.additionalCount}</span>` : ""}</button>`;
  }

  function renderDay({ dateKey, todayKey, items, itemsReady }) {
    if (!itemsReady || !isInForecastWindow(dateKey, todayKey)) {
      state.selectionsByDate.delete(dateKey);
      return "";
    }

    let selection = selectLocationsForDate(items);
    if (selection.needsHome) {
      if (state.home.status === "idle" || state.home.status === "loading") {
        ensureHome();
        return renderLoading();
      }
      if (state.home.status === "error") return renderUnavailableStatus();
      selection = selectLocationsForDate(items, state.home.location);
      if (!selection.primary) {
        state.selectionsByDate.delete(dateKey);
        return "";
      }
    }

    state.selectionsByDate.set(dateKey, selection);
    const entries = selection.locations.map(location => ensureForecast(location));
    const primaryEntry = entries[0];
    if (primaryEntry.status === "loading") return renderLoading();
    if (primaryEntry.status === "error") return renderUnavailableTrigger(dateKey, selection);

    const forecast = primaryEntry.payload;
    if (!dateInResponseRange(forecast, dateKey)) {
      state.selectionsByDate.delete(dateKey);
      return "";
    }
    const daily = dailyForDate(forecast, dateKey);
    return daily
      ? renderTrigger(dateKey, selection, daily)
      : renderUnavailableTrigger(dateKey, selection);
  }

  function localTime(value) {
    if (typeof value !== "string") return "";
    const match = value.match(/T(\d{2}):(\d{2})/);
    if (!match) return "";
    const time = new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2])));
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "UTC",
      hour: "numeric",
      minute: "2-digit",
    }).format(time);
  }

  function decimal(value, places = 2) {
    if (!finiteNumber(value)) return "";
    return value.toFixed(places).replace(/\.?0+$/, "");
  }

  function windSummary(hour) {
    const direction = compassDirection(hour.wind_direction_deg);
    const speed = rounded(hour.wind_speed_mph);
    const gust = rounded(hour.wind_gust_mph);
    const parts = [];
    if (direction || speed) parts.push(`${direction}${direction && speed ? " " : ""}${speed}${speed ? " mph" : ""}`);
    if (gust) parts.push(`gust ${gust} mph`);
    return parts.join(" · ");
  }

  function hourlyRow(hour) {
    const condition = conditionPresentation(hour.condition);
    const temperature = degrees(hour.temperature_f);
    const apparent = degrees(hour.apparent_temperature_f);
    const temperatures = [
      temperature,
      apparent && apparent !== temperature ? `feels ${apparent}` : "",
    ].filter(Boolean).join(" · ");
    const precipitation = [];
    if (finiteNumber(hour.precipitation_probability_pct)) {
      precipitation.push(`${Math.round(hour.precipitation_probability_pct)}%`);
    }
    if (finiteNumber(hour.precipitation_in)) {
      precipitation.push(`${decimal(hour.precipitation_in)} in`);
    }
    const snowfall = finiteNumber(hour.snowfall_in) && hour.snowfall_in > 0
      ? `<span class="plan-weather-hour-snow">Snow ${escapeHtml(decimal(hour.snowfall_in))} in</span>`
      : "";
    const time = localTime(hour.timestamp_local);
    return `<li class="plan-weather-hour"><time>${escapeHtml(time)}</time><span class="plan-weather-hour-condition">${condition.icon} ${escapeHtml(condition.label)}</span><span class="plan-weather-hour-temperature">${escapeHtml(temperatures)}</span><span class="plan-weather-hour-wind">${escapeHtml(windSummary(hour))}</span><span class="plan-weather-hour-precipitation">${escapeHtml(precipitation.join(" · "))}</span>${snowfall}</li>`;
  }

  function dailySummary(daily) {
    if (!daily) {
      return '<p class="plan-weather-location-summary">Sunrise and sunset unavailable.</p>';
    }
    const condition = conditionPresentation(daily.condition);
    const temperature = dailyTemperature(daily);
    const temperatures = temperature
      ? `<span>${escapeHtml(temperature)}</span>`
      : "";
    const sunrise = localTime(daily.sunrise_local);
    const sunset = localTime(daily.sunset_local);
    const sunTimes = [sunrise ? `Sunrise ${sunrise}` : "", sunset ? `Sunset ${sunset}` : ""]
      .filter(Boolean)
      .join(" · ");
    return `<p class="plan-weather-location-summary"><span>${condition.icon} ${escapeHtml(condition.label)}</span>${temperatures}</p><p class="plan-weather-sun-times">${escapeHtml(sunTimes || "Sunrise and sunset unavailable.")}</p>`;
  }

  function locationDetailMarkup(location, result) {
    const status = result?.status || "loading";
    const stale = result?.freshness === "stale"
      ? `<p class="plan-weather-stale" role="status">Stale forecast${Number.isInteger(result.stale_age_minutes) ? ` · ${result.stale_age_minutes} min old` : ""}</p>`
      : "";
    let content = '<p class="plan-weather-detail-status" role="status">Loading hourly forecast...</p>';
    if (status === "unsupported") {
      content = '<p class="plan-weather-detail-status" role="status">Hourly forecast is not available for this date.</p>';
    } else if (status === "unavailable") {
      content = '<p class="plan-weather-detail-status" role="status">Hourly forecast unavailable.</p>';
    } else if (status === "ready") {
      const hours = Array.isArray(result.hourly)
        ? [...result.hourly].sort((left, right) => String(left.timestamp_local).localeCompare(String(right.timestamp_local)))
        : [];
      content = hours.length
        ? `<ol class="plan-weather-hour-list" aria-label="Hourly forecast for ${escapeHtml(location.display_name)}">${hours.map(hourlyRow).join("")}</ol>`
        : '<p class="plan-weather-detail-status" role="status">No hourly details are available for this date.</p>';
    }
    return `<section class="plan-weather-location" aria-labelledby="plan-weather-location-${escapeHtml(location.location_id)}"><h3 id="plan-weather-location-${escapeHtml(location.location_id)}">${escapeHtml(location.display_name)}</h3>${stale}${dailySummary(result?.daily)}${content}</section>`;
  }

  function renderDialogBody() {
    if (!state.activeDetail || !state.dialogBody) return;
    const { selection, results } = state.activeDetail;
    const resultById = new Map(
      (results || []).map(result => [String(result.location_id), result]),
    );
    state.dialogBody.innerHTML = selection.locations
      .map(location => locationDetailMarkup(
        location,
        resultById.get(String(location.location_id)),
      ))
      .join("");
  }

  function ensureDialog() {
    if (state.dialog) return;
    const root = document.createElement("div");
    root.id = "planWeatherDialog";
    root.className = "plan-template-library plan-weather-dialog hidden";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-hidden", "true");
    root.setAttribute("aria-labelledby", "planWeatherDialogTitle");
    root.innerHTML = `
      <div class="plan-template-library-backdrop" data-plan-weather-action="backdrop"></div>
      <section class="plan-template-library-panel plan-weather-dialog-panel">
        <div class="plan-template-library-content">
          <header class="plan-template-library-header">
            <div><h2 id="planWeatherDialogTitle"></h2></div>
            <button type="button" class="drawer-close-button" data-plan-weather-action="close"
              aria-label="Close hourly weather">×</button>
          </header>
          <div class="plan-template-library-body plan-weather-dialog-body" id="planWeatherDialogBody"></div>
        </div>
      </section>`;
    document.body.appendChild(root);
    state.dialog = root;
    state.dialogTitle = root.querySelector("#planWeatherDialogTitle");
    state.dialogBody = root.querySelector("#planWeatherDialogBody");
    state.closeButton = root.querySelector("[data-plan-weather-action='close']");
    state.surface = global.TrainingApp?.TransientSurface?.create?.({
      getSurface: () => state.dialog,
      restoreFocus: false,
      onBeforeClose: () => {
        state.dialog.classList.add("hidden");
        state.dialog.setAttribute("aria-hidden", "true");
      },
      onAfterClose: reason => {
        const activeDetail = state.activeDetail;
        state.activeDetail = null;
        if (["tab", "feature-deactivate", "replace"].includes(reason)) return;
        const opener = activeDetail?.opener;
        const fallback = activeDetail?.dateKey
          ? document.querySelector(`#planStrip [data-plan-weather-trigger="${activeDetail.dateKey}"]`)
          : null;
        const focusTarget = opener?.isConnected !== false ? opener : fallback;
        focusTarget?.focus?.();
      },
    });
    root.addEventListener("click", event => {
      const action = event.target.closest?.("[data-plan-weather-action]")?.dataset?.planWeatherAction;
      if (action === "backdrop") requestClose("backdrop");
      if (action === "close") requestClose("close-button");
    });
    document.addEventListener("keydown", handleDialogKeydown);
  }

  function closeDialog(reason) {
    if (!state.activeDetail) return false;
    if (state.surface) return state.surface.close(reason);
    state.dialog?.classList.add("hidden");
    state.dialog?.setAttribute("aria-hidden", "true");
    state.activeDetail = null;
    return true;
  }

  function requestClose(reason) {
    if (!state.activeDetail) return Promise.resolve(false);
    return state.surface?.requestClose(reason) ?? Promise.resolve(closeDialog(reason));
  }

  function focusableDialogElements() {
    return Array.from(state.dialog?.querySelectorAll(
      "button, a[href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    ) || []).filter(element => !element.disabled && element.offsetParent !== null);
  }

  function handleDialogKeydown(event) {
    if (!state.activeDetail) return;
    if (event.key === "Escape") {
      event.preventDefault();
      requestClose("escape");
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableDialogElements();
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function loadLocationDetail(location, dateKey) {
    const forecastEntry = ensureForecast(location);
    await forecastEntry.promise;
    let daily = null;
    let freshness = forecastEntry.payload?.freshness;
    let staleAgeMinutes = forecastEntry.payload?.stale_age_minutes;
    if (forecastEntry.status === "ready") {
      if (!dateInResponseRange(forecastEntry.payload, dateKey)) {
        return {
          location_id: location.location_id,
          status: "unsupported",
          daily: null,
          freshness,
          stale_age_minutes: staleAgeMinutes,
        };
      }
      daily = dailyForDate(forecastEntry.payload, dateKey);
    }

    try {
      const payload = await global.api.fetchWeatherHourly(location.location_id, dateKey);
      if (!Array.isArray(payload?.hourly)) {
        throw new Error("Hourly forecast response is invalid.");
      }
      freshness = payload.freshness || freshness;
      staleAgeMinutes = payload.stale_age_minutes ?? staleAgeMinutes;
      return {
        location_id: location.location_id,
        status: "ready",
        daily,
        hourly: payload.hourly,
        freshness,
        stale_age_minutes: staleAgeMinutes,
      };
    } catch (error) {
      return {
        location_id: location.location_id,
        status: error?.status === 422 ? "unsupported" : "unavailable",
        daily,
        freshness,
        stale_age_minutes: staleAgeMinutes,
      };
    }
  }

  async function openDetails(dateKey, opener) {
    const selection = state.selectionsByDate.get(dateKey);
    if (!selection?.primary || !selection.locations.length) return;
    ensureDialog();
    const generation = ++state.detailGeneration;
    state.activeDetail = { dateKey, selection, opener, results: [] };
    state.dialogTitle.textContent = `Hourly weather - ${fullDateLabel(dateKey)}`;
    state.dialog.classList.remove("hidden");
    state.dialog.setAttribute("aria-hidden", "false");
    state.surface?.open({ opener });
    renderDialogBody();
    state.closeButton?.focus?.();

    const results = await Promise.all(
      selection.locations.map(location => loadLocationDetail(location, dateKey)),
    );
    if (generation !== state.detailGeneration || !state.activeDetail) return;
    state.activeDetail.results = results;
    renderDialogBody();
  }

  function handleStripClick(event) {
    const trigger = event.target.closest?.("[data-plan-weather-trigger]");
    if (!trigger || !state.strip?.contains(trigger)) return;
    const dateKey = trigger.dataset.planWeatherTrigger;
    if (dateKey) openDetails(dateKey, trigger);
  }

  function init({ onChange } = {}) {
    if (typeof onChange === "function") state.onChange = onChange;
    if (state.initialized) return true;
    state.strip = document.getElementById("planStrip");
    if (!state.strip) return false;
    state.initialized = true;
    ensureDialog();
    state.strip.addEventListener("click", handleStripClick);
    return true;
  }

  function resetForPlanLoad() {
    state.generation += 1;
    state.forecastByLocation.clear();
    state.home = { status: "idle", location: null, promise: null };
    state.selectionsByDate.clear();
    if (state.activeDetail) closeDialog("replace");
  }

  function deactivate() {
    if (state.activeDetail) closeDialog("tab");
  }

  global.PlanWeatherController = {
    deactivate,
    init,
    renderDay,
    resetForPlanLoad,
    selectLocationsForDate,
  };
})(window);
