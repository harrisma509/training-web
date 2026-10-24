const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const activityPresentation = require("../static/activity-presentation.js");

const apiSource = fs.readFileSync("static/api.js", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");
const itemSource = fs.readFileSync("static/plan_items.js", "utf8");
const templateSource = fs.readFileSync("templates/index.html", "utf8");
const cssSource = fs.readFileSync("static/plan.css", "utf8");

assert.match(apiSource, /async fetchPlanItems\(startDate, endDate, options = \{\}\)/);
assert.match(apiSource, /\/api\/plan\/items\?\$\{params\.toString\(\)\}/);
assert.match(apiSource, /signal: options\.signal/);
assert.match(itemSource, /const state = \{/);
assert.match(itemSource, /generation: 0/);
assert.match(itemSource, /new AbortController\(\)/);
assert.match(itemSource, /new Map\(\)/);
assert.match(itemSource, /data-plan-item-id/);
assert.match(itemSource, /role="status"/);
assert.match(itemSource, /Planned items unavailable/);
assert.match(itemSource, /target_load/);
assert.match(itemSource, /item_state === "draft"/);
assert.match(itemSource, /structured workout with/);
assert.match(itemSource, /role="listitem" tabindex="0" draggable="true"/);
assert.match(itemSource, /data-plan-item-action="manage"/);
assert.match(itemSource, /Manage \$\{escape\(title\)\} planned for/);
assert.match(itemSource, /draggable="false"[\s\S]*data-plan-item-action="manage"/);
assert.doesNotMatch(itemSource, /data-plan-item-action="(?:edit|move|drag-move)"/);
assert.doesNotMatch(itemSource, /plan-planned-actions|plan-planned-move-handle/);
assert.doesNotMatch(itemSource, /fetch(?:Daily|Weekly|Load)|update(?:Daily|Weekly|Load)/);
assert.doesNotMatch(itemSource, /fetch\([^)]*method:\s*["'](?:POST|PUT|PATCH|DELETE)/);
assert.doesNotMatch(itemSource, /user_note/);
assert.match(planSource, /PlanItemsController\?\.init\?\.\(\{ onChange: renderPlanStrip \}\)/);
assert.match(planSource, /PlanItemsController\?\.load\?\.\(range, \{ force \}\)/);
assert.match(planSource, /renderDaySection\?\.\(dayKey\)/);
assert.match(planSource, /No activity recorded yet/);
assert.match(planSource, /plannedState\.status === "success"/);
assert.match(planSource, /MONTH_NAMES\[dateValue\.getUTCMonth\(\)\]/);
assert.match(templateSource, /plan_items\.js\?v=\{\{ asset_version \}\}/);
assert.match(templateSource, /plan_items\.js[\s\S]*plan\.js/);
assert.match(cssSource, /\.plan-planned-section/);
assert.match(cssSource, /\.plan-planned-card\.is-historical/);
assert.match(cssSource, /\.plan-planned-card\[data-plan-item-manageable="true"\]:focus-visible/);
assert.match(cssSource, /\.plan-planned-manage:focus-visible/);
assert.match(cssSource, /var\(--panel2\)/);
assert.match(cssSource, /var\(--blue\)/);
assert.match(cssSource, /overflow-wrap: anywhere/);

async function testApiWrapper() {
  let request;
  const response = {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ start_date: "2026-10-12", end_date: "2026-11-09", items: [] }),
  };
  const context = {
    fetch: async (url, options) => {
      request = { url, options };
      return response;
    },
    window: {},
    URLSearchParams,
  };
  vm.runInNewContext(apiSource, context);
  const signal = { aborted: false };
  await context.window.api.fetchPlanItems("2026-10-12", "2026-11-09", { signal });

  assert.equal(
    request.url,
    "/api/plan/items?start_date=2026-10-12&end_date=2026-11-09",
  );
  assert.equal(request.options.signal, signal);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function denverDateOffset(offset) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  const date = new Date(Date.UTC(values.year, values.month - 1, values.day + offset, 12));
  return date.toISOString().slice(0, 10);
}

async function testController() {
  const requests = [];
  let changeCount = 0;
  let hidePastPlanned = false;
  const context = {
    window: {
      ActivityPresentation: activityPresentation,
      PlanOptionsController: {
        getHidePastPlanned: () => hidePastPlanned,
      },
      escapeHtml: value => String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[character])),
      api: {
        fetchPlanItems: (start, end, options) => {
          const pending = deferred();
          requests.push({ start, end, options, pending });
          return pending.promise;
        },
      },
    },
    AbortController,
    Intl,
    Map,
    Object,
    Promise,
  };
  vm.runInNewContext(itemSource, context);
  const controller = context.window.PlanItemsController;
  const today = denverDateOffset(0);
  const future = denverDateOffset(7);
  const past = denverDateOffset(-1);
  assert.equal(controller.init({ onChange: () => { changeCount += 1; } }), true);
  assert.equal(controller.init({ onChange: () => { changeCount += 1; } }), true);

  const firstLoad = controller.load({
    start: "2026-10-05",
    end: "2026-11-02",
  });
  assert.equal(controller.getState().status, "loading");
  assert.match(controller.renderDaySection("2026-10-18"), /Loading planned items/);

  const secondLoad = controller.load({
    start: "2026-10-12",
    end: "2026-11-09",
  });
  assert.equal(requests[0].options.signal.aborted, true);
  requests[1].pending.resolve({
    items: [
      {
        plan_item_id: 2,
        planned_date: future,
        item_state: "committed",
        category: { category_name: "Endurance" },
        prescription: {
          title: "Second item",
          sport_type: "PhysicalTherapy",
          target_duration_min: null,
          target_load: 0,
          segments: [],
        },
      },
      {
        plan_item_id: 1,
        planned_date: future,
        item_state: "draft",
        category: { category_name: "Endurance" },
        prescription: {
          title: "<Unsafe item>",
          activity_category: "Ride",
          target_duration_min: 90,
          target_load: null,
          segments: [{ segment_order: 1 }],
        },
      },
      {
        plan_item_id: 3,
        planned_date: today,
        item_state: "committed",
        prescription: { title: "Today item" },
      },
      {
        plan_item_id: 4,
        planned_date: past,
        item_state: "committed",
        prescription: { title: "Past item" },
      },
      { plan_item_id: 99, planned_date: "not-a-date" },
    ],
  });
  await secondLoad;
  requests[0].pending.resolve({
    items: [{
      plan_item_id: 100,
      planned_date: "2026-10-20",
      prescription: { title: "Stale item" },
    }],
  });
  await firstLoad;

  const state = controller.getState();
  assert.equal(state.status, "success");
  assert.equal(state.range.start, "2026-10-12");
  assert.equal(state.range.end, "2026-11-09");
  assert.equal(state.items.map(item => item.plan_item_id).join(","), "2,1,3,4");
  assert.equal(
    controller.getItemsForDate(future).map(item => item.plan_item_id).join(","),
    "2,1",
  );
  const rendered = controller.renderDaySection(future);
  assert.match(rendered, /Planned activities/);
  assert.match(rendered, /data-plan-item-id="2"/);
  assert.match(rendered, /data-plan-item-id="1"/);
  assert.match(rendered, /Target load 0/);
  assert.match(rendered, /90 min/);
  assert.match(rendered, /Structured · 1 segments/);
  assert.match(rendered, /Physical Therapy/);
  assert.doesNotMatch(rendered, /PhysicalTherapy/);
  assert.match(rendered, /Draft/);
  assert.equal((rendered.match(/>Planned</g) || []).length, 1);
  assert.doesNotMatch(rendered, /plan-planned-badge/);
  assert.match(rendered, /&lt;Unsafe item&gt;/);
  assert.equal((rendered.match(/data-plan-item-action="manage"/g) || []).length, 1);
  const fullDate = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(`${future}T12:00:00Z`));
  assert.ok(rendered.includes(`aria-label="Manage Second item planned for ${fullDate}"`));
  assert.match(rendered, /draggable="false"/);
  assert.match(rendered, /draggable="true"/);
  assert.match(rendered, /Drag is optional; activate to edit/);
  assert.doesNotMatch(rendered, />Edit<|>Move<|drag-move|plan-planned-actions/);
  for (const historicalDate of [past]) {
    const historical = controller.renderDaySection(historicalDate);
    assert.match(historical, /Read-only/);
    assert.doesNotMatch(historical, /data-plan-item-action="manage"|draggable="true"|tabindex="0"/);
  }
  const todayRendered = controller.renderDaySection(today);
  assert.match(todayRendered, /Today item/);
  assert.match(todayRendered, /data-plan-item-manageable="true"/);
  assert.match(todayRendered, /data-plan-item-action="manage"/);
  assert.doesNotMatch(todayRendered, /Read-only/);
  hidePastPlanned = true;
  assert.equal(controller.getItemsForDate(past).length, 1, "the full Plan collection retains past items");
  assert.equal(controller.getVisibleItemsForDate(past).length, 0);
  assert.equal(controller.renderDaySection(past), "");
  assert.match(controller.renderDaySection(today), /Today item/);
  assert.match(controller.renderDaySection(future), /Second item/);
  assert.doesNotMatch(rendered, /user_note|plan_prescription_id|owner_kind/);
  assert.ok(changeCount >= 3);

  const failureLoad = controller.load(
    { start: "2026-11-09", end: "2026-12-07" },
    { force: true },
  );
  requests[2].pending.reject(new Error("planned request failed"));
  await failureLoad;
  assert.equal(controller.getState().status, "error");
  assert.match(
    controller.renderDaySection("2026-11-18"),
    /Planned items unavailable\. Actual activities are still shown\./,
  );
}

function eventTarget({ card = null, manageButton = null, button = false, day = null } = {}) {
  return {
    closest(selector) {
      if (selector === ".plan-planned-card[data-plan-item-id]") return card;
      if (selector === '[data-plan-item-action="manage"]') return manageButton;
      if (selector === "button, input, select, textarea, a") return button ? manageButton : null;
      if (selector === "[data-plan-item-target]") return null;
      if (selector === "[data-plan-date]") return day;
      return null;
    },
  };
}

function createClassList() {
  const values = new Set();
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name),
  };
}

function makeEvent(target, extra = {}) {
  return {
    target,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.propagationStopped = true; },
    ...extra,
  };
}

async function testCardInteractionAndDragContracts() {
  const listeners = new Map();
  const today = denverDateOffset(0);
  const yesterday = denverDateOffset(-1);
  const tomorrow = denverDateOffset(1);
  const sourceCard = {
    dataset: { planItemId: "41", planItemManageable: "true" },
    classList: createClassList(),
  };
  const manageButton = {
    dataset: { planItemId: "41" },
    classList: createClassList(),
  };
  const oldCard = {
    dataset: { planItemId: "43", planItemManageable: "false" },
    classList: createClassList(),
  };
  const todayCard = {
    dataset: { planItemId: "42", planItemManageable: "true" },
    classList: createClassList(),
  };
  const days = [yesterday, today, tomorrow].map(planDate => ({
    dataset: { planDate },
    classList: createClassList(),
    contains: () => false,
  }));
  const strip = {
    dataset: {},
    addEventListener(type, listener) {
      const registrations = listeners.get(type) || [];
      registrations.push(listener);
      listeners.set(type, registrations);
    },
    querySelectorAll() {
      return [...days, sourceCard, todayCard, oldCard];
    },
  };
  const editorCalls = { open: [], dragStart: [], drop: [] };
  const context = {
    window: {
      escapeHtml: value => String(value ?? ""),
      api: { fetchPlanItems: async () => ({ items: [] }) },
      PlanItemEditor: {
        itemDragMime: "application/x-training-plan-item-id",
        open: (...args) => editorCalls.open.push(args),
        handleDragStart: (itemId, event) => {
          editorCalls.dragStart.push(itemId);
          event.dataTransfer.setData("application/x-training-plan-item-id", String(itemId));
          return true;
        },
        handleDrop: (...args) => editorCalls.drop.push(args),
      },
    },
    document: {
      getElementById: id => id === "planStrip" ? strip : null,
      querySelectorAll: () => [...days, sourceCard, todayCard, oldCard],
    },
  };
  vm.runInNewContext(itemSource, context);
  const controller = context.window.PlanItemsController;
  let changes = 0;
  controller.init({ onChange: () => { changes += 1; } });
  const listenerCount = Array.from(listeners.values()).reduce((sum, rows) => sum + rows.length, 0);
  controller.init({ onChange: () => { changes += 1; } });
  assert.equal(
    Array.from(listeners.values()).reduce((sum, rows) => sum + rows.length, 0),
    listenerCount,
    "repeated initialization must not duplicate delegated listeners",
  );
  controller.acceptCreatedItem({
    plan_item_id: 41,
    planned_date: tomorrow,
    item_state: "committed",
    prescription: { title: "Future ride" },
  });
  controller.acceptCreatedItem({
    plan_item_id: 42,
    planned_date: today,
    item_state: "committed",
    prescription: { title: "Today ride" },
  });
  const dispatch = (type, event) => {
    for (const listener of listeners.get(type) || []) listener(event);
  };

  const normalClick = makeEvent(eventTarget({ card: sourceCard }));
  dispatch("click", normalClick);
  assert.equal(editorCalls.open.length, 1);
  assert.equal(editorCalls.open[0][0].plan_item_id, 41);
  assert.equal(editorCalls.open[0][2], "edit");

  const ellipsisClick = makeEvent(eventTarget({ card: sourceCard, manageButton, button: true }));
  dispatch("click", ellipsisClick);
  assert.equal(editorCalls.open.length, 2);
  assert.equal(editorCalls.open[1][1], manageButton);
  assert.equal(ellipsisClick.propagationStopped, true);

  for (const key of ["Enter", " "]) {
    const keyEvent = makeEvent(eventTarget({ card: sourceCard }), { key });
    dispatch("keydown", keyEvent);
    assert.equal(keyEvent.defaultPrevented, true);
  }
  assert.equal(editorCalls.open.length, 4, "keyboard activation opens exactly once per key");
  dispatch("click", makeEvent(eventTarget({ card: oldCard })));
  assert.equal(editorCalls.open.length, 4, "past read-only cards do not open the editor");
  dispatch("click", makeEvent(eventTarget({ card: todayCard })));
  assert.equal(editorCalls.open.length, 5, "today's card opens the editor");
  assert.equal(editorCalls.open[4][0].plan_item_id, 42);

  let transferred = [];
  const dataTransfer = {
    types: ["application/x-training-plan-item-id"],
    setData(type, value) { transferred.push([type, value]); },
    getData() { return "41"; },
  };
  const changesBeforeDrag = changes;
  dispatch("dragstart", makeEvent(eventTarget({ card: sourceCard }), { dataTransfer }));
  assert.deepEqual(transferred, [["application/x-training-plan-item-id", "41"]]);
  assert.deepEqual(editorCalls.dragStart, ["41"]);
  assert.equal(changes, changesBeforeDrag, "dragstart does not rerender the source card");
  assert.equal(sourceCard.classList.contains("is-dragging"), true);
  assert.equal(days.find(day => day.dataset.planDate === tomorrow).classList.contains("is-item-drop-valid"), true);
  assert.equal(days.find(day => day.dataset.planDate === today).classList.contains("is-item-drop-valid"), false);
  assert.equal(days.find(day => day.dataset.planDate === yesterday).classList.contains("is-item-drop-valid"), false);

  const blockedDay = days.find(day => day.dataset.planDate === today);
  const blockedDragOver = makeEvent(eventTarget({ day: blockedDay }), { dataTransfer });
  dispatch("dragover", blockedDragOver);
  assert.equal(blockedDragOver.defaultPrevented, false);
  const dropDay = days.find(day => day.dataset.planDate === tomorrow);
  const allowedDragOver = makeEvent(eventTarget({ day: dropDay }), { dataTransfer });
  dispatch("dragover", allowedDragOver);
  assert.equal(allowedDragOver.defaultPrevented, true);
  assert.equal(dropDay.classList.contains("is-item-drop-hover"), true);
  const dropEvent = makeEvent(eventTarget({ day: dropDay }), { dataTransfer });
  dispatch("drop", dropEvent);
  assert.equal(editorCalls.drop.length, 1);
  assert.equal(dropEvent.defaultPrevented, true);

  dispatch("dragend", makeEvent(eventTarget({ card: sourceCard })));
  assert.equal(editorCalls.drop.length, 1, "dragend never submits a mutation");
  const postDragClick = makeEvent(eventTarget({ card: sourceCard }));
  dispatch("click", postDragClick);
  assert.equal(postDragClick.defaultPrevented, true);
  assert.equal(editorCalls.open.length, 5, "post-drag click is suppressed");
  dispatch("pointerdown", makeEvent(eventTarget({ card: sourceCard })));
  dispatch("click", makeEvent(eventTarget({ card: sourceCard })));
  assert.equal(editorCalls.open.length, 6, "a normal click works after the drag guard resets");

  let preventedMenuDrag = false;
  dispatch("dragstart", makeEvent(
    eventTarget({ card: sourceCard, manageButton, button: true }),
    { dataTransfer, preventDefault() { preventedMenuDrag = true; } },
  ));
  assert.equal(preventedMenuDrag, true);
  assert.equal(editorCalls.dragStart.length, 1, "ellipsis is not a drag source");

  const canceledTransfer = {
    types: ["application/x-training-plan-item-id"],
    setData() {},
    getData() { return "41"; },
  };
  dispatch("dragstart", makeEvent(eventTarget({ card: sourceCard }), { dataTransfer: canceledTransfer }));
  dispatch("dragend", makeEvent(eventTarget({ card: sourceCard })));
  dispatch("click", makeEvent(eventTarget({ card: sourceCard })));
  assert.equal(editorCalls.open.length, 6, "cancelled drag does not open the editor");
}

Promise.all([testApiWrapper(), testController(), testCardInteractionAndDragContracts()]).then(() => {
  console.log("Plan planned-items overlay contract tests passed.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
