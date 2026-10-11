(function () {
  const PLAN_TIME_ZONE = "America/Denver";
  const state = {
    paletteOpen: false,
    templatesStatus: "idle",
    templates: [],
    categories: [],
    searchText: "",
    categoryId: "",
    allTemplatesExpanded: false,
    selectedTemplate: null,
    dragTemplate: null,
    targetDate: null,
    mode: "idle",
    inFlight: false,
    outcomeRequiresRefresh: false,
    statusMessage: "",
    errorStatus: null,
    requestGeneration: 0,
    abortController: null,
  };

  let initialized = false;
  let onChange = null;
  let root;
  let trigger;
  let closeButton;
  let searchInput;
  let categorySelect;
  let status;
  let rows;
  let quickRows;
  let allTemplates;
  let allTemplatesToggle;
  let quickEmpty;
  let manageButton;
  let placementBanner;
  let workspace;
  let draggingRow;

  function escape(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    }[character]));
  }

  function setAllTemplatesExpanded(expanded) {
    state.allTemplatesExpanded = Boolean(expanded);
    render();
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

  function isMobile() {
    return window.innerWidth < 700;
  }

  function announce(message) {
    state.statusMessage = message;
    if (status) status.textContent = message;
  }

  function filteredTemplates() {
    const query = state.searchText.trim().toLowerCase();
    return state.templates.filter(template => {
      if (state.categoryId && String(template.category?.plan_category_id) !== String(state.categoryId)) {
        return false;
      }
      if (!query) return true;
      const prescription = template.prescription || {};
      return [
        template.template_name,
        template.category?.category_name,
        prescription.sport_type,
        prescription.activity_category,
      ].some(value => String(value || "").toLowerCase().includes(query));
    });
  }

  function templateRow(template) {
    const prescription = template.prescription || {};
    const details = [
      template.category?.category_name || "Uncategorized",
      prescription.sport_type || prescription.activity_category || "",
    ].filter(Boolean);
    if (prescription.target_duration_min !== null && prescription.target_duration_min !== undefined) {
      details.push(`${prescription.target_duration_min} min`);
    }
    if (prescription.target_load !== null && prescription.target_load !== undefined) {
      details.push(`Load ${prescription.target_load}`);
    }
    if (prescription.segment_count > 0) {
      details.push(`${prescription.segment_count} segments`);
    }
    const selected = state.selectedTemplate?.planTemplateId === template.plan_template_id;
    return `
      <button type="button" class="plan-palette-row${selected ? " is-selected" : ""}"
        role="listitem" draggable="true" aria-describedby="planPaletteDragInstructions"
        data-plan-palette-template-id="${escape(template.plan_template_id)}"
        aria-pressed="${selected ? "true" : "false"}">
        <strong>${escape(template.template_name)}</strong>
        <span>${escape(details.join(" · "))}</span>
      </button>`;
  }

  function renderRows(container, templates) {
    if (!container) return;
    container.innerHTML = templates.length
      ? templates.map(templateRow).join("")
      : '<div class="plan-palette-state">No matching templates.</div>';
  }

  function render() {
    if (!root) return;
    root.hidden = !state.paletteOpen;
    workspace?.classList.toggle("plan-palette-open", state.paletteOpen);
    trigger?.setAttribute("aria-expanded", state.paletteOpen ? "true" : "false");
    if (searchInput && searchInput.value !== state.searchText) searchInput.value = state.searchText;
    if (categorySelect && categorySelect.value !== state.categoryId) categorySelect.value = state.categoryId;
    if (allTemplates) allTemplates.hidden = !state.allTemplatesExpanded;
    if (allTemplatesToggle) {
      allTemplatesToggle.setAttribute("aria-expanded", state.allTemplatesExpanded ? "true" : "false");
      allTemplatesToggle.querySelector("span:last-child")?.replaceChildren(
        document.createTextNode(state.allTemplatesExpanded ? "−" : "+"),
      );
    }
    if (status) status.textContent = state.statusMessage;
    if (categorySelect) {
      categorySelect.innerHTML = [
        '<option value="">All categories</option>',
        ...state.categories.map(category =>
          `<option value="${escape(category.plan_category_id)}">${escape(category.category_name)}</option>`),
      ].join("");
      categorySelect.value = state.categoryId;
    }
    if (!rows || !quickRows) return;
    if (state.templatesStatus === "loading") {
      quickRows.innerHTML = '<div class="plan-palette-state" role="status">Loading templates…</div>';
      rows.innerHTML = "";
      quickEmpty.hidden = true;
    } else if (state.templatesStatus === "error") {
      quickRows.innerHTML = `
        <div class="plan-palette-state is-error" role="alert">
          Templates are temporarily unavailable.
          <button type="button" class="button-secondary" data-plan-palette-action="retry">Retry</button>
        </div>`;
      rows.innerHTML = "";
      quickEmpty.hidden = true;
    } else {
      const quick = state.templates.filter(template => template.is_favorite === true);
      const visible = filteredTemplates();
      renderRows(quickRows, quick);
      renderRows(rows, visible);
      quickEmpty.hidden = state.templatesStatus !== "success" || quick.length > 0;
      quickRows.hidden = quick.length === 0;
    }
    if (manageButton) manageButton.disabled = state.inFlight;
    if (closeButton) closeButton.disabled = state.inFlight;
    if (placementBanner) {
      placementBanner.innerHTML = state.selectedTemplate && !state.paletteOpen
        ? `<div class="plan-palette-placement-banner" role="status">
            <span>${escape(state.selectedTemplate.templateName)} selected. Choose a future day.</span>
            <button type="button" class="button-secondary" data-plan-palette-action="cancel">Cancel placement</button>
          </div>`
        : "";
    }
  }

  async function loadTemplates(force = false) {
    if (state.templatesStatus === "loading" && !force) return;
    state.abortController?.abort();
    const controller = new AbortController();
    const generation = ++state.requestGeneration;
    state.abortController = controller;
    state.templatesStatus = "loading";
    state.statusMessage = "";
    render();
    try {
      const [categoryPayload, templatePayload] = await Promise.all([
        window.api.fetchPlanCategories(),
        window.api.fetchPlanTemplates(null, 200),
      ]);
      if (generation !== state.requestGeneration || controller.signal.aborted) return;
      state.categories = Array.isArray(categoryPayload?.categories) ? categoryPayload.categories : [];
      state.templates = Array.isArray(templatePayload?.templates) ? templatePayload.templates : [];
      state.templatesStatus = "success";
      state.abortController = null;
      render();
    } catch (error) {
      if (generation !== state.requestGeneration || controller.signal.aborted) return;
      state.templatesStatus = "error";
      state.abortController = null;
      announce("Templates are temporarily unavailable.");
      render();
    }
  }

  function setOpen(open, { focus = true } = {}) {
    state.paletteOpen = open;
    render();
    if (open && focus) {
      window.setTimeout(() => searchInput?.focus(), 0);
    }
    if (!open) {
      trigger?.focus();
    }
  }

  function clearSelection(message = "") {
    draggingRow?.classList.remove("is-dragging");
    draggingRow = null;
    state.selectedTemplate = null;
    state.targetDate = null;
    state.mode = "idle";
    state.inFlight = false;
    state.outcomeRequiresRefresh = false;
    state.errorStatus = null;
    if (message) announce(message);
    render();
    if (typeof onChange === "function") onChange();
    window.PlanController?.setPaletteDragState?.(false);
  }

  function selectTemplate(templateId, { closeMobile = true } = {}) {
    if (state.inFlight) return;
    const template = state.templates.find(row => String(row.plan_template_id) === String(templateId));
    if (!template) return;
    state.selectedTemplate = {
      planTemplateId: Number(template.plan_template_id),
      templateName: String(template.template_name),
    };
    state.targetDate = null;
    state.mode = "selected";
    announce(`${state.selectedTemplate.templateName} selected. Choose a future Plan date.`);
    if (isMobile() && closeMobile) setOpen(false, { focus: false });
    render();
    if (typeof onChange === "function") onChange();
  }

  function currentRangeContains(dateKey) {
    const range = window.PlanController?.getRange?.();
    return Boolean(range?.start && range?.end && dateKey >= range.start && dateKey < range.end);
  }

  function validItem(item) {
    return item
      && item.plan_item_id != null
      && /^\d{4}-\d{2}-\d{2}$/.test(String(item.planned_date || ""))
      && item.item_state
      && item.prescription;
  }

  async function reconcileUnknown() {
    const range = window.PlanController?.getRange?.();
    if (range?.start && range?.end) {
      await window.PlanItemsController?.load?.(range, { force: true });
    }
    clearSelection("Plan refreshed. Review the target date before trying again.");
  }

  async function submit(dateKey) {
    if (
      state.inFlight
      || state.outcomeRequiresRefresh
      || !state.selectedTemplate
      || !isValidTarget(dateKey)
    ) return false;
    state.targetDate = dateKey;
    state.mode = "saving";
    state.inFlight = true;
    announce(`Saving ${state.selectedTemplate.templateName} on ${dateKey}…`);
    render();
    if (typeof onChange === "function") onChange();
    try {
      const item = await window.api.createPlanItemFromTemplate({
        planTemplateId: state.selectedTemplate.planTemplateId,
        plannedDate: dateKey,
        sortOrder: 0,
        userNote: null,
      });
      if (!validItem(item)) {
        throw Object.assign(new Error("Malformed plan item response"), { unknown: true });
      }
      if (currentRangeContains(item.planned_date)) {
        window.PlanItemsController?.acceptCreatedItem?.(item);
      }
      clearSelection(`${state.selectedTemplate.templateName} added on ${item.planned_date}.`);
      return true;
    } catch (error) {
      const statusCode = Number(error?.status || 0);
      if (!statusCode || error?.unknown) {
        state.mode = "unknown";
        state.outcomeRequiresRefresh = true;
        announce("Placement outcome is unknown. Refreshing Plan before retry.");
        render();
        try {
          await reconcileUnknown();
        } catch (_reconcileError) {
          state.inFlight = false;
          state.mode = "error";
          announce("Plan could not be refreshed. Review the target date before trying again.");
          render();
        }
        return false;
      }
      const templateName = state.selectedTemplate.templateName;
      clearSelection(
        statusCode === 400
          ? "That date is no longer available. Choose another future day."
          : statusCode === 404
            ? "This template is no longer available."
            : statusCode === 403
              ? "You do not have permission to add this plan."
              : statusCode === 409
                ? "This plan could not be added because of a conflict."
                : `Unable to add ${templateName}. You can select it again to retry.`,
      );
      if (statusCode === 404) loadTemplates(true);
      return false;
    }
  }

  function targetMarkup(dateKey, dateLabel) {
    if (!state.selectedTemplate || !["selected", "saving"].includes(state.mode) || !isValidTarget(dateKey)) return "";
    const saving = state.mode === "saving" && state.targetDate === dateKey;
    return `
      <button type="button" class="plan-palette-day-target"
        data-plan-palette-target="${escape(dateKey)}"
        aria-label="${escape(`Add ${state.selectedTemplate.templateName} on ${dateLabel}`)}"
        ${saving ? "disabled" : ""}>
        ${saving ? "Saving planned item…" : "+ Add here"}
      </button>`;
  }

  function handleDragStart(event) {
    const templateRowElement = event.target.closest?.("[data-plan-palette-template-id]");
    if (!templateRowElement || state.inFlight) return;
    const templateId = templateRowElement.getAttribute("data-plan-palette-template-id");
    const template = state.templates.find(row => String(row.plan_template_id) === String(templateId));
    if (!template) return;
    draggingRow = templateRowElement;
    draggingRow.classList.add("is-dragging");
    state.selectedTemplate = {
      planTemplateId: Number(template.plan_template_id),
      templateName: String(template.template_name),
    };
    state.targetDate = null;
    state.mode = "dragging";
    state.dragTemplate = {
      planTemplateId: state.selectedTemplate.planTemplateId,
      templateName: state.selectedTemplate.templateName,
    };
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("application/x-training-plan-template-id", String(template.plan_template_id));
    event.dataTransfer.setData("text/plain", String(template.template_name));
    announce(`${template.template_name} ready to place. Drop on a future Plan date.`);
    window.PlanController?.setPaletteDragState?.(true);
  }

  function handleDragEnd() {
    if (state.inFlight) return;
    state.dragTemplate = null;
    draggingRow?.classList.remove("is-dragging");
    draggingRow = null;
    if (state.mode === "dragging") {
      state.mode = state.selectedTemplate ? "selected" : "idle";
      render();
    }
    window.PlanController?.setPaletteDragState?.(false);
  }

  function handleCalendarDrop(dateKey, event) {
    if (state.mode !== "dragging" || state.inFlight || !isValidTarget(dateKey)) return false;
    event.preventDefault();
    submit(dateKey);
    return true;
  }

  function handleCalendarDragOver(dateKey, event) {
    if (state.mode !== "dragging" || state.inFlight || !isValidTarget(dateKey)) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    return true;
  }

  function handleCalendarDragState(mode, dateKey) {
    if (state.mode !== "dragging") return false;
    return isValidTarget(dateKey) && mode;
  }

  function handleClick(event) {
    const action = event.target.closest?.("[data-plan-palette-action]");
    const template = event.target.closest?.("[data-plan-palette-template-id]");
    const target = event.target.closest?.("[data-plan-palette-target]");
    if (target) {
      event.preventDefault();
      submit(target.getAttribute("data-plan-palette-target"));
      return;
    }
    if (template) {
      event.preventDefault();
      selectTemplate(template.getAttribute("data-plan-palette-template-id"));
      return;
    }
    if (!action) return;
    const actionName = action.getAttribute("data-plan-palette-action");
    if (actionName === "cancel") {
      clearSelection("Placement cancelled.");
    } else if (actionName === "retry") {
      loadTemplates(true);
    } else if (actionName === "manage") {
      manageTemplates();
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape" && state.selectedTemplate && !state.inFlight) {
      event.preventDefault();
      clearSelection("Placement cancelled.");
    }
  }

  function openPalette() {
    if (state.inFlight) return;
    setOpen(true);
    loadTemplates(true);
  }

  function manageTemplates() {
    if (state.inFlight) return;
    clearSelection();
    setOpen(false, { focus: false });
    window.PlanTemplateLibraryController?.open?.(manageButton);
  }

  function init(options = {}) {
    if (typeof options.onChange === "function") onChange = options.onChange;
    if (initialized) return true;
    root = document.getElementById("planPalette");
    trigger = document.getElementById("planPaletteOpen");
    closeButton = document.getElementById("planPaletteClose");
    searchInput = document.getElementById("planPaletteSearch");
    categorySelect = document.getElementById("planPaletteCategory");
    status = document.getElementById("planPaletteStatus");
    rows = document.getElementById("planPaletteRows");
    quickRows = document.getElementById("planPaletteQuickRows");
    allTemplates = document.getElementById("planPaletteAllTemplates");
    allTemplatesToggle = document.getElementById("planPaletteAllTemplatesToggle");
    quickEmpty = document.getElementById("planPaletteQuickEmpty");
    manageButton = document.getElementById("planPaletteManage");
    placementBanner = document.getElementById("planPalettePlacement");
    workspace = root?.closest(".plan-workspace");
    if (!root || !trigger || !closeButton || !searchInput || !categorySelect || !status || !rows
      || !quickRows || !allTemplates || !allTemplatesToggle || !quickEmpty || !manageButton || !workspace) {
      return false;
    }
    initialized = true;
    trigger.addEventListener("click", openPalette);
    closeButton.addEventListener("click", () => {
      if (state.selectedTemplate) clearSelection("Placement cancelled.");
      setOpen(false);
    });
    manageButton.addEventListener("click", manageTemplates);
    allTemplatesToggle.addEventListener("click", () => setAllTemplatesExpanded(!state.allTemplatesExpanded));
    root.addEventListener("click", handleClick);
    root.addEventListener("dragstart", handleDragStart);
    root.addEventListener("dragend", handleDragEnd);
    searchInput.addEventListener("input", event => {
      state.searchText = event.target.value;
      render();
    });
    categorySelect.addEventListener("change", event => {
      state.categoryId = event.target.value;
      render();
    });
    document.addEventListener("click", event => {
      if (event.target.closest?.("[data-plan-palette-target]")) handleClick(event);
    });
    document.addEventListener("keydown", handleKeydown);
    render();
    return true;
  }

  window.PlanPaletteController = {
    init,
    open: openPalette,
    close: () => setOpen(false),
    deactivate: () => {
      state.requestGeneration += 1;
      state.abortController?.abort();
      clearSelection();
      setOpen(false, { focus: false });
    },
    targetMarkup,
    handleCalendarDrop,
    handleCalendarDragOver,
    handleCalendarDragState,
    setAllTemplatesExpanded,
    getState: () => ({
      ...state,
      templates: [...state.templates],
      selectedTemplate: state.selectedTemplate ? { ...state.selectedTemplate } : null,
    }),
  };

  if (typeof document !== "undefined") {
    const initializeWhenReady = () => init({
      onChange: () => window.PlanController?.render?.(),
    });
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initializeWhenReady, { once: true });
    } else {
      initializeWhenReady();
    }
  }
})();
