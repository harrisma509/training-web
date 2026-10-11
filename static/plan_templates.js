(function () {
  const SPORT_CHOICES = [
    ["Ride", "Ride"],
    ["Virtual Ride", "VirtualRide"],
    ["Mountain Bike Ride", "MountainBikeRide"],
    ["Gravel Ride", "GravelRide"],
    ["Run", "Run"],
    ["Trail Run", "TrailRun"],
    ["Walk", "Walk"],
    ["Hike", "Hike"],
    ["Strength", "Strength"],
    ["Workout", "Workout"],
    ["Mobility", "Mobility"],
    ["Recovery", "Recovery"],
  ];
  const ACTIVITY_CHOICES = [
    ["Ride", "Ride"],
    ["Run", "Run"],
    ["Strength", "Strength"],
    ["Mobility", "Mobility"],
    ["Recovery", "Recovery"],
    ["Rest", "Rest"],
  ];
  const EMPTY_DETAIL = {
    template_name: "",
    template_description: null,
    sort_order: 0,
    category: null,
    is_active: true,
    prescription: {
      title: "",
      description: null,
      sport_type: null,
      activity_category: null,
      trainer: null,
      target_duration_min: null,
      target_load: null,
      target_load_source: null,
      target_distance_mi: null,
      target_elevation_ft: null,
      instruction_text: null,
      segments: [],
    },
  };

  const state = {
    open: false,
    view: "library",
    categories: { status: "idle", rows: [], error: null },
    templates: { status: "idle", rows: [], categoryId: null, error: null },
    selectedTemplateId: null,
    detail: { status: "idle", confirmed: null, error: null },
    draft: null,
    dirty: false,
    saving: false,
    deactivating: false,
    formErrors: {},
    formMessage: "",
    generation: 0,
    categoriesGeneration: 0,
    templatesGeneration: 0,
    detailGeneration: 0,
    surface: null,
    initialized: false,
  };

  let root;
  let content;
  let trigger;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function display(value, fallback = "") {
    return value === null || value === undefined || value === "" ? fallback : String(value);
  }

  function numberValue(value) {
    if (value === null || value === undefined || value === "") return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function textValue(value) {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed || null;
  }

  function isKnownChoice(value, choices) {
    return choices.some(([, optionValue]) => optionValue === value);
  }

  function optionMarkup(choices, value, label) {
    const custom = value && value !== "__custom__" && !isKnownChoice(value, choices);
    const options = [
      `<option value="">Not specified</option>`,
      ...choices.map(([optionLabel, optionValue]) =>
        `<option value="${escapeHtml(optionValue)}" ${value === optionValue ? "selected" : ""}>${escapeHtml(optionLabel)}</option>`),
      custom
        ? `<option value="__custom__" selected>Existing: ${escapeHtml(value)}</option>`
        : `<option value="__custom__" ${value === "__custom__" ? "selected" : ""}>Custom</option>`,
    ];
    return options.join("");
  }

  function fieldError(field) {
    const message = state.formErrors[field];
    return message
      ? `<div id="plan-template-error-${escapeHtml(field)}" class="plan-template-field-error" role="alert">${escapeHtml(message)}</div>`
      : "";
  }

  function describedBy(field) {
    return state.formErrors[field] ? ` aria-describedby="plan-template-error-${escapeHtml(field)}"` : "";
  }

  function statusMarkup() {
    if (!state.formMessage) return "";
    const role = state.formMessage.toLowerCase().includes("unavailable") ? "alert" : "status";
    return `<div class="plan-template-status" role="${role}" aria-live="polite">${escapeHtml(state.formMessage)}</div>`;
  }

  function categoryOptions(selected) {
    return [
      `<option value="">Select a category</option>`,
      ...state.categories.rows.map(row =>
        `<option value="${row.plan_category_id}" ${Number(selected) === Number(row.plan_category_id) ? "selected" : ""}>${escapeHtml(row.category_name)}</option>`),
    ].join("");
  }

  function segmentSummary(segments) {
    if (!Array.isArray(segments) || segments.length === 0) return "";
    const names = segments
      .map(segment => segment.segment_name || segment.target_metric || "Structured segment")
      .slice(0, 3)
      .map(escapeHtml)
      .join(", ");
    const suffix = segments.length > 3 ? "…" : "";
    return `
      <section class="plan-template-segment-summary" aria-label="Preserved structured segments">
        <strong>${segments.length} structured segment${segments.length === 1 ? "" : "s"}</strong>
        <span>${names}${suffix}</span>
        <small>Structured segments are preserved during scalar edits.</small>
      </section>`;
  }

  function cardMarkup(row) {
    const prescription = row.prescription || {};
    const details = [];
    if (prescription.sport_type) details.push(escapeHtml(prescription.sport_type));
    if (prescription.target_duration_min !== null && prescription.target_duration_min !== undefined) {
      details.push(`${escapeHtml(prescription.target_duration_min)} min`);
    }
    if (prescription.target_load !== null && prescription.target_load !== undefined) {
      details.push(`Load ${escapeHtml(prescription.target_load)}`);
    }
    if (prescription.segment_count > 0) {
      details.push(`${escapeHtml(prescription.segment_count)} segments`);
    }
    return `
      <article class="plan-template-card">
        <div class="plan-template-card-main">
          <h3>${escapeHtml(row.template_name)}</h3>
          <div class="plan-template-card-meta">
            <span>${escapeHtml(row.category?.category_name || "Uncategorized")}</span>
            ${prescription.trainer === true ? '<span class="plan-template-badge">Trainer</span>' : ""}
          </div>
          ${details.length ? `<div class="plan-template-card-details">${details.join(" · ")}</div>` : ""}
          ${prescription.description || row.template_description
            ? `<p>${escapeHtml(prescription.description || row.template_description)}</p>` : ""}
        </div>
        <button type="button" class="button-secondary plan-template-edit-button"
          data-plan-template-action="edit" data-template-id="${row.plan_template_id}">Edit</button>
      </article>`;
  }

  function libraryMarkup() {
    const templates = state.templates;
    let body;
    if (templates.status === "loading") {
      body = '<div class="plan-template-state" role="status" aria-live="polite">Loading templates…</div>';
    } else if (templates.status === "error") {
      body = `
        <div class="plan-template-state plan-template-state-error" role="alert">
          <p>Templates are temporarily unavailable.</p>
          <button type="button" class="button-secondary" data-plan-template-action="retry-templates">Retry</button>
        </div>`;
    } else if (templates.rows.length === 0) {
      const filtered = templates.categoryId !== null;
      body = `
        <div class="plan-template-state">
          <h3>${filtered ? "No templates in this category" : "No templates yet"}</h3>
          <p>${filtered ? "Try another category or create a reusable template." : "Create a reusable template to get started."}</p>
          <button type="button" class="button-primary" data-plan-template-action="create">Create template</button>
        </div>`;
    } else {
      body = `<div class="plan-template-card-list" aria-live="polite">${templates.rows.map(cardMarkup).join("")}</div>`;
    }
    return `
      <div class="plan-template-library-header">
        <div>
          <h2 tabindex="-1">Template Library</h2>
          <p>Reusable planned-workout templates</p>
        </div>
        <button type="button" class="drawer-close-button" aria-label="Close Template Library"
          data-plan-template-action="close">×</button>
      </div>
      <div class="plan-template-library-body">
        ${statusMarkup()}
        <div class="plan-template-library-controls">
          <label for="planTemplateCategoryFilter">Category</label>
          <select id="planTemplateCategoryFilter" data-plan-template-field="category-filter"
            ${state.categories.status !== "ready" ? "disabled" : ""}>
            <option value="">All categories</option>
            ${state.categories.rows.map(row =>
              `<option value="${row.plan_category_id}" ${Number(state.templates.categoryId) === Number(row.plan_category_id) ? "selected" : ""}>${escapeHtml(row.category_name)}</option>`).join("")}
          </select>
          <button type="button" class="button-primary" data-plan-template-action="create">Create template</button>
        </div>
        ${state.categories.status === "loading" ? '<div class="plan-template-state" role="status">Loading categories…</div>' : ""}
        ${state.categories.status === "error" ? `
          <div class="plan-template-state plan-template-state-error" role="alert">
            <p>Categories are temporarily unavailable.</p>
            <button type="button" class="button-secondary" data-plan-template-action="retry-categories">Retry</button>
          </div>` : ""}
        ${body}
      </div>`;
  }

  function inputMarkup({ field, label, value, type = "text", required = false, step, min, textarea = false }) {
    const attrs = [
      `name="${escapeHtml(field)}"`,
      `id="plan-template-${escapeHtml(field)}"`,
      `data-plan-template-field="${escapeHtml(field)}"`,
      describedBy(field),
      required ? "required" : "",
      step ? `step="${step}"` : "",
      min ? `min="${min}"` : "",
    ].join(" ");
    const element = textarea
      ? `<textarea ${attrs} rows="3">${escapeHtml(display(value))}</textarea>`
      : `<input ${attrs} type="${type}" value="${escapeHtml(display(value))}">`;
    return `<div class="plan-template-field">
      <label for="plan-template-${escapeHtml(field)}">${escapeHtml(label)}${required ? " *" : ""}</label>
      ${element}
      ${fieldError(field)}
    </div>`;
  }

  function selectMarkup({ field, label, value, options, required = false }) {
    return `<div class="plan-template-field">
      <label for="plan-template-${escapeHtml(field)}">${escapeHtml(label)}${required ? " *" : ""}</label>
      <select id="plan-template-${escapeHtml(field)}" name="${escapeHtml(field)}"
        data-plan-template-field="${escapeHtml(field)}"${required ? " required" : ""}${describedBy(field)}>
        ${options}
      </select>
      ${fieldError(field)}
    </div>`;
  }

  function editorMarkup() {
    if (state.detail.status === "loading") {
      return '<div class="plan-template-state" role="status" aria-live="polite">Loading template…</div>';
    }
    if (state.detail.status === "error") {
      return `
        <div class="plan-template-state plan-template-state-error" role="alert">
          <p>The selected template is no longer available.</p>
          <button type="button" class="button-secondary" data-plan-template-action="back">Back to templates</button>
        </div>`;
    }

    const draft = state.draft || EMPTY_DETAIL;
    const prescription = draft.prescription || EMPTY_DETAIL.prescription;
    const sportCustom = prescription.sport_type === "__custom__"
      || (prescription.sport_type && !isKnownChoice(prescription.sport_type, SPORT_CHOICES));
    const activityCustom = prescription.activity_category === "__custom__"
      || (prescription.activity_category && !isKnownChoice(prescription.activity_category, ACTIVITY_CHOICES));
    const customSport = sportCustom && prescription.sport_type !== "__custom__" ? prescription.sport_type : "";
    const customActivity = activityCustom && prescription.activity_category !== "__custom__"
      ? prescription.activity_category
      : "";
    const title = state.view === "create" ? "Create Template" : "Edit Template";
    return `
      <div class="plan-template-editor-header">
        <button type="button" class="button-secondary" data-plan-template-action="back">Back to templates</button>
        <div>
          <h2 tabindex="-1">${title}</h2>
          ${state.dirty ? '<span class="plan-template-dirty">Unsaved changes</span>' : ""}
        </div>
        <button type="button" class="drawer-close-button" aria-label="Close Template Editor"
          data-plan-template-action="close">×</button>
      </div>
      <form id="planTemplateForm" class="plan-template-form" novalidate>
        ${statusMarkup()}
        <fieldset>
          <legend>Template</legend>
          ${inputMarkup({ field: "template_name", label: "Template name", value: draft.template_name, required: true })}
          ${selectMarkup({ field: "category_id", label: "Category", value: draft.category?.plan_category_id || draft.category_id, options: categoryOptions(draft.category?.plan_category_id || draft.category_id), required: true })}
          ${inputMarkup({ field: "template_description", label: "Description", value: draft.template_description, textarea: true })}
        </fieldset>
        <fieldset>
          <legend>Prescription</legend>
          ${inputMarkup({ field: "title", label: "Prescription title", value: prescription.title, required: true })}
          ${inputMarkup({ field: "description", label: "Prescription description", value: prescription.description, textarea: true })}
          ${selectMarkup({ field: "sport_type", label: "Sport", value: sportCustom ? "__custom__" : prescription.sport_type, options: optionMarkup(SPORT_CHOICES, prescription.sport_type) })}
          ${sportCustom ? inputMarkup({ field: "sport_type_custom", label: "Custom sport", value: customSport }) : ""}
          ${selectMarkup({ field: "activity_category", label: "Activity category", value: activityCustom ? "__custom__" : prescription.activity_category, options: optionMarkup(ACTIVITY_CHOICES, prescription.activity_category) })}
          ${activityCustom ? inputMarkup({ field: "activity_category_custom", label: "Custom activity category", value: customActivity }) : ""}
          ${selectMarkup({ field: "trainer", label: "Trainer", value: prescription.trainer === null ? "" : String(prescription.trainer), options: '<option value="">Not specified</option><option value="false">No</option><option value="true">Yes</option>' })}
          ${inputMarkup({ field: "target_duration_min", label: "Target duration (minutes)", value: prescription.target_duration_min, type: "number", step: "0.01", min: "0" })}
          ${inputMarkup({ field: "target_load", label: "Target load", value: prescription.target_load, type: "number", step: "1", min: "0" })}
          ${inputMarkup({ field: "target_distance_mi", label: "Target distance (miles)", value: prescription.target_distance_mi, type: "number", step: "0.001", min: "0" })}
          ${inputMarkup({ field: "target_elevation_ft", label: "Target elevation (feet)", value: prescription.target_elevation_ft, type: "number", step: "1", min: "0" })}
          ${inputMarkup({ field: "instruction_text", label: "Instructions", value: prescription.instruction_text, textarea: true })}
        </fieldset>
        ${segmentSummary(prescription.segments)}
        <div class="plan-template-form-actions">
          ${state.view === "edit" ? `<button type="button" class="button-danger" data-plan-template-action="deactivate"${state.saving || state.deactivating ? " disabled" : ""}>Deactivate template</button>` : ""}
          <span class="plan-template-form-spacer"></span>
          <button type="button" class="button-secondary" data-plan-template-action="back" ${state.saving ? "disabled" : ""}>Cancel</button>
          <button type="submit" class="button-primary" ${state.saving || state.deactivating ? "disabled" : ""}>${state.saving ? "Saving…" : "Save template"}</button>
        </div>
      </form>`;
  }

  function render() {
    if (!content) return;
    content.innerHTML = state.view === "library" ? libraryMarkup() : editorMarkup();
    root.setAttribute("aria-hidden", state.open ? "false" : "true");
    trigger?.setAttribute("aria-expanded", state.open ? "true" : "false");
  }

  function setOpen(open) {
    state.open = open;
    root.classList.toggle("hidden", !open);
    root.setAttribute("aria-hidden", open ? "false" : "true");
    trigger?.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function focusSurface() {
    window.setTimeout(() => {
      const target = content?.querySelector("h2, input, select, button");
      target?.focus();
    }, 0);
  }

  function resetEditor() {
    state.detail = { status: "idle", confirmed: null, error: null };
    state.draft = null;
    state.dirty = false;
    state.formErrors = {};
    state.formMessage = "";
  }

  function openLibrary(opener = trigger) {
    state.view = "library";
    state.formMessage = "";
    state.generation += 1;
    state.surface?.open({ opener });
    setOpen(true);
    render();
    focusSurface();
    if (state.categories.status === "idle" || state.templates.status === "idle") {
      loadCategories();
    }
  }

  function close(reason = "close") {
    if (!state.open) return true;
    state.generation += 1;
    state.surface?.close(reason);
    setOpen(false);
    resetEditor();
    trigger?.focus();
    return true;
  }

  function canDeactivate() {
    if (!state.open || !state.dirty) return true;
    return window.confirm("Discard unsaved template changes?");
  }

  function deactivate() {
    if (state.open) close("feature-deactivate");
  }

  async function loadCategories() {
    const generation = ++state.categoriesGeneration;
    state.categories = { ...state.categories, status: "loading", error: null };
    render();
    try {
      const payload = await window.api.fetchPlanCategories();
      if (generation !== state.categoriesGeneration || !state.open) return;
      state.categories = { status: "ready", rows: Array.isArray(payload?.categories) ? payload.categories : [], error: null };
      if (state.templates.status === "idle") await loadTemplates(state.templates.categoryId);
      else {
        render();
        focusSurface();
      }
    } catch (error) {
      if (generation !== state.categoriesGeneration || !state.open) return;
      state.categories = { ...state.categories, status: "error", error };
      render();
      focusSurface();
    }
  }

  async function loadTemplates(categoryId = null) {
    const generation = ++state.templatesGeneration;
    state.templates = { ...state.templates, status: "loading", categoryId, error: null };
    render();
    try {
      const payload = await window.api.fetchPlanTemplates(categoryId, 200);
      if (generation !== state.templatesGeneration || !state.open) return;
      state.templates = {
        status: "ready",
        rows: Array.isArray(payload?.templates) ? payload.templates : [],
        categoryId,
        error: null,
      };
      render();
      focusSurface();
    } catch (error) {
      if (generation !== state.templatesGeneration || !state.open) return;
      state.templates = { ...state.templates, status: "error", categoryId, error };
      render();
      focusSurface();
    }
  }

  function draftFromDetail(detail) {
    return {
      ...detail,
      category_id: detail.category?.plan_category_id || null,
      prescription: { ...detail.prescription, segments: detail.prescription?.segments || [] },
    };
  }

  async function openEditor(templateId) {
    if (state.dirty && !canDeactivate()) return;
    state.view = "edit";
    state.selectedTemplateId = Number(templateId);
    state.detail = { status: "loading", confirmed: null, error: null };
    state.draft = null;
    state.dirty = false;
    state.formErrors = {};
    state.formMessage = "";
    const generation = ++state.detailGeneration;
    render();
    try {
      const detail = await window.api.fetchPlanTemplate(templateId);
      if (generation !== state.detailGeneration || !state.open) return;
      state.detail = { status: "ready", confirmed: detail, error: null };
      state.draft = draftFromDetail(detail);
      render();
      focusSurface();
    } catch (error) {
      if (generation !== state.detailGeneration || !state.open) return;
      state.detail = { status: "error", confirmed: null, error };
      state.formMessage = error.status === 404 ? "This template is no longer available." : "Templates are temporarily unavailable.";
      render();
    }
  }

  function openCreate() {
    if (state.dirty && !canDeactivate()) return;
    state.view = "create";
    state.selectedTemplateId = null;
    state.detail = { status: "ready", confirmed: null, error: null };
    state.draft = JSON.parse(JSON.stringify(EMPTY_DETAIL));
    state.dirty = false;
    state.formErrors = {};
    state.formMessage = "";
    render();
    focusSurface();
  }

  function updateDraftField(field, value) {
    if (!state.draft) return;
    const prescriptionFields = new Set([
      "title", "description", "sport_type", "activity_category", "trainer",
      "target_duration_min", "target_load", "target_distance_mi",
      "target_elevation_ft", "instruction_text",
    ]);
    if (field === "category_id") {
      state.draft.category_id = value ? Number(value) : null;
    } else if (field === "sport_type_custom") {
      state.draft.prescription.sport_type = value;
    } else if (field === "activity_category_custom") {
      state.draft.prescription.activity_category = value;
    } else if (prescriptionFields.has(field)) {
      state.draft.prescription[field] = field === "trainer"
        ? (value === "" ? null : value === "true")
        : ["target_duration_min", "target_load", "target_distance_mi", "target_elevation_ft"].includes(field)
          ? numberValue(value)
          : value;
    } else {
      state.draft[field] = value;
    }
    state.dirty = true;
    state.formMessage = "";
  }

  function buildPayload() {
    const draft = state.draft;
    const confirmed = state.detail.confirmed;
    const prescription = draft.prescription;
    return {
      template_name: String(draft.template_name || "").trim(),
      template_description: textValue(draft.template_description),
      category_id: Number(draft.category_id),
      sort_order: confirmed?.sort_order ?? 0,
      prescription: {
        title: String(prescription.title || "").trim(),
        description: textValue(prescription.description),
          sport_type: textValue(prescription.sport_type === "__custom__" ? null : prescription.sport_type),
          activity_category: textValue(prescription.activity_category === "__custom__" ? null : prescription.activity_category),
        trainer: prescription.trainer === null || prescription.trainer === undefined ? null : Boolean(prescription.trainer),
        target_duration_min: prescription.target_duration_min ?? null,
        target_load: prescription.target_load ?? null,
        target_load_source: confirmed?.prescription?.target_load_source ?? null,
        target_distance_mi: prescription.target_distance_mi ?? null,
        target_elevation_ft: prescription.target_elevation_ft ?? null,
        instruction_text: textValue(prescription.instruction_text),
      },
      segments: state.view === "create"
        ? []
        : (confirmed?.prescription?.segments || []).map(segment => ({ ...segment })),
    };
  }

  function validateDraft() {
    const draft = state.draft;
    const prescription = draft?.prescription || {};
    const errors = {};
    if (!String(draft?.template_name || "").trim()) errors.template_name = "Template name is required.";
    if (!draft?.category_id) errors.category_id = "Select a category.";
    if (!String(prescription.title || "").trim()) errors.title = "Prescription title is required.";
    for (const field of ["target_duration_min", "target_load", "target_distance_mi", "target_elevation_ft"]) {
      if (prescription[field] !== null && prescription[field] !== undefined
        && (!Number.isFinite(Number(prescription[field])) || Number(prescription[field]) < 0)) {
        errors[field] = "Enter zero or a positive number.";
      }
    }
    state.formErrors = errors;
    return Object.keys(errors).length === 0;
  }

  function applyApiError(error) {
    state.formErrors = {};
    if (error.status === 422 && Array.isArray(error.detail)) {
      for (const item of error.detail) {
        const location = Array.isArray(item?.loc) ? item.loc : [];
        const field = location[location.length - 1];
        if (typeof field === "string" && field !== "body") {
          state.formErrors[field] = item.msg || "Check this field.";
        }
      }
    }
    state.formMessage = error.status === 403
      ? "This action is not allowed from the current origin."
      : error.status === 409
        ? "This template changed or is not owned by the template library. Refresh and try again."
        : error.status === 503
          ? "Templates are temporarily unavailable."
          : error.status === 404
            ? "This template is no longer available."
            : error.status === 400
              ? (typeof error.detail === "string" ? error.detail : "Check the template values.")
              : "Check the highlighted fields and try again.";
  }

  async function save() {
    if (!validateDraft()) {
      state.formMessage = "Check the highlighted fields.";
      render();
      focusSurface();
      return;
    }
    state.saving = true;
    state.formMessage = "Saving…";
    render();
    try {
      const payload = buildPayload();
      const detail = state.view === "create"
        ? await window.api.createPlanTemplate(payload)
        : await window.api.updatePlanTemplate(state.selectedTemplateId, payload);
      state.detail = { status: "ready", confirmed: detail, error: null };
      state.draft = draftFromDetail(detail);
      state.dirty = false;
      state.formMessage = "Saved.";
      state.saving = false;
      const wasCreate = state.view === "create";
      if (wasCreate) {
        state.selectedTemplateId = detail.plan_template_id;
        state.view = "library";
      }
      await loadTemplates(state.templates.categoryId);
      if (!wasCreate) state.view = "edit";
      render();
      focusSurface();
    } catch (error) {
      state.saving = false;
      applyApiError(error);
      render();
      focusSurface();
    }
  }

  async function deactivateTemplate() {
    if (!state.selectedTemplateId || state.deactivating || !window.confirm("Deactivate this template?\nIt will leave the active library while existing uses and provenance remain.")) {
      return;
    }
    state.deactivating = true;
    state.formMessage = "Deactivating…";
    render();
    try {
      await window.api.deactivatePlanTemplate(state.selectedTemplateId);
      state.deactivating = false;
      resetEditor();
      state.view = "library";
      state.formMessage = "Template deactivated.";
      await loadTemplates(state.templates.categoryId);
      render();
      focusSurface();
    } catch (error) {
      state.deactivating = false;
      applyApiError(error);
      render();
      focusSurface();
    }
  }

  function handleClick(event) {
    const actionElement = event.target.closest?.("[data-plan-template-action]");
    if (!actionElement) return;
    const action = actionElement.dataset.planTemplateAction;
    if (action === "backdrop") {
      if (canDeactivate()) close("backdrop");
    } else if (action === "close") {
      if (canDeactivate()) close("close-button");
    } else if (action === "create") {
      openCreate();
    } else if (action === "edit") {
      openEditor(actionElement.dataset.templateId);
    } else if (action === "back") {
      if (canDeactivate()) {
        state.view = "library";
        resetEditor();
        render();
        focusSurface();
      }
    } else if (action === "retry-categories") {
      loadCategories();
    } else if (action === "retry-templates") {
      loadTemplates(state.templates.categoryId);
    } else if (action === "deactivate") {
      deactivateTemplate();
    }
  }

  function handleChange(event) {
    const field = event.target.dataset.planTemplateField;
    if (!field) return;
    if (field === "category-filter") {
      loadTemplates(event.target.value ? Number(event.target.value) : null);
      return;
    }
    updateDraftField(field, event.target.value);
    if (field === "sport_type" || field === "activity_category") {
      if (value === "__custom__") {
        state.draft.prescription[field] = "__custom__";
      }
      render();
      focusSurface();
    }
  }

  function handleInput(event) {
    const field = event.target.dataset.planTemplateField;
    if (field && field !== "category-filter") updateDraftField(field, event.target.value);
  }

  function trapFocus(event) {
    if (!state.open || event.key !== "Tab") return;
    const focusable = Array.from(content.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])"))
      .filter(element => !element.disabled && element.offsetParent !== null);
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

  function handleKeydown(event) {
    if (!state.open) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (canDeactivate()) close("escape");
      return;
    }
    trapFocus(event);
  }

  function init() {
    if (state.initialized) return true;
    root = document.getElementById("planTemplateLibrary");
    content = document.getElementById("planTemplateLibraryContent");
    trigger = document.getElementById("planTemplateLibraryOpen");
    if (!root || !content || !trigger) return false;
    state.initialized = true;
    state.surface = window.TrainingApp?.TransientSurface?.create?.({
      getSurface: () => root,
      canClose: () => canDeactivate(),
      onBeforeClose: () => setOpen(false),
    });
    trigger.addEventListener("click", () => openLibrary(trigger));
    root.addEventListener("click", handleClick);
    root.addEventListener("change", handleChange);
    root.addEventListener("input", handleInput);
    content.addEventListener("submit", event => {
      if (event.target.id === "planTemplateForm") {
        event.preventDefault();
        save();
      }
    });
    document.addEventListener("keydown", handleKeydown);
    render();
    return true;
  }

  window.PlanTemplateLibraryController = {
    init,
    open: openLibrary,
    close,
    canDeactivate,
    deactivate,
    getState: () => state,
  };
})();
