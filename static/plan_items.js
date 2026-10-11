(function () {
  const PLAN_TIME_ZONE = "America/Denver";
  const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
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
    const sport = prescription.sport_type || prescription.activity_category || "";
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
    const isHistorical = dateKey <= getDenverTodayKey();
    const statusLabel = isDraft ? "Draft" : isHistorical ? "Read-only" : "";
    const classes = [
      "plan-planned-card",
      isHistorical ? "is-historical" : "",
      isDraft ? "is-draft" : "",
    ].filter(Boolean).join(" ");
    const context = ["Planned", prescription.title, category, sport, ...metrics];
    if (segmentCount > 0) {
      context.push(`structured workout with ${segmentCount} segments`);
    }
    if (statusLabel) {
      context.push(statusLabel);
    }
    return `
      <li class="${classes}" data-plan-item-id="${escape(item?.plan_item_id)}"
          aria-label="${escape(context.filter(Boolean).join(", "))}">
        <div class="plan-planned-card-heading">
          <span class="plan-planned-badge">Planned</span>
          ${statusLabel ? `<span class="plan-planned-state">${escape(statusLabel)}</span>` : ""}
        </div>
        <div class="plan-planned-title">${escape(prescription.title || "Untitled planned item")}</div>
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
    const items = state.byDate.get(dateKey) || [];
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
    initialized = true;
    return initialized;
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
    renderDaySection,
    reset,
  };
})();
