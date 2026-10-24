(function () {
  const PLAN_TIME_ZONE = "America/Denver";
  const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
  const QUICK_ACTIONS_MENU_ID = "planItemQuickActions";
  const state = {
    range: { start: null, end: null },
    status: "idle",
    items: [],
    byDate: new Map(),
    error: null,
    generation: 0,
    abortController: null,
  };
  let initialized = false;
  let onChange = null;
  let quickActionMenu = null;
  let quickActionSurface = null;
  let quickActionState = null;

  function escape(value) {
    if (typeof window.escapeHtml === "function") {
      return window.escapeHtml(value);
    }
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[character]));
  }

  function isIsoDate(value) {
    return typeof value === "string" && ISO_DATE_PATTERN.test(value);
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

  function formatFullDate(dateKey) {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: PLAN_TIME_ZONE,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(new Date(`${dateKey}T12:00:00Z`));
  }

  function setState(nextState) {
    Object.assign(state, nextState);
    if (typeof onChange === "function") {
      onChange();
    }
  }

  function groupItems(items) {
    const byDate = new Map();
    for (const item of items) {
      const plannedDate = item?.planned_date;
      if (!isIsoDate(plannedDate)) {
        continue;
      }
      const dateItems = byDate.get(plannedDate) || [];
      dateItems.push(item);
      byDate.set(plannedDate, dateItems);
    }
    return byDate;
  }

  function formatMetric(value, suffix = "") {
    if (value === null || value === undefined || value === "") {
      return "";
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return "";
    }
    const display = Number.isInteger(numeric) ? String(numeric) : String(numeric);
    return `${display}${suffix}`;
  }

  function renderItemCard(item, dateKey) {
    const prescription = item?.prescription || {};
    const category = item?.category?.category_name || "";
    const sportType = prescription.sport_type || prescription.activity_category || "";
    const sport = window.ActivityPresentation?.getActivityTypeLabel(sportType) || sportType;
    const duration = formatMetric(prescription.target_duration_min, " min");
    const targetLoad = formatMetric(prescription.target_load);
    const metrics = [
      duration,
      targetLoad === "" ? "" : `Target load ${targetLoad}`,
    ].filter(Boolean);
    const segmentCount = Array.isArray(prescription.segments)
      ? prescription.segments.length
      : 0;
    const isDraft = item?.item_state === "draft";
    const isHistorical = dateKey < getDenverTodayKey();
    const statusLabel = isDraft ? "Draft" : isHistorical ? "Read-only" : "";
    const isManageable = !isHistorical && item?.item_state === "committed";
    const classes = [
      "plan-planned-card",
      isHistorical ? "is-historical" : "",
      isDraft ? "is-draft" : "",
    ].filter(Boolean).join(" ");
    const title = prescription.title || "Untitled planned item";
    const fullDate = formatFullDate(dateKey);
    const context = ["Planned", title, `planned for ${fullDate}`, category, sport, ...metrics];
    if (segmentCount > 0) {
      context.push(`structured workout with ${segmentCount} segments`);
    }
    if (statusLabel) {
      context.push(statusLabel);
    }
    if (isManageable) {
      context.push("Drag is optional; activate to edit. The Actions button opens planned-item actions.");
    }
    return `
      <li class="${classes}" data-plan-item-id="${escape(item?.plan_item_id)}"
          data-plan-item-manageable="${isManageable ? "true" : "false"}"
          ${isManageable ? 'role="listitem" tabindex="0" draggable="true"' : ""}
          aria-label="${escape(context.filter(Boolean).join(", "))}">
        ${statusLabel ? `<div class="plan-planned-card-heading"><span class="plan-planned-state">${escape(statusLabel)}</span></div>` : ""}
        <div class="plan-planned-title-row">
          <span class="plan-planned-title">${escape(title)}</span>
          ${isManageable ? `<button type="button" class="plan-planned-manage" draggable="false"
            data-plan-item-action="manage" data-plan-item-id="${escape(item?.plan_item_id)}"
            aria-label="Actions for ${escape(title)} planned for ${escape(fullDate)}"
            aria-haspopup="menu" aria-expanded="false" aria-controls="${QUICK_ACTIONS_MENU_ID}">⋮</button>` : ""}
        </div>
        <div class="plan-planned-meta">${escape([category, sport].filter(Boolean).join(" · "))}</div>
        ${metrics.length ? `<div class="plan-planned-metrics">${escape(metrics.join(" · "))}</div>` : ""}
        ${segmentCount > 0 ? `<div class="plan-planned-structure">Structured · ${segmentCount} segments</div>` : ""}
      </li>
    `;
  }

  function renderDaySection(dateKey) {
    if (state.status === "loading") {
      return '<div class="plan-planned-status" role="status">Loading planned items…</div>';
    }
    if (state.status === "error") {
      return '<div class="plan-planned-status is-error" role="status">Planned items unavailable. Actual activities are still shown.</div>';
    }
    if (state.status !== "success") {
      return "";
    }
    const items = getVisibleItemsForDate(dateKey);
    if (!items.length) {
      return "";
    }
    return `
      <section class="plan-planned-section" aria-label="Planned activities">
        <div class="plan-planned-heading">Planned</div>
        <ul class="plan-planned-list">${items.map(item => renderItemCard(item, dateKey)).join("")}</ul>
      </section>
    `;
  }

  async function load(range, options = {}) {
    const nextRange = {
      start: String(range?.start || ""),
      end: String(range?.end || ""),
    };
    const sameRange = state.range.start === nextRange.start && state.range.end === nextRange.end;
    const force = options.force === true;
    if (!nextRange.start || !nextRange.end) {
      return state;
    }
    if (sameRange && !force && (state.status === "loading" || state.status === "success")) {
      return state;
    }

    state.abortController?.abort();
    const abortController = new AbortController();
    const generation = state.generation + 1;
    state.abortController = abortController;
    setState({
      range: nextRange,
      status: "loading",
      items: [],
      byDate: new Map(),
      error: null,
      generation,
    });

    try {
      const payload = await window.api.fetchPlanItems(
        nextRange.start,
        nextRange.end,
        { signal: abortController.signal },
      );
      if (generation !== state.generation || abortController.signal.aborted) {
        return state;
      }
      const items = Array.isArray(payload?.items) ? payload.items : [];
      setState({
        status: "success",
        items: items.filter(item => isIsoDate(item?.planned_date)),
        byDate: groupItems(items),
        error: null,
        abortController: null,
      });
    } catch (error) {
      if (generation !== state.generation || abortController.signal.aborted) {
        return state;
      }
      setState({
        status: "error",
        error,
        abortController: null,
      });
    }
    return state;
  }

  function init(options = {}) {
    if (typeof options.onChange === "function") {
      onChange = options.onChange;
    }
    bindCardInteractions();
    initialized = true;
    return initialized;
  }

  let activeDragItemId = null;
  let suppressClickForItemId = null;

  function closeQuickActionMenu(reason) {
    if (quickActionSurface?.isOpen()) {
      quickActionSurface.close(reason);
    }
  }

  function positionQuickActionMenu(trigger) {
    const triggerRect = trigger.getBoundingClientRect();
    const menuRect = quickActionMenu.getBoundingClientRect();
    const margin = 8;
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    let left = Math.min(triggerRect.right - menuRect.width, viewportWidth - menuRect.width - margin);
    let top = triggerRect.bottom + margin;
    if (
      top + menuRect.height > viewportHeight - margin
      && triggerRect.top - menuRect.height - margin >= margin
    ) {
      top = triggerRect.top - menuRect.height - margin;
    }
    quickActionMenu.style.left = `${Math.max(margin, left)}px`;
    quickActionMenu.style.top = `${Math.max(margin, top)}px`;
  }

  function openQuickActionMenu(item, trigger) {
    if (!quickActionMenu && !ensureQuickActionMenu()) return false;
    if (quickActionSurface.isOpen() && quickActionState?.trigger === trigger) {
      closeQuickActionMenu("toggle");
      return true;
    }
    if (quickActionSurface.isOpen()) closeQuickActionMenu("replace");
    const title = item?.prescription?.title || "Untitled planned item";
    const date = formatFullDate(item.planned_date);
    quickActionState = { itemId: String(item.plan_item_id), trigger };
    quickActionMenu.innerHTML = `
      <button type="button" role="menuitem" data-plan-quick-action="edit">Edit</button>
      <button type="button" role="menuitem" data-plan-quick-action="move">Move</button>
      <button type="button" role="menuitem" data-plan-quick-action="delete" class="is-destructive">Delete from plan</button>
    `;
    quickActionMenu.setAttribute("aria-label", `Actions for ${title} planned for ${date}`);
    quickActionMenu.hidden = false;
    quickActionMenu.style.visibility = "hidden";
    quickActionSurface.open({ opener: trigger });
    trigger.setAttribute("aria-expanded", "true");
    positionQuickActionMenu(trigger);
    quickActionMenu.style.visibility = "";
    quickActionMenu.querySelector('[role="menuitem"]')?.focus();
    return true;
  }

  function ensureQuickActionMenu() {
    if (quickActionMenu) return true;
    const transientSurface = window.TrainingApp?.TransientSurface;
    if (typeof transientSurface?.create !== "function") {
      throw new Error("Plan quick actions require the transient surface controller.");
    }
    quickActionMenu = document.createElement("div");
    quickActionMenu.id = QUICK_ACTIONS_MENU_ID;
    quickActionMenu.className = "plan-item-quick-actions";
    quickActionMenu.setAttribute("role", "menu");
    quickActionMenu.hidden = true;
    document.body.appendChild(quickActionMenu);
    quickActionSurface = transientSurface.create({
      getSurface: () => quickActionMenu,
      restoreFocus: false,
      onBeforeClose: (_reason, surface) => {
        surface.hidden = true;
        quickActionState?.trigger?.setAttribute("aria-expanded", "false");
      },
      onAfterClose: reason => {
        const trigger = quickActionState?.trigger;
        quickActionState = null;
        if (
          !["action", "replace", "tab", "viewport-change"].includes(reason)
          && trigger?.isConnected !== false
        ) {
          trigger?.focus?.();
        }
      },
    });
    quickActionMenu.addEventListener("click", event => {
      const actionButton = event.target.closest?.("[data-plan-quick-action]");
      if (!actionButton || !quickActionState || !quickActionMenu.contains(actionButton)) return;
      const { itemId, trigger } = quickActionState;
      const item = state.items.find(row => String(row.plan_item_id) === itemId);
      const action = actionButton.dataset.planQuickAction;
      closeQuickActionMenu("action");
      if (!item) {
        trigger?.focus?.();
        return;
      }
      if (action === "edit") {
        if (!window.PlanItemEditor?.open?.(item, trigger, "edit", false)) {
          trigger?.focus?.();
        }
      } else if (action === "move") {
        if (!window.PlanItemEditor?.startQuickMove?.(item, trigger)) {
          trigger?.focus?.();
        }
      } else if (action === "delete") {
        window.PlanItemEditor?.cancelFromQuickAction?.(item, trigger);
      }
    });
    quickActionMenu.addEventListener("keydown", event => {
      const items = [...quickActionMenu.querySelectorAll('[role="menuitem"]')];
      const currentIndex = items.indexOf(document.activeElement);
      if (event.key === "Escape") {
        event.preventDefault();
        closeQuickActionMenu("escape");
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        items[(currentIndex + direction + items.length) % items.length]?.focus();
      } else if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        items[event.key === "Home" ? 0 : items.length - 1]?.focus();
      }
    });
    quickActionMenu.addEventListener("focusout", event => {
      if (!quickActionMenu.contains(event.relatedTarget)) {
        quickActionSurface.close("tab");
      }
    });
    document.addEventListener("pointerdown", event => {
      if (
        quickActionSurface.isOpen()
        && !quickActionMenu.contains(event.target)
        && event.target !== quickActionState?.trigger
      ) {
        quickActionSurface.requestClose("outside");
      }
    });
    document.addEventListener("scroll", () => {
      if (quickActionSurface.isOpen()) quickActionSurface.requestClose("viewport-change");
    }, true);
    window.addEventListener("resize", () => {
      if (quickActionSurface.isOpen()) quickActionSurface.requestClose("viewport-change");
    });
    return true;
  }

  function bindCardInteractions() {
    if (typeof document === "undefined") {
      return;
    }
    const strip = document.getElementById("planStrip");
    if (!strip || strip.dataset.planItemBound === "true") {
      return;
    }
    ensureQuickActionMenu();
    const getCard = target => target?.closest?.(".plan-planned-card[data-plan-item-id]");
    const getItem = itemId => state.items.find(item =>
      String(item.plan_item_id) === String(itemId));
    const clearItemDropState = () => {
      strip.querySelectorAll(
        ".is-item-drop-valid, .is-item-drop-hover, .is-dragging",
      ).forEach(element => element.classList.remove(
        "is-item-drop-valid",
        "is-item-drop-hover",
        "is-dragging",
      ));
    };

    strip.addEventListener("pointerdown", () => {
      suppressClickForItemId = null;
    });
    strip.addEventListener("click", event => {
      if (window.PlanItemEditor?.isQuickMoveMode?.()) {
        const day = event.target.closest?.("[data-plan-date]");
        const interactive = event.target.closest?.("button, a, input, select, textarea");
        if (
          day
          && !interactive
          && window.PlanItemEditor?.isQuickMoveDestination?.(day.dataset.planDate)
        ) {
          event.preventDefault();
          window.PlanItemEditor?.handleQuickMoveTarget?.(day.dataset.planDate);
        }
        return;
      }
      const moveTarget = event.target.closest?.("[data-plan-item-target]");
      if (moveTarget) {
        event.preventDefault();
        window.PlanItemEditor?.handleTarget?.(moveTarget.dataset.planItemTarget);
        return;
      }
      const card = getCard(event.target);
      if (!card) {
        return;
      }
      const itemId = card.dataset.planItemId;
      const manageButton = event.target.closest?.('[data-plan-item-action="manage"]');
      if (manageButton) {
        event.preventDefault();
        event.stopPropagation();
        const item = getItem(manageButton.dataset.planItemId);
        if (
          item
          && card.dataset.planItemManageable === "true"
          && !window.PlanItemEditor?.isQuickMoveMode?.()
        ) {
          openQuickActionMenu(item, manageButton);
        }
        return;
      }
      if (suppressClickForItemId !== null) {
        const shouldSuppress = String(suppressClickForItemId) === String(itemId);
        suppressClickForItemId = null;
        if (shouldSuppress) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (card.dataset.planItemManageable !== "true") {
        return;
      }
      const item = getItem(itemId);
      if (item) {
        window.PlanItemEditor?.open?.(item, card, "edit", false);
      }
    });
    strip.addEventListener("keydown", event => {
      const card = getCard(event.target);
      if (window.PlanItemEditor?.isQuickMoveMode?.()) {
        const day = event.target.closest?.("[data-plan-date]");
        if (
          day
          && ["Enter", " ", "Spacebar"].includes(event.key)
          && window.PlanItemEditor?.isQuickMoveDestination?.(day.dataset.planDate)
        ) {
          event.preventDefault();
          window.PlanItemEditor?.handleQuickMoveTarget?.(day.dataset.planDate);
        }
        return;
      }
      if (!card || event.target.closest?.("button, input, select, textarea, a")) {
        return;
      }
      if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") {
        return;
      }
      suppressClickForItemId = null;
      if (card.dataset.planItemManageable !== "true") {
        return;
      }
      const item = getItem(card.dataset.planItemId);
      if (!item) {
        return;
      }
      event.preventDefault();
      window.PlanItemEditor?.open?.(item, card, "edit", false);
    });
    strip.addEventListener("dragstart", event => {
      const card = getCard(event.target);
      const manageButton = event.target.closest?.('[data-plan-item-action="manage"]');
      if (manageButton) {
        event.preventDefault();
        return;
      }
      if (!card || card.dataset.planItemManageable !== "true") {
        return;
      }
      const itemId = card.dataset.planItemId;
      if (!window.PlanItemEditor?.handleDragStart?.(itemId, event)) {
        event.preventDefault();
        return;
      }
      activeDragItemId = String(itemId);
      card.classList.add("is-dragging");
      strip.querySelectorAll("[data-plan-date]").forEach(day => {
        if (day.dataset.planDate > getDenverTodayKey()) {
          day.classList.add("is-item-drop-valid");
        }
      });
    });
    strip.addEventListener("dragover", event => {
      const hasItemMime = event.dataTransfer?.types?.includes(
        window.PlanItemEditor?.itemDragMime,
      );
      const day = event.target.closest?.("[data-plan-date]");
      if (!activeDragItemId || !hasItemMime || !day
          || day.dataset.planDate <= getDenverTodayKey()) {
        return;
      }
      event.preventDefault();
      day.classList.add("is-item-drop-hover");
    });
    strip.addEventListener("dragleave", event => {
      const day = event.target.closest?.("[data-plan-date]");
      if (day && !day.contains(event.relatedTarget)) {
        day.classList.remove("is-item-drop-hover");
      }
    });
    strip.addEventListener("drop", event => {
      const hasItemMime = event.dataTransfer?.types?.includes(
        window.PlanItemEditor?.itemDragMime,
      );
      const transferredItemId = event.dataTransfer?.getData(
        window.PlanItemEditor?.itemDragMime,
      );
      const day = event.target.closest?.("[data-plan-date]");
      if (!activeDragItemId || String(transferredItemId) !== activeDragItemId
          || !hasItemMime || !day
          || day.dataset.planDate <= getDenverTodayKey()) {
        return;
      }
      event.preventDefault();
      clearItemDropState();
      window.PlanItemEditor?.handleDrop?.(day.dataset.planDate, event);
    });
    strip.addEventListener("dragend", () => {
      if (activeDragItemId !== null) {
        suppressClickForItemId = activeDragItemId;
        activeDragItemId = null;
      }
      clearItemDropState();
    });
    strip.dataset.planItemBound = "true";
  }

  function getState() {
    return {
      ...state,
      range: { ...state.range },
      items: [...state.items],
      byDate: new Map(state.byDate),
    };
  }

  function getItemsForDate(dateKey) {
    return [...(state.byDate.get(dateKey) || [])];
  }

  function getVisibleItemsForDate(dateKey) {
    const hidePastPlanned = window.PlanOptionsController?.getHidePastPlanned?.() !== false;
    if (hidePastPlanned && isIsoDate(dateKey) && dateKey < getDenverTodayKey()) {
      return [];
    }
    return getItemsForDate(dateKey);
  }

  function acceptCreatedItem(item) {
    if (!item || item.plan_item_id == null || !isIsoDate(item.planned_date)) {
      return false;
    }
    const nextItems = state.items.filter(existing => existing.plan_item_id !== item.plan_item_id);
    nextItems.push(item);
    nextItems.sort((left, right) => {
      const dateOrder = String(left.planned_date).localeCompare(String(right.planned_date));
      if (dateOrder !== 0) return dateOrder;
      const sortOrder = Number(left.sort_order || 0) - Number(right.sort_order || 0);
      if (sortOrder !== 0) return sortOrder;
      return Number(left.plan_item_id) - Number(right.plan_item_id);
    });
    setState({ items: nextItems, byDate: groupItems(nextItems) });
    return true;
  }

  function replaceItem(item) {
    if (!item || item.plan_item_id == null || !isIsoDate(item.planned_date)) {
      return false;
    }
    const nextItems = state.items.filter(existing => existing.plan_item_id !== item.plan_item_id);
    nextItems.push(item);
    nextItems.sort((left, right) => {
      const dateOrder = String(left.planned_date).localeCompare(String(right.planned_date));
      if (dateOrder !== 0) return dateOrder;
      const sortOrder = Number(left.sort_order || 0) - Number(right.sort_order || 0);
      if (sortOrder !== 0) return sortOrder;
      return Number(left.plan_item_id) - Number(right.plan_item_id);
    });
    setState({ items: nextItems, byDate: groupItems(nextItems) });
    return true;
  }

  function removeItem(planItemId) {
    const nextItems = state.items.filter(item => item.plan_item_id !== planItemId);
    if (nextItems.length === state.items.length) {
      return false;
    }
    setState({ items: nextItems, byDate: groupItems(nextItems) });
    return true;
  }

  function reset() {
    state.abortController?.abort();
    state.range = { start: null, end: null };
    state.status = "idle";
    state.items = [];
    state.byDate = new Map();
    state.error = null;
    state.generation += 1;
    state.abortController = null;
    if (typeof onChange === "function") {
      onChange();
    }
  }

  window.PlanItemsController = {
    init,
    load,
    getState,
    getItemsForDate,
    getVisibleItemsForDate,
    acceptCreatedItem,
    replaceItem,
    removeItem,
    renderDaySection,
    reset,
  };
})();
