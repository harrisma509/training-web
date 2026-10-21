(function () {
  const PLAN_TIME_ZONE = "America/Denver";
  const DEFAULT_HIDE_PAST_PLANNED = true;
  const state = {
    open: false,
    hidePastPlanned: DEFAULT_HIDE_PAST_PLANNED,
    loaded: false,
    saving: false,
    error: false,
    statusMessage: "",
  };
  let initialized = false;
  let onChange = null;
  let surface = null;
  let lastDenverDate = "";
  let midnightTimer = null;

  function getElements() {
    return {
      trigger: document.getElementById("planOptionsOpen"),
      popover: document.getElementById("planOptionsPopover"),
      toggle: document.getElementById("planHidePastPlanned"),
      reset: document.getElementById("planOptionsReset"),
      status: document.getElementById("planOptionsStatus"),
    };
  }

  function render() {
    const { trigger, popover, toggle, reset, status } = getElements();
    if (!trigger || !popover || !toggle || !reset || !status) return;
    trigger.setAttribute("aria-expanded", String(state.open));
    trigger.classList.toggle("is-active", state.open);
    popover.hidden = !state.open;
    toggle.checked = state.hidePastPlanned;
    toggle.disabled = state.saving;
    toggle.setAttribute("aria-checked", String(state.hidePastPlanned));
    reset.disabled = state.saving;
    status.textContent = state.statusMessage;
    status.dataset.state = state.error ? "error" : state.saving ? "saving" : "";
  }

  function publish() {
    render();
    if (typeof onChange === "function") onChange();
  }

  function preferenceValue(payload) {
    if (!payload || typeof payload !== "object"
        || Array.isArray(payload)
        || typeof payload.hide_past_planned !== "boolean"
        || Object.keys(payload).some(key => key !== "hide_past_planned")) {
      throw new Error("Invalid Plan preference response.");
    }
    return payload.hide_past_planned;
  }

  function getDenverParts(date) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: PLAN_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    return Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  }

  function getDenverDateKey(date) {
    const parts = getDenverParts(date);
    return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
  }

  function getNextDenverMidnightEpoch(now) {
    const parts = getDenverParts(now);
    const wallMidnight = Date.UTC(parts.year, parts.month - 1, parts.day + 1);
    let candidate = wallMidnight + 7 * 60 * 60 * 1000;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const local = getDenverParts(new Date(candidate));
      const localAsUtc = Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
      );
      candidate = wallMidnight - (localAsUtc - candidate);
    }
    return candidate;
  }

  function scheduleMidnightRefresh() {
    if (midnightTimer !== null) window.clearTimeout(midnightTimer);
    const now = new Date();
    lastDenverDate = getDenverDateKey(now);
    const delay = Math.max(1000, getNextDenverMidnightEpoch(now) - now.getTime() + 100);
    midnightTimer = window.setTimeout(() => {
      midnightTimer = null;
      const currentDate = getDenverDateKey(new Date());
      if (currentDate !== lastDenverDate) {
        lastDenverDate = currentDate;
        if (typeof onChange === "function") onChange();
      }
      scheduleMidnightRefresh();
    }, delay);
  }

  function close(reason) {
    if (!state.open || !surface) return false;
    return surface.close(reason);
  }

  function open(trigger) {
    const { toggle } = getElements();
    surface.open({ opener: trigger });
    state.open = true;
    render();
    toggle?.focus();
  }

  async function loadPreferences() {
    try {
      const payload = await window.api.fetchPlanPreferences();
      state.hidePastPlanned = preferenceValue(payload);
      state.loaded = true;
      state.error = false;
      state.statusMessage = "";
    } catch {
      state.loaded = true;
      state.error = true;
      state.statusMessage = "Saved Plan options are unavailable; using the default for this visit.";
    }
    publish();
  }

  function hasUnknownOutcome(error) {
    return error?.status === undefined || error?.status === null || error.status >= 500;
  }

  async function reconcileUnknownOutcome(previousValue, requestedValue) {
    try {
      const payload = await window.api.fetchPlanPreferences();
      state.hidePastPlanned = preferenceValue(payload);
      state.loaded = true;
      state.error = false;
      state.statusMessage = state.hidePastPlanned === requestedValue
        ? "Plan options saved."
        : "Current saved Plan options restored.";
    } catch {
      state.hidePastPlanned = previousValue;
      state.error = true;
      state.statusMessage = "Unable to verify the save; showing the last confirmed setting.";
    }
  }

  async function savePreference(value, force = false) {
    if (state.saving || (!force && value === state.hidePastPlanned)) return false;
    const previousValue = state.hidePastPlanned;
    state.saving = true;
    state.error = false;
    state.statusMessage = "Saving Plan options…";
    render();

    try {
      const payload = await window.api.updatePlanPreferences({
        hide_past_planned: value,
      });
      state.hidePastPlanned = preferenceValue(payload);
      state.loaded = true;
      state.statusMessage = "Plan options saved.";
    } catch (error) {
      state.hidePastPlanned = previousValue;
      if (hasUnknownOutcome(error)) {
        await reconcileUnknownOutcome(previousValue, value);
      } else {
        state.error = true;
        state.statusMessage = "Unable to save Plan options.";
      }
    } finally {
      state.saving = false;
      publish();
    }
    return true;
  }

  function init(options = {}) {
    if (typeof options.onChange === "function") onChange = options.onChange;
    if (initialized) return true;

    const { trigger, popover, toggle, reset } = getElements();
    if (!trigger || !popover || !toggle || !reset) return false;
    const transientSurface = window.TrainingApp?.TransientSurface;
    if (typeof transientSurface?.create !== "function") {
      throw new Error("Plan Options requires the transient-surface controller.");
    }
    surface = transientSurface.create({
      getSurface: () => popover,
      onBeforeClose: () => {
        state.open = false;
        render();
      },
    });

    trigger.addEventListener("click", () => {
      if (state.open) close("trigger");
      else open(trigger);
    });
    toggle.addEventListener("change", event => {
      savePreference(Boolean(event.currentTarget.checked));
    });
    reset.addEventListener("click", () => {
      savePreference(DEFAULT_HIDE_PAST_PLANNED, true);
    });
    document.addEventListener("pointerdown", event => {
      if (!state.open
          || popover.contains(event.target)
          || trigger.contains(event.target)) return;
      close("outside");
    });
    document.addEventListener("keydown", event => {
      if (!state.open || event.key !== "Escape") return;
      event.preventDefault();
      close("escape");
    });
    window.addEventListener("beforeunload", () => {
      if (midnightTimer !== null) window.clearTimeout(midnightTimer);
      midnightTimer = null;
    }, { once: true });

    initialized = true;
    render();
    scheduleMidnightRefresh();
    loadPreferences();
    return true;
  }

  window.PlanOptionsController = {
    init,
    getState: () => ({ ...state }),
    getHidePastPlanned: () => state.hidePastPlanned,
    resetViewDefaults: () => savePreference(DEFAULT_HIDE_PAST_PLANNED, true),
  };
})();
