(function () {
  const ITEM_DRAG_MIME = "application/x-training-plan-item-id";
  const PLAN_TIME_ZONE = "America/Denver";
  const state = {
    item: null,
    mode: "idle",
    saving: false,
    error: "",
    categories: [],
    opener: null,
  };
  let panel;
  let form;
  let status;
  let initialized = false;

  function renderCalendar() {
    window.PlanController?.render?.();
  }

  function escape(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function todayKey() {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: PLAN_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function formatFullDate(dateKey) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: PLAN_TIME_ZONE,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(`${dateKey}T12:00:00Z`));
  }

  function value(name, fallback = "") {
    return form?.elements?.namedItem(name)?.value ?? fallback;
  }

  function numberOrNull(raw) {
    if (raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function itemPayload(plannedDate = value("planned_date")) {
    const item = state.item;
    const prescription = item.prescription || {};
    const sportTypeField = form?.elements?.namedItem("sport_type");
    const enteredSportType = value("sport_type", prescription.sport_type || "").trim();
    const sportType = sportTypeField?.dataset?.canonicalValue
      && enteredSportType === sportTypeField.dataset.presentationLabel
      ? sportTypeField.dataset.canonicalValue
      : enteredSportType || null;
    let segments;
    try {
      segments = JSON.parse(value("segments", "[]"));
    } catch {
      throw new Error("Segments must be valid JSON.");
    }
    if (!Array.isArray(segments)) {
      throw new Error("Segments must be a JSON array.");
    }
    return {
      planned_date: plannedDate,
      sort_order: Number(value("sort_order", item.sort_order || 0)),
      category_id: Number(value("category_id", item.category?.plan_category_id)),
      user_note: value("user_note").trim() || null,
      prescription: {
        title: value("title", prescription.title).trim(),
        description: value("description", prescription.description || "").trim() || null,
        sport_type: sportType,
        activity_category: value("activity_category", prescription.activity_category || "").trim() || null,
        trainer: value("trainer", prescription.trainer == null ? "" : String(prescription.trainer)) === ""
          ? null : value("trainer") === "true",
        target_duration_min: numberOrNull(value("target_duration_min", prescription.target_duration_min ?? "")),
        target_load: numberOrNull(value("target_load", prescription.target_load ?? "")),
        target_load_source: value("target_load_source", prescription.target_load_source || "").trim() || null,
        target_distance_mi: numberOrNull(value("target_distance_mi", prescription.target_distance_mi ?? "")),
        target_elevation_ft: numberOrNull(value("target_elevation_ft", prescription.target_elevation_ft ?? "")),
        instruction_text: value("instruction_text", prescription.instruction_text || "").trim() || null,
      },
      segments,
    };
  }

  function render() {
    if (!panel) return;
    panel.hidden = state.mode === "idle";
    panel.classList.toggle("is-moving", state.mode === "moving");
    if (state.mode === "idle") return;
    const item = state.item;
    const prescription = item.prescription || {};
    const rawSportType = prescription.sport_type || "";
    const sportLabel = window.ActivityPresentation?.getActivityTypeLabel(rawSportType);
    const displayedSportType = sportLabel || rawSportType;
    const sportPresentationAttributes = sportLabel && sportLabel !== rawSportType
      ? `data-canonical-value="${escape(rawSportType)}" data-presentation-label="${escape(sportLabel)}"`
      : "";
    const categoryRows = state.categories.length ? state.categories : (item.category ? [item.category] : []);
    const categories = categoryRows.map(category =>
      `<option value="${escape(category.plan_category_id)}" ${String(category.plan_category_id) === String(item.category?.plan_category_id) ? "selected" : ""}>${escape(category.category_name)}</option>`).join("");
    panel.innerHTML = `
      <div class="plan-item-editor-header">
        <div><h2 id="planItemEditorTitle">${state.mode === "moving" ? "Move planned item" : "Edit planned item"}</h2>
        <p>${escape(prescription.title || "Untitled planned item")}</p></div>
        <button type="button" class="drawer-close-button" data-plan-item-editor-action="close" aria-label="Close planned item editor">×</button>
      </div>
      <div class="plan-item-editor-body">
        <div class="plan-item-editor-status" role="status" aria-live="polite">${escape(state.error || (state.mode === "moving" ? "Choose a future day." : ""))}</div>
        ${state.mode === "moving" ? `<p class="plan-item-editor-help">Choose a future day in the calendar, or update the planned date.</p>` : ""}
        <form id="planItemEditorForm" class="plan-item-editor-form">
          <label>Planned date<input name="planned_date" type="date" value="${escape(item.planned_date)}" required></label>
          <label>Category<select name="category_id" required>${categories}</select></label>
          <label>Sort order<input name="sort_order" type="number" min="0" step="1" value="${escape(item.sort_order ?? 0)}"></label>
          <label>Title<input name="title" maxlength="200" required value="${escape(prescription.title)}"></label>
          <label>Description<textarea name="description" maxlength="2000">${escape(prescription.description || "")}</textarea></label>
          <label>Sport type<input name="sport_type" maxlength="100" value="${escape(displayedSportType)}" ${sportPresentationAttributes}></label>
          <label>Activity category<input name="activity_category" maxlength="100" value="${escape(prescription.activity_category || "")}"></label>
          <label>Trainer<select name="trainer"><option value="">Not specified</option><option value="true" ${prescription.trainer === true ? "selected" : ""}>Yes</option><option value="false" ${prescription.trainer === false ? "selected" : ""}>No</option></select></label>
          <label>Duration (min)<input name="target_duration_min" type="number" min="0" step="0.01" value="${escape(prescription.target_duration_min ?? "")}"></label>
          <label>Target load<input name="target_load" type="number" min="0" step="1" value="${escape(prescription.target_load ?? "")}"></label>
          <label>Target load source<input name="target_load_source" maxlength="100" value="${escape(prescription.target_load_source || "")}"></label>
          <label>Distance (mi)<input name="target_distance_mi" type="number" min="0" step="0.001" value="${escape(prescription.target_distance_mi ?? "")}"></label>
          <label>Elevation (ft)<input name="target_elevation_ft" type="number" min="0" step="1" value="${escape(prescription.target_elevation_ft ?? "")}"></label>
          <label>Instruction<textarea name="instruction_text" maxlength="4000">${escape(prescription.instruction_text || "")}</textarea></label>
          <label>User note<textarea name="user_note" maxlength="4000">${escape(item.user_note || "")}</textarea></label>
          <label>Segments JSON<textarea name="segments" aria-describedby="planItemEditorSegmentsHelp">${escape(JSON.stringify(prescription.segments || [], null, 2))}</textarea></label>
          <small id="planItemEditorSegmentsHelp">Structured segments are replaced atomically. Preserve the existing shape when editing them.</small>
          <div class="plan-item-editor-actions">
            <div class="plan-item-editor-primary-actions">
              <button type="submit" class="button-primary" ${state.saving || state.mode === "moving" ? "disabled" : ""}>Save changes</button>
              <button type="button" class="button-secondary" data-plan-item-editor-action="move" ${state.saving ? "disabled" : ""}>Move</button>
            </div>
            <button type="button" class="button-danger plan-item-editor-delete" data-plan-item-editor-action="cancel" ${state.saving ? "disabled" : ""}>Delete from plan</button>
          </div>
        </form>
      </div>`;
    form = panel.querySelector("#planItemEditorForm");
    status = panel.querySelector(".plan-item-editor-status");
  }

  async function loadCategories() {
    if (state.categories.length || !window.api?.fetchPlanCategories) return;
    const payload = await window.api.fetchPlanCategories();
    state.categories = Array.isArray(payload?.categories) ? payload.categories : [];
  }

  function open(item, opener, mode = "edit", refreshCalendar = mode === "moving") {
    if (!item || item.item_state !== "committed" || item.planned_date <= todayKey()) return false;
    state.item = item;
    state.opener = opener || null;
    state.mode = mode;
    state.error = "";
    render();
    loadCategories().then(() => {
      if (state.item !== item || !form) return;
      const select = form.elements.namedItem("category_id");
      if (!select) return;
      const selected = select.value || String(item.category?.plan_category_id || "");
      select.innerHTML = state.categories.map(category =>
        `<option value="${escape(category.plan_category_id)}">${escape(category.category_name)}</option>`).join("");
      select.value = selected;
    }).catch(() => {
      state.error = "Categories are temporarily unavailable.";
      render();
    });
    if (refreshCalendar) renderCalendar();
    panel?.querySelector("input, select, textarea, button")?.focus();
    return true;
  }

  function close(force = false) {
    if (!force && form && state.mode === "edit") {
      const current = JSON.stringify(itemPayload());
      const original = JSON.stringify(itemPayload(state.item.planned_date));
      if (current !== original && !window.confirm("Discard unsaved planned-item changes?")) return false;
    }
    const itemId = state.item?.plan_item_id;
    const opener = state.opener;
    state.item = null;
    state.mode = "idle";
    state.error = "";
    render();
    renderCalendar();
    if (opener?.isConnected !== false && opener) {
      opener.focus?.();
    } else {
      const cards = Array.from(
        document.querySelectorAll?.(".plan-planned-card[data-plan-item-id]") || [],
      );
      const movedCard = cards.find(card => String(card.dataset.planItemId) === String(itemId));
      (movedCard || document.getElementById("planDateJump"))?.focus?.();
    }
    state.opener = null;
    return true;
  }

  async function submit(payload) {
    if (state.saving) return;
    state.saving = true;
    state.error = "Saving planned item…";
    render();
    try {
      const item = await window.api.updatePlanItem(state.item.plan_item_id, payload);
      window.PlanItemsController?.replaceItem?.(item);
      close(true);
    } catch (error) {
      state.error = error?.status ? (error.detail || "Unable to save planned item.") : "The outcome is unknown. Review the calendar before retrying.";
      if (!error?.status) await window.PlanController?.refresh?.();
      render();
    } finally {
      state.saving = false;
    }
  }

  async function cancelItem() {
    if (state.saving || !state.item) return;
    const title = state.item.prescription?.title || "this planned item";
    const date = formatFullDate(state.item.planned_date);
    if (!window.confirm(
      `Delete ${title} from the plan for ${date}?\nThis removes the item from the active Plan calendar.`,
    )) return;
    state.saving = true;
    state.error = "Cancelling planned item…";
    render();
    try {
      await window.api.cancelPlanItem(state.item.plan_item_id);
      window.PlanItemsController?.removeItem?.(state.item.plan_item_id);
      close(true);
    } catch (error) {
      state.error = error?.status ? (error.detail || "Unable to cancel planned item.") : "The outcome is unknown. Review the calendar before retrying.";
      if (!error?.status) await window.PlanController?.refresh?.();
      render();
    } finally {
      state.saving = false;
    }
  }

  function movePayload(item, plannedDate) {
    const prescription = item.prescription || {};
    const numeric = name => numberOrNull(
      prescription[name] == null ? "" : String(prescription[name]),
    );
    return {
      planned_date: plannedDate,
      sort_order: Number(item.sort_order || 0),
      category_id: Number(item.category?.plan_category_id),
      user_note: String(item.user_note || "").trim() || null,
      prescription: {
        title: String(prescription.title || "").trim(),
        description: String(prescription.description || "").trim() || null,
        sport_type: String(prescription.sport_type || "").trim() || null,
        activity_category: String(prescription.activity_category || "").trim() || null,
        trainer: prescription.trainer ?? null,
        target_duration_min: numeric("target_duration_min"),
        target_load: numeric("target_load"),
        target_load_source: String(prescription.target_load_source || "").trim() || null,
        target_distance_mi: numeric("target_distance_mi"),
        target_elevation_ft: numeric("target_elevation_ft"),
        instruction_text: String(prescription.instruction_text || "").trim() || null,
      },
      segments: Array.isArray(prescription.segments) ? prescription.segments : [],
    };
  }

  async function handleDrop(dateKey, event) {
    const itemId = event.dataTransfer?.getData(ITEM_DRAG_MIME);
    if (!itemId || state.saving || dateKey <= todayKey()) return false;
    const item = window.PlanItemsController?.getState?.().items?.find(row =>
      String(row.plan_item_id) === String(itemId));
    if (!item || item.item_state !== "committed" || item.planned_date <= todayKey()
        || item.planned_date === dateKey) {
      return false;
    }
    event.preventDefault();
    state.saving = true;
    let showError = false;
    try {
      const updated = await window.api.updatePlanItem(
        item.plan_item_id,
        movePayload(item, dateKey),
      );
      if (String(updated?.plan_item_id) !== String(item.plan_item_id)
          || !window.PlanItemsController?.replaceItem?.(updated)) {
        throw new Error("The move response did not contain the moved planned item.");
      }
      const cards = Array.from(
        document.querySelectorAll?.(".plan-planned-card[data-plan-item-id]") || [],
      );
      cards.find(card => String(card.dataset.planItemId) === String(item.plan_item_id))
        ?.focus?.();
      return true;
    } catch (error) {
      state.item = item;
      state.mode = "edit";
      state.opener = Array.from(
        document.querySelectorAll?.(".plan-planned-card[data-plan-item-id]") || [],
      ).find(card => String(card.dataset.planItemId) === String(item.plan_item_id)) || null;
      state.error = error?.status
        ? (error.detail || "Unable to move planned item.")
        : "The outcome is unknown. Review the calendar before retrying.";
      if (!error?.status) await window.PlanController?.refresh?.();
      showError = true;
      return false;
    } finally {
      state.saving = false;
      if (showError) {
        render();
        panel?.querySelector("input, select, textarea, button")?.focus();
      }
    }
  }

  function handleTarget(dateKey) {
    if (state.mode !== "moving" || !state.item || dateKey <= todayKey()) return false;
    const payload = itemPayload(dateKey);
    submit(payload);
    return true;
  }

  function bind() {
    if (initialized) return;
    panel = document.getElementById("planItemEditor");
    if (!panel) return;
    panel.addEventListener("click", event => {
      const action = event.target.closest("[data-plan-item-editor-action]")?.dataset.planItemEditorAction;
      if (action === "close") close();
      if (action === "move") {
        state.mode = "moving";
        state.error = "";
        render();
        renderCalendar();
      }
      if (action === "cancel") cancelItem();
    });
    panel.addEventListener("submit", event => {
      event.preventDefault();
      if (value("planned_date") <= todayKey()) {
        state.error = "Planned date must be after today.";
        render();
        return;
      }
      try { submit(itemPayload()); } catch (error) { state.error = error.message; render(); }
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && state.mode !== "idle") close();
    });
    initialized = true;
  }

  window.PlanItemEditor = {
    bind,
    open,
    close,
    getState: () => ({ ...state }),
    targetMarkup: (dateKey, dateLabel) => state.mode === "moving" && dateKey > todayKey()
      ? `<button type="button" class="plan-item-day-target" data-plan-item-target="${escape(dateKey)}" aria-label="Move ${escape(state.item?.prescription?.title || "planned item")} to ${escape(dateLabel)}">+ Move here</button>`
      : "",
    handleTarget,
    itemDragMime: ITEM_DRAG_MIME,
    handleDragStart: (itemId, event) => {
      const item = window.PlanItemsController?.getState?.().items?.find(row => String(row.plan_item_id) === String(itemId));
      if (!item || item.item_state !== "committed" || item.planned_date <= todayKey()) return false;
      event.dataTransfer?.setData(ITEM_DRAG_MIME, String(itemId));
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
      return true;
    },
    handleDrop: (dateKey, event) => {
      const itemId = event.dataTransfer?.getData(ITEM_DRAG_MIME);
      if (!itemId) return false;
      return handleDrop(dateKey, event);
    },
  };
})();
