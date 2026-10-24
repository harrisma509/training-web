const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const activityPresentation = require("../static/activity-presentation.js");

const apiSource = fs.readFileSync("static/api.js", "utf8");
const editorSource = fs.readFileSync("static/plan_item_editor.js", "utf8");
const itemsSource = fs.readFileSync("static/plan_items.js", "utf8");
const planSource = fs.readFileSync("static/plan.js", "utf8");
const paneSource = fs.readFileSync("templates/partials/panes/plan_pane.html", "utf8");
const cssSource = fs.readFileSync("static/plan.css", "utf8");

assert.match(apiSource, /async updatePlanItem\(planItemId, payload\)/);
assert.match(apiSource, /method: "PUT"/);
assert.match(apiSource, /async cancelPlanItem\(planItemId\)/);
assert.match(apiSource, /\/cancel/);
assert.match(editorSource, /application\/x-training-plan-item-id/);
assert.match(editorSource, /outcome is unknown\. Review the calendar before retrying/);
assert.match(editorSource, /Segments JSON/);
assert.match(editorSource, /Delete from plan/);
assert.doesNotMatch(editorSource, /Cancel planned item/);
assert.match(editorSource, /Delete \$\{title\} from the plan for \$\{date\}/);
assert.match(editorSource, /This removes the item from the active Plan calendar\./);
assert.match(editorSource, /data-plan-item-target/);
assert.match(editorSource, />\+ Move here<\/button>/);
assert.match(editorSource, /plan-item-editor-primary-actions/);
assert.match(editorSource, /plan-item-editor-delete/);
assert.match(editorSource, /startQuickMove/);
assert.match(editorSource, /isQuickMoveDestination/);
assert.match(editorSource, /cancelFromQuickAction/);
assert.match(editorSource, /Moving .* choose a future day/);
assert.match(editorSource, /window\.api\.updatePlanItem\(/);
assert.match(editorSource, /window\.PlanItemsController\?\.replaceItem\?\.\(updated\)/);
assert.match(itemsSource, /replaceItem\(item\)/);
assert.match(itemsSource, /removeItem\(planItemId\)/);
assert.match(itemsSource, /data-plan-item-action="manage"/);
assert.doesNotMatch(itemsSource, /data-plan-item-action="(?:edit|move|drag-move)"/);
assert.match(planSource, /PlanItemsController\?\.init\?\.\(\{ onChange: renderPlanStrip \}\)/);
assert.match(itemsSource, /PlanItemEditor\?\.handleDragStart/);
assert.match(itemsSource, /PlanItemEditor\?\.handleDrop/);
assert.doesNotMatch(planSource, /setupPlanItemHandlers/);
assert.match(paneSource, /id="planItemEditor"/);
assert.match(cssSource, /\.plan-item-editor/);
assert.match(cssSource, /\.plan-day\.is-item-drop-valid/);
assert.match(cssSource, /\.plan-planned-card\[data-plan-item-manageable="true"\]:focus-visible/);
assert.match(cssSource, /@media \(max-width: 700px\)[\s\S]*\.plan-item-editor/);

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

function createHarness() {
  const today = denverDateOffset(0);
  const sourceDate = denverDateOffset(4);
  const targetDate = denverDateOffset(2);
  const focus = { panel: 0, dateJump: 0, card: 0, cancel: 0, status: 0 };
  const formValues = {
    planned_date: sourceDate,
    sort_order: "3",
    category_id: "7",
    user_note: "  Keep the note  ",
    title: "  Sunday tempo  ",
    description: " Workout details ",
    sport_type: " Road ride ",
    activity_category: " Endurance ",
    trainer: "",
    target_duration_min: "75",
    target_load: "42",
    target_load_source: " estimate ",
    target_distance_mi: "18.5",
    target_elevation_ft: "800",
    instruction_text: " Finish steady ",
    segments: "[]",
  };
  const form = {
    elements: {
      namedItem: name => ({
        value: formValues[name] ?? "",
        dataset: name === "sport_type" && formValues[name] === "Physical Therapy"
          ? { canonicalValue: "PhysicalTherapy", presentationLabel: "Physical Therapy" }
          : {},
      }),
    },
  };
  const status = {};
  const actionStatus = {
    hidden: true,
    focus() { focus.status += 1; },
  };
  const actionStatusText = { textContent: "" };
  const moveCancelButton = {
    hidden: true,
    disabled: false,
    listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    focus() { focus.cancel += 1; },
  };
  const actionStatusDismiss = {
    hidden: true,
    addEventListener(type, listener) { this.listener = listener; },
  };
  const listeners = new Map();
  const documentListeners = new Map();
  const panel = {
    hidden: true,
    innerHTML: "",
    classList: { toggle() {} },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    querySelector(selector) {
      if (selector === "#planItemEditorForm") return form;
      if (selector === ".plan-item-editor-status") return status;
      if (selector === "input, select, textarea, button") {
        return { focus() { focus.panel += 1; } };
      }
      return null;
    },
  };
  const dateJump = { focus() { focus.dateJump += 1; } };
  const opener = {
    dataset: { planItemId: "31" },
    isConnected: true,
    focus() { focus.card += 1; },
  };
  const item = {
    plan_item_id: 31,
    planned_date: sourceDate,
    sort_order: 3,
    item_state: "committed",
    user_note: "Keep the note",
    category: { plan_category_id: 7, category_name: "Endurance" },
    prescription: {
      title: "Sunday tempo",
      description: "Workout details",
      sport_type: "Road ride",
      activity_category: "Endurance",
      trainer: null,
      target_duration_min: 75,
      target_load: 42,
      target_load_source: "estimate",
      target_distance_mi: 18.5,
      target_elevation_ft: 800,
      instruction_text: "Finish steady",
      segments: [{ segment_order: 1, segment_name: "Tempo" }],
    },
  };
  const movedCard = {
    dataset: { planItemId: "31" },
    focus() { focus.card += 1; },
  };
  let items = [item];
  let cards = [opener];
  const calls = { updates: [], cancels: [], removed: [], confirms: [], renders: 0 };
  const dateTransfer = {
    types: ["application/x-training-plan-item-id"],
    values: new Map(),
    effectAllowed: "",
    setData(type, value) { this.values.set(type, value); },
    getData(type) { return this.values.get(type) || ""; },
  };
  const document = {
    getElementById(id) {
      if (id === "planItemEditor") return panel;
      if (id === "planDateJump") return dateJump;
      if (id === "planItemActionStatus") return actionStatus;
      if (id === "planItemActionStatusText") return actionStatusText;
      if (id === "planItemMoveCancel") return moveCancelButton;
      if (id === "planItemActionStatusDismiss") return actionStatusDismiss;
      return null;
    },
    querySelectorAll() { return cards; },
    addEventListener(type, listener) { documentListeners.set(type, listener); },
  };
  const context = {
    document,
    window: {
      ActivityPresentation: activityPresentation,
      confirm: message => {
        calls.confirms.push(message);
        return calls.confirmResult === true;
      },
      api: {
        fetchPlanCategories: async () => ({
          categories: [{ plan_category_id: 7, category_name: "Endurance" }],
        }),
        updatePlanItem: async (id, payload) => {
          calls.updates.push({ id, payload });
          return { ...item, planned_date: payload.planned_date };
        },
        cancelPlanItem: async id => {
          calls.cancels.push(id);
        },
      },
      PlanItemsController: {
        getState: () => ({ items }),
        replaceItem: updated => {
          items = [updated];
          opener.isConnected = false;
          cards = [movedCard];
          return true;
        },
        removeItem: id => {
          calls.removed.push(id);
          items = items.filter(row => row.plan_item_id !== id);
          opener.isConnected = false;
          cards = [];
          return true;
        },
      },
      PlanController: { render: () => { calls.renders += 1; } },
    },
  };
  vm.runInNewContext(editorSource, context);
  context.window.PlanItemEditor.bind();
  return {
    actionStatus,
    actionStatusDismiss,
    actionStatusText,
    calls,
    context,
    dateJump,
    documentListeners,
    dateTransfer,
    focus,
    formValues,
    item,
    listeners,
    moveCancelButton,
    opener,
    panel,
    sourceDate,
    targetDate,
    today,
  };
}

async function testFullCardDragUsesOneAuthoritativePut() {
  const harness = createHarness();
  const editor = harness.context.window.PlanItemEditor;
  let prevented = false;
  assert.equal(editor.getState().mode, "idle");
  assert.equal(editor.handleDragStart("31", {
    dataTransfer: harness.dateTransfer,
  }), true);
  assert.deepEqual(
    Array.from(harness.dateTransfer.values.keys()),
    ["application/x-training-plan-item-id"],
  );
  assert.equal(harness.dateTransfer.effectAllowed, "move");
  assert.equal(harness.panel.innerHTML, "", "dragstart does not open or rerender the editor");
  assert.equal(editor.getState().mode, "idle");

  const result = await editor.handleDrop(harness.targetDate, {
    dataTransfer: harness.dateTransfer,
    preventDefault() { prevented = true; },
  });
  assert.equal(result, true);
  assert.equal(prevented, true);
  assert.equal(harness.calls.updates.length, 1);
  assert.equal(harness.calls.updates[0].id, 31);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls.updates[0].payload)), {
    planned_date: harness.targetDate,
    sort_order: 3,
    category_id: 7,
    user_note: "Keep the note",
    prescription: {
      title: "Sunday tempo",
      description: "Workout details",
      sport_type: "Road ride",
      activity_category: "Endurance",
      trainer: null,
      target_duration_min: 75,
      target_load: 42,
      target_load_source: "estimate",
      target_distance_mi: 18.5,
      target_elevation_ft: 800,
      instruction_text: "Finish steady",
    },
    segments: [{ segment_order: 1, segment_name: "Tempo" }],
  });
  assert.equal(harness.context.window.PlanItemsController.getState().items[0].planned_date, harness.targetDate);
  assert.equal(harness.focus.card, 1, "focus follows the authoritative item to its new date");
  assert.equal(harness.calls.cancels.length, 0);

  const todayHarness = createHarness();
  todayHarness.item.planned_date = todayHarness.today;
  const todayEditor = todayHarness.context.window.PlanItemEditor;
  assert.equal(todayEditor.handleDragStart("31", {
    dataTransfer: todayHarness.dateTransfer,
  }), true, "today's committed item remains draggable");
  assert.equal(await todayEditor.handleDrop(todayHarness.today, {
    dataTransfer: todayHarness.dateTransfer,
    preventDefault() {},
  }), false, "today cannot be a move destination");
  assert.equal(await todayEditor.handleDrop(todayHarness.targetDate, {
    dataTransfer: todayHarness.dateTransfer,
    preventDefault() {},
  }), true, "today's item can move to a future date");
  assert.equal(todayHarness.calls.updates[0].payload.planned_date, todayHarness.targetDate);
  todayHarness.context.window.PlanItemsController.getState().items[0].planned_date =
    denverDateOffset(-1);
  assert.equal(todayEditor.handleDragStart("31", {
    dataTransfer: todayHarness.dateTransfer,
  }), false, "past items cannot be dragged");
}

async function testDeleteFromPlanConfirmationAndReadOnlyDates() {
  const harness = createHarness();
  const editor = harness.context.window.PlanItemEditor;
  const todayItem = { ...harness.item, planned_date: harness.today };
  const pastItem = { ...harness.item, planned_date: denverDateOffset(-1) };
  assert.equal(editor.open(todayItem, harness.opener, "edit", false), true);
  assert.equal(editor.open(pastItem, harness.opener, "edit", false), false);
  assert.equal(harness.panel.hidden, false);
  await Promise.resolve();
  assert.match(harness.panel.innerHTML, /Save changes/);
  assert.match(harness.panel.innerHTML, />Move<\/button>/);
  assert.match(harness.panel.innerHTML, />Delete from plan<\/button>/);
  assert.doesNotMatch(harness.panel.innerHTML, /Cancel planned item/);

  harness.formValues.planned_date = harness.today;
  const submit = harness.listeners.get("submit");
  submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.updates.length, 1, "saving today's existing date is accepted");
  assert.equal(harness.calls.updates[0].payload.planned_date, harness.today);

  assert.equal(editor.open(todayItem, harness.opener, "edit", false), true);
  await Promise.resolve();
  const click = harness.listeners.get("click");
  const cancelAction = {
    closest: selector => selector === "[data-plan-item-editor-action]"
      ? { dataset: { planItemEditorAction: "cancel" } }
      : null,
  };
  harness.calls.confirmResult = false;
  click({ target: cancelAction });
  assert.equal(harness.calls.cancels.length, 0, "dismissing confirmation sends no request");
  assert.equal(harness.calls.removed.length, 0);

  harness.calls.confirmResult = true;
  click({ target: cancelAction });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.cancels.length, 1);
  assert.deepEqual(harness.calls.cancels, [31]);
  assert.deepEqual(harness.calls.removed, [31]);
  assert.equal(editor.getState().mode, "idle");
  assert.equal(harness.focus.dateJump, 1, "deletion restores focus to the stable calendar date control");
  assert.match(
    harness.calls.confirms[1],
    /^Delete Sunday tempo from the plan for .+\?\nThis removes the item from the active Plan calendar\.$/,
  );
}

async function testTodayMoveTargetsMustBeFuture() {
  const harness = createHarness();
  harness.item.planned_date = harness.today;
  const editor = harness.context.window.PlanItemEditor;
  assert.equal(editor.open(harness.item, harness.opener, "moving", false), true);
  assert.equal(editor.handleTarget(harness.today), false);
  assert.equal(editor.handleTarget(harness.targetDate), true);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.updates.length, 1);
  assert.equal(harness.calls.updates[0].payload.planned_date, harness.targetDate);
}

async function testQuickMoveLifecycleAndFailure() {
  const harness = createHarness();
  const editor = harness.context.window.PlanItemEditor;
  assert.equal(editor.startQuickMove(harness.item, harness.opener), true);
  assert.equal(editor.isQuickMoveMode(), true);
  assert.equal(harness.panel.hidden, true, "quick move does not open the full editor");
  assert.equal(harness.moveCancelButton.hidden, false);
  assert.equal(harness.focus.cancel, 1, "focus moves to the visible Cancel control");
  assert.equal(harness.actionStatus.hidden, false);
  assert.match(harness.actionStatusText.textContent, /choose a future day/);
  assert.equal(editor.isQuickMoveDestination(denverDateOffset(-1)), false);
  assert.equal(editor.isQuickMoveDestination(harness.today), false);
  assert.equal(editor.isQuickMoveDestination(harness.sourceDate), false);
  assert.equal(editor.isQuickMoveDestination(harness.targetDate), true);
  const escapeEvent = {
    key: "Escape",
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
  };
  harness.documentListeners.get("keydown")(escapeEvent);
  assert.equal(escapeEvent.defaultPrevented, true);
  assert.equal(editor.isQuickMoveMode(), false);
  assert.equal(harness.focus.card, 1, "cancel returns focus to the menu trigger");
  assert.equal(harness.calls.updates.length, 0, "cancel does not mutate the planned item");

  assert.equal(editor.startQuickMove(harness.item, harness.opener), true);
  harness.moveCancelButton.listeners.get("click")();
  assert.equal(editor.isQuickMoveMode(), false, "the persistent Cancel control exits move mode");
  assert.equal(harness.focus.card, 2);

  assert.equal(editor.startQuickMove(harness.item, harness.opener), true);
  assert.equal(await editor.handleQuickMoveTarget(harness.targetDate), true);
  assert.equal(harness.calls.updates.length, 1, "one destination click sends one update");
  assert.equal(harness.calls.updates[0].payload.planned_date, harness.targetDate);
  assert.equal(editor.isQuickMoveMode(), false);
  assert.equal(harness.actionStatus.hidden, true);
  assert.equal(harness.focus.card, 3, "success focuses the moved card after rerender");

  const failureHarness = createHarness();
  const failureEditor = failureHarness.context.window.PlanItemEditor;
  failureHarness.context.window.api.updatePlanItem = async () => {
    const error = new Error("Move rejected");
    error.status = 409;
    error.detail = "The item can no longer be moved.";
    throw error;
  };
  assert.equal(failureEditor.startQuickMove(failureHarness.item, failureHarness.opener), true);
  assert.equal(await failureEditor.handleQuickMoveTarget(failureHarness.targetDate), false);
  assert.equal(failureEditor.isQuickMoveMode(), false);
  assert.equal(failureHarness.actionStatus.hidden, false);
  assert.match(failureHarness.actionStatusText.textContent, /can no longer be moved/);
  assert.equal(failureHarness.focus.status, 1, "failure notice receives focus");
  assert.equal(failureHarness.context.window.PlanItemEditor.getState().saving, false);
  failureHarness.actionStatusDismiss.listener();
  assert.equal(failureHarness.actionStatus.hidden, true);
  assert.equal(failureHarness.focus.dateJump, 1, "dismissing the notice focuses a stable control");

  const refreshFailureHarness = createHarness();
  refreshFailureHarness.context.window.api.updatePlanItem = async () => {
    throw new Error("Connection lost");
  };
  refreshFailureHarness.context.window.PlanController.refresh = async () => {
    throw new Error("Refresh unavailable");
  };
  const refreshFailureEditor = refreshFailureHarness.context.window.PlanItemEditor;
  assert.equal(
    refreshFailureEditor.startQuickMove(refreshFailureHarness.item, refreshFailureHarness.opener),
    true,
  );
  assert.equal(
    await refreshFailureEditor.handleQuickMoveTarget(refreshFailureHarness.targetDate),
    false,
  );
  assert.equal(refreshFailureEditor.isQuickMoveMode(), false);
  assert.match(refreshFailureHarness.actionStatusText.textContent, /Refresh failed/);
  assert.equal(refreshFailureEditor.getState().saving, false);
}

async function testQuickDeleteConfirmationAndMutation() {
  const harness = createHarness();
  const editor = harness.context.window.PlanItemEditor;
  harness.calls.confirmResult = false;
  assert.equal(await editor.cancelFromQuickAction(harness.item, harness.opener), false);
  assert.equal(harness.calls.cancels.length, 0);
  assert.equal(harness.calls.removed.length, 0);

  harness.calls.confirmResult = true;
  assert.equal(await editor.cancelFromQuickAction(harness.item, harness.opener), true);
  assert.deepEqual(harness.calls.cancels, [31]);
  assert.deepEqual(harness.calls.removed, [31]);
  assert.equal(harness.focus.dateJump, 1);
}

async function testPhysicalTherapyEditorLabelPreservesCanonicalToken() {
  const harness = createHarness();
  harness.item.prescription.sport_type = "PhysicalTherapy";
  harness.formValues.sport_type = "Physical Therapy";
  const editor = harness.context.window.PlanItemEditor;
  assert.equal(editor.open(harness.item, harness.opener, "edit", false), true);
  assert.match(harness.panel.innerHTML, /value="Physical Therapy"/);
  assert.match(
    harness.panel.innerHTML,
    /data-canonical-value="PhysicalTherapy" data-presentation-label="Physical Therapy"/,
  );
  assert.doesNotMatch(harness.panel.innerHTML, /name="sport_type"[^>]*\svalue="PhysicalTherapy"/);

  harness.listeners.get("submit")({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.calls.updates.length, 1);
  assert.equal(harness.calls.updates[0].payload.prescription.sport_type, "PhysicalTherapy");
}

Promise.all([
  testFullCardDragUsesOneAuthoritativePut(),
  testDeleteFromPlanConfirmationAndReadOnlyDates(),
  testTodayMoveTargetsMustBeFuture(),
  testQuickMoveLifecycleAndFailure(),
  testQuickDeleteConfirmationAndMutation(),
  testPhysicalTherapyEditorLabelPreservesCanonicalToken(),
]).then(() => {
  console.log("Plan item editor contract tests passed.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
