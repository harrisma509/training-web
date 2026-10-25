const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const activityPresentation = require("../static/activity-presentation.js");

const paletteSource = fs.readFileSync("static/plan_palette.js", "utf8");
const apiSource = fs.readFileSync("static/api.js", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");
const itemSource = fs.readFileSync("static/plan_items.js", "utf8");
const templateSource = fs.readFileSync("templates/partials/panes/plan_pane.html", "utf8");
const indexSource = fs.readFileSync("templates/index.html", "utf8");
const cssSource = fs.readFileSync("static/plan.css", "utf8");
const templateControllerSource = fs.readFileSync("static/plan_templates.js", "utf8");

assert.match(templateSource, /id="planPalette"/);
assert.match(templateSource, /<aside id="planPalette"/);
assert.match(templateSource, /id="planPaletteOpen"[^>]*>[\s\S]*?Add plans/);
assert.equal((templateSource.match(/id="planPaletteClose"/g) || []).length, 1);
assert.match(templateSource, /<button id="planPaletteClose"[^>]*class="drawer-close-button plan-palette-close"[^>]*aria-label="Close Add plans">×<\/button>/);
assert.match(templateSource, /id="planPaletteManage"[^>]*>[\s\S]*?Manage templates/);
assert.match(templateSource, /id="planPalettePlacement"/);
assert.match(templateSource, /id="planPaletteQuickPicksTitle"[^>]*>Quick Picks/);
assert.match(templateSource, /id="planPaletteAllTemplatesToggle"[^>]*aria-expanded="false"/);
assert.match(templateSource, /id="planPaletteAllTemplates" hidden/);
assert.match(templateSource, /id="planPaletteQuickEmpty"/);
assert.match(templateSource, /No Quick Picks yet/);
assert.equal((templateSource.match(/id="planPaletteManage"/g) || []).length, 1);
assert.doesNotMatch(templateSource, /data-plan-palette-action="manage"/);
assert.match(indexSource, /plan_palette\.js[\s\S]*plan_templates\.js[\s\S]*plan\.js/);
assert.match(paletteSource, /America\/Denver/);
assert.match(paletteSource, /state\.mode = "selected"/);
assert.match(paletteSource, /state\.mode = "saving"/);
assert.match(paletteSource, /state\.mode = "unknown"/);
assert.match(paletteSource, /state\.mode = "dragging"/);
assert.match(paletteSource, /classList\.add\("is-dragging"\)/);
assert.match(paletteSource, /classList\.remove\("is-dragging"\)/);
assert.match(paletteSource, /template\.is_favorite === true/);
assert.match(paletteSource, /window\.ActivityPresentation\?\.getActivityTypeLabel\(sportType\) \|\| sportType/);
assert.match(indexSource, /activity-presentation\.js[\s\S]*plan_palette\.js/);
assert.match(paletteSource, /quickEmpty\.hidden = state\.templatesStatus !== "success" \|\| quick\.length > 0/);
assert.match(paletteSource, /aria-describedby="planPaletteDragInstructions"/);
assert.match(paletteSource, /draggable="true"/);
assert.match(paletteSource, /application\/x-training-plan-template-id/);
assert.match(paletteSource, /handleCalendarDrop/);
assert.match(paletteSource, /setAllTemplatesExpanded/);
assert.match(paletteSource, /state\.mode === "dragging"/);
assert.match(paletteSource, /\+ Add here/);
assert.match(paletteSource, /outcomeRequiresRefresh/);
assert.match(paletteSource, /createPlanItemFromTemplate/);
assert.match(paletteSource, /planTemplateId: state\.selectedTemplate\.planTemplateId/);
assert.match(paletteSource, /plannedDate: dateKey/);
assert.match(paletteSource, /sortOrder: 0/);
assert.match(paletteSource, /userNote: null/);
assert.match(paletteSource, /PlanItemsController\?\.acceptCreatedItem/);
assert.match(paletteSource, /PlanItemsController\?\.load\?\.\(range, \{ force: true \}\)/);
assert.match(paletteSource, /String\(dateKey\) >= getDenverTodayKey\(\)/);
assert.match(planSource, /dayKey >= getDenverTodayKey\(\)/);
assert.match(planSource, /day\.dataset\.planDate >= todayKey/);
assert.match(paletteSource, /Choose today or a future Plan date/);
assert.match(paletteSource, /data-plan-palette-target/);
assert.match(paletteSource, /PlanTemplateLibraryController\?\.open/);
assert.match(planSource, /data-plan-date="\$\{escapeHtml\(dayKey\)\}"/);
assert.match(planSource, /PlanPaletteController\?\.targetMarkup/);
assert.match(planSource, /setupPlanPaletteDragHandlers/);
assert.match(planSource, /handleCalendarDragOver/);
assert.match(planSource, /handleCalendarDragState/);
assert.match(planSource, /is-palette-drop-hover/);
assert.match(planSource, /is-palette-drop-valid/);
assert.match(planSource, /setPaletteDragState/);
assert.match(itemSource, /function acceptCreatedItem\(item\)/);
assert.match(itemSource, /acceptCreatedItem,/);
assert.match(cssSource, /\.plan-workspace/);
assert.match(cssSource, /\.plan-palette \.plan-palette-close\s*\{[^}]*display:\s*inline-flex[^}]*width:\s*32px[^}]*height:\s*32px[^}]*background:\s*var\(--panel2\)/s);
assert.match(cssSource, /\.plan-palette \.plan-palette-close:hover/);
assert.match(cssSource, /\.plan-palette-placement-banner/);
assert.match(cssSource, /\.plan-palette-day-target/);
assert.match(cssSource, /\.plan-workspace\.plan-palette-open/);
assert.match(cssSource, /\.plan-palette-section-toggle/);
assert.match(cssSource, /\.plan-day\.is-palette-drop-valid/);
assert.match(cssSource, /\.plan-day\.is-palette-drop-hover/);
assert.match(cssSource, /Drop here/);
assert.match(cssSource, /\.plan-palette-state\[hidden\]/);
assert.match(cssSource, /\.plan-palette-row\.is-dragging/);
assert.match(cssSource, /\.plan-palette-header p[\s\S]*white-space: nowrap/);
assert.match(cssSource, /@media \(max-width: 700px\)[\s\S]*\.plan-palette-header p[\s\S]*white-space: normal/);
assert.doesNotMatch(templateControllerSource, /planPalette|data-plan-palette|Place here|Add plans/);
const planDayRenderer = planSource.slice(
  planSource.indexOf("function renderPlanDayCell("),
  planSource.indexOf("\n  function getWeekDates", planSource.indexOf("function renderPlanDayCell(")),
);
assert.match(planDayRenderer, /const paletteTargetHtml = window\.PlanPaletteController\?\.targetMarkup/);
assert.match(
  planDayRenderer,
  /bodyHtml = `\$\{plannedHtml\}\$\{paletteTargetHtml\}\$\{itemTargetHtml\}\$\{bodyHtml\}`;/,
);
assert.ok(
  planDayRenderer.indexOf("const paletteTargetHtml") < planDayRenderer.indexOf("if (!hasActualActivity)"),
  "the palette target is computed independently of actual-activity content",
);
assert.match(planDayRenderer, /renderPlanCheckinControl\(dayKey, formattedDateLabel\)/);

async function testApiWrapper() {
  let request;
  const context = {
    fetch: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 201,
        statusText: "Created",
        json: async () => ({ plan_item_id: 7 }),
      };
    },
    window: {},
    URLSearchParams,
  };
  vm.runInNewContext(apiSource, context);
  const signal = { aborted: false };
  await context.window.api.createPlanItemFromTemplate({
    planTemplateId: 15,
    plannedDate: "2099-01-02",
    sortOrder: 0,
    userNote: null,
  }, { signal });
  assert.equal(request.url, "/api/plan/items/from-template");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.signal, signal);
  assert.deepEqual(JSON.parse(request.options.body), {
    plan_template_id: 15,
    planned_date: "2099-01-02",
    sort_order: 0,
    user_note: null,
  });
}

function testPaletteModuleLoadsWithoutPlacementMutation() {
  const context = {
    window: { ActivityPresentation: activityPresentation },
    Intl,
    Object,
    Promise,
    AbortController,
    setTimeout,
  };
  vm.runInNewContext(paletteSource, context);
  assert.equal(typeof context.window.PlanPaletteController.init, "function");
  assert.equal(context.window.PlanPaletteController.getState().mode, "idle");
  assert.equal(context.window.PlanPaletteController.getState().selectedTemplate, null);
}

async function testQuickPicksUseSharedPhysicalTherapyPresentation() {
  const elements = new Map();
  const workspace = { classList: { toggle() {} } };
  const listeners = new Map();
  const createElement = id => {
    const element = {
      id,
      hidden: false,
      innerHTML: "",
      value: "",
      disabled: false,
      attributes: {},
      listeners: new Map(),
      classList: { toggle() {}, add() {}, remove() {} },
      addEventListener(type, listener) {
        this.listeners.set(type, listener);
      },
      setAttribute(name, value) {
        this.attributes[name] = String(value);
      },
      closest(selector) {
        return selector === ".plan-workspace" ? workspace : null;
      },
      focus() {
        document.activeElement = this;
      },
      querySelector() {
        return { replaceChildren() {} };
      },
    };
    elements.set(id, element);
    return element;
  };
  const root = createElement("planPalette");
  root.closest = () => workspace;
  const trigger = createElement("planPaletteOpen");
  const closeButton = createElement("planPaletteClose");
  const searchInput = createElement("planPaletteSearch");
  const categorySelect = createElement("planPaletteCategory");
  const status = createElement("planPaletteStatus");
  const rows = createElement("planPaletteRows");
  const quickRows = createElement("planPaletteQuickRows");
  const allTemplates = createElement("planPaletteAllTemplates");
  const allTemplatesToggle = createElement("planPaletteAllTemplatesToggle");
  const quickEmpty = createElement("planPaletteQuickEmpty");
  const manageButton = createElement("planPaletteManage");
  const placementBanner = createElement("planPalettePlacement");
  const placementCalls = [];
  const acceptedItems = [];
  const dragStateChanges = [];
  const document = {
    readyState: "loading",
    activeElement: null,
    getElementById: id => elements.get(id) || null,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    createTextNode: value => ({ textContent: value }),
  };
  const context = {
    window: {
      ActivityPresentation: activityPresentation,
      innerWidth: 1280,
      setTimeout: callback => callback(),
      api: {
        fetchPlanCategories: async () => ({ categories: [] }),
        fetchPlanTemplates: async () => ({
          templates: [{
            plan_template_id: 23,
            template_name: "PT Quick Pick",
            is_favorite: true,
            category: { category_name: "Rehabilitation" },
            prescription: { sport_type: "PhysicalTherapy", target_duration_min: 30 },
          }],
        }),
        createPlanItemFromTemplate: async payload => {
          placementCalls.push(payload);
          return {
            plan_item_id: 100 + placementCalls.length,
            planned_date: payload.plannedDate,
            item_state: "committed",
            prescription: { title: "PT Quick Pick" },
          };
        },
      },
      PlanController: {
        getRange: () => ({ start: "2000-01-01", end: "2100-01-01" }),
        render() {},
        setPaletteDragState: active => dragStateChanges.push(active),
      },
      PlanItemsController: {
        acceptCreatedItem: item => acceptedItems.push(item),
      },
    },
    document,
    Intl,
    AbortController,
    setTimeout,
  };
  vm.runInNewContext(paletteSource, context);
  listeners.get("DOMContentLoaded")();
  trigger.listeners.get("click")();
  await new Promise(resolve => setImmediate(resolve));

  assert.match(quickRows.innerHTML, /Rehabilitation · Physical Therapy · 30 min/);
  assert.doesNotMatch(quickRows.innerHTML, /PhysicalTherapy/);
  assert.match(rows.innerHTML, /Physical Therapy/);
  assert.equal(context.window.PlanPaletteController.getState().templates[0].is_favorite, true);
  assert.equal(allTemplates.hidden, true);
  assert.equal(closeButton.disabled, false);
  assert.equal(searchInput.value, "");
  assert.equal(categorySelect.value, "");
  assert.equal(status.textContent, "");
  assert.equal(quickEmpty.hidden, true);
  assert.equal(manageButton.disabled, false);
  assert.equal(placementBanner.innerHTML, "");

  const today = denverDateOffset(0);
  const tomorrow = denverDateOffset(1);
  const yesterday = denverDateOffset(-1);
  const palette = context.window.PlanPaletteController;
  const selectTemplate = () => root.listeners.get("click")({
    target: {
      closest: selector => selector === "[data-plan-palette-template-id]"
        ? { getAttribute: () => "23" }
        : null,
    },
    preventDefault() {},
  });
  selectTemplate();
  assert.match(palette.targetMarkup(today, "today"), /data-plan-palette-target/);
  assert.match(palette.targetMarkup(tomorrow, "tomorrow"), /data-plan-palette-target/);
  assert.equal(palette.targetMarkup(yesterday, "yesterday"), "");
  assert.match(status.textContent, /today or a future Plan date/);

  const todayTarget = {
    getAttribute: () => today,
  };
  listeners.get("click")({
    target: {
      closest: selector => selector === "[data-plan-palette-target]" ? todayTarget : null,
    },
    preventDefault() {},
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(placementCalls.length, 1, "one click creates exactly one planned item");
  assert.equal(placementCalls[0].plannedDate, today);
  assert.equal(acceptedItems.length, 1);

  selectTemplate();
  const dragRow = {
    classList: { add() {}, remove() {} },
    getAttribute: () => "23",
  };
  root.listeners.get("dragstart")({
    target: { closest: () => dragRow },
    dataTransfer: { setData() {}, effectAllowed: "" },
  });
  let blockedPastDrop = false;
  assert.equal(palette.handleCalendarDragOver(yesterday, {
    preventDefault() { blockedPastDrop = true; },
    dataTransfer: {},
  }), false);
  assert.equal(blockedPastDrop, false);
  let todayDragOver = false;
  const todayDragEvent = {
    preventDefault() { todayDragOver = true; },
    dataTransfer: {},
  };
  assert.equal(palette.handleCalendarDragOver(today, todayDragEvent), true);
  assert.equal(todayDragOver, true);
  assert.equal(palette.handleCalendarDragState(true, today), true);
  assert.equal(palette.handleCalendarDrop(today, {
    preventDefault() {},
    dataTransfer: {},
  }), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(placementCalls.length, 2, "one drag/drop creates one additional item");
  assert.deepEqual(placementCalls.map(call => call.plannedDate), [today, today]);
  assert.deepEqual(acceptedItems.map(item => item.plan_item_id), [101, 102]);
  assert.deepEqual(dragStateChanges, [false, true, false]);

  selectTemplate();
  assert.match(palette.targetMarkup(today, "today"), /data-plan-palette-target/);
  closeButton.listeners.get("click")();
  let paletteState = palette.getState();
  assert.equal(root.hidden, true);
  assert.equal(trigger.attributes["aria-expanded"], "false");
  assert.equal(paletteState.selectedTemplate, null);
  assert.equal(paletteState.mode, "idle");
  assert.equal(paletteState.statusMessage, "");
  assert.equal(placementBanner.innerHTML, "");
  assert.equal(palette.targetMarkup(today, "today"), "");
  assert.equal(dragStateChanges.at(-1), false);
  assert.equal(document.activeElement, trigger);
  assert.equal(placementCalls.length, 2, "the close button performs no placement mutation");

  trigger.listeners.get("click")();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.hidden, false, "the trigger reopens the panel");
  selectTemplate();
  document.activeElement = trigger;
  trigger.listeners.get("click")();
  paletteState = palette.getState();
  assert.equal(root.hidden, true, "the Add plans trigger toggles the panel closed");
  assert.equal(trigger.attributes["aria-expanded"], "false");
  assert.equal(paletteState.selectedTemplate, null);
  assert.equal(paletteState.mode, "idle");
  assert.equal(placementBanner.innerHTML, "");
  assert.equal(palette.targetMarkup(today, "today"), "");
  assert.equal(placementCalls.length, 2, "the trigger toggle performs no placement mutation");

  trigger.listeners.get("click")();
  await new Promise(resolve => setImmediate(resolve));
  selectTemplate();
  listeners.get("keydown")({
    key: "Escape",
    preventDefault() {},
  });
  paletteState = palette.getState();
  assert.equal(root.hidden, true, "Escape closes the panel");
  assert.equal(trigger.attributes["aria-expanded"], "false");
  assert.equal(paletteState.selectedTemplate, null);
  assert.equal(paletteState.mode, "idle");
  assert.equal(placementBanner.innerHTML, "");
  assert.equal(palette.targetMarkup(today, "today"), "");
  assert.equal(document.activeElement, trigger);
  assert.equal(placementCalls.length, 2, "Escape performs no placement mutation");

  trigger.listeners.get("click")();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.hidden, false, "reopening after close succeeds");
  assert.equal(palette.getState().mode, "idle", "reopening starts in idle mode");
  assert.equal(palette.getState().selectedTemplate, null);
}

function denverDateOffset(offset) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  return new Date(Date.UTC(values.year, values.month - 1, values.day + offset, 12))
    .toISOString().slice(0, 10);
}

function testTodayAndFuturePaletteDaysAreDragTargets() {
  const today = denverDateOffset(0);
  const days = [-1, 0, 1].map(offset => {
    const classes = new Set();
    return {
      dataset: { planDate: denverDateOffset(offset) },
      classes,
      classList: {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        remove(name) { classes.delete(name); },
      },
    };
  });
  const start = planSource.indexOf("function setPaletteDragState(");
  const end = planSource.indexOf("\n  async function ensurePlanWeeklyRows", start);
  assert.ok(start >= 0 && end > start);
  const context = vm.createContext({
    document: { querySelectorAll: () => days },
    getDenverTodayKey: () => today,
  });
  vm.runInContext(`${planSource.slice(start, end)}\nsetPaletteDragState(true)`, context);
  assert.equal(days[0].classes.has("is-palette-drop-valid"), false);
  assert.equal(days[1].classes.has("is-palette-drop-valid"), true);
  assert.equal(days[2].classes.has("is-palette-drop-valid"), true);
  vm.runInContext("setPaletteDragState(false)", context);
  assert.equal(days[1].classes.has("is-palette-drop-valid"), false);
}

Promise.all([
  testApiWrapper(),
  testPaletteModuleLoadsWithoutPlacementMutation(),
  testQuickPicksUseSharedPhysicalTherapyPresentation(),
  testTodayAndFuturePaletteDaysAreDragTargets(),
]).then(() => {
  console.log("Plan Palette contract tests passed.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
