const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const apiSource = fs.readFileSync("static/api.js", "utf8");
const optionsSource = fs.readFileSync("static/plan_options.js", "utf8");
const paneSource = fs.readFileSync("templates/partials/panes/plan_pane.html", "utf8");
const templateSource = fs.readFileSync("templates/index.html", "utf8");
const cssSource = fs.readFileSync("static/plan.css", "utf8");
const transientSource = fs.readFileSync("static/transient-surface.js", "utf8");

assert.match(apiSource, /fetchPlanPreferences\(\)[\s\S]*?\/api\/plan\/preferences/);
assert.match(apiSource, /updatePlanPreferences\(payload\)[\s\S]*?method: "PUT"/);
assert.match(paneSource, /id="planOptionsOpen"[\s\S]*?aria-expanded="false"/);
assert.match(paneSource, /id="planOptionsPopover"[\s\S]*?role="dialog"/);
assert.match(paneSource, /Hide past planned/);
assert.match(paneSource, /Reset view defaults/);
assert.doesNotMatch(
  paneSource,
  /Weather|Compliance|Weekly outlook|Card density|Check-ins|Planned only|Actual only/i,
);
assert.match(templateSource, /plan_options\.js\?v=\{\{ asset_version \}\}/);
assert.match(templateSource, /plan_options\.js[\s\S]*plan_items\.js[\s\S]*plan\.js/);
assert.match(cssSource, /\.plan-options-popover/);
assert.match(cssSource, /var\(--panel\)/);
assert.match(cssSource, /var\(--line\)/);
assert.match(cssSource, /\.plan-options-status\[data-state="error"\][\s\S]*var\(--red\)/);
assert.match(cssSource, /min-height: 44px/);
assert.match(optionsSource, /America\/Denver/);
assert.match(optionsSource, /getNextDenverMidnightEpoch/);
assert.doesNotMatch(optionsSource, /localStorage|document\.cookie/);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeElement(name, document) {
  const listeners = new Map();
  const attributes = new Map();
  const classes = new Set();
  return {
    name,
    ownerDocument: document,
    dataset: {},
    hidden: name === "popover",
    checked: true,
    disabled: false,
    tabIndex: 0,
    textContent: "",
    isConnected: true,
    getClientRects: () => [1],
    matches: selector => selector === "button",
    closest: () => null,
    contains: target => target === this || target?.inside === name,
    focus() {
      document.activeElement = this;
      this.focusCount = (this.focusCount || 0) + 1;
    },
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      callbacks.push(callback);
      listeners.set(type, callbacks);
    },
    dispatch(type, event = {}) {
      for (const callback of listeners.get(type) || []) {
        callback({ currentTarget: this, target: this, ...event });
      }
    },
    setAttribute(key, value) {
      attributes.set(key, value);
    },
    getAttribute(key) {
      return attributes.has(key) ? attributes.get(key) : null;
    },
    classList: {
      toggle(value, enabled) {
        if (enabled) classes.add(value);
        else classes.delete(value);
      },
      contains(value) {
        return classes.has(value);
      },
    },
  };
}

function createHarness({ initialPreference = null } = {}) {
  let now = Date.parse("2026-10-20T12:00:00Z");
  class ControlledDate extends Date {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }

    static now() {
      return now;
    }
  }
  const documentListeners = new Map();
  const document = {
    activeElement: null,
    addEventListener(type, callback) {
      const callbacks = documentListeners.get(type) || [];
      callbacks.push(callback);
      documentListeners.set(type, callbacks);
    },
    dispatch(type, event) {
      for (const callback of documentListeners.get(type) || []) callback(event);
    },
    getElementById(id) {
      return elements[id] || null;
    },
  };
  const elements = {
    planOptionsOpen: makeElement("trigger", document),
    planOptionsPopover: makeElement("popover", document),
    planHidePastPlanned: makeElement("toggle", document),
    planOptionsReset: makeElement("reset", document),
    planOptionsStatus: makeElement("status", document),
  };
  const gets = [];
  const puts = [];
  const timers = [];
  const window = {
    TrainingApp: {},
    addEventListener() {},
    clearTimeout(timer) {
      if (timer) timer.cancelled = true;
    },
    setTimeout(callback, delay) {
      const timer = { callback, delay, cancelled: false };
      timers.push(timer);
      return timer;
    },
    api: {
      fetchPlanPreferences() {
        if (gets.length === 0 && initialPreference) {
          const pending = deferred();
          gets.push(pending);
          pending.resolve(initialPreference);
          return pending.promise;
        }
        const pending = deferred();
        gets.push(pending);
        return pending.promise;
      },
      updatePlanPreferences(payload) {
        const pending = deferred();
        puts.push({ payload, pending });
        return pending.promise;
      },
    },
  };
  vm.runInNewContext(transientSource, { window, document, console });
  vm.runInNewContext(optionsSource, {
    window,
    document,
    Date: ControlledDate,
    Intl,
    Object,
    Promise,
    String,
    Math,
  });
  return {
    controller: window.PlanOptionsController,
    document,
    elements,
    gets,
    puts,
    timers,
    advance(milliseconds) {
      now += milliseconds;
    },
  };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function testPreferenceLifecycle() {
  const harness = createHarness();
  let changes = 0;
  assert.equal(harness.controller.getState().hidePastPlanned, true);
  assert.equal(harness.controller.init({ onChange: () => { changes += 1; } }), true);
  assert.equal(harness.controller.init(), true);
  assert.equal(harness.gets.length, 1, "initialization binds and loads only once");
  assert.equal(harness.controller.getState().hidePastPlanned, true);
  assert.equal(harness.elements.planOptionsOpen.getAttribute("aria-expanded"), "false");

  harness.gets[0].resolve({ hide_past_planned: false });
  await flush();
  assert.equal(harness.controller.getState().hidePastPlanned, false);
  assert.equal(harness.elements.planHidePastPlanned.checked, false);

  harness.elements.planOptionsOpen.dispatch("click");
  assert.equal(harness.controller.getState().open, true);
  assert.equal(harness.elements.planOptionsPopover.hidden, false);
  assert.equal(harness.elements.planOptionsOpen.getAttribute("aria-expanded"), "true");
  assert.equal(harness.document.activeElement, harness.elements.planHidePastPlanned);

  harness.document.dispatch("pointerdown", { target: { inside: "outside" } });
  assert.equal(harness.controller.getState().open, false);
  assert.equal(harness.elements.planOptionsPopover.hidden, true);
  assert.equal(harness.elements.planOptionsOpen.focusCount, 1);

  harness.elements.planOptionsOpen.dispatch("click");
  const escapeEvent = { key: "Escape", prevented: false, preventDefault() { this.prevented = true; } };
  harness.document.dispatch("keydown", escapeEvent);
  assert.equal(escapeEvent.prevented, true);
  assert.equal(harness.controller.getState().open, false);
  assert.equal(harness.elements.planOptionsOpen.focusCount, 2);

  harness.elements.planHidePastPlanned.checked = true;
  harness.elements.planHidePastPlanned.dispatch("change");
  assert.equal(harness.puts.length, 1);
  assert.equal(harness.puts[0].payload.hide_past_planned, true);
  assert.equal(harness.elements.planHidePastPlanned.disabled, true);
  harness.elements.planHidePastPlanned.checked = false;
  harness.elements.planHidePastPlanned.dispatch("change");
  assert.equal(harness.puts.length, 1, "additional updates are locked while saving");
  harness.puts[0].pending.resolve({ hide_past_planned: false });
  await flush();
  assert.equal(harness.controller.getState().hidePastPlanned, false);
  assert.equal(harness.elements.planHidePastPlanned.disabled, false);

  const resetPromise = harness.controller.resetViewDefaults();
  assert.equal(harness.puts.length, 2);
  assert.equal(harness.puts[1].payload.hide_past_planned, true);
  harness.puts[1].pending.resolve({ hide_past_planned: true });
  await resetPromise;
  assert.equal(harness.controller.getState().hidePastPlanned, true);
  assert.ok(changes >= 3);
}

async function testAuthoritativeFailureAndUnknownOutcome() {
  const harness = createHarness({ initialPreference: { hide_past_planned: false } });
  harness.controller.init();
  await flush();
  assert.equal(harness.controller.getState().hidePastPlanned, false);

  harness.elements.planHidePastPlanned.checked = true;
  harness.elements.planHidePastPlanned.dispatch("change");
  harness.puts[0].pending.resolve({ hide_past_planned: false });
  await flush();
  assert.equal(harness.controller.getState().hidePastPlanned, false);

  harness.elements.planHidePastPlanned.checked = true;
  harness.elements.planHidePastPlanned.dispatch("change");
  harness.puts[1].pending.reject(Object.assign(new Error("network failure"), { status: 503 }));
  await flush();
  assert.equal(harness.gets.length, 2, "an unknown PUT outcome performs one GET reconciliation");
  harness.gets[1].resolve({ hide_past_planned: true });
  await flush();
  assert.equal(harness.controller.getState().hidePastPlanned, true);
  assert.equal(harness.controller.getState().error, false);
}

async function testDefaultSurvivesInitialReadFailureAndDenverRolloverRefreshes() {
  const harness = createHarness();
  let changes = 0;
  harness.controller.init({ onChange: () => { changes += 1; } });
  assert.equal(harness.controller.getHidePastPlanned(), true);
  harness.gets[0].reject(new Error("unavailable"));
  await flush();
  assert.equal(harness.controller.getHidePastPlanned(), true);
  assert.equal(harness.controller.getState().error, true);

  const timer = harness.timers.find(entry => !entry.cancelled);
  assert.ok(timer && timer.delay > 0);
  const before = changes;
  harness.advance(timer.delay);
  timer.callback();
  assert.equal(changes, before + 1, "Denver day boundary rerenders the calendar");
}

Promise.all([
  testPreferenceLifecycle(),
  testAuthoritativeFailureAndUnknownOutcome(),
  testDefaultSurvivesInitialReadFailureAndDenverRolloverRefreshes(),
]).then(() => {
  console.log("Plan Options tests passed.");
}).catch(error => {
  console.error(error);
  process.exitCode = 1;
});
