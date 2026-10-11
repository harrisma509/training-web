(function () {
  const PLAN_TIME_ZONE = "America/Denver";
  const state = {
    mode: "idle",
    template: null,
    targetDate: null,
    sourceElement: null,
    inFlight: false,
    outcomeRequiresRefresh: false,
    statusMessage: "",
    errorStatus: null,
  };

  let initialized = false;
  let onChange = null;
  let liveRegion = null;

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[character]));
  }

  function getDenverTodayKey() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: PLAN_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function isValidTarget(dateKey) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ""))
      && String(dateKey) > getDenverTodayKey();
  }

  function announce(message) {
    state.statusMessage = message;
    if (liveRegion) {
      liveRegion.textContent = "";
      window.setTimeout(() => {
        if (liveRegion) liveRegion.textContent = message;
      }, 0);
    }
  }

  function notify() {
    if (typeof onChange === "function") onChange();
  }

  function setLibraryPlacementMode(active) {
    window.PlanTemplateLibraryController?.setPlacementMode?.(active);
  }

  function clearState({ restoreFocus = true } = {}) {
    const source = state.sourceElement;
    state.mode = "idle";
    state.template = null;
    state.targetDate = null;
    state.sourceElement = null;
    state.inFlight = false;
    state.outcomeRequiresRefresh = false;
    state.errorStatus = null;
    setLibraryPlacementMode(false);
    notify();
    if (restoreFocus && source?.isConnected && typeof source.focus === "function") {
      source.focus();
    }
  }

  function startSelection({ planTemplateId, templateName, sourceElement }) {
    if (state.inFlight || !planTemplateId || !templateName) return false;
    state.mode = "selected";
    state.template = { planTemplateId: Number(planTemplateId), templateName: String(templateName) };
    state.targetDate = null;
    state.sourceElement = sourceElement || null;
    state.errorStatus = null;
    setLibraryPlacementMode(true);
    announce(`${state.template.templateName} selected. Choose a future Plan date.`);
    notify();
    return true;
  }

  function startDrag({ planTemplateId, templateName, sourceElement, dataTransfer }) {
    if (!startSelection({ planTemplateId, templateName, sourceElement })) return false;
    state.mode = "dragging";
    if (dataTransfer) {
      dataTransfer.effectAllowed = "copy";
      dataTransfer.setData(
        "application/x-training-plan-template",
        JSON.stringify({ plan_template_id: Number(planTemplateId), template_name: String(templateName) }),
      );
      dataTransfer.setData("text/plain", String(planTemplateId));
    }
    notify();
    return true;
  }

  function cancel({ restoreFocus = true } = {}) {
    if (state.inFlight) return false;
    if (state.mode === "idle") return false;
    announce("Placement cancelled.");
    clearState({ restoreFocus });
    return true;
  }

  function normalizeTarget(event) {
    const element = event.target?.closest?.("[data-plan-date]");
    return element?.getAttribute("data-plan-date") || null;
  }

  function setTarget(dateKey) {
    if (!state.template || !isValidTarget(dateKey)) return false;
    state.targetDate = dateKey;
    notify();
    return true;
  }

  function validAuthoritativeItem(item) {
    return item
      && item.plan_item_id !== null
      && item.plan_item_id !== undefined
      && /^\d{4}-\d{2}-\d{2}$/.test(String(item.planned_date || ""))
      && item.item_state
      && item.prescription;
  }

  function currentRangeContains(dateKey) {
    const range = window.PlanController?.getRange?.();
    return Boolean(range?.start && range?.end && dateKey >= range.start && dateKey < range.end);
  }

  async function reconcileUnknown() {
    const range = window.PlanController?.getRange?.();
    if (range?.start && range?.end) {
      await window.PlanItemsController?.load?.(range, { force: true });
    }
    state.outcomeRequiresRefresh = false;
    state.inFlight = false;
    state.mode = "error";
    announce("Plan refreshed. Review the target date before trying again.");
    setLibraryPlacementMode(false);
    notify();
  }

  async function submit(dateKey) {
    if (
      state.inFlight
      || !state.template
      || state.outcomeRequiresRefresh
      || !isValidTarget(dateKey)
    ) {
      return false;
    }
    state.targetDate = dateKey;
    state.mode = "saving";
    state.inFlight = true;
    state.errorStatus = null;
    announce(`Saving ${state.template.templateName} on ${dateKey}…`);
    notify();

    try {
      const item = await window.api.createPlanItemFromTemplate({
        planTemplateId: state.template.planTemplateId,
        plannedDate: dateKey,
        sortOrder: 0,
        userNote: null,
      });
      if (!validAuthoritativeItem(item)) {
        throw Object.assign(new Error("Malformed plan item response"), { status: 0, unknown: true });
      }
      if (currentRangeContains(item.planned_date)) {
        window.PlanItemsController?.acceptCreatedItem?.(item);
      }
      const source = state.sourceElement;
      const templateName = state.template.templateName;
      state.mode = "success";
      state.inFlight = false;
      state.targetDate = null;
      setLibraryPlacementMode(false);
      announce(`${templateName} placed on ${item.planned_date}.`);
      notify();
      state.template = null;
      state.sourceElement = source;
      window.setTimeout(() => {
        if (state.mode === "success") clearState({ restoreFocus: true });
      }, 0);
      return true;
    } catch (error) {
      const status = Number(error?.status || 0);
      const unknown = error?.unknown || !status;
      if (unknown) {
        state.mode = "unknown";
        state.outcomeRequiresRefresh = true;
        announce("Placement outcome is unknown. Refreshing Plan before retry.");
        notify();
        try {
          await reconcileUnknown();
        } catch (_reconcileError) {
          state.inFlight = false;
          state.mode = "error";
          announce("Plan could not be refreshed. Review the target date before trying again.");
          notify();
        }
        return false;
      }
      state.inFlight = false;
      state.errorStatus = status;
      state.targetDate = null;
      setLibraryPlacementMode(false);
      if (status === 400) announce("That date is no longer available. Choose another future date.");
      else if (status === 404) {
        announce("This template is no longer available.");
        window.PlanTemplateLibraryController?.refresh?.();
      } else if (status === 403) announce("You do not have permission to place this template.");
      else if (status === 409) announce("This template could not be placed because of a Plan conflict.");
      else announce("Plan item persistence is temporarily unavailable. You can try again.");
      state.mode = "error";
      notify();
      return false;
    }
  }

  function targetMarkup(dateKey, dateLabel) {
    if (!state.template || !isValidTarget(dateKey)) return "";
    const saving = state.mode === "saving" && state.targetDate === dateKey;
    const active = state.targetDate === dateKey;
    return `
      <button type="button" class="plan-placement-target${active ? " is-active" : ""}"
        data-plan-placement-target="${escape(dateKey)}"
        aria-label="${escape(`Place ${state.template.templateName} on ${dateLabel}`)}"
        ${saving ? "disabled" : ""}>
        ${saving ? "Saving planned item…" : "Place here"}
      </button>`;
  }

  function handleDragOver(event) {
    if (!state.template || !["selected", "dragging"].includes(state.mode)) return;
    const dateKey = normalizeTarget(event);
    if (isValidTarget(dateKey)) {
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
      setTarget(dateKey);
    }
  }

  function handleDrop(event) {
    if (!state.template || !["selected", "dragging"].includes(state.mode)) return;
    const dateKey = normalizeTarget(event);
    if (!isValidTarget(dateKey)) return;
    event.preventDefault();
    submit(dateKey);
  }

  function handleClick(event) {
    const target = event.target?.closest?.("[data-plan-placement-target]");
    if (!target) return;
    event.preventDefault();
    submit(target.getAttribute("data-plan-placement-target"));
  }

  function handleKeydown(event) {
    if (event.key === "Escape" && ["selected", "dragging", "error", "success"].includes(state.mode)) {
      event.preventDefault();
      cancel();
    }
  }

  function init(options = {}) {
    if (typeof options.onChange === "function") onChange = options.onChange;
    if (initialized) return true;
    initialized = true;
    liveRegion = document.getElementById("planPlacementStatus");
    document.addEventListener("dragover", handleDragOver);
    document.addEventListener("drop", handleDrop);
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown);
    return true;
  }

  window.PlanPlacementController = {
    init,
    startSelection,
    startDrag,
    cancel,
    setTarget,
    submit,
    targetMarkup,
    getState: () => ({ ...state, template: state.template ? { ...state.template } : null }),
    isActive: () => state.mode !== "idle",
    onLibraryClose: () => {
      if (!state.inFlight) cancel({ restoreFocus: false });
    },
  };
})();
